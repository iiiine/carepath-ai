"""
安全追問的觀測指標。

批次 C 步驟 4。原設計是「新舊引擎並行、只記差異」，
但舊的布林引擎在 #59 就已經被取代，main 上沒有東西可以並行比對，
等價性也已經用五萬組隨機輸入驗過。

因此改為觀測而非比對：記錄追問實際發生了什麼，
用來回答幾個現在真的不知道的問題 ——

    追問多常被觸發？
    使用者答不答？答了多少？
    有多少次問診最後是「評估未完成」收尾？
    哪些旗標最常問、最常沒被回答？

這些數字直接決定兩個先前只能憑判斷的決定是否正確：
每輪上限 2 題，以及同規則內的發問優先序。

純函式：不碰資料庫、不寫日誌、不影響任何回應。
呼叫端拿到 dict 之後自行輸出。
"""

from typing import Any, Dict, Iterable, List, Mapping

from safety_types import (
    STATE_UNKNOWN,
    normalize_flag_states,
)


SAFETY_OBSERVABILITY_VERSION = "2026.09.1"


# ============================================================
# 評估完整度
#
# 「資訊不足」與「已確認低風險」必須分開 ——
# 兩者的 risk_level 都可能是 standard，但意義完全不同。
#
# insufficient 的定義：還有「已被主訴帶動」的 emergency 規則
# 停在未定案，也就是我們知道有東西沒問清楚。
# ============================================================

COMPLETE = "complete"
INSUFFICIENT = "insufficient"


def assessment_completeness(
    assessment: Mapping[str, Any] | None,
) -> str:

    for rule in (
        (assessment or {}).get(
            "indeterminate_rules"
        )
        or []
    ):

        if (
            rule.get("engaged")
            and rule.get("risk_level") == "emergency"
        ):
            return INSUFFICIENT


    return COMPLETE


# ============================================================
# 逐輪觀測
#
# answered / unanswered 是靠「上一輪問過的旗標，這一輪是不是還 unknown」
# 推出來的。這是唯一可靠的判斷方式：
# 使用者可能答了但抽取器沒接住，那對我們來說與沒答等價。
# ============================================================

def observe_turn(
    prior_state: Mapping[str, Any] | None,
    next_state: Mapping[str, Any] | None,
    assessment: Mapping[str, Any] | None,
    clarifications: Iterable[Mapping[str, str]] | None = None,
) -> Dict[str, Any]:

    prior = prior_state or {}

    merged = normalize_flag_states(
        (next_state or {}).get(
            "flag_states"
        )
    )


    asked_before: List[str] = list(
        prior.get(
            "asked_flags"
        )
        or []
    )


    # 上一輪問過、這一輪仍然 unknown 的，視為沒得到答案
    unanswered = sorted(
        flag
        for flag in asked_before
        if merged.get(
            flag,
            STATE_UNKNOWN,
        )
        == STATE_UNKNOWN
    )


    answered = sorted(
        set(
            asked_before
        )
        - set(
            unanswered
        )
    )


    indeterminate = (
        (assessment or {}).get(
            "indeterminate_rules"
        )
        or []
    )


    asking_now = [
        item["flag"]
        for item in (clarifications or [])
    ]


    return {

        "observability_version":
            SAFETY_OBSERVABILITY_VERSION,

        "turn":
            (next_state or {}).get(
                "turn_count",
                0,
            ),

        "risk_level":
            (assessment or {}).get(
                "risk_level"
            ),

        "completeness":
            assessment_completeness(
                assessment
            ),

        # 規則層面
        "indeterminate_total":
            len(
                indeterminate
            ),

        "indeterminate_engaged":
            sum(
                1
                for rule in indeterminate
                if rule.get("engaged")
            ),

        # 追問層面
        "asking_now":
            asking_now,

        "asked_cumulative":
            len(
                (next_state or {}).get(
                    "asked_flags"
                )
                or []
            ),

        "answered_since_last_turn":
            answered,

        "unanswered_since_last_turn":
            unanswered,

        # 這兩個是決定「每輪上限」是否合理的依據
        "answer_rate":
            round(
                len(answered) / len(asked_before),
                2,
            )
            if asked_before
            else None,

        "hit_question_limit":
            len(asking_now) >= 2,
    }


def format_observation(
    record: Mapping[str, Any],
) -> str:
    """組成單行日誌，方便之後從 Render log 直接 grep 出來統計。"""

    return (
        "🛡️ [Safety Observability] "
        + " ".join(
            f"{key}={value}"
            for key, value in record.items()
            if key != "observability_version"
        )
    )


# ============================================================
# Smoke test
# ============================================================

if __name__ == "__main__":

    from safety_types import STATE_ABSENT, STATE_PRESENT

    # 沒有帶動的 emergency 未定案規則 → 評估算完整
    assert assessment_completeness({}) == COMPLETE
    assert assessment_completeness({
        "indeterminate_rules": [
            {"code": "X", "risk_level": "emergency", "engaged": False},
        ]
    }) == COMPLETE

    # 有帶動的 → 資訊不足
    assert assessment_completeness({
        "indeterminate_rules": [
            {"code": "X", "risk_level": "emergency", "engaged": True},
        ]
    }) == INSUFFICIENT

    # urgent 不影響完整度（政策：只有 emergency 產生追問）
    assert assessment_completeness({
        "indeterminate_rules": [
            {"code": "X", "risk_level": "urgent", "engaged": True},
        ]
    }) == COMPLETE

    print("✓ 評估完整度")


    # 上一輪問了兩題，這一輪只有一題拿到答案
    record = observe_turn(
        prior_state={
            "asked_flags": ["taking_anticoagulants", "loss_of_consciousness"],
        },
        next_state={
            "flag_states": {
                "head_injury": STATE_PRESENT,
                "taking_anticoagulants": STATE_ABSENT,
                "loss_of_consciousness": STATE_UNKNOWN,
            },
            "asked_flags": ["taking_anticoagulants", "loss_of_consciousness"],
            "turn_count": 2,
        },
        assessment={"risk_level": "urgent", "indeterminate_rules": []},
    )

    assert record["answered_since_last_turn"] == ["taking_anticoagulants"]
    assert record["unanswered_since_last_turn"] == ["loss_of_consciousness"]
    assert record["answer_rate"] == 0.5
    assert record["turn"] == 2

    print("✓ 回答率")


    # 第一輪沒有問過任何東西，回答率不該是 0 而是 None
    first = observe_turn(None, {"turn_count": 1}, {})
    assert first["answer_rate"] is None
    assert first["answered_since_last_turn"] == []

    print("✓ 首輪不誤報回答率")


    # 空輸入不應爆炸
    assert observe_turn(None, None, None)["turn"] == 0

    print("✓ 空輸入")

    print("\n✅ safety_observability smoke test finished")
