

from dataclasses import dataclass
from itertools import product
from typing import Any, Callable, Iterator, List, Mapping

from safety_types import (
    STATE_ABSENT,
    STATE_PRESENT,
    EngineResult,
    FlagStates,
    IndeterminateRule,
    Truth,
    any_of,
    has,
    normalize_flag_states,
    t_and,
    t_or,
)


# ============================================================
# Safety Engine Version
#
# 每次修改正式規則時更新版本，
# 方便未來追蹤某次問診使用的是哪一版安全規則。
#
# 2026.09.2：規則改用三態（safety_types），新增 indeterminate_rules。
#            命中條件與 2026.09.1 相同，只有 present 會命中。
# ============================================================

SAFETY_ENGINE_VERSION = "2026.09.2"


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
#
# predicate 一律回傳 Truth，不可回傳 bool。
# 組合時用 t_and / t_or，不可用 Python 的 and / or ——
# Truth.__bool__ 會直接拋 TypeError。
# ============================================================

@dataclass(frozen=True)
class SafetyRule:
    code: str
    risk_level: str
    title: str
    reason: str
    predicate: Callable[[FlagStates], Truth]


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
    # Mental health / Harm risk
    #
    # 明確意圖、計畫或立即危險：
    # 中止一般 AI 問診流程。
    # --------------------------------------------------------

    SafetyRule(
        code="SELF_HARM_INTENT_OR_PLAN",
        risk_level=RISK_EMERGENCY,
        title="自傷或自殺高風險警訊",
        reason=(
            "使用者明確表達傷害自己的意圖、"
            "計畫、方法或已準備相關手段。"
        ),
        predicate=lambda f: any_of(
            f,
            "self_harm_intent_or_plan",
            "imminent_self_harm",
        ),
    ),

    SafetyRule(
        code="HARM_TO_OTHERS_INTENT_OR_PLAN",
        risk_level=RISK_EMERGENCY,
        title="傷害他人高風險警訊",
        reason=(
            "使用者明確表達傷害他人的意圖、"
            "計畫、方法或已準備相關手段。"
        ),
        predicate=lambda f: any_of(
            f,
            "harm_others_intent_or_plan",
            "imminent_harm_to_others",
        ),
    ),

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
        predicate=lambda f: t_and(
            has(
                f,
                "chest_pain",
            ),
            any_of(
                f,
                "shortness_of_breath",
                "severe_shortness_of_breath",
                "fainting",
                "cold_sweat",
            ),
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
        predicate=lambda f: t_and(
            has(
                f,
                "head_injury",
            ),
            any_of(
                f,
                "loss_of_consciousness",
                "severe_altered_consciousness",
                "taking_anticoagulants",
            ),
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
        predicate=lambda f: t_and(
            has(
                f,
                "pregnant",
            ),
            t_or(
                has(
                    f,
                    "heavy_vaginal_bleeding",
                ),
                t_and(
                    has(
                        f,
                        "vaginal_bleeding",
                    ),
                    any_of(
                        f,
                        "severe_abdominal_pain",
                        "fainting",
                    ),
                ),
            ),
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
        predicate=lambda f: t_and(
            has(
                f,
                "fever",
            ),
            any_of(
                f,
                "stiff_neck",
                "severe_altered_consciousness",
            ),
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

    # --------------------------------------------------------
    # Mental health / Harm thoughts
    #
    # 有明確傷害念頭，但尚未抽取到明確意圖 / 計畫：
    # 需要儘快由真人進一步評估。
    #
    # 若同時有 intent_or_plan，
    # Emergency 規則會自動取得較高風險等級。
    # --------------------------------------------------------

    SafetyRule(
        code="SELF_HARM_THOUGHTS",
        risk_level=RISK_URGENT,
        title="自傷或自殺想法需要儘快評估",
        reason=(
            "使用者目前表達有傷害自己的想法、"
            "念頭或衝動，需要儘快由醫療或心理健康專業人員評估。"
        ),
        predicate=lambda f: has(
            f,
            "self_harm_thoughts",
        ),
    ),

    SafetyRule(
        code="HARM_TO_OTHERS_THOUGHTS",
        risk_level=RISK_URGENT,
        title="傷害他人的想法需要儘快評估",
        reason=(
            "使用者目前表達有傷害他人的想法、"
            "念頭或衝動，需要儘快由真人進一步評估安全風險。"
        ),
        predicate=lambda f: has(
            f,
            "harm_others_thoughts",
        ),
    ),

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
# Swing set
#
# 規則求值為 UNKNOWN 時，找出「哪些 unknown 旗標值得追問」。
#
# 旗標 k 屬於 swing_set 的條件：
# 存在某種其他 unknown 旗標的補值方式，
# 使得 k = present 時規則成立，而 k = absent 時不成立。
#
# 換句話說，k 的答案真的會左右這條規則。
# 例：chest_pain = present、fainting = absent，
#     shortness_of_breath / cold_sweat 為 unknown
#     → swing_set = [shortness_of_breath, cold_sweat]，
#       不會去問已經否認的 fainting。
#
# 規則引用的旗標最多五、六個，窮舉成本可以忽略。
# ============================================================

class _KeyRecorder(Mapping[str, Any]):
    """記下 predicate 讀過哪些旗標。"""

    def __init__(
        self,
        flags: FlagStates,
    ) -> None:

        self._flags = flags
        self.keys: List[str] = []


    def __getitem__(
        self,
        key: str,
    ) -> Any:

        if key not in self.keys:
            self.keys.append(key)

        return self._flags[key]


    def __iter__(self) -> Iterator[str]:
        return iter(self._flags)


    def __len__(self) -> int:
        return len(self._flags)


def _evaluate_rule(
    rule: SafetyRule,
    flags: FlagStates,
) -> Truth:

    result = rule.predicate(
        flags
    )

    # 回傳 bool 代表規則沒改寫乾淨，
    # 默默當成不命中會往「不升級」倒，所以直接拋例外。
    if not isinstance(
        result,
        Truth,
    ):

        raise TypeError(
            f"規則 {rule.code} 回傳 "
            f"{type(result).__name__}，必須回傳 Truth"
        )

    return result


def _swing_set(
    rule: SafetyRule,
    flags: FlagStates,
) -> List[str]:

    recorder = _KeyRecorder(
        flags
    )

    # t_and / t_or 的參數會先全部求值，
    # 所以跑一次就能記到規則引用的所有旗標。
    _evaluate_rule(
        rule,
        recorder,
    )

    unknown_keys = [
        key
        for key in recorder.keys
        if has(flags, key) is Truth.UNKNOWN
    ]

    swing: List[str] = []

    for key in unknown_keys:

        others = [
            other
            for other in unknown_keys
            if other != key
        ]

        for fill in product(
            (STATE_PRESENT, STATE_ABSENT),
            repeat=len(others),
        ):

            filled = {
                **flags,
                **dict(zip(others, fill)),
            }

            if (
                _evaluate_rule(rule, {**filled, key: STATE_PRESENT})
                is Truth.TRUE
                and _evaluate_rule(rule, {**filled, key: STATE_ABSENT})
                is not Truth.TRUE
            ):

                swing.append(key)
                break

    return swing


# ============================================================
# 規則求值失敗
#
# 規則逐條隔離執行：一條出錯不影響其他條繼續跑，
# 但只要有任何一條出錯，整體評估就視為失敗。
#
# 不可以跳過出錯的規則 ——
# 「這條規則沒跑成功」不等於「這條規則沒命中」，
# 跳過的方向是往不升級倒。
# ============================================================

class SafetyRuleEvaluationError(RuntimeError):

    def __init__(
        self,
        failures: List[tuple],
    ) -> None:

        # [(rule_code, exception), ...]，保留全部，方便一次看完所有出錯的規則
        self.failures = failures

        super().__init__(
            "安全規則求值失敗："
            + "、".join(
                f"{code}（{type(exc).__name__}: {exc}）"
                for code, exc in failures
            )
        )


# ============================================================
# Safety Assessment
# ============================================================

def evaluate_red_flags(
    flag_states: FlagStates | None,
) -> EngineResult:
    """
    根據「已結構化的三態症狀旗標」進行安全風險判斷。

    注意：
    這個函式本身不負責 NLP，也不負責跨輪合併。
    輸入必須是合併後的 present / absent / unknown。

    正式流程會是：

    使用者自然語言
        ↓
    LLM / Structured Extraction（三態）
        ↓
    flag_states
        ↓
    evaluate_red_flags()

    風險判定只看 Truth.TRUE：unknown 不會升級風險，
    而是列進 indeterminate_rules 供追問使用。

    規則逐條隔離執行，全部跑完後只要有任何一條出錯，
    就拋 SafetyRuleEvaluationError（列出所有出錯的規則），
    由 safety_pipeline 轉成 risk_level = unknown 並中止問診。
    """

    flags = normalize_flag_states(
        flag_states
    )

    matched_rules: List[SafetyRule] = []

    indeterminate_rules: List[IndeterminateRule] = []

    failures: List[tuple] = []

    for rule in ALL_RULES:

        try:

            truth = _evaluate_rule(
                rule,
                flags,
            )

            if truth is Truth.TRUE:

                matched_rules.append(
                    rule
                )

            elif truth is Truth.UNKNOWN:

                indeterminate_rules.append(
                    {
                        "code":
                            rule.code,

                        "risk_level":
                            rule.risk_level,

                        "swing_set":
                            _swing_set(
                                rule,
                                flags,
                            ),
                    }
                )

        except Exception as exc:

            failures.append(
                (rule.code, exc)
            )


    if failures:

        raise SafetyRuleEvaluationError(
            failures
        )


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

        "indeterminate_rules":
            indeterminate_rules,
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

    P, A, U = (
        STATE_PRESENT,
        STATE_ABSENT,
        "unknown",
    )

    def codes(result):
        return [
            flag["code"]
            for flag in result["red_flags"]
        ]

    def indeterminate(result):
        return {
            rule["code"]: rule["swing_set"]
            for rule in result["indeterminate_rules"]
        }


    examples = [

        {
            "name": "一般頭痛（其餘沒提到）",
            "flags": {"headache": P},
            "risk_level": RISK_STANDARD,
            "codes": [],
        },

        {
            "name": "胸痛 + 呼吸困難",
            "flags": {"chest_pain": P, "shortness_of_breath": P},
            "risk_level": RISK_EMERGENCY,
            "codes": ["HIGH_RISK_CHEST_PAIN", "CHEST_PAIN"],
        },

        {
            "name": "疑似中風",
            "flags": {"one_sided_weakness": P},
            "risk_level": RISK_EMERGENCY,
            "codes": ["NEURO_STROKE_SIGN"],
        },

        {
            "name": "單純胸痛，伴隨症狀沒問",
            "flags": {"chest_pain": P},
            "risk_level": RISK_URGENT,
            "codes": ["CHEST_PAIN"],
        },

        {
            "name": "神經症狀已恢復但近期曾發生",
            "flags": {"recent_resolved_neurologic_deficit": P},
            "risk_level": RISK_EMERGENCY,
            "codes": ["RECENT_RESOLVED_NEUROLOGIC_DEFICIT"],
        },

        {
            "name": "只有生氣，沒有傷害想法",
            "flags": {},
            "risk_level": RISK_STANDARD,
            "codes": [],
        },

        {
            "name": "有傷害他人的想法但無計畫",
            "flags": {
                "harm_others_thoughts": P,
                "harm_others_intent_or_plan": A,
                "imminent_harm_to_others": A,
            },
            "risk_level": RISK_URGENT,
            "codes": ["HARM_TO_OTHERS_THOUGHTS"],
        },

        {
            "name": "有自傷想法但無計畫",
            "flags": {
                "self_harm_thoughts": P,
                "self_harm_intent_or_plan": A,
                "imminent_self_harm": A,
            },
            "risk_level": RISK_URGENT,
            "codes": ["SELF_HARM_THOUGHTS"],
        },

        {
            "name": "明確自傷計畫",
            "flags": {
                "self_harm_thoughts": P,
                "self_harm_intent_or_plan": P,
            },
            "risk_level": RISK_EMERGENCY,
            "codes": ["SELF_HARM_INTENT_OR_PLAN", "SELF_HARM_THOUGHTS"],
        },

        {
            "name": "立即傷害他人危險",
            "flags": {
                "harm_others_thoughts": P,
                "harm_others_intent_or_plan": P,
                "imminent_harm_to_others": P,
            },
            "risk_level": RISK_EMERGENCY,
            "codes": ["HARM_TO_OTHERS_INTENT_OR_PLAN", "HARM_TO_OTHERS_THOUGHTS"],
        },

        {
            "name": "孕期出血 + 昏厥（巢狀規則）",
            "flags": {
                "pregnant": P,
                "vaginal_bleeding": P,
                "fainting": P,
            },
            "risk_level": RISK_EMERGENCY,
            "codes": ["PREGNANCY_EMERGENCY", "FAINTING"],
        },

        {
            "name": "非 present 的舊版 bool 一律視為 unknown，不會命中",
            "flags": {"chest_pain": True},
            "risk_level": RISK_STANDARD,
            "codes": [],
        },

    ]


    for example in examples:

        result = evaluate_red_flags(
            example["flags"]
        )

        assert result["risk_level"] == example["risk_level"], example["name"]
        assert codes(result) == example["codes"], (example["name"], codes(result))
        assert result["should_stop_normal_flow"] == (
            example["risk_level"] == RISK_EMERGENCY
        ), example["name"]

        print(
            "✓",
            example["name"],
            "→",
            result["risk_level"],
            codes(result),
        )


    # FALSE 的短路權：明確否認就不列入待確認
    result = evaluate_red_flags(
        {"chest_pain": A}
    )
    assert "HIGH_RISK_CHEST_PAIN" not in indeterminate(result)
    assert "CHEST_PAIN" not in indeterminate(result)

    # 胸痛成立、昏厥已否認：只追問還沒問過的伴隨症狀
    result = evaluate_red_flags(
        {"chest_pain": P, "fainting": A}
    )
    assert indeterminate(result)["HIGH_RISK_CHEST_PAIN"] == [
        "shortness_of_breath",
        "severe_shortness_of_breath",
        "cold_sweat",
    ]

    # 什麼都沒問：swing_set 是規則引用的全部旗標
    result = evaluate_red_flags({})
    assert result["risk_level"] == RISK_STANDARD
    assert len(result["indeterminate_rules"]) == len(ALL_RULES)
    assert indeterminate(result)["HEAD_INJURY"] == ["head_injury"]

    # 巢狀規則：大量出血已確認，就不必再問一般出血與腹痛
    result = evaluate_red_flags(
        {"pregnant": U, "heavy_vaginal_bleeding": P}
    )
    assert indeterminate(result)["PREGNANCY_EMERGENCY"] == ["pregnant"]

    # 已命中的規則不會出現在 indeterminate_rules
    result = evaluate_red_flags(
        {"head_injury": P, "loss_of_consciousness": P}
    )
    assert "HIGH_RISK_HEAD_INJURY" in codes(result)
    assert "HIGH_RISK_HEAD_INJURY" not in indeterminate(result)

    # 規則誤回 bool 必須拋例外，不可被當成不命中
    bad_rule = SafetyRule(
        code="BAD_RULE",
        risk_level=RISK_EMERGENCY,
        title="",
        reason="",
        predicate=lambda f: False,
    )

    try:
        _evaluate_rule(bad_rule, {})

    except TypeError:
        pass

    else:
        raise AssertionError(
            "回傳 bool 的規則應該拋 TypeError"
        )

    # 逐條隔離：出錯的規則不會中斷其他規則，
    # 但全部跑完後必須拋例外並列出每一條出錯的規則
    crash_rule = SafetyRule(
        code="CRASH_RULE",
        risk_level=RISK_URGENT,
        title="",
        reason="",
        predicate=lambda f: f["missing_key"],
    )

    later_rule_calls = []

    later_rule = SafetyRule(
        code="LATER_RULE",
        risk_level=RISK_URGENT,
        title="",
        reason="",
        predicate=lambda f: (
            later_rule_calls.append(True)
            or has(f, "head_injury")
        ),
    )

    original_rules = ALL_RULES
    ALL_RULES = [bad_rule, crash_rule, later_rule]

    try:
        evaluate_red_flags({"head_injury": P})

    except SafetyRuleEvaluationError as exc:
        assert [code for code, _ in exc.failures] == [
            "BAD_RULE",
            "CRASH_RULE",
        ], exc.failures
        assert later_rule_calls, "出錯規則之後的規則也要照跑"

    else:
        raise AssertionError(
            "有規則出錯時應該拋 SafetyRuleEvaluationError"
        )

    finally:
        ALL_RULES = original_rules

    print(
        "=" * 60
    )

    print(
        "✅ Safety Engine smoke test finished"
    )
