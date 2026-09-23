# safety_pipeline.py
from __future__ import annotations  # ponytail: 本機 venv 是 Python 3.9，沒這行 `X | None` 會炸

import time

from typing import Any, Dict, Optional, Sequence

from symptom_flag_extractor import (
    extract_symptom_flags,
)

from safety_observability import (
    INSUFFICIENT,
    assessment_completeness,
)

from safety_types import (
    STATE_ABSENT,
    STATE_PRESENT,
    STATE_UNKNOWN,
)

from safety_state import (
    advance,
    merged_for_evaluation,
)

from safety_engine import (
    evaluate_red_flags,
)


# ============================================================
# Pipeline Version
# ============================================================

SAFETY_PIPELINE_VERSION = "2026.09.2"


# ============================================================
# Risk labels
# ============================================================

RISK_LABELS = {
    "standard": "一般",
    "urgent": "儘快就醫",
    "emergency": "緊急",
    "unknown": "無法完成安全評估",
}


# ============================================================
# Performance Helper
# ============================================================

def _elapsed_ms(
    start_time: float,
    end_time: float,
) -> float:
    """
    將 perf_counter 秒數差轉成毫秒。
    """

    return round(
        (
            end_time
            -
            start_time
        )
        * 1000,
        1,
    )


# ============================================================
# Safety Pipeline
#
# Natural Language
#       ↓
# Gemini Structured Extraction
#       ↓
# Rule-based Safety Engine
#       ↓
# Final Safety Assessment
# ============================================================

def _flags_in_state(
    flags,
    wanted,
):
    """從合併後的旗標取出指定狀態的鍵，供稽核欄位使用。"""

    return sorted(
        key
        for key, state in (flags or {}).items()
        if state == wanted
    )


def run_safety_pipeline(
    symptom_text: str,
    history: Optional[Sequence[Any]] = None,
    prior_state: Optional[Dict[str, Any]] = None,
    prior_state_unavailable: bool = False,
) -> Dict[str, Any]:
    """
    執行安全評估。

    prior_state 是同一段對話先前累積的跨輪狀態（safety_state 的格式）。
    帶入時，引擎收到的是「合併後」的旗標而非本輪抽取結果 ——
    本輪沒再提到的症狀不會退回 unknown，先前成立的警訊也不會消失。

    不帶 prior_state 時行為與先前完全相同（每輪獨立評估），
    這是訪客與未帶 conversation_id 的用戶端走的路徑。

    prior_state_unavailable 代表「對方帶了 conversation_id，但狀態讀不到」。
    這種情況一律走既有的 fail-safe 分支，不可以當成新對話繼續 ——
    先前很可能已經有成立的警訊，讀不到不等於不存在。
    """

    # ========================================================
    # Performance：
    # 整個 Safety Pipeline 起始時間
    # ========================================================

    pipeline_started_at = (
        time.perf_counter()
    )


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


    try:

        # ====================================================
        # 0. 跨輪狀態讀取失敗 → 直接走 fail-safe
        #
        # 刻意用 raise 交給下面的 except 統一處理，
        # 而不是在這裡另外組一份回應 ——
        # 失敗時的回應格式只能有一個來源。
        # ====================================================

        if prior_state_unavailable:

            raise RuntimeError(
                "跨輪安全狀態無法讀取"
            )


        # ====================================================
        # 1. AI 結構化抽取
        # ====================================================

        extractor_started_at = (
            time.perf_counter()
        )


        extraction = (
            extract_symptom_flags(
                symptom_text=symptom_text,
                history=history,
            )
        )


        extractor_finished_at = (
            time.perf_counter()
        )


        extractor_ms = (
            _elapsed_ms(
                extractor_started_at,
                extractor_finished_at,
            )
        )


        # ====================================================
        # 2. Rule-based Safety Engine
        # ====================================================

        engine_started_at = (
            time.perf_counter()
        )


        # 引擎吃三態，不可再傳 safety_flags（bool）：
        # bool 會被收斂成 unknown，所有規則都不會命中。
        #
        # 也不可以直接傳 extraction["states"]：
        # 那是「本輪」的抽取結果，沒有先前輪次的資訊，
        # 跨輪保護會靜默失效。一律走 merged_for_evaluation。
        merged_flags = merged_for_evaluation(
            prior_state,
            extraction[
                "states"
            ],
        )


        assessment = (
            evaluate_red_flags(
                merged_flags
            )
        )


        # 推進狀態供呼叫端保存；本模組不寫資料庫。
        next_state = advance(
            prior_state,
            extraction[
                "states"
            ],
            assessment,
        )


        engine_finished_at = (
            time.perf_counter()
        )


        engine_ms = (
            _elapsed_ms(
                engine_started_at,
                engine_finished_at,
            )
        )


        risk_level = (
            assessment.get(
                "risk_level",
                "standard",
            )
        )


        # ====================================================
        # 3. 是否需要人工 / 醫療端優先確認
        # ====================================================

        requires_human_review = (
            risk_level
            in {
                "urgent",
                "emergency",
            }
        )


        # ====================================================
        # Performance：
        # 整體 Pipeline 耗時
        # ====================================================

        pipeline_finished_at = (
            time.perf_counter()
        )


        total_ms = (
            _elapsed_ms(
                pipeline_started_at,
                pipeline_finished_at,
            )
        )


        # ====================================================
        # Performance Log
        #
        # 注意：
        # 只寫後端 Console，
        # 不修改 API Response Schema，
        # 避免影響現在前端與 Pydantic Model。
        # ====================================================

        print(
            "\n"
            "⏱️ [Safety Performance]\n"
            f"   total      = {total_ms} ms\n"
            f"   extractor  = {extractor_ms} ms\n"
            f"   rule_engine= {engine_ms} ms\n"
            f"   risk       = {risk_level}"
        )


        # ====================================================
        # 4. 統一結果
        # ====================================================

        return {

            "pipeline_version":
                SAFETY_PIPELINE_VERSION,

            "assessment_status":
                "success",

            "technical_failure":
                False,

            "risk_level":
                risk_level,

            "assessment_completeness":
                assessment_completeness(
                    assessment
                ),

            "risk_label":
                RISK_LABELS.get(
                    risk_level,
                    "未知",
                ),

            "should_stop_normal_flow":
                assessment.get(
                    "should_stop_normal_flow",
                    False,
                ),

            "requires_human_review":
                requires_human_review,

            "has_red_flags":
                assessment.get(
                    "has_red_flags",
                    False,
                ),

            "matched_rule_count":
                assessment.get(
                    "matched_rule_count",
                    0,
                ),

            "red_flags":
                assessment.get(
                    "red_flags",
                    [],
                ),

            "safety_action":
                assessment.get(
                    "safety_action",
                    "",
                ),


            # =================================================
            # Extraction audit data
            # =================================================

            "extractor_version":
                extraction.get(
                    "extractor_version"
                ),

            "engine_version":
                assessment.get(
                    "engine_version"
                ),

            # 稽核欄位反映「引擎實際據以判斷的旗標」，也就是合併後的狀態。
            # 只記本輪抽取會讓快照謊稱判斷基礎，事後無法重現當時的決定。
            "present_flags":
                _flags_in_state(
                    merged_flags,
                    STATE_PRESENT,
                ),

            "absent_flags":
                _flags_in_state(
                    merged_flags,
                    STATE_ABSENT,
                ),

            "next_state":
                next_state,

            "unknown_flags":
                _flags_in_state(
                    merged_flags,
                    STATE_UNKNOWN,
                ),

            "flag_states":
                extraction.get(
                    "states",
                    {},
                ),

            "evidence":
                extraction.get(
                    "evidence",
                    [],
                ),

            "ambiguous_information":
                extraction.get(
                    "ambiguous_information",
                    [],
                ),
        }


    except Exception as exc:

        # ====================================================
        # Performance：
        # 技術失敗時仍記錄整體耗時
        # ====================================================

        failed_at = (
            time.perf_counter()
        )


        failed_total_ms = (
            _elapsed_ms(
                pipeline_started_at,
                failed_at,
            )
        )


        print(
            "\n"
            "⏱️ [Safety Performance - FAILED]\n"
            f"   total      = {failed_total_ms} ms\n"
            f"   error_type = {type(exc).__name__}"
        )


        # ====================================================
        # FAIL-SAFE
        #
        # 非常重要：
        #
        # Safety extraction 如果技術失敗，
        # 絕對不能偷偷回：
        #
        # risk_level = standard
        #
        # 因為：
        #
        # 「沒有完成安全評估」
        # 不等於
        # 「沒有危險」
        #
        # 所以設定：
        #
        # risk_level = unknown
        # should_stop_normal_flow = True
        #
        # 後續 diagnose.py 可以顯示安全降級訊息。
        # ====================================================

        print(
            "❌ Safety Pipeline failed:",
            repr(exc),
        )


        return {

            "pipeline_version":
                SAFETY_PIPELINE_VERSION,

            "assessment_status":
                "unavailable",

            "technical_failure":
                True,

            "risk_level":
                "unknown",

            # 技術失敗時評估當然是不完整的
            "assessment_completeness":
                INSUFFICIENT,

            "risk_label":
                RISK_LABELS[
                    "unknown"
                ],

            "should_stop_normal_flow":
                True,

            "requires_human_review":
                True,

            "has_red_flags":
                False,

            "matched_rule_count":
                0,

            "red_flags":
                [],

            "safety_action": (
                "目前無法完成安全風險篩檢。"
                "系統不應將此次結果視為一般低風險狀況，"
                "也不應僅依賴 AI 問診結果。"
            ),

            "extractor_version":
                None,

            "engine_version":
                None,

            "present_flags":
                [],

            "absent_flags":
                [],

            "unknown_flags":
                [],

            "flag_states":
                {},

            "evidence":
                [],

            "ambiguous_information":
                [],

            "technical_error_type":
                type(exc).__name__,
        }


# ============================================================
# Built-in Preview
#
# 不建立 test_safety_pipeline.py
#
# 執行：
#
# python safety_pipeline.py
#
# 注意：
# 這會實際執行多次 Gemini Safety Extraction。
# Performance Profiling 階段不需要執行它，
# 直接從正式 /diagnose 測一筆即可。
# ============================================================

if __name__ == "__main__":

    examples = [

        {
            "name":
                "一般頭痛",

            "text":
                "我今天有點頭痛，沒有胸痛，也沒有呼吸困難。",
        },

        {
            "name":
                "單純胸痛",

            "text":
                "我現在胸口痛，但沒有喘，也沒有昏倒。",
        },

        {
            "name":
                "胸痛合併呼吸困難與冷汗",

            "text":
                "我現在胸口很痛，而且呼吸困難，一直冒冷汗。",
        },

        {
            "name":
                "疑似中風警訊",

            "text":
                "我的右手突然沒力，而且講話突然變得很含糊。",
        },

    ]


    print(
        "=" * 72
    )

    print(
        "Medical Safety Pipeline Preview"
    )

    print(
        "=" * 72
    )


    for index, example in enumerate(
        examples,
        start=1,
    ):

        print()

        print(
            f"[Case {index}] "
            f"{example['name']}"
        )

        print(
            "輸入：",
            example["text"],
        )


        result = (
            run_safety_pipeline(
                symptom_text=(
                    example["text"]
                )
            )
        )


        print(
            "assessment_status =",
            result[
                "assessment_status"
            ],
        )

        print(
            "risk_level =",
            result[
                "risk_level"
            ],
        )

        print(
            "risk_label =",
            result[
                "risk_label"
            ],
        )

        print(
            "should_stop_normal_flow =",
            result[
                "should_stop_normal_flow"
            ],
        )

        print(
            "requires_human_review =",
            result[
                "requires_human_review"
            ],
        )

        print(
            "present_flags =",
            result[
                "present_flags"
            ],
        )

        print(
            "matched_rule_count =",
            result[
                "matched_rule_count"
            ],
        )


        for rule in result[
            "red_flags"
        ]:

            print(
                "RED FLAG →",
                rule[
                    "code"
                ],
                "/",
                rule[
                    "title"
                ],
            )


        if result[
            "ambiguous_information"
        ]:

            print(
                "ambiguous_information =",
                result[
                    "ambiguous_information"
                ],
            )


        print(
            "-" * 72
        )


    print(
        "✅ Medical Safety Pipeline preview finished"
    )