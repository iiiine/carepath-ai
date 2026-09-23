"""安全追問路由：相關性閘門、上限、不重複問，以及 APK 的形狀限制。"""

import pytest

from safety_engine import evaluate_red_flags
from safety_followup import (
    MAX_QUESTIONS_PER_TURN,
    QUESTIONS,
    build_followup_message,
    pending_clarifications,
)
from safety_types import STATE_PRESENT as P


def flags_for(states, asked=None):
    return [
        item["flag"]
        for item in pending_clarifications(evaluate_red_flags(states), asked)
    ]


# ============================================================
# 相關性閘門
# ============================================================

def test_unrelated_complaint_asks_nothing():
    """
    第一輪所有旗標都是 unknown，幾乎每條 emergency 規則都會是 UNKNOWN。

    沒有閘門的話，使用者只說頭痛就會被問到自傷意念與陰道出血。
    """
    assert flags_for({"headache": P}) == []


def test_never_asks_about_self_harm_out_of_the_blue():
    for complaint in ("headache", "chest_pain", "fever", "head_injury"):
        asked = flags_for({complaint: P})
        assert not any("self_harm" in f or "harm_others" in f for f in asked), asked


def test_engaged_rule_asks_its_own_swing_set():
    asked = flags_for({"head_injury": P})

    assert asked
    assert set(asked) <= {
        "loss_of_consciousness",
        "severe_altered_consciousness",
        "taking_anticoagulants",
    }


def test_already_matched_rule_is_not_asked_again():
    """規則已經命中就該阻斷，不是繼續問。"""
    assert flags_for({"chest_pain": P, "cold_sweat": P}) == []


# ============================================================
# 追問政策
# ============================================================

def test_respects_per_turn_limit():
    assert len(flags_for({"chest_pain": P})) <= MAX_QUESTIONS_PER_TURN


def test_does_not_repeat_asked_flags():
    first = flags_for({"head_injury": P})
    second = flags_for({"head_injury": P}, asked=first)

    assert set(first).isdisjoint(second)


def test_stops_once_everything_has_been_asked():
    states = {"head_injury": P}
    asked = []
    for _ in range(5):
        batch = flags_for(states, asked)
        if not batch:
            break
        asked += batch

    assert flags_for(states, asked) == []


def test_every_askable_flag_has_question_text():
    """沒有問句就不該問；這裡確認閘門開啟後的旗標都有文案。"""
    import itertools
    from safety_engine import EMERGENCY_RULES, _KeyRecorder

    missing = set()
    for rule in EMERGENCY_RULES:
        recorder = _KeyRecorder({})
        try:
            rule.predicate(recorder)
        except Exception:
            pass
        for size in (1, 2):
            for combo in itertools.combinations(sorted(recorder.keys), size):
                result = evaluate_red_flags({k: P for k in combo})
                for entry in result["indeterminate_rules"]:
                    if entry["engaged"] and entry["risk_level"] == "emergency":
                        missing |= {f for f in entry["swing_set"] if f not in QUESTIONS}

    assert not missing, f"缺問句：{sorted(missing)}"


# ============================================================
# 文案
# ============================================================

def test_message_states_assessment_is_incomplete():
    """
    APK 讀不到 assessment_completeness，
    「評估尚未完成」只能靠這段文字傳達。
    """
    message = build_followup_message(
        pending_clarifications(evaluate_red_flags({"head_injury": P}))
    )

    assert "安全評估尚未完成" in message


def test_message_makes_no_diagnostic_claim():
    message = build_followup_message(
        pending_clarifications(evaluate_red_flags({"chest_pain": P}))
    )

    for forbidden in ("診斷", "確定是", "您罹患", "確診"):
        assert forbidden not in message


def test_empty_clarifications_produce_no_message():
    assert build_followup_message([]) == ""


# ============================================================
# 2026-09-18 臨床審閱決定
# ============================================================

def test_chest_pain_does_not_spend_both_slots_on_breathing():
    """
    「呼吸急促」與「喘到說不完一句話」基本上是同一件事的兩個程度。
    兩題都問等於浪費名額，鑑別力更高的冷汗反而問不到。
    """
    asked = flags_for({"chest_pain": P})

    assert "cold_sweat" in asked
    assert not {"shortness_of_breath", "severe_shortness_of_breath"} <= set(asked)


def test_head_injury_asks_about_anticoagulants_first():
    """病人會主動說自己昏過去，不會主動說在吃抗凝血劑。"""
    asked = flags_for({"head_injury": P})

    assert asked[0] == "taking_anticoagulants"


def test_male_is_not_asked_about_pregnancy():
    from safety_engine import evaluate_red_flags
    from safety_followup import PREGNANCY_SPECIFIC_FLAGS, pending_clarifications

    for complaint in ("severe_abdominal_pain", "fainting"):
        asked = [
            item["flag"]
            for item in pending_clarifications(
                evaluate_red_flags({complaint: P}), biological_sex="男",
            )
        ]
        assert not set(asked) & set(PREGNANCY_SPECIFIC_FLAGS), asked


@pytest.mark.parametrize("sex", [None, "女", "其他", "", "unknown-value"])
def test_anything_other_than_male_still_gets_asked(sex):
    """保守預設在「問」那一側：只有明確為男才跳過。"""
    from safety_engine import evaluate_red_flags
    from safety_followup import PREGNANCY_SPECIFIC_FLAGS, pending_clarifications

    asked = [
        item["flag"]
        for item in pending_clarifications(
            evaluate_red_flags({"severe_abdominal_pain": P}), biological_sex=sex,
        )
    ]

    assert set(asked) & set(PREGNANCY_SPECIFIC_FLAGS), (sex, asked)


def test_suppression_does_not_affect_non_pregnancy_questions():
    asked_male = flags_for({"chest_pain": P})
    from safety_engine import evaluate_red_flags
    from safety_followup import pending_clarifications

    asked_with_sex = [
        item["flag"]
        for item in pending_clarifications(
            evaluate_red_flags({"chest_pain": P}), biological_sex="男",
        )
    ]

    assert asked_male == asked_with_sex
