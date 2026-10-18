"""
跨輪安全狀態合併。

純函式模組：不碰資料庫、不碰 FastAPI、不呼叫任何模型，
也不做任何風險判斷 —— 判斷一律是 safety_engine 的事。

這裡只回答一個問題：

    「既有狀態」加上「本輪抽取結果」，合併後的狀態是什麼？

合併規則刻意不對稱，方向一律往保守倒。對應的持久化在
schema/consultation_safety_state.sql，欄位名稱與這裡的 key 一致。
"""

from typing import (
    Any,
    Dict,
    Iterable,
    List,
    Mapping,
)

from safety_types import (
    STATE_ABSENT,
    STATE_PRESENT,
    STATE_UNKNOWN,
    normalize_flag_states,
)


# ============================================================
# 版本
#
# 合併規則屬於安全語意的一部分，改動時必須更新，
# 否則事後無法回推當時用的是哪一版合併邏輯。
# ============================================================

SAFETY_STATE_VERSION = "2026.09.1"


# ============================================================
# 空狀態
#
# key 與 consultation_safety_state 的欄位一一對應，
# 可以直接寫進 jsonb，不需要轉換層。
# ============================================================

def empty_state() -> Dict[str, Any]:

    return {
        "flag_states": {},
        "established_rules": [],
        "asked_flags": [],
        "resolved_recently": [],
        "turn_count": 0,
    }


# ============================================================
# 旗標合併
#
# 既有 → 本輪 → 結果
#
#   unknown  → 任何值  → 採用新值        （從無資訊到有資訊）
#   present  → unknown → 維持 present    （沒再提不等於消失）
#   absent   → present → present         （風險只能往上）
#   present  → absent  → 維持 present    （見下方說明）
#   absent   → unknown → 維持 absent     （已否認的事不會因沉默而變未知）
#
# 關於 present → absent：
#
# 使用者後來否認先前提過的症狀，可能是更正口誤，也可能是症狀真的緩解了，
# 兩者臨床意義完全不同，而抽取器分不出來。
#
# 這裡的選擇是「狀態同時保留兩個事實」：
# flag_states 維持 present（不讓較晚的否認抹掉較早的陽性），
# 同時把該旗標記進 resolved_recently。
#
# 要不要因為「已緩解」而降級，是規則層的醫學判斷，不是合併層的事。
# 規則需要時可以自己去看 resolved_recently。
#
# 參考：抽取器已有 recent_resolved_neurologic_deficit 旗標，
# 但它只涵蓋「同一句話裡說剛才無力現在好了」，
# 接不住跨輪的 present → absent，所以才需要這一層。
# ============================================================

def merge_flag_states(
    prior_flags: Mapping[str, str] | None,
    incoming_flags: Mapping[str, str] | None,
) -> Dict[str, str]:

    prior = normalize_flag_states(
        prior_flags
    )

    incoming = normalize_flag_states(
        incoming_flags
    )


    merged = dict(
        prior
    )


    for key, incoming_state in incoming.items():

        prior_state = prior.get(
            key,
            STATE_UNKNOWN,
        )


        # 既有是 present：只有 present 能維持，其餘一律不覆蓋
        if prior_state == STATE_PRESENT:
            continue


        # 既有是 absent：只有 present 能翻轉
        if prior_state == STATE_ABSENT:

            if incoming_state == STATE_PRESENT:
                merged[key] = STATE_PRESENT

            continue


        # 既有是 unknown（或沒有這個 key）：採用新值
        merged[key] = incoming_state


    return merged


# ============================================================
# 偵測「本輪被否認、但先前曾為 present」的旗標
#
# 這些旗標在 merge_flag_states 裡維持 present，
# 另外記進 resolved_recently，讓規則層看得到這個轉折。
# ============================================================

def detect_resolved(
    prior_flags: Mapping[str, str] | None,
    incoming_flags: Mapping[str, str] | None,
) -> List[str]:

    prior = normalize_flag_states(
        prior_flags
    )

    incoming = normalize_flag_states(
        incoming_flags
    )


    return sorted(
        key
        for key, incoming_state in incoming.items()
        if incoming_state == STATE_ABSENT
        and prior.get(key) == STATE_PRESENT
    )


# ============================================================
# 累積清單
#
# established_rules / asked_flags / resolved_recently 都是只進不出：
# 「本輪沒再命中」不代表「先前沒成立過」。
#
# 注意 established_rules 目前是純稽核紀錄，沒有任何地方讀它做判斷。
# 跨輪保護靠的是 flag_states 的 present 黏性，不是這個欄位。
# ============================================================

def _accumulate(
    existing: Iterable[str] | None,
    additions: Iterable[str] | None,
) -> List[str]:

    merged = set(
        existing or []
    )

    merged.update(
        additions or []
    )


    return sorted(
        merged
    )


# ============================================================
# 要餵給引擎的旗標
#
# 呼叫順序必須是：
#
#     flags      = merged_for_evaluation(prior_state, incoming)
#     assessment = evaluate_red_flags(flags)
#     state      = advance(prior_state, incoming, assessment)
#
# 把 incoming 直接餵給引擎會讓整層跨輪保護靜默失效 ——
# 本輪沒抽到的旗標會退回 unknown，先前成立的風險就消失了，
# 而且不會有任何錯誤訊息。
#
# 這個函式存在的唯一理由就是讓正確的寫法比錯誤的寫法更順手。
# ============================================================

def merged_for_evaluation(
    prior_state: Mapping[str, Any] | None,
    incoming_flags: Mapping[str, str] | None,
) -> Dict[str, str]:

    return merge_flag_states(
        (prior_state or {}).get(
            "flag_states"
        ),
        incoming_flags,
    )


# ============================================================
# 推進一輪
#
# assessment 是 safety_engine 的輸出，只讀不改；
# 這裡不重新判斷風險，只把已成立的規則代碼累積起來。
#
# 內部會再合併一次旗標，與 merged_for_evaluation 的結果相同，
# 因此呼叫端不需要把合併結果傳進來。
# ============================================================

def advance(
    prior_state: Mapping[str, Any] | None,
    incoming_flags: Mapping[str, str] | None,
    assessment: Mapping[str, Any] | None = None,
    asked_flags: Iterable[str] | None = None,
) -> Dict[str, Any]:

    prior = dict(
        prior_state or empty_state()
    )


    prior_flags = prior.get(
        "flag_states"
    )


    merged_flags = merge_flag_states(
        prior_flags,
        incoming_flags,
    )


    resolved = detect_resolved(
        prior_flags,
        incoming_flags,
    )


    # 本輪命中的規則代碼；assessment 缺席時不累積
    matched_codes = [
        str(
            flag.get(
                "code"
            )
        )
        for flag in (
            (assessment or {}).get(
                "red_flags"
            )
            or []
        )
        if flag.get("code")
    ]


    return {

        "flag_states":
            merged_flags,

        "established_rules":
            _accumulate(
                prior.get(
                    "established_rules"
                ),
                matched_codes,
            ),

        "asked_flags":
            _accumulate(
                prior.get(
                    "asked_flags"
                ),
                asked_flags,
            ),

        "resolved_recently":
            _accumulate(
                prior.get(
                    "resolved_recently"
                ),
                resolved,
            ),

        "turn_count":
            int(
                prior.get(
                    "turn_count"
                )
                or 0
            )
            + 1,
    }


# ============================================================
# Smoke test
#
# 安全相關模組不另建 test_*.py，新增規則時在這裡補案例。
# ============================================================

if __name__ == "__main__":

    P = STATE_PRESENT
    A = STATE_ABSENT
    U = STATE_UNKNOWN

    # --------------------------------------------------------
    # 四條合併規則
    # --------------------------------------------------------

    assert merge_flag_states({}, {"chest_pain": P}) == {"chest_pain": P}
    assert merge_flag_states({"x": U}, {"x": A}) == {"x": A}

    # present 具黏性：沒再提、被否認，都不會消失
    assert merge_flag_states({"x": P}, {"x": U}) == {"x": P}
    assert merge_flag_states({"x": P}, {"x": A}) == {"x": P}

    # 風險只能往上
    assert merge_flag_states({"x": A}, {"x": P}) == {"x": P}

    # 已否認的事不會因為沉默而退回 unknown
    assert merge_flag_states({"x": A}, {"x": U}) == {"x": A}

    # 本輪沒出現的旗標原封不動保留
    assert merge_flag_states({"x": P}, {"y": P}) == {"x": P, "y": P}

    # 無法辨識的值收斂成 unknown，不會蓋掉既有的 present
    assert merge_flag_states({"x": P}, {"x": "yes"}) == {"x": P}

    print("✓ 四條合併規則")


    # --------------------------------------------------------
    # present → absent 另記，且不抹掉 present
    # --------------------------------------------------------

    assert detect_resolved({"x": P}, {"x": A}) == ["x"]
    assert detect_resolved({"x": A}, {"x": A}) == []
    assert detect_resolved({"x": U}, {"x": A}) == []

    print("✓ resolved 偵測")


    # --------------------------------------------------------
    # TIA 情境：第 2 輪說單側無力，第 5 輪說好了
    # --------------------------------------------------------

    state = empty_state()

    state = advance(
        state,
        {"one_sided_weakness": P},
        {"red_flags": [{"code": "NEURO_STROKE_SIGN"}]},
    )

    state = advance(
        state,
        {"one_sided_weakness": A},
    )

    assert state["flag_states"]["one_sided_weakness"] == P, "症狀消失不等於風險解除"
    assert state["resolved_recently"] == ["one_sided_weakness"]
    assert state["established_rules"] == ["NEURO_STROKE_SIGN"], "已成立的規則不因後續輪次解除"
    assert state["turn_count"] == 2

    print("✓ TIA 情境：緩解不抹除風險")


    # --------------------------------------------------------
    # 已成立的阻斷不因其他欄位變 unknown 而解除
    # --------------------------------------------------------

    state = advance(
        empty_state(),
        {"self_harm_intent_or_plan": P},
        {"red_flags": [{"code": "SELF_HARM_INTENT_OR_PLAN"}]},
    )

    state = advance(
        state,
        {"headache": P},
    )

    assert state["established_rules"] == ["SELF_HARM_INTENT_OR_PLAN"]
    assert state["flag_states"]["self_harm_intent_or_plan"] == P

    print("✓ 已成立的阻斷維持")


    # --------------------------------------------------------
    # 追問記錄只進不出
    # --------------------------------------------------------

    state = advance(
        empty_state(),
        {"head_injury": P},
        asked_flags=["taking_anticoagulants"],
    )

    state = advance(
        state,
        {},
        asked_flags=["loss_of_consciousness"],
    )

    assert state["asked_flags"] == [
        "loss_of_consciousness",
        "taking_anticoagulants",
    ]

    print("✓ 追問記錄累積")


    # --------------------------------------------------------
    # merged_for_evaluation：直接餵 incoming 會讓保護失效
    #
    # 這個案例存在是因為實作當下就踩過一次：
    # 用 {**prior, **incoming} 合併時，本輪的值會蓋掉既有 present。
    # --------------------------------------------------------

    state = advance(
        empty_state(),
        {"one_sided_weakness": P},
    )

    correct = merged_for_evaluation(
        state,
        {"one_sided_weakness": A},
    )

    naive = {
        **state["flag_states"],
        **{"one_sided_weakness": A},
    }

    assert correct["one_sided_weakness"] == P, "合併後必須維持 present"
    assert naive["one_sided_weakness"] == A, "天真的 dict 合併會抹掉風險"

    print("✓ merged_for_evaluation 擋住天真合併")


    # --------------------------------------------------------
    # 空輸入不應爆炸
    # --------------------------------------------------------

    assert advance(None, None)["turn_count"] == 1
    assert advance(None, {})["flag_states"] == {}
    assert merge_flag_states(None, None) == {}

    print("✓ 空輸入")

    print("\n✅ safety_state smoke test finished")
