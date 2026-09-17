"""
安全追問路由。

純函式模組：不碰資料庫、不碰 FastAPI、不呼叫模型，也不做風險判斷。
輸入是引擎的 indeterminate_rules 與本對話已問過的旗標，
輸出是「這一輪該問哪幾件事」。

⚠️ 問句文字屬於面向病人的醫療溝通內容，請臨床背景的人審閱過再上線。
   措辭要能用是／否回答，不做任何診斷暗示。
"""

from typing import Any, Dict, Iterable, List, Mapping


SAFETY_FOLLOWUP_VERSION = "2026.09.1"


# ============================================================
# 追問政策
#
# 1. 只有 emergency 層級的規則產生追問，urgent 只記錄不問。
# 2. 規則必須已被帶動（engaged）：至少有一個引用旗標已經是 present。
#    沒有這道閘門，使用者只說「頭痛」也會被問到自傷意念 ——
#    第一輪所有旗標都是 unknown，幾乎每條規則都會是 UNKNOWN。
# 3. 同一個旗標問過一次就不再問，改標記評估未完成。
# 4. 每輪最多兩題。
# ============================================================

MAX_QUESTIONS_PER_TURN = 2


# ============================================================
# 問句
#
# 只涵蓋閘門開啟後實際可能被追問的旗標（目前 15 個，分屬四條規則）。
# 沒有對應問句的旗標寧可不問，也不要生出語意不清的問題 ——
# 這種情況會被標記為評估未完成，由文案告知使用者。
# ============================================================

QUESTIONS: Dict[str, str] = {

    # HIGH_RISK_CHEST_PAIN
    "chest_pain":
        "請問您現在有胸口疼痛或壓迫感嗎？",
    "shortness_of_breath":
        "請問您有呼吸急促或喘不過氣的情形嗎？",
    "severe_shortness_of_breath":
        "請問您會喘到難以說完一整句話嗎？",
    "cold_sweat":
        "請問您有冒冷汗的情形嗎？",
    "fainting":
        "請問您有昏倒，或快要暈過去的感覺嗎？",

    # HIGH_RISK_HEAD_INJURY
    "head_injury":
        "請問您的頭部最近有撞擊或受傷嗎？",
    "loss_of_consciousness":
        "請問您有失去意識或昏過去嗎？",
    "severe_altered_consciousness":
        "請問您有意識不清、叫喚反應變差，或講話顛三倒四的情形嗎？",
    "taking_anticoagulants":
        "請問您有在服用抗凝血劑或抗血小板藥物嗎？"
        "（例如 warfarin、可邁丁、阿斯匹靈）",

    # PREGNANCY_EMERGENCY
    # 這幾題不預設提問對象。
    #
    # 追問是依症狀觸發的，系統在這一層沒有性別資訊 ——
    # 劇烈腹痛會帶動 PREGNANCY_EMERGENCY，男性使用者同樣會看到。
    # 與其依賴可能沒填的 user_profiles.gender 做過濾，
    # 不如把問句寫成對任何人都讀得通。
    "pregnant":
        "請問目前是否有懷孕或可能懷孕的情況？"
        "（若不適用，回覆「沒有」即可）",
    "vaginal_bleeding":
        "請問是否有陰道出血的情形？"
        "（若不適用，回覆「沒有」即可）",
    # 這題可能在使用者從未提到出血時就被問到
    # （劇烈腹痛也會帶動 PREGNANCY_EMERGENCY），
    # 所以不能寫成「出血量大嗎」那種預設出血已存在的問法。
    "heavy_vaginal_bleeding":
        "請問是否有大量陰道出血的情形？"
        "（例如一小時內濕透一片以上的衛生棉；若不適用，回覆「沒有」即可）",
    "severe_abdominal_pain":
        "請問您有劇烈的腹痛嗎？",

    # FEVER_NEURO_DANGER
    "fever":
        "請問您目前有發燒嗎？",
    "stiff_neck":
        "請問您的脖子有僵硬、低頭時特別疼痛的情形嗎？",
}


def pending_clarifications(
    assessment: Mapping[str, Any] | None,
    asked_flags: Iterable[str] | None = None,
    limit: int = MAX_QUESTIONS_PER_TURN,
) -> List[Dict[str, str]]:
    """
    決定這一輪要追問哪些旗標。

    回傳 [{"flag", "question", "for_rule"}]，沒有要問的就是空清單。
    """

    already = set(
        asked_flags or []
    )


    candidates: List[Dict[str, str]] = []

    seen = set()


    rules = (
        (assessment or {}).get(
            "indeterminate_rules"
        )
        or []
    )


    # 解鎖所需的未知項越少，越優先問 —— 最快能定案的先問。
    ordered = sorted(
        (
            rule
            for rule in rules
            if rule.get("engaged")
            and rule.get("risk_level") == "emergency"
        ),
        key=lambda rule: len(
            rule.get("swing_set")
            or []
        ),
    )


    for rule in ordered:

        for flag in (rule.get("swing_set") or []):

            if flag in already or flag in seen:
                continue


            question = QUESTIONS.get(
                flag
            )


            # 沒有問句就不要問。生一個語意不清的問題，
            # 比承認評估未完成更糟。
            if not question:
                continue


            seen.add(
                flag
            )

            candidates.append(
                {
                    "flag": flag,
                    "question": question,
                    "for_rule": rule.get("code"),
                }
            )


            if len(candidates) >= limit:
                return candidates


    return candidates


def build_followup_message(
    clarifications: List[Dict[str, str]],
) -> str:
    """
    組出追問文案。

    說明「為什麼問」而不宣稱任何診斷，並明確告知評估尚未完成 ——
    已上架的 APK 讀不到 assessment_completeness 欄位，
    這段文字是唯一能傳達該狀態的管道。
    """

    if not clarifications:
        return ""


    questions = [
        item["question"]
        for item in clarifications
    ]


    if len(questions) == 1:
        body = questions[0]

    else:
        body = "\n".join(
            f"{index}. {text}"
            for index, text in enumerate(
                questions,
                start=1,
            )
        )


    return (
        "為了判斷這個情況是否需要立即就醫，"
        "我需要先確認下列資訊（安全評估尚未完成）：\n"
        f"{body}"
    )
