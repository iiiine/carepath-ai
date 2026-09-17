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
