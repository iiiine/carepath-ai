# safety_llm_net.py
#
# AI 安全網：讓 Gemini 獨立判斷一次緊急程度，只能把規則的結果「往上調」。
#
# 為什麼需要：
#   規則引擎 100% 可重現，但只認得規則表寫到的症狀。
#   Robin 案例集（S001-S200）評測中，規則漏掉的 39 筆判太輕，
#   多數是規則表沒涵蓋的急症；同一批案例直接問 LLM 的判太輕只有 9 筆。
#   反過來，LLM 會把「症狀已恢復的中風前兆」降級、同一句話答案會變，
#   這些正是規則能擋住的。兩者取較嚴重者，各自的弱點互補。
#
# 不變的原則：
#   - 規則引擎仍是安全評估的主體，安全網只能升級、絕不降級
#   - 安全網失敗（逾時、配額、格式錯誤）時維持規則結果，
#     不會因為安全網而變成 unknown —— 規則評估本身是完整的，
#     這時的結果與沒有安全網的版本完全相同
#   - 每次升級都記錄來源、理由與版本，可稽核
#
# 純函式模組：不碰資料庫、不依賴 FastAPI。

import json
import time
from typing import Any, Dict, Literal, Optional, Sequence

from google.genai import types
from google.genai.errors import APIError
from pydantic import BaseModel

from services import client, GEMINI_MODEL_NAME


SAFETY_NET_VERSION = "2026.10.1"


# ============================================================
# Prompt
#
# 與評測對照組（eval/eval_safety.py 的 llm_only）是同一份文字，
# 評測直接 import 這裡 —— 改這段等於改了被量測的東西，要重跑評測。
#
# 等級定義刻意寫成與 safety_pipeline.RISK_LABELS 相同的語意。
# ============================================================

class SafetyNetSchema(BaseModel):

    risk_level: Literal[
        "standard",
        "urgent",
        "emergency",
    ]

    reason: str


SAFETY_NET_PROMPT = """
你是一位健康諮詢助理。請根據使用者的描述，判斷就醫的緊急程度，
只能從以下三個等級中選擇一個：

- emergency：可能危及生命，應立即撥打 119 或前往急診
- urgent：需要儘快（當天內）接受醫療評估
- standard：可以安排一般門診，或先在家觀察

並用一句話說明理由。

{history_block}使用者的描述：
「{text}」
"""


def build_safety_net_prompt(
    symptom_text: str,
    history: Optional[Sequence[Any]] = None,
) -> str:
    """
    history 只取使用者說過的話。

    AI 先前的追問與回覆不送：那是模型自己的輸出，
    送回去會讓安全網受上一輪一般問診的說法影響。
    """

    user_turns = [
        getattr(msg, "content", "")
        for msg in (history or [])
        if getattr(msg, "role", "user") == "user"
        and getattr(msg, "content", "")
    ]

    history_block = (
        "使用者先前說過：\n"
        + "\n".join(f"- {content}" for content in user_turns)
        + "\n\n"
        if user_turns
        else ""
    )

    return SAFETY_NET_PROMPT.format(
        history_block=history_block,
        text=symptom_text,
    )


# ============================================================
# Gemini call
# ============================================================

def run_safety_net(
    symptom_text: str,
    history: Optional[Sequence[Any]] = None,
    temperature: Optional[float] = 0,
    max_retries: int = 3,
) -> Dict[str, Any]:
    """
    回傳 {"risk_level", "reason"}；失敗時拋例外，由呼叫端決定怎麼處理。

    正式流程固定 temperature = 0（與抽取器一致，盡量可重現）；
    評測對照組傳 None，模擬一般人直接問 AI 的情況。
    """

    if not client:
        raise RuntimeError("Gemini client 尚未初始化")

    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=SafetyNetSchema,
        temperature=temperature,
    )

    prompt = build_safety_net_prompt(
        symptom_text,
        history,
    )

    delay = 1.5

    for attempt in range(max_retries):

        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL_NAME,
                contents=prompt,
                config=config,
            )

            parsed = response.parsed or SafetyNetSchema.model_validate(
                json.loads(response.text)
            )

            return {
                "risk_level": parsed.risk_level,
                "reason": parsed.reason,
            }

        except APIError as exc:

            if (
                getattr(exc, "code", None) in {429, 500, 502, 503, 504}
                and attempt < max_retries - 1
            ):
                time.sleep(delay)
                delay *= 2
                continue

            raise

    raise RuntimeError("AI 安全網超過最大重試次數")


# ============================================================
# 升級判斷
#
# 純函式，不呼叫模型；safety_pipeline 與 smoke test 共用。
# ============================================================

RISK_PRIORITY = {
    "standard": 0,
    "urgent": 1,
    "emergency": 2,
}

SAFETY_NET_RULE_CODE = "AI_SAFETY_NET"


def should_escalate(
    rule_risk_level: str,
    net_risk_level: Optional[str],
) -> bool:
    """
    只有安全網比規則嚴重時才升級。

    規則結果不在三級之內（理論上不會發生）時不動它：
    這裡只負責「往上補」，不負責修正規則層的輸出。
    """

    if net_risk_level not in RISK_PRIORITY:
        return False

    if rule_risk_level not in RISK_PRIORITY:
        return False

    return RISK_PRIORITY[net_risk_level] > RISK_PRIORITY[rule_risk_level]


def escalation_flag(
    net_risk_level: str,
    net_reason: str,
) -> Dict[str, str]:
    """升級時加進 red_flags 的那一筆，讓稽核面板與跨輪紀錄看得到來源。"""

    return {
        "code": SAFETY_NET_RULE_CODE,
        "risk_level": net_risk_level,
        "title": "AI 安全網提高風險等級",
        "reason": (
            "安全規則的判斷較輕，但 AI 獨立判斷認為需要提高警覺："
            + (net_reason or "（未提供理由）")
        ),
    }


# ============================================================
# Built-in smoke test（純邏輯，不呼叫 Gemini）
# ============================================================

if __name__ == "__main__":

    assert should_escalate("standard", "urgent")
    assert should_escalate("urgent", "emergency")
    assert should_escalate("standard", "emergency")

    # 只升不降
    assert not should_escalate("emergency", "urgent")
    assert not should_escalate("urgent", "standard")
    assert not should_escalate("urgent", "urgent")

    # 安全網沒有結果或結果無法辨識：不動規則結果
    assert not should_escalate("standard", None)
    assert not should_escalate("standard", "unknown")
    assert not should_escalate("standard", "緊急")

    flag = escalation_flag("emergency", "突然單眼看不見")
    assert flag["code"] == SAFETY_NET_RULE_CODE
    assert flag["risk_level"] == "emergency"
    assert "突然單眼看不見" in flag["reason"]

    # history 只取使用者的話
    class _Msg:
        def __init__(self, role, content):
            self.role = role
            self.content = content

    prompt = build_safety_net_prompt(
        "現在頭很痛",
        [_Msg("user", "發燒兩天"), _Msg("model", "請問有頸部僵硬嗎？")],
    )
    assert "發燒兩天" in prompt
    assert "頸部僵硬" not in prompt

    print("✅ Safety net smoke test finished")
