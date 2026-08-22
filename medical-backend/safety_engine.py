# safety_engine.py

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Mapping


# ============================================================
# Safety Engine Version
#
# 每次修改正式規則時更新版本，
# 方便未來追蹤某次問診使用的是哪一版安全規則。
# ============================================================

SAFETY_ENGINE_VERSION = "2026.08.2"


# ============================================================
# Risk Level
# ============================================================

RISK_EMERGENCY = "emergency"
RISK_URGENT = "urgent"
RISK_STANDARD = "standard"


RISK_PRIORITY = {
    RISK_STANDARD: 0,
    RISK_URGENT: 1,
    RISK_EMERGENCY: 2,
}


# ============================================================
# Rule
# ============================================================

@dataclass(frozen=True)
class SafetyRule:
    code: str
    risk_level: str
    title: str
    reason: str
    predicate: Callable[[Mapping[str, bool]], bool]


# ============================================================
# Boolean normalization
#
# 未來 Gemini 結構化結果可能出現：
#
# true
# false
# "true"
# "false"
# 1
# 0
#
# 這裡統一轉換。
# ============================================================

def _to_bool(value: Any) -> bool:

    if isinstance(value, bool):
        return value

    if isinstance(value, int):
        return value == 1

    if isinstance(value, str):

        normalized = (
            value
            .strip()
            .lower()
        )

        return normalized in {
            "true",
            "1",
            "yes",
            "y",
        }

    return False


def normalize_flags(
    raw_flags: Mapping[str, Any] | None,
) -> Dict[str, bool]:

    if not raw_flags:
        return {}

    return {
        str(key): _to_bool(value)
        for key, value in raw_flags.items()
    }


# ============================================================
# Helper
# ============================================================

def has(
    flags: Mapping[str, bool],
    key: str,
) -> bool:

    return bool(
        flags.get(key, False)
    )


def any_of(
    flags: Mapping[str, bool],
    *keys: str,
) -> bool:

    return any(
        has(flags, key)
        for key in keys
    )


def all_of(
    flags: Mapping[str, bool],
    *keys: str,
) -> bool:

    return all(
        has(flags, key)
        for key in keys
    )


# ============================================================
# Emergency Rules
#
# 這一層採「保守安全策略」。
#
# 它不是疾病診斷器。
# 它的工作只有：
#
# 「這個人是否不應繼續走一般 AI 門診推薦流程？」
#
# 正式醫療使用前仍需由臨床專業人員審閱規則。
# ============================================================

EMERGENCY_RULES: List[SafetyRule] = [

    # --------------------------------------------------------
    # Stroke / Acute neurological signs
    # --------------------------------------------------------

    SafetyRule(
        code="NEURO_STROKE_SIGN",
        risk_level=RISK_EMERGENCY,
        title="疑似急性神經學警訊",
        reason=(
            "出現臉部歪斜、單側肢體無力"
            "或新發語言異常等警訊。"
        ),
        predicate=lambda f: any_of(
            f,
            "facial_droop",
            "one_sided_weakness",
            "new_speech_difficulty",
        ),
    ),

    # --------------------------------------------------------
    # Recent resolved neurological deficit
    #
    # 例如：
    # 剛才單側手腳無力 / 語言異常，
    # 目前雖然已恢復，
    # 仍不可因「現在正常」而降為 standard。
    # --------------------------------------------------------

    SafetyRule(
        code="RECENT_RESOLVED_NEUROLOGIC_DEFICIT",
        risk_level=RISK_EMERGENCY,
        title="近期曾出現急性神經學警訊",
        reason=(
            "近期曾出現單側肢體無力、"
            "臉部歪斜或新發語言異常等"
            "急性神經學症狀，"
            "即使目前已恢復，"
            "仍需要立即接受醫療評估。"
        ),
        predicate=lambda f: has(
            f,
            "recent_resolved_neurologic_deficit",
        ),
    ),

    # --------------------------------------------------------
    # Altered consciousness
    # --------------------------------------------------------

    SafetyRule(
        code="ALTERED_CONSCIOUSNESS",
        risk_level=RISK_EMERGENCY,
        title="意識狀態異常",
        reason=(
            "出現意識不清、無法正常喚醒"
            "或新發嚴重意識改變。"
        ),
        predicate=lambda f: any_of(
            f,
            "unresponsive",
            "severe_altered_consciousness",
        ),
    ),

    # --------------------------------------------------------
    # Severe respiratory distress
    # --------------------------------------------------------

    SafetyRule(
        code="SEVERE_RESPIRATORY_DISTRESS",
        risk_level=RISK_EMERGENCY,
        title="嚴重呼吸困難",
        reason=(
            "出現嚴重呼吸困難、無法完整說話"
            "或明顯呼吸窘迫。"
        ),
        predicate=lambda f: any_of(
            f,
            "severe_shortness_of_breath",
            "unable_to_speak_full_sentences",
            "cyanosis",
        ),
    ),

    # --------------------------------------------------------
    # Chest pain with high-risk associated symptoms
    # --------------------------------------------------------

    SafetyRule(
        code="HIGH_RISK_CHEST_PAIN",
        risk_level=RISK_EMERGENCY,
        title="高風險胸痛",
        reason=(
            "胸痛合併呼吸困難、昏厥、"
            "冷汗或其他高風險症狀。"
        ),
        predicate=lambda f: (
            has(
                f,
                "chest_pain",
            )
            and any_of(
                f,
                "shortness_of_breath",
                "severe_shortness_of_breath",
                "fainting",
                "cold_sweat",
            )
        ),
    ),

    # --------------------------------------------------------
    # Severe allergic reaction / airway compromise
    # --------------------------------------------------------

    SafetyRule(
        code="ANAPHYLAXIS_AIRWAY",
        risk_level=RISK_EMERGENCY,
        title="疑似嚴重過敏反應",
        reason=(
            "出現喉嚨或舌頭腫脹、"
            "呼吸困難等可能影響呼吸道的症狀。"
        ),
        predicate=lambda f: any_of(
            f,
            "throat_swelling",
            "tongue_swelling",
            "severe_allergic_reaction",
        ),
    ),

    # --------------------------------------------------------
    # Severe bleeding
    # --------------------------------------------------------

    SafetyRule(
        code="UNCONTROLLED_BLEEDING",
        risk_level=RISK_EMERGENCY,
        title="嚴重或無法控制的出血",
        reason=(
            "出現大量出血或持續無法止血。"
        ),
        predicate=lambda f: any_of(
            f,
            "severe_bleeding",
            "uncontrolled_bleeding",
        ),
    ),

    # --------------------------------------------------------
    # Seizure
    # --------------------------------------------------------

    SafetyRule(
        code="PROLONGED_SEIZURE",
        risk_level=RISK_EMERGENCY,
        title="高風險癲癇發作",
        reason=(
            "癲癇發作時間過長，"
            "或反覆發作且意識未恢復。"
        ),
        predicate=lambda f: any_of(
            f,
            "seizure_over_5_minutes",
            "repeated_seizures_without_recovery",
        ),
    ),

    # --------------------------------------------------------
    # Severe head injury
    # --------------------------------------------------------

    SafetyRule(
        code="HIGH_RISK_HEAD_INJURY",
        risk_level=RISK_EMERGENCY,
        title="高風險頭部外傷",
        reason=(
            "頭部外傷合併失去意識、"
            "意識異常或其他高風險因素。"
        ),
        predicate=lambda f: (
            has(
                f,
                "head_injury",
            )
            and any_of(
                f,
                "loss_of_consciousness",
                "severe_altered_consciousness",
                "taking_anticoagulants",
            )
        ),
    ),

    # --------------------------------------------------------
    # Pregnancy emergency signs
    # --------------------------------------------------------

    SafetyRule(
        code="PREGNANCY_EMERGENCY",
        risk_level=RISK_EMERGENCY,
        title="孕期高風險警訊",
        reason=(
            "懷孕期間出現大量陰道出血，"
            "或出血合併劇烈腹痛／昏厥。"
        ),
        predicate=lambda f: (
            has(
                f,
                "pregnant",
            )
            and (
                has(
                    f,
                    "heavy_vaginal_bleeding",
                )
                or (
                    has(
                        f,
                        "vaginal_bleeding",
                    )
                    and any_of(
                        f,
                        "severe_abdominal_pain",
                        "fainting",
                    )
                )
            )
        ),
    ),

    # --------------------------------------------------------
    # Fever + neurological danger signs
    # --------------------------------------------------------

    SafetyRule(
        code="FEVER_NEURO_DANGER",
        risk_level=RISK_EMERGENCY,
        title="發燒合併神經學警訊",
        reason=(
            "發燒合併頸部僵硬、"
            "嚴重意識改變等高風險症狀。"
        ),
        predicate=lambda f: (
            has(
                f,
                "fever",
            )
            and any_of(
                f,
                "stiff_neck",
                "severe_altered_consciousness",
            )
        ),
    ),
]


# ============================================================
# Urgent Rules
#
# urgent 不代表診斷，
# 代表不適合單純等待一般例行門診。
# ============================================================

URGENT_RULES: List[SafetyRule] = [

    SafetyRule(
        code="CHEST_PAIN",
        risk_level=RISK_URGENT,
        title="胸痛需要儘快評估",
        reason=(
            "目前有胸痛症狀，"
            "即使尚未符合緊急警訊組合，"
            "仍建議儘快接受醫療評估。"
        ),
        predicate=lambda f: has(
            f,
            "chest_pain",
        ),
    ),

    SafetyRule(
        code="FAINTING",
        risk_level=RISK_URGENT,
        title="昏厥需要儘快評估",
        reason=(
            "近期出現昏厥或失去意識事件。"
        ),
        predicate=lambda f: has(
            f,
            "fainting",
        ),
    ),

    SafetyRule(
        code="BLOOD_IN_VOMIT_OR_STOOL",
        risk_level=RISK_URGENT,
        title="疑似消化道出血警訊",
        reason=(
            "出現吐血、血便或黑便等症狀。"
        ),
        predicate=lambda f: any_of(
            f,
            "vomiting_blood",
            "bloody_stool",
            "black_stool",
        ),
    ),

    SafetyRule(
        code="PERSISTENT_VOMITING",
        risk_level=RISK_URGENT,
        title="持續嘔吐",
        reason=(
            "持續嘔吐可能造成脫水，"
            "需要進一步醫療評估。"
        ),
        predicate=lambda f: has(
            f,
            "persistent_vomiting",
        ),
    ),

    SafetyRule(
        code="HEAD_INJURY",
        risk_level=RISK_URGENT,
        title="頭部外傷",
        reason=(
            "近期有頭部外傷，"
            "需要確認是否存在延遲性併發症風險。"
        ),
        predicate=lambda f: has(
            f,
            "head_injury",
        ),
    ),
]


ALL_RULES = (
    EMERGENCY_RULES
    + URGENT_RULES
)


# ============================================================
# Safety Assessment
# ============================================================

def evaluate_red_flags(
    raw_flags: Mapping[str, Any] | None,
) -> Dict[str, Any]:
    """
    根據「已結構化的症狀旗標」進行安全風險判斷。

    注意：
    這個函式本身不負責 NLP。
    不應直接把自然語言症狀丟進來。

    正式流程會是：

    使用者自然語言
        ↓
    LLM / Structured Extraction
        ↓
    symptom_flags
        ↓
    evaluate_red_flags()
    """

    flags = normalize_flags(
        raw_flags
    )

    matched_rules: List[SafetyRule] = []

    for rule in ALL_RULES:

        try:

            if rule.predicate(
                flags
            ):
                matched_rules.append(
                    rule
                )

        except Exception:

            # Safety engine 不應因單一規則錯誤
            # 讓整個診斷 API crash。
            continue


    # ========================================================
    # 找最高風險
    # ========================================================

    if not matched_rules:

        highest_risk = (
            RISK_STANDARD
        )

    else:

        highest_risk = max(
            (
                rule.risk_level
                for rule
                in matched_rules
            ),
            key=lambda level:
                RISK_PRIORITY[
                    level
                ],
        )


    # ========================================================
    # 是否阻斷一般問診流程
    # ========================================================

    should_stop_normal_flow = (
        highest_risk
        == RISK_EMERGENCY
    )


    # ========================================================
    # 建議動作
    # ========================================================

    if highest_risk == RISK_EMERGENCY:

        safety_action = (
            "偵測到可能需要立即處理的高風險警訊。"
            "建議立即尋求緊急醫療協助，"
            "不應只依賴線上 AI 問診結果。"
        )

    elif highest_risk == RISK_URGENT:

        safety_action = (
            "偵測到需要儘快接受醫療評估的警訊。"
            "建議儘早聯絡醫療機構或就醫評估。"
        )

    else:

        safety_action = (
            "目前未由安全規則偵測到"
            "需要中止一般問診流程的明確高風險警訊。"
        )


    # ========================================================
    # Response
    # ========================================================

    return {

        "engine_version":
            SAFETY_ENGINE_VERSION,

        "risk_level":
            highest_risk,

        "should_stop_normal_flow":
            should_stop_normal_flow,

        "has_red_flags":
            len(
                matched_rules
            ) > 0,

        "matched_rule_count":
            len(
                matched_rules
            ),

        "red_flags": [
            {
                "code":
                    rule.code,

                "risk_level":
                    rule.risk_level,

                "title":
                    rule.title,

                "reason":
                    rule.reason,
            }
            for rule
            in matched_rules
        ],

        "safety_action":
            safety_action,
    }


# ============================================================
# 內建 Smoke Test
#
# 不額外建立 test_xxx.py
# 直接執行：
#
# python safety_engine.py
# ============================================================

if __name__ == "__main__":

    examples = [

        {
            "name":
                "一般頭痛",

            "flags": {
                "headache":
                    True,
            },
        },

        {
            "name":
                "胸痛 + 呼吸困難",

            "flags": {
                "chest_pain":
                    True,

                "shortness_of_breath":
                    True,
            },
        },

        {
            "name":
                "疑似中風",

            "flags": {
                "one_sided_weakness":
                    True,
            },
        },

        {
            "name":
                "單純胸痛",

            "flags": {
                "chest_pain":
                    True,
            },
        },

        {
            "name":
                "神經症狀已恢復但近期曾發生",

            "flags": {
                "recent_resolved_neurologic_deficit":
                    True,
            },
        },

    ]


    for example in examples:

        result = evaluate_red_flags(
            example["flags"]
        )

        print(
            "=" * 60
        )

        print(
            example["name"]
        )

        print(
            "risk_level =",
            result["risk_level"]
        )

        print(
            "should_stop_normal_flow =",
            result[
                "should_stop_normal_flow"
            ]
        )

        print(
            "matched_rule_count =",
            result[
                "matched_rule_count"
            ]
        )

        for flag in result[
            "red_flags"
        ]:

            print(
                "-",
                flag["code"],
                flag["title"],
            )

    print(
        "=" * 60
    )

    print(
        "✅ Safety Engine smoke test finished"
    )