# visit_summary.py

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Sequence


# ============================================================
# Version
# ============================================================

VISIT_SUMMARY_VERSION = "2026.08.2"


# ============================================================
# Constants
# ============================================================

RISK_LABELS = {
    "standard": "一般",
    "urgent": "建議儘快就醫",
    "emergency": "緊急",
    "unknown": "安全評估未完成",
}


# ============================================================
# Basic helpers
# ============================================================

def _clean_text(
    value: Any,
) -> str:
    """
    將任意值轉成乾淨字串。
    """

    if value is None:
        return ""

    text = str(value).strip()

    return text


def _clean_string_list(
    values: Any,
) -> List[str]:
    """
    清理 list[str]。

    支援：
    - list
    - tuple
    - set
    - 單一字串
    """

    if values is None:
        return []

    if isinstance(
        values,
        str,
    ):
        values = [
            values
        ]

    if not isinstance(
        values,
        (
            list,
            tuple,
            set,
        ),
    ):
        return []

    result: List[str] = []

    for value in values:

        text = _clean_text(
            value
        )

        if (
            text
            and
            text not in result
        ):
            result.append(
                text
            )

    return result


def _safe_int(
    value: Any,
) -> Optional[int]:
    """
    安全轉 int。
    """

    try:

        if value is None:
            return None

        return int(
            value
        )

    except (
        TypeError,
        ValueError,
    ):
        return None



# ============================================================
# Profile helpers
# ============================================================

def _calculate_age_from_birth_date(
    value: Any,
) -> Optional[int]:
    """
    從 Profile 的 birth_date 計算目前年齡。

    支援：
    - datetime.date
    - datetime.datetime
    - YYYY-MM-DD
    - ISO datetime string

    無法解析時回傳 None，
    不自行猜測年齡。
    """

    if value is None:
        return None

    birth_date: Optional[date] = None

    if isinstance(value, datetime):
        birth_date = value.date()

    elif isinstance(value, date):
        birth_date = value

    else:
        text = _clean_text(value)

        if not text:
            return None

        try:
            birth_date = datetime.fromisoformat(text).date()

        except ValueError:
            try:
                birth_date = datetime.strptime(
                    text,
                    "%Y-%m-%d",
                ).date()

            except ValueError:
                return None

    if birth_date is None:
        return None

    today = date.today()

    if birth_date > today:
        return None

    age = (
        today.year
        - birth_date.year
        - (
            (today.month, today.day)
            <
            (birth_date.month, birth_date.day)
        )
    )

    if age < 0 or age > 130:
        return None

    return age


def _clean_profile_string_list(
    value: Any,
) -> List[str]:
    """
    清理 Profile 中可能以單一文字欄保存的：
    過敏史、目前用藥、既往病史。

    支援常見分隔符：
    、 , ， ; ； 換行
    """

    if value is None:
        return []

    if isinstance(
        value,
        (
            list,
            tuple,
            set,
        ),
    ):
        return _clean_string_list(value)

    text = _clean_text(value)

    if not text:
        return []

    values = [
        text.replace("\r\n", "\n").replace("\r", "\n")
    ]

    for separator in [
        "、",
        ",",
        "，",
        ";",
        "；",
        "\n",
    ]:
        next_values: List[str] = []

        for item in values:
            next_values.extend(
                item.split(separator)
            )

        values = next_values

    return _clean_string_list(values)


# ============================================================
# History helpers
# ============================================================

def _extract_user_messages(
    history: Optional[
        Sequence[Any]
    ],
) -> List[str]:
    """
    從多輪問診 history 中，
    只抽取使用者自己講過的內容。

    不使用 AI 回答來建立病史，
    避免把 AI 推論誤當成病人陳述。
    """

    if not history:
        return []

    messages: List[str] = []

    for item in history:

        if isinstance(
            item,
            dict,
        ):

            role = _clean_text(
                item.get(
                    "role"
                )
            ).lower()

            content = _clean_text(
                item.get(
                    "content"
                )
            )

        else:

            role = _clean_text(
                getattr(
                    item,
                    "role",
                    "",
                )
            ).lower()

            content = _clean_text(
                getattr(
                    item,
                    "content",
                    "",
                )
            )

        if (
            role == "user"
            and
            content
        ):

            messages.append(
                content
            )

    return messages


def build_symptom_course(
    symptom_text: str,
    history: Optional[
        Sequence[Any]
    ] = None,
) -> Dict[str, Any]:
    """
    建立本次症狀描述與問診過程。

    原則：
    只使用使用者實際輸入，
    不自行新增醫療事實。
    """

    initial_symptom = _clean_text(
        symptom_text
    )

    user_messages = (
        _extract_user_messages(
            history
        )
    )

    # 避免 symptom_text 與 history 第一筆重複
    unique_messages: List[str] = []

    for message in user_messages:

        if (
            message
            not in unique_messages
        ):
            unique_messages.append(
                message
            )

    if (
        initial_symptom
        and
        initial_symptom
        not in unique_messages
    ):
        unique_messages.insert(
            0,
            initial_symptom,
        )

    return {
        "initial_symptom":
            initial_symptom,

        "patient_statements":
            unique_messages,

        "statement_count":
            len(
                unique_messages
            ),
    }


# ============================================================
# Safety Summary
# ============================================================

def build_safety_summary(
    safety: Optional[
        Dict[str, Any]
    ],
) -> Dict[str, Any]:
    """
    將 Safety Engine 結果轉成
    就醫摘要可讀格式。

    Safety Engine 是唯一的安全判斷來源。
    此模組不重新判斷 emergency。
    """

    if not safety:

        return {
            "assessment_available":
                False,

            "risk_level":
                "unknown",

            "risk_label":
                RISK_LABELS[
                    "unknown"
                ],

            "has_red_flags":
                False,

            "red_flags":
                [],

            "safety_action":
                "",

            "requires_human_review":
                True,
        }

    risk_level = _clean_text(
        safety.get(
            "risk_level"
        )
    ) or "unknown"

    raw_red_flags = (
        safety.get(
            "red_flags"
        )
        or
        []
    )

    red_flags: List[
        Dict[str, str]
    ] = []

    for item in raw_red_flags:

        if not isinstance(
            item,
            dict,
        ):
            continue

        code = _clean_text(
            item.get(
                "code"
            )
        )

        title = _clean_text(
            item.get(
                "title"
            )
        )

        reason = _clean_text(
            item.get(
                "reason"
            )
        )

        red_flags.append({
            "code":
                code,

            "title":
                title,

            "reason":
                reason,
        })

    return {
        "assessment_available":
            not bool(
                safety.get(
                    "technical_failure",
                    False,
                )
            ),

        "risk_level":
            risk_level,

        "risk_label":
            safety.get(
                "risk_label"
            )
            or
            RISK_LABELS.get(
                risk_level,
                "未知",
            ),

        "has_red_flags":
            bool(
                safety.get(
                    "has_red_flags",
                    False,
                )
            ),

        "red_flags":
            red_flags,

        "safety_action":
            _clean_text(
                safety.get(
                    "safety_action"
                )
            ),

        "requires_human_review":
            bool(
                safety.get(
                    "requires_human_review",
                    False,
                )
            ),
    }


# ============================================================
# Patient Profile
# ============================================================

def build_patient_context(
    profile: Optional[
        Dict[str, Any]
    ],
) -> Dict[str, Any]:
    """
    將已存在的會員健康 Profile
    整理成就醫摘要。

    不推論、不補值。

    目前正式 Profile schema：
    - birth_date
    - gender
    - past_medical_history
    - allergy_history
    - current_medications

    同時保留舊欄位相容性。
    """

    profile = (
        profile
        or
        {}
    )

    age = _safe_int(
        profile.get(
            "age"
        )
    )

    if age is None:
        age = _calculate_age_from_birth_date(
            profile.get(
                "birth_date"
            )
        )

    biological_sex = _clean_text(
        profile.get(
            "biological_sex"
        )
        or
        profile.get(
            "sex"
        )
        or
        profile.get(
            "gender"
        )
    )

    allergies = _clean_profile_string_list(
        profile.get(
            "allergies"
        )
        or
        profile.get(
            "allergy_history"
        )
    )

    medications = _clean_profile_string_list(
        profile.get(
            "medications"
        )
        or
        profile.get(
            "current_medications"
        )
    )

    chronic_conditions = _clean_profile_string_list(
        profile.get(
            "chronic_conditions"
        )
        or
        profile.get(
            "past_medical_history"
        )
        or
        profile.get(
            "medical_history"
        )
    )

    return {
        "age":
            age,

        "biological_sex":
            biological_sex,

        "allergies":
            allergies,

        "medications":
            medications,

        "chronic_conditions":
            chronic_conditions,

        "has_profile_data":
            bool(
                age is not None
                or
                biological_sex
                or
                allergies
                or
                medications
                or
                chronic_conditions
            ),
    }


# ============================================================
# Doctor-facing text
# ============================================================

def build_handoff_text(
    *,
    symptom_course: Dict[str, Any],
    pain_level: Optional[int],
    suggested_department: str,
    possible_causes: List[str],
    safety_summary: Dict[str, Any],
    patient_context: Dict[str, Any],
) -> str:
    """
    建立可以直接給醫療人員看的摘要文字。

    此文字只能重組已知資料，
    不能生成新的診斷。
    """

    lines: List[str] = []

    # --------------------------------------------------------
    # 主訴
    # --------------------------------------------------------

    initial_symptom = (
        symptom_course.get(
            "initial_symptom"
        )
        or
        ""
    )

    if initial_symptom:

        lines.append(
            f"主訴：{initial_symptom}"
        )


    # --------------------------------------------------------
    # 不適程度
    # --------------------------------------------------------

    if pain_level is not None:

        lines.append(
            f"自評不適程度：{pain_level}/5"
        )


    # --------------------------------------------------------
    # 多輪症狀補充
    # --------------------------------------------------------

    statements = (
        symptom_course.get(
            "patient_statements"
        )
        or
        []
    )

    if len(
        statements
    ) > 1:

        lines.append(
            "問診期間病人補充："
        )

        for statement in statements[
            1:
        ]:

            lines.append(
                f"- {statement}"
            )


    # --------------------------------------------------------
    # Safety
    # --------------------------------------------------------

    risk_label = (
        safety_summary.get(
            "risk_label"
        )
    )

    if risk_label:

        lines.append(
            f"安全風險分級：{risk_label}"
        )


    red_flags = (
        safety_summary.get(
            "red_flags"
        )
        or
        []
    )

    if red_flags:

        lines.append(
            "Safety Engine 偵測警訊："
        )

        for flag in red_flags:

            title = (
                flag.get(
                    "title"
                )
                or
                flag.get(
                    "code"
                )
                or
                "未命名警訊"
            )

            reason = (
                flag.get(
                    "reason"
                )
                or
                ""
            )

            if reason:

                lines.append(
                    f"- {title}：{reason}"
                )

            else:

                lines.append(
                    f"- {title}"
                )


    # --------------------------------------------------------
    # 建議科別
    # --------------------------------------------------------

    if suggested_department:

        lines.append(
            "系統建議就醫科別："
            f"{suggested_department}"
        )


    # --------------------------------------------------------
    # AI 可能原因
    # --------------------------------------------------------

    if possible_causes:

        lines.append(
            "AI 問診曾提出的可能原因"
            "（非診斷）："
        )

        for cause in possible_causes:

            lines.append(
                f"- {cause}"
            )


    # --------------------------------------------------------
    # Profile
    # --------------------------------------------------------

    if patient_context.get(
        "age"
    ) is not None:

        lines.append(
            "年齡："
            f"{patient_context['age']}"
        )


    if patient_context.get(
        "biological_sex"
    ):

        lines.append(
            "生理性別："
            f"{patient_context['biological_sex']}"
        )


    allergies = (
        patient_context.get(
            "allergies"
        )
        or
        []
    )

    if allergies:

        lines.append(
            "已記錄過敏史："
            +
            "、".join(
                allergies
            )
        )


    medications = (
        patient_context.get(
            "medications"
        )
        or
        []
    )

    if medications:

        lines.append(
            "已記錄目前用藥："
            +
            "、".join(
                medications
            )
        )


    chronic_conditions = (
        patient_context.get(
            "chronic_conditions"
        )
        or
        []
    )

    if chronic_conditions:

        lines.append(
            "已記錄慢性病 / 過去病史："
            +
            "、".join(
                chronic_conditions
            )
        )


    return "\n".join(
        lines
    )


# ============================================================
# Main Builder
# ============================================================

def build_visit_summary(
    *,
    symptom_text: str,
    pain_level: Optional[int] = None,
    history: Optional[
        Sequence[Any]
    ] = None,
    suggested_department: Optional[str] = None,
    possible_causes: Any = None,
    safety: Optional[
        Dict[str, Any]
    ] = None,
    profile: Optional[
        Dict[str, Any]
    ] = None,
    session_id: Any = None,
    created_at: Any = None,
) -> Dict[str, Any]:
    """
    CarePath AI 就醫摘要主入口。

    ==========================================================
    設計原則
    ==========================================================

    1. 不自行診斷
    2. 不新增病人沒有提供的症狀
    3. 不新增未記錄的病史 / 用藥 / 過敏
    4. Safety 風險完全沿用 Safety Engine
    5. possible_causes 明確標示「非診斷」
    6. 摘要適合：
       - 就診前查看
       - 給醫師閱讀
       - 未來匯出 PDF / QR / 分享
    """

    symptom_text = _clean_text(
        symptom_text
    )

    if not symptom_text:

        raise ValueError(
            "symptom_text 不可為空"
        )


    normalized_pain_level = (
        _safe_int(
            pain_level
        )
    )


    if (
        normalized_pain_level
        is not None
    ):

        normalized_pain_level = max(
            1,
            min(
                5,
                normalized_pain_level,
            ),
        )


    normalized_department = (
        _clean_text(
            suggested_department
        )
    )


    normalized_causes = (
        _clean_string_list(
            possible_causes
        )
    )


    symptom_course = (
        build_symptom_course(
            symptom_text=(
                symptom_text
            ),
            history=history,
        )
    )


    safety_summary = (
        build_safety_summary(
            safety
        )
    )


    patient_context = (
        build_patient_context(
            profile
        )
    )


    handoff_text = (
        build_handoff_text(
            symptom_course=(
                symptom_course
            ),
            pain_level=(
                normalized_pain_level
            ),
            suggested_department=(
                normalized_department
            ),
            possible_causes=(
                normalized_causes
            ),
            safety_summary=(
                safety_summary
            ),
            patient_context=(
                patient_context
            ),
        )
    )


    generated_at = (
        datetime.now(
            timezone.utc
        )
        .isoformat()
    )


    return {
        "feature":
            "visit_summary",

        "summary_version":
            VISIT_SUMMARY_VERSION,

        "generated_at":
            generated_at,

        "session_id":
            session_id,

        "session_created_at":
            (
                created_at.isoformat()
                if hasattr(
                    created_at,
                    "isoformat",
                )
                else
                created_at
            ),

        "chief_complaint":
            symptom_text,

        "pain_level":
            normalized_pain_level,

        "symptom_course":
            symptom_course,

        "safety":
            safety_summary,

        "recommended_department":
            normalized_department,

        "possible_causes":
            normalized_causes,

        "possible_causes_disclaimer":
            (
                "可能原因來自 AI 問診結果，"
                "僅供就醫溝通參考，"
                "不代表疾病診斷。"
            ),

        "patient_context":
            patient_context,

        "handoff_text":
            handoff_text,

        "disclaimer":
            (
                "此摘要僅整理 CarePath AI 中"
                "已存在的使用者陳述、健康資料與"
                "安全風險評估結果，"
                "供就醫溝通使用；"
                "不能取代醫師問診、身體檢查、"
                "檢驗或正式診斷。"
            ),
    }


# ============================================================
# Preview
# ============================================================

if __name__ == "__main__":

    preview = build_visit_summary(

        session_id=123,

        symptom_text=(
            "我最近持續頭痛，而且有手腳麻木的感覺"
        ),

        pain_level=3,

        history=[
            {
                "role": "user",
                "content":
                    "我最近持續頭痛，而且有手腳麻木的感覺",
            },
            {
                "role": "model",
                "content":
                    "請問麻木是單側還是雙側？",
            },
            {
                "role": "user",
                "content":
                    "主要是右手比較明顯",
            },
        ],

        suggested_department=(
            "神經外科"
        ),

        possible_causes=[
            "偏頭痛",
            "神經壓迫",
        ],

        safety={
            "risk_level":
                "standard",

            "risk_label":
                "一般",

            "technical_failure":
                False,

            "has_red_flags":
                False,

            "red_flags":
                [],

            "requires_human_review":
                False,

            "safety_action":
                "",
        },

        profile={
            "age":
                65,

            "biological_sex":
                "男性",

            "allergies": [
                "青黴素"
            ],

            "medications": [
                "降血壓藥"
            ],

            "chronic_conditions": [
                "高血壓"
            ],
        },
    )


    import json

    print(
        json.dumps(
            preview,
            ensure_ascii=False,
            indent=2,
        )
    )