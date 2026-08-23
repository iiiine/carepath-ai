# safety_pipeline.py
from __future__ import annotations  # ponytail: 本機 venv 是 Python 3.9，沒這行 `X | None` 會炸

from typing import Any, Dict, Optional, Sequence

from symptom_flag_extractor import (
    extract_symptom_flags,
)

from safety_engine import (
    evaluate_red_flags,
)


# ============================================================
# Pipeline Version
# ============================================================

SAFETY_PIPELINE_VERSION = "2026.08.1"


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

def run_safety_pipeline(
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


    try:

        # ====================================================
        # 1. AI 結構化抽取
        # ====================================================

        extraction = (
            extract_symptom_flags(
                symptom_text=symptom_text,
                history=history,
            )
        )


        # ====================================================
        # 2. Rule-based Safety Engine
        # ====================================================

        assessment = (
            evaluate_red_flags(
                extraction[
                    "safety_flags"
                ]
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

            "present_flags":
                extraction.get(
                    "present_flags",
                    [],
                ),

            "absent_flags":
                extraction.get(
                    "absent_flags",
                    [],
                ),

            "unknown_flags":
                extraction.get(
                    "unknown_flags",
                    [],
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