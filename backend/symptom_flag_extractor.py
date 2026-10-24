

import json
import time
from typing import Any, Dict, List, Literal, Optional, Sequence

from google.genai import types
from google.genai.errors import APIError
from pydantic import BaseModel, Field

from services import client, GEMINI_MODEL_NAME


# ============================================================
# Extractor Version
# ============================================================

SYMPTOM_EXTRACTOR_VERSION = "2026.10.1"  # 2026.10.1：被動的死亡意念視為 self_harm_thoughts


# ============================================================
# 三態症狀狀態
#
# present = 明確存在
# absent  = 明確否認
# unknown = 沒有足夠資訊
# ============================================================

FlagState = Literal[
    "present",
    "absent",
    "unknown",
]


# ============================================================
# Gemini Structured Output Schema
#
# 這些欄位必須與 safety_engine.py 使用的 flag key 對應。
# ============================================================

class SymptomFlagsSchema(BaseModel):

    # --------------------------------------------------------
    # Neurological
    # --------------------------------------------------------

    facial_droop: FlagState = "unknown"

    one_sided_weakness: FlagState = "unknown"

    new_speech_difficulty: FlagState = "unknown"

    # 曾經出現急性神經學異常，
    # 但目前症狀已經恢復。
    #
    # 例如：
    # 「剛剛右手突然沒力，現在恢復了」
    # 「剛才講話含糊，現在正常了」
    #
    # 這個 flag 用來保留：
    # 「曾經發生過高風險神經事件」
    #
    # 避免因為目前症狀消失，
    # 就被錯誤降成一般 standard。
    recent_resolved_neurologic_deficit: FlagState = "unknown"

    unresponsive: FlagState = "unknown"

    severe_altered_consciousness: FlagState = "unknown"

    seizure_over_5_minutes: FlagState = "unknown"

    repeated_seizures_without_recovery: FlagState = "unknown"

    stiff_neck: FlagState = "unknown"


    # --------------------------------------------------------
    # Cardiopulmonary
    # --------------------------------------------------------

    chest_pain: FlagState = "unknown"

    shortness_of_breath: FlagState = "unknown"

    severe_shortness_of_breath: FlagState = "unknown"

    unable_to_speak_full_sentences: FlagState = "unknown"

    cyanosis: FlagState = "unknown"

    fainting: FlagState = "unknown"

    cold_sweat: FlagState = "unknown"


    # --------------------------------------------------------
    # Allergy / Airway
    # --------------------------------------------------------

    throat_swelling: FlagState = "unknown"

    tongue_swelling: FlagState = "unknown"

    severe_allergic_reaction: FlagState = "unknown"


    # --------------------------------------------------------
    # Bleeding
    # --------------------------------------------------------

    severe_bleeding: FlagState = "unknown"

    uncontrolled_bleeding: FlagState = "unknown"

    vomiting_blood: FlagState = "unknown"

    bloody_stool: FlagState = "unknown"

    black_stool: FlagState = "unknown"


    # --------------------------------------------------------
    # Trauma
    # --------------------------------------------------------

    head_injury: FlagState = "unknown"

    loss_of_consciousness: FlagState = "unknown"

    taking_anticoagulants: FlagState = "unknown"


    # --------------------------------------------------------
    # Pregnancy
    # --------------------------------------------------------

    pregnant: FlagState = "unknown"

    heavy_vaginal_bleeding: FlagState = "unknown"

    vaginal_bleeding: FlagState = "unknown"

    severe_abdominal_pain: FlagState = "unknown"


    # --------------------------------------------------------
    # Mental health / Harm safety
    #
    # thoughts:
    #   有傷害自己 / 他人的想法、衝動或念頭，
    #   但不代表已有明確計畫。
    #
    # intent_or_plan:
    #   已表達要做、打算做、已想好方法，
    #   或已準備手段。
    #
    # imminent:
    #   描述現在 / 馬上 / 即將行動，
    #   或手段已在身邊且準備執行。
    # --------------------------------------------------------

    self_harm_thoughts: FlagState = "unknown"

    harm_others_thoughts: FlagState = "unknown"

    self_harm_intent_or_plan: FlagState = "unknown"

    harm_others_intent_or_plan: FlagState = "unknown"

    imminent_self_harm: FlagState = "unknown"

    imminent_harm_to_others: FlagState = "unknown"


    # --------------------------------------------------------
    # General
    # --------------------------------------------------------

    fever: FlagState = "unknown"

    persistent_vomiting: FlagState = "unknown"


class SymptomExtractionSchema(BaseModel):

    flags: SymptomFlagsSchema

    evidence: List[str] = Field(
        default_factory=list
    )

    ambiguous_information: List[str] = Field(
        default_factory=list
    )


# ============================================================
# History formatter
#
# 不直接依賴 ChatMessage class，
# 讓這個 module 保持低耦合。
# ============================================================

def _history_to_text(
    history: Optional[Sequence[Any]],
) -> str:

    if not history:
        return "無過往對話"

    lines: List[str] = []

    for item in history:

        role = None
        content = None

        # Pydantic model / class
        if hasattr(
            item,
            "role",
        ):
            role = getattr(
                item,
                "role",
                None,
            )

            content = getattr(
                item,
                "content",
                None,
            )

        # dict
        elif isinstance(
            item,
            dict,
        ):
            role = item.get(
                "role"
            )

            content = item.get(
                "content"
            )

        if not content:
            continue

        role_label = (
            "使用者"
            if role == "user"
            else "AI"
        )

        lines.append(
            f"{role_label}: {content}"
        )

    if not lines:
        return "無過往對話"

    return "\n".join(
        lines
    )


# ============================================================
# Prompt
# ============================================================

def build_symptom_flag_prompt(
    symptom_text: str,
    history: Optional[Sequence[Any]] = None,
) -> str:

    history_text = (
        _history_to_text(
            history
        )
    )

    return f"""
你是醫療問診系統中的「症狀結構化抽取器」。

你的工作不是診斷疾病，也不是提供治療建議。

你的唯一任務是：

根據使用者目前提供的自然語言，
以及過往問診對話，
判斷指定的安全症狀旗標是：

present
absent
unknown

============================================================
【非常重要的判定原則】
============================================================

1. present

只有在使用者明確表示存在該症狀，
或語意非常明確等價時，
才能標記 present。

例如：

「我胸口很痛」
→ chest_pain = present

「右手突然完全沒力」
→ one_sided_weakness = present


2. absent

只有在使用者明確否認該症狀時，
才能標記 absent。

例如：

「沒有胸痛」
→ chest_pain = absent

「沒有喘」
→ shortness_of_breath = absent


3. unknown

如果使用者沒有提到，
資訊不足，
描述模糊，
或無法可靠確定，

一律標記 unknown。

重要：

「使用者沒有提到」
絕對不能自動視為 absent。


4. 禁止自行補充

不得因為某個疾病常見某症狀，
就自行推論該症狀存在。

例如：

使用者說：
「我頭痛」

不能因此自行標記：

fever = present
stiff_neck = present
one_sided_weakness = present


5. 時序

目前症狀狀態與「近期曾經發生但已恢復的神經學事件」
必須分開判斷。

如果使用者是在描述過去曾經有症狀，
但明確表示目前已不存在：

目前症狀旗標應依現在狀態判斷。

例如：

「剛剛右手沒力，現在恢復正常了」

應判斷：

one_sided_weakness = absent

但是，如果過往對話或最新描述明確顯示：

曾經突然出現以下任何急性局部神經學異常：

- 單側臉部歪斜或無力
- 單側手腳突然無力
- 新發說話含糊
- 突然說不出話
- 突然無法正常理解語言

而現在這些症狀已經恢復或消失，

則必須同時標記：

recent_resolved_neurologic_deficit = present

例如：

「我剛剛右手突然沒力，
但現在已經恢復正常。」

應判斷：

one_sided_weakness = absent
recent_resolved_neurologic_deficit = present


例如：

過往對話：

使用者：
「我剛剛突然右邊手腳沒力，
而且講話含糊不清。」

最新描述：

「現在手腳已經恢復力氣了，
講話也正常了。」

應判斷：

one_sided_weakness = absent

new_speech_difficulty = absent

recent_resolved_neurologic_deficit = present


如果只有一般頭暈、頭痛、疲倦，
但沒有明確曾出現上述局部神經學異常，

不可自行標記：

recent_resolved_neurologic_deficit = present


如果無法確定症狀是否曾真正出現，
使用 unknown。


6. 自傷 / 傷人風險的分級抽取

這一組旗標必須非常保守，
不能因為一般負面情緒就自行推論成傷害風險。

------------------------------------------------------------
A. 一般情緒，不等於傷害想法
------------------------------------------------------------

例如：

「我很生氣」
「我很煩」
「我討厭他」
「我快氣死了」

若沒有實際表達要傷害自己或他人，

不得因此標記：

self_harm_thoughts = present
harm_others_thoughts = present
self_harm_intent_or_plan = present
harm_others_intent_or_plan = present
imminent_self_harm = present
imminent_harm_to_others = present


------------------------------------------------------------
B. 傷害想法 / 衝動
------------------------------------------------------------

若使用者明確表達有傷害自己或他人的想法、
念頭或衝動，但沒有明確行動計畫：

「最近有時候會想傷害自己」
→ self_harm_thoughts = present

「我有點想打人」
→ harm_others_thoughts = present

「我很想揍他，但我沒有要真的去做」
→ harm_others_thoughts = present
→ harm_others_intent_or_plan = absent
→ imminent_harm_to_others = absent

重要：
「有想法」不能自動等同於
「已有計畫」或「即將行動」。


------------------------------------------------------------
B-2. 被動的死亡意念（希望自己不存在）
------------------------------------------------------------

使用者沒有說「傷害自己」，
但表達希望自己死掉、消失、不要再活下去，
這在臨床上同樣屬於自殺意念，需要儘快由真人評估：

「活著好累，有時候會想乾脆消失算了」
「我不想活了」
「如果睡著就不要醒來就好了」
「我死了大家應該會比較輕鬆」
「覺得活著沒有意義」

→ self_harm_thoughts = present

沒有提到計畫或方法時，
intent_or_plan 與 imminent 維持 unknown，
不可標成 absent（使用者沒有否認），
也不可升級成 present（使用者沒有說要做）。

但以下是日常誇飾用語，對象是某件事而不是生命本身，
不得標記 self_harm_thoughts = present：

「累死了」「熱死了」「笑死」「氣死我了」「煩死了」

若無法判斷是誇飾還是真的不想活，
例如「考試考爛了好想死」，
應使用 unknown，
並把「需確認是否真的有不想活的念頭」加入 ambiguous_information。


------------------------------------------------------------
C. 明確意圖或計畫
------------------------------------------------------------

只有在使用者明確表示：

- 打算真的執行
- 已決定要做
- 已想好方法
- 已準備工具 / 藥物 / 武器 / 其他手段
- 正在安排執行

才能標記 intent_or_plan = present。

例如：

「我已經想好要怎麼傷害自己了」
→ self_harm_thoughts = present
→ self_harm_intent_or_plan = present

「我今晚打算去傷害他」
→ harm_others_thoughts = present
→ harm_others_intent_or_plan = present


------------------------------------------------------------
D. 立即危險
------------------------------------------------------------

只有明確表示：

- 現在就要做
- 馬上要做
- 正在準備執行
- 已在危險位置準備行動
- 手段已在身邊且準備立即使用

才能標記 imminent_* = present。

例如：

「我現在就要傷害自己」
→ self_harm_thoughts = present
→ self_harm_intent_or_plan = present
→ imminent_self_harm = present

「工具就在旁邊，我現在準備去傷害他」
→ harm_others_thoughts = present
→ harm_others_intent_or_plan = present
→ imminent_harm_to_others = present


------------------------------------------------------------
E. 時序與否定
------------------------------------------------------------

若使用者明確表示只是過去曾有想法，
目前已沒有：

「以前想過傷害自己，但現在完全沒有了」

應判斷：

self_harm_thoughts = absent

不得因過往對話曾出現想法，
就忽略使用者最新的明確否認。

若最新描述與過往資訊衝突，
以「最新且明確的目前狀態」為優先。

如果語意不足以區分
「只是生氣」
和
「真的有傷害念頭」，

應使用 unknown，
並把缺少的資訊加入 ambiguous_information。


7. evidence

只紀錄真正影響 safety flag 判斷的
使用者原始資訊摘要。

不得自行創造患者沒有說過的內容。

如果：

recent_resolved_neurologic_deficit = present

evidence 應保留：

曾經出現的急性神經學症狀

以及

目前已恢復的資訊。


7. ambiguous_information

如果某句話可能涉及高風險症狀，
但資訊不足以判定 present / absent，

請把缺少的關鍵資訊放入
ambiguous_information。


============================================================
【安全旗標說明】
============================================================

facial_droop
臉部突然歪斜或單側臉部無力。

one_sided_weakness
目前存在的新發單側手腳明顯無力。

new_speech_difficulty
目前存在的新發說話含糊、說不出話或理解語言困難。

recent_resolved_neurologic_deficit
近期曾經突然出現局部神經學異常，
例如單側臉部歪斜、單側肢體無力、
新發說話含糊、說不出話或理解語言困難，
但目前症狀已經恢復或消失。

只有使用者或過往對話明確提供
「曾經出現」且「目前已恢復」
這兩項資訊時，
才能標記 present。

不得僅因頭痛、頭暈或其他非特異症狀
自行推論此旗標存在。

unresponsive
無法正常喚醒或對刺激沒有正常反應。

severe_altered_consciousness
新發明顯意識混亂或嚴重意識改變。

seizure_over_5_minutes
癲癇／抽搐持續超過約 5 分鐘。

repeated_seizures_without_recovery
反覆抽搐，兩次之間意識沒有恢復。

stiff_neck
明顯頸部僵硬。

chest_pain
胸痛、胸口疼痛、胸部壓迫疼痛。

shortness_of_breath
喘、呼吸困難、呼吸不順。

severe_shortness_of_breath
嚴重呼吸困難。

unable_to_speak_full_sentences
因呼吸困難而無法完整說完一句話。

cyanosis
嘴唇或皮膚明顯發紫。

fainting
昏厥。

cold_sweat
異常冷汗。

throat_swelling
喉嚨明顯腫脹。

tongue_swelling
舌頭明顯腫脹。

severe_allergic_reaction
疑似嚴重全身性過敏反應。

severe_bleeding
大量出血。

uncontrolled_bleeding
持續無法止血。

vomiting_blood
吐血。

bloody_stool
明顯血便。

black_stool
黑色柏油樣便。

head_injury
近期頭部受到撞擊或外傷。

loss_of_consciousness
曾因目前事件失去意識。

taking_anticoagulants
目前正在使用抗凝血藥物。

pregnant
目前已知懷孕。

heavy_vaginal_bleeding
大量陰道出血。

vaginal_bleeding
陰道出血。

severe_abdominal_pain
劇烈腹痛。

self_harm_thoughts
目前有明確傷害自己、自殺或自我傷害的想法、念頭或衝動，
包含被動的死亡意念（想消失、不想活、希望睡著不要醒來）。
一般低落、難過、想哭、壓力大，不可自動視為此旗標 present。

harm_others_thoughts
目前有明確傷害、攻擊他人的想法、念頭或衝動。
一般生氣、討厭某人、抱怨，不可自動視為此旗標 present。

self_harm_intent_or_plan
目前已表達傷害自己的明確意圖、決定、方法、計畫，
或已準備相關手段。
僅有模糊想法時不可標記 present。

harm_others_intent_or_plan
目前已表達傷害他人的明確意圖、決定、方法、計畫，
或已準備相關手段。
僅有模糊想法時不可標記 present。

imminent_self_harm
目前存在立即或即將執行的自傷 / 自殺危險，
例如「現在就要做」、「馬上要做」、
或手段已在身邊且準備立即執行。

imminent_harm_to_others
目前存在立即或即將傷害他人的危險，
例如「現在就要去傷害他」、
或手段已在身邊且準備立即執行。

fever
目前發燒。

persistent_vomiting
持續或反覆嘔吐。


============================================================
【過往對話】
============================================================

{history_text}


============================================================
【使用者最新描述】
============================================================

{symptom_text}


請只依照上述資訊進行結構化抽取。
"""


# ============================================================
# Gemini call
# ============================================================

def _call_extractor_with_retry(
    prompt: str,
    max_retries: int = 4,
) -> SymptomExtractionSchema:

    if not client:

        raise RuntimeError(
            "Gemini client 尚未初始化"
        )

    delay = 1.5

    for attempt in range(
        max_retries
    ):

        try:

            response = (
                client.models.generate_content(
                    model=GEMINI_MODEL_NAME,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type=(
                            "application/json"
                        ),
                        response_schema=(
                            SymptomExtractionSchema
                        ),
                        temperature=0,
                    ),
                )
            )

            # ------------------------------------------------
            # 優先使用 parsed structured output
            # ------------------------------------------------

            parsed = getattr(
                response,
                "parsed",
                None,
            )

            if parsed is not None:

                if isinstance(
                    parsed,
                    SymptomExtractionSchema,
                ):
                    return parsed

                return (
                    SymptomExtractionSchema.model_validate(
                        parsed
                    )
                )

            # ------------------------------------------------
            # Fallback：解析 response.text
            # ------------------------------------------------

            raw_text = (
                response.text or ""
            ).strip()

            if not raw_text:

                raise ValueError(
                    "Gemini 回傳空白結果"
                )

            data = json.loads(
                raw_text
            )

            return (
                SymptomExtractionSchema.model_validate(
                    data
                )
            )

        except APIError as exc:

            retryable = (
                getattr(
                    exc,
                    "code",
                    None,
                )
                in {
                    429,
                    500,
                    502,
                    503,
                    504,
                }
            )

            if (
                retryable
                and attempt
                < max_retries - 1
            ):

                print(
                    "⚠️ Symptom extractor "
                    f"Gemini 暫時失敗 "
                    f"({getattr(exc, 'code', '?')})，"
                    f"{delay:.1f} 秒後重試..."
                )

                time.sleep(
                    delay
                )

                delay *= 2

                continue

            raise

        except (
            ValueError,
            json.JSONDecodeError,
        ):

            if attempt < max_retries - 1:

                print(
                    "⚠️ Symptom extractor "
                    "Structured Output 解析失敗，"
                    f"{delay:.1f} 秒後重試..."
                )

                time.sleep(
                    delay
                )

                delay *= 2

                continue

            raise


    raise RuntimeError(
        "Symptom extractor 超過最大重試次數"
    )


# ============================================================
# Public API
# ============================================================

def extract_symptom_flags(
    symptom_text: str,
    history: Optional[Sequence[Any]] = None,
) -> Dict[str, Any]:

    if not symptom_text:
        raise ValueError(
            "symptom_text 不可為空"
        )

    symptom_text = (
        symptom_text.strip()
    )

    if not symptom_text:
        raise ValueError(
            "symptom_text 不可為空"
        )

    prompt = (
        build_symptom_flag_prompt(
            symptom_text=symptom_text,
            history=history,
        )
    )

    result = (
        _call_extractor_with_retry(
            prompt
        )
    )

    states = (
        result.flags.model_dump()
    )


    # ========================================================
    # 舊版 bool mapping，僅為相容保留。
    #
    # present → True
    # absent / unknown → False
    #
    # Safety Engine 自 2026.09.2 起改吃 states（三態），
    # 不可再把 safety_flags 餵給引擎。
    # ========================================================

    safety_flags = {
        key: (
            state
            == "present"
        )
        for key, state
        in states.items()
    }


    present_flags = [
        key
        for key, state
        in states.items()
        if state == "present"
    ]


    absent_flags = [
        key
        for key, state
        in states.items()
        if state == "absent"
    ]


    unknown_flags = [
        key
        for key, state
        in states.items()
        if state == "unknown"
    ]


    return {

        "extractor_version":
            SYMPTOM_EXTRACTOR_VERSION,

        "states":
            states,

        "safety_flags":
            safety_flags,

        "present_flags":
            present_flags,

        "absent_flags":
            absent_flags,

        "unknown_flags":
            unknown_flags,

        "evidence":
            result.evidence,

        "ambiguous_information":
            result.ambiguous_information,
    }


# ============================================================
# Built-in Preview
#
# 不建立額外 test_xxx.py。
#
# 執行：
#
# python symptom_flag_extractor.py
# ============================================================

if __name__ == "__main__":

    print(
        "=" * 70
    )

    print(
        "Symptom Flag Extractor Preview"
    )

    print(
        "=" * 70
    )


    examples = [

        "我今天胸口很痛，而且有點喘，一直冒冷汗。",

        "我只是頭痛，沒有胸痛，也沒有呼吸困難。",

        "我右手突然沒力，講話也變得含糊。",

        "我很生氣，但沒有想傷害任何人。",

        "我有點想打人，但沒有要真的去做。",

        "我最近有傷害自己的念頭，但沒有計畫。",

        # 被動的死亡意念：應抽到 self_harm_thoughts = present
        "最近常常覺得活著很累，有時候會想乾脆消失算了。",

        # 日常誇飾：不應抽到 self_harm_thoughts = present
        "今天加班到半夜，累死了。",

        "我已經想好要怎麼傷害自己，而且現在就準備做。",

    ]


    for index, text in enumerate(
        examples,
        start=1,
    ):

        print()

        print(
            f"[Example {index}]"
        )

        print(
            "輸入：",
            text
        )


        try:

            result = (
                extract_symptom_flags(
                    symptom_text=text
                )
            )


            print(
                "present_flags =",
                result[
                    "present_flags"
                ]
            )

            print(
                "absent_flags =",
                result[
                    "absent_flags"
                ]
            )

            print(
                "evidence =",
                result[
                    "evidence"
                ]
            )

            print(
                "ambiguous_information =",
                result[
                    "ambiguous_information"
                ]
            )


        except Exception as exc:

            print(
                "❌ Extractor failed:",
                repr(exc),
            )


        print(
            "-" * 70
        )


    print(
        "✅ Symptom Flag Extractor preview finished"
    )