"""
CarePath AI - Longitudinal Health Intelligence Engine
Competition Upgrade 02 / Refinement 2026.08.2

核心原則：
- 不跨不同健康問題直接比較 pain level。
- 只有相同症狀概念至少出現 2 次時，才建立該症狀的 pain trend。
- 重複科別全部保留，不只顯示第一名。
- 本模組不做疾病診斷、預後預測或急診分級。
- 即時危險症狀仍由 Red Flag Safety Engine 優先處理。
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timezone
from statistics import mean, median
from typing import Any, Dict, Iterable, List, Optional, Tuple


LONGITUDINAL_ENGINE_VERSION = "2026.08.2"

DEFAULT_ANALYSIS_WINDOW_DAYS = 90
MAX_TIMELINE_ITEMS = 12

PAIN_INCREASE_THRESHOLD = 0.35
PAIN_DECREASE_THRESHOLD = -0.35


# ============================================================
# 症狀概念
#
# 用於跨 Session 的「同症狀」比較。
# 這不是疾病分類，也不是診斷模型。
# ============================================================

SYMPTOM_CONCEPTS: Dict[str, Tuple[str, ...]] = {

    "頭痛": (
        "頭痛",
        "頭很痛",
        "頭疼",
        "頭部疼痛",
        "偏頭痛",
    ),

    "頭暈": (
        "頭暈",
        "暈眩",
        "眩暈",
    ),

    "胸痛": (
        "胸痛",
        "胸口痛",
        "胸部疼痛",
        "胸悶痛",
        "胸口悶痛",
    ),

    "胸悶": (
        "胸悶",
        "胸口悶",
        "胸部悶",
    ),

    "呼吸困難": (
        "呼吸困難",
        "喘不過氣",
        "呼吸不順",
        "吸不到氣",
        "喘",
    ),

    "心悸": (
        "心悸",
        "心跳很快",
        "心跳過快",
        "心跳亂",
        "心跳不規則",
    ),

    "發燒": (
        "發燒",
        "高燒",
        "發熱",
        "體溫高",
    ),

    "咳嗽": (
        "咳嗽",
        "一直咳",
        "乾咳",
        "咳痰",
        "有痰",
    ),

    "喉嚨痛": (
        "喉嚨痛",
        "喉嚨疼",
        "喉嚨不舒服",
        "咽喉痛",
    ),

    "流鼻水": (
        "流鼻水",
        "流鼻涕",
        "鼻水",
    ),

    "鼻塞": (
        "鼻塞",
        "鼻子塞",
        "鼻子不通",
    ),

    "腹痛": (
        "腹痛",
        "肚子痛",
        "腹部疼痛",
        "胃痛",
        "肚痛",
    ),

    "噁心": (
        "噁心",
        "反胃",
        "想吐",
    ),

    "嘔吐": (
        "嘔吐",
        "吐了",
        "一直吐",
    ),

    "腹瀉": (
        "腹瀉",
        "拉肚子",
        "水瀉",
        "拉稀",
    ),

    "便秘": (
        "便秘",
        "大不出來",
        "排便困難",
    ),

    "背痛": (
        "背痛",
        "背部疼痛",
        "後背痛",
    ),

    "腰痛": (
        "腰痛",
        "腰痠",
        "腰酸",
        "腰部疼痛",
    ),

    "頸部疼痛": (
        "脖子痛",
        "頸部疼痛",
        "脖子痠",
        "頸部痠痛",
    ),

    "關節痛": (
        "關節痛",
        "關節疼痛",
        "膝蓋痛",
        "肩膀痛",
        "手肘痛",
    ),

    "肢體無力": (
        "手腳無力",
        "肢體無力",
        "單側無力",
        "一邊沒力",
        "半邊沒力",
        "手腳沒力",
    ),

    "麻木": (
        "麻木",
        "手麻",
        "腳麻",
        "手腳麻",
        "發麻",
    ),

    "語言異常": (
        "講話不清楚",
        "說話不清楚",
        "口齒不清",
        "講話含糊",
        "語言困難",
        "講話變得含糊",
    ),

    "昏厥": (
        "昏倒",
        "昏厥",
        "失去意識",
        "暈倒",
    ),

    "疲倦": (
        "疲倦",
        "疲勞",
        "很累",
        "沒精神",
    ),

    "失眠": (
        "失眠",
        "睡不著",
        "難入睡",
        "睡眠不好",
    ),

    "皮膚紅腫": (
        "皮膚紅腫",
        "紅腫",
        "皮膚腫",
    ),

    "皮疹": (
        "皮疹",
        "紅疹",
        "起疹子",
        "疹子",
    ),

    "搔癢": (
        "搔癢",
        "很癢",
        "發癢",
        "皮膚癢",
    ),

    "牙痛": (
        "牙痛",
        "牙齒痛",
        "牙疼",
        "牙齒疼痛",
    ),

    "排尿異常": (
        "頻尿",
        "尿痛",
        "排尿疼痛",
        "尿不出來",
        "血尿",
    ),

    "視力異常": (
        "視力模糊",
        "看不清楚",
        "視野模糊",
        "視力下降",
    ),

    "耳部症狀": (
        "耳鳴",
        "耳痛",
        "耳朵痛",
        "耳朵不舒服",
    ),
}


# ============================================================
# 簡易否定詞
#
# 用於避免：
# 「沒有胸痛」
# 被 keyword matcher 錯誤辨識為胸痛。
#
# Safety Engine 仍使用自己的 Structured Extraction，
# 這裡不取代 Safety Engine。
# ============================================================

NEGATION_TERMS = (
    "沒有",
    "並沒有",
    "並無",
    "無",
    "否認",
    "不是",
    "未出現",
    "未有",
)


# ============================================================
# 基本工具
# ============================================================

def _safe_text(
    value: Any,
) -> str:

    if value is None:
        return ""

    return str(
        value
    ).strip()


def _safe_int(
    value: Any,
    default: int = 0,
) -> int:

    try:

        return int(
            value
        )

    except (
        TypeError,
        ValueError,
    ):

        return default


def _parse_datetime(
    value: Any,
) -> Optional[datetime]:

    if value is None:
        return None


    if isinstance(
        value,
        datetime,
    ):

        if value.tzinfo:

            return value

        return value.replace(
            tzinfo=timezone.utc
        )


    if isinstance(
        value,
        date,
    ):

        return datetime(
            value.year,
            value.month,
            value.day,
            tzinfo=timezone.utc,
        )


    text = str(
        value
    ).strip()


    if not text:
        return None


    # --------------------------------------------------------
    # ISO 8601
    # --------------------------------------------------------

    try:

        parsed = datetime.fromisoformat(
            text.replace(
                "Z",
                "+00:00",
            )
        )

        if parsed.tzinfo:

            return parsed

        return parsed.replace(
            tzinfo=timezone.utc
        )

    except ValueError:

        pass


    # --------------------------------------------------------
    # 常見 PostgreSQL / API 日期格式
    # --------------------------------------------------------

    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    ):

        try:

            return datetime.strptime(
                text,
                fmt,
            ).replace(
                tzinfo=timezone.utc
            )

        except ValueError:

            continue


    return None


def _normalize_text(
    text: str,
) -> str:

    return (
        _safe_text(
            text
        )
        .replace(
            " ",
            "",
        )
        .replace(
            "\n",
            "",
        )
        .replace(
            "\r",
            "",
        )
        .lower()
    )


def _deduplicate_strings(
    values: Iterable[str],
) -> List[str]:

    result: List[str] = []

    seen = set()


    for value in values:

        text = _safe_text(
            value
        )


        if not text:

            continue


        if text in seen:

            continue


        seen.add(
            text
        )

        result.append(
            text
        )


    return result


# ============================================================
# Session 正規化
# ============================================================

def normalize_session(
    raw_session: Dict[str, Any],
) -> Dict[str, Any]:

    symptom_text = (

        _safe_text(
            raw_session.get(
                "original_symptom"
            )
        )

        or

        _safe_text(
            raw_session.get(
                "symptom_text"
            )
        )
    )


    pain_level = _safe_int(
        raw_session.get(
            "pain_level"
        ),
        0,
    )


    if (
        pain_level < 1
        or
        pain_level > 5
    ):

        pain_level = 0


    possible_causes = raw_session.get(
        "possible_causes"
    )


    if not isinstance(
        possible_causes,
        list,
    ):

        possible_causes = []


    return {

        "id":
            raw_session.get(
                "id"
            ),

        "symptom_text":
            symptom_text,

        "pain_level":
            pain_level,

        "suggested_department":
            _safe_text(
                raw_session.get(
                    "suggested_department"
                )
            ),

        "possible_causes":
            _deduplicate_strings(
                possible_causes
            ),

        "created_at":
            _parse_datetime(
                raw_session.get(
                    "created_at"
                )
            ),
    }


# ============================================================
# 症狀概念抽取
# ============================================================

def _keyword_has_non_negated_match(
    normalized_text: str,
    keyword: str,
) -> bool:
    """
    輕量否定詞處理。

    例如：
    「沒有胸痛」
    不應被縱向分析記成胸痛。

    注意：
    這不是 Safety Engine 的醫療級抽取。
    """

    keyword = _normalize_text(
        keyword
    )


    start = 0


    while True:

        index = normalized_text.find(
            keyword,
            start,
        )


        if index == -1:

            return False


        # ----------------------------------------------------
        # 往症狀關鍵字前面看一小段文字
        # ----------------------------------------------------

        prefix = normalized_text[
            max(
                0,
                index - 6,
            ):
            index
        ]


        negated = any(

            prefix.endswith(
                term
            )

            or

            term in prefix[
                -4:
            ]

            for term in NEGATION_TERMS
        )


        if not negated:

            return True


        start = (
            index
            +
            len(
                keyword
            )
        )


def extract_symptom_concepts(
    symptom_text: str,
) -> List[str]:

    normalized_text = _normalize_text(
        symptom_text
    )


    if not normalized_text:

        return []


    detected: List[str] = []


    for concept, keywords in (
        SYMPTOM_CONCEPTS.items()
    ):

        for keyword in keywords:

            if _keyword_has_non_negated_match(
                normalized_text,
                keyword,
            ):

                detected.append(
                    concept
                )

                break


    return detected


# ============================================================
# Pain Trend 基礎演算法
# ============================================================

def _linear_regression_slope(
    values: List[float],
) -> float:

    if len(
        values
    ) < 2:

        return 0.0


    x_values = list(
        range(
            len(
                values
            )
        )
    )


    x_mean = mean(
        x_values
    )

    y_mean = mean(
        values
    )


    numerator = sum(

        (
            x
            -
            x_mean
        )
        *
        (
            y
            -
            y_mean
        )

        for x, y in zip(
            x_values,
            values,
        )
    )


    denominator = sum(

        (
            x
            -
            x_mean
        )
        ** 2

        for x in x_values
    )


    if denominator == 0:

        return 0.0


    return (
        numerator
        /
        denominator
    )


def analyze_pain_trend(
    sessions: List[
        Dict[str, Any]
    ],
) -> Dict[str, Any]:
    """
    只用於：
    已確認屬於「同一症狀概念」的一組 Sessions。

    不允許把不同健康問題直接串在一起比較。
    """

    pain_points = [

        {
            "session_id":
                session.get(
                    "id"
                ),

            "created_at":
                (
                    session[
                        "created_at"
                    ].isoformat()

                    if session.get(
                        "created_at"
                    )

                    else None
                ),

            "pain_level":
                session.get(
                    "pain_level"
                ),
        }

        for session in sessions

        if session.get(
            "pain_level",
            0,
        ) > 0
    ]


    values = [

        point[
            "pain_level"
        ]

        for point in pain_points
    ]


    if not values:

        return {

            "status":
                "no_data",

            "trend":
                "unknown",

            "trend_label":
                "沒有可比較的不適程度資料",

            "latest":
                None,

            "average":
                None,

            "maximum":
                None,

            "minimum":
                None,

            "slope":
                0.0,

            "data_points":
                [],
        }


    if len(
        values
    ) == 1:

        return {

            "status":
                "insufficient_data",

            "trend":
                "insufficient_data",

            "trend_label":
                "尚無法判斷趨勢",

            "latest":
                values[
                    -1
                ],

            "average":
                round(
                    float(
                        mean(
                            values
                        )
                    ),
                    2,
                ),

            "maximum":
                max(
                    values
                ),

            "minimum":
                min(
                    values
                ),

            "slope":
                0.0,

            "data_points":
                pain_points,
        }


    slope = _linear_regression_slope(
        [
            float(
                value
            )
            for value in values
        ]
    )


    # --------------------------------------------------------
    # 只有兩筆時直接看差值
    # --------------------------------------------------------

    if len(
        values
    ) == 2:

        difference = (
            values[
                -1
            ]
            -
            values[
                0
            ]
        )


        if difference >= 1:

            trend = "increasing"

            label = "不適程度上升"


        elif difference <= -1:

            trend = "decreasing"

            label = "不適程度下降"


        else:

            trend = "stable"

            label = "不適程度大致穩定"


    # --------------------------------------------------------
    # 三筆以上使用 regression slope
    # --------------------------------------------------------

    else:

        if (
            slope
            >=
            PAIN_INCREASE_THRESHOLD
        ):

            trend = "increasing"

            label = "不適程度呈上升趨勢"


        elif (
            slope
            <=
            PAIN_DECREASE_THRESHOLD
        ):

            trend = "decreasing"

            label = "不適程度呈下降趨勢"


        elif (
            max(
                values
            )
            -
            min(
                values
            )
        ) >= 3:

            trend = "variable"

            label = "不適程度波動較大"


        else:

            trend = "stable"

            label = "不適程度大致穩定"


    return {

        "status":
            "success",

        "trend":
            trend,

        "trend_label":
            label,

        "latest":
            values[
                -1
            ],

        "average":
            round(
                float(
                    mean(
                        values
                    )
                ),
                2,
            ),

        "maximum":
            max(
                values
            ),

        "minimum":
            min(
                values
            ),

        "slope":
            round(
                float(
                    slope
                ),
                3,
            ),

        "data_points":
            pain_points,
    }


# ============================================================
# 症狀別 Pain Trend
# ============================================================

def analyze_symptom_pain_trends(
    sessions: List[
        Dict[str, Any]
    ],
) -> List[
    Dict[str, Any]
]:
    """
    只有相同症狀概念至少出現 2 次，
    才建立 pain trend。

    可以：
        頭痛 2
        頭痛 4
        頭痛 5
        → increasing

    不可以：
        牙痛 3
        腹痛 2
        頭暈 1
        → decreasing
    """

    sessions_by_concept: Dict[
        str,
        List[
            Dict[str, Any]
        ],
    ] = {}


    for session in sessions:

        concepts = set(
            extract_symptom_concepts(
                session.get(
                    "symptom_text",
                    "",
                )
            )
        )


        for concept in concepts:

            sessions_by_concept.setdefault(
                concept,
                [],
            ).append(
                session
            )


    results: List[
        Dict[str, Any]
    ] = []


    for (
        concept,
        concept_sessions,
    ) in sessions_by_concept.items():

        pain_session_count = sum(

            1

            for session in concept_sessions

            if session.get(
                "pain_level",
                0,
            ) > 0
        )


        # ----------------------------------------------------
        # 少於兩次同症狀，不稱為趨勢
        # ----------------------------------------------------

        if pain_session_count < 2:

            continue


        trend = analyze_pain_trend(
            concept_sessions
        )


        results.append(
            {

                "symptom":
                    concept,

                "session_count":
                    len(
                        concept_sessions
                    ),

                **trend,
            }
        )


    # --------------------------------------------------------
    # 優先把值得注意的趨勢放前面
    # --------------------------------------------------------

    priority = {

        "increasing":
            0,

        "variable":
            1,

        "stable":
            2,

        "decreasing":
            3,

        "insufficient_data":
            4,

        "unknown":
            5,
    }


    results.sort(

        key=lambda item: (

            priority.get(
                item.get(
                    "trend"
                ),
                99,
            ),

            -item.get(
                "session_count",
                0,
            ),

            item.get(
                "symptom",
                "",
            ),
        )
    )


    return results


# ============================================================
# Pain Trend 摘要
# ============================================================

def summarize_pain_trends(
    symptom_pain_trends: List[
        Dict[str, Any]
    ],
) -> Dict[str, Any]:
    """
    不再輸出跨不同症狀的 global slope。
    """

    if not symptom_pain_trends:

        return {

            "status":
                "not_comparable",

            "trend":
                "not_comparable",

            "trend_label":
                "目前沒有足夠的同症狀資料可比較",

            "comparison_basis":
                "same_symptom_only",

            "comparable_symptom_count":
                0,

            "symptom_trends":
                [],
        }


    trend_types = {

        item.get(
            "trend"
        )

        for item in symptom_pain_trends

        if item.get(
            "trend"
        )
    }


    if len(
        trend_types
    ) == 1:

        only_trend = next(
            iter(
                trend_types
            )
        )


        label_map = {

            "increasing":
                "有重複症狀的不適程度呈上升趨勢",

            "decreasing":
                "有重複症狀的不適程度呈下降趨勢",

            "stable":
                "重複症狀的不適程度大致穩定",

            "variable":
                "重複症狀的不適程度有明顯波動",
        }


        summary_trend = (
            only_trend
        )


        summary_label = (
            label_map.get(
                only_trend,
                "已建立同症狀不適程度趨勢",
            )
        )


    else:

        summary_trend = (
            "mixed"
        )


        summary_label = (
            "不同重複症狀呈現不同的不適程度變化"
        )


    return {

        "status":
            "success",

        "trend":
            summary_trend,

        "trend_label":
            summary_label,

        "comparison_basis":
            "same_symptom_only",

        "comparable_symptom_count":
            len(
                symptom_pain_trends
            ),

        "symptom_trends":
            symptom_pain_trends,
    }


# ============================================================
# 問診頻率
# ============================================================

def analyze_visit_frequency(
    sessions: List[
        Dict[str, Any]
    ],
    now: Optional[
        datetime
    ] = None,
) -> Dict[str, Any]:

    if now is None:

        now = datetime.now(
            timezone.utc
        )


    dates = [

        session[
            "created_at"
        ]

        for session in sessions

        if session.get(
            "created_at"
        )
        is not None
    ]


    last_30_days = sum(

        1

        for item in dates

        if
        0
        <=
        (
            now
            -
            item
        ).days
        <=
        30
    )


    last_90_days = sum(

        1

        for item in dates

        if
        0
        <=
        (
            now
            -
            item
        ).days
        <=
        90
    )


    intervals: List[
        int
    ] = []


    if len(
        dates
    ) >= 2:

        ordered_dates = sorted(
            dates
        )


        for (
            previous,
            current,
        ) in zip(
            ordered_dates,
            ordered_dates[
                1:
            ],
        ):

            interval = (
                current
                -
                previous
            ).days


            if interval >= 0:

                intervals.append(
                    interval
                )


    median_interval = (

        round(
            float(
                median(
                    intervals
                )
            ),
            1,
        )

        if intervals

        else None
    )


    if last_30_days >= 3:

        pattern = (
            "frequent"
        )

        label = (
            "近期問診頻率較高"
        )


    elif last_90_days >= 5:

        pattern = (
            "recurrent"
        )

        label = (
            "近三個月有多次問診紀錄"
        )


    elif len(
        sessions
    ) >= 2:

        pattern = (
            "occasional"
        )

        label = (
            "已有多次歷史問診"
        )


    elif len(
        sessions
    ) == 1:

        pattern = (
            "single"
        )

        label = (
            "目前只有一次問診紀錄"
        )


    else:

        pattern = (
            "none"
        )

        label = (
            "目前沒有歷史問診資料"
        )


    return {

        "total_sessions":
            len(
                sessions
            ),

        "last_30_days":
            last_30_days,

        "last_90_days":
            last_90_days,

        "median_interval_days":
            median_interval,

        "pattern":
            pattern,

        "pattern_label":
            label,
    }


# ============================================================
# 重複症狀
# ============================================================

def analyze_recurring_symptoms(
    sessions: List[
        Dict[str, Any]
    ],
) -> List[
    Dict[str, Any]
]:

    counter: Counter[
        str
    ] = Counter()


    session_ids_by_concept: Dict[
        str,
        List[Any],
    ] = {}


    for session in sessions:

        concepts = set(
            extract_symptom_concepts(
                session.get(
                    "symptom_text",
                    "",
                )
            )
        )


        for concept in concepts:

            counter[
                concept
            ] += 1


            session_ids_by_concept.setdefault(
                concept,
                [],
            ).append(
                session.get(
                    "id"
                )
            )


    return [

        {

            "symptom":
                concept,

            "session_count":
                count,

            "session_ids":
                session_ids_by_concept.get(
                    concept,
                    [],
                ),
        }

        for (
            concept,
            count,
        ) in counter.most_common()

        if count >= 2
    ]


# ============================================================
# 重複科別
# ============================================================

def analyze_department_patterns(
    sessions: List[
        Dict[str, Any]
    ],
) -> List[
    Dict[str, Any]
]:

    counter: Counter[
        str
    ] = Counter()


    for session in sessions:

        department = _safe_text(
            session.get(
                "suggested_department"
            )
        )


        if department:

            counter[
                department
            ] += 1


    return [

        {

            "department":
                department,

            "session_count":
                count,
        }

        for (
            department,
            count,
        ) in counter.most_common()

        if count >= 2
    ]


# ============================================================
# 重複可能原因
# ============================================================

def _normalize_cause(
    cause: str,
) -> str:

    text = _safe_text(
        cause
    )


    for word in (

        "可能為",
        "可能是",
        "可能",
        "疑似",
        "考慮",
    ):

        if text.startswith(
            word
        ):

            return text[
                len(
                    word
                ):
            ].strip()


    return text


def analyze_recurring_causes(
    sessions: List[
        Dict[str, Any]
    ],
) -> List[
    Dict[str, Any]
]:

    counter: Counter[
        str
    ] = Counter()


    for session in sessions:

        normalized_causes = {


            _normalize_cause(
                cause
            )

            for cause in session.get(
                "possible_causes",
                [],
            )

            if _normalize_cause(
                cause
            )
        }


        for cause in normalized_causes:

            counter[
                cause
            ] += 1


    return [

        {

            "cause":
                cause,

            "session_count":
                count,

            "disclaimer":
                (
                    "此項為歷次 AI 問診中的重複可能原因，"
                    "不代表疾病確診。"
                ),
        }

        for (
            cause,
            count,
        ) in counter.most_common()

        if count >= 2
    ]


# ============================================================
# Timeline
# ============================================================

def build_timeline(
    sessions: List[
        Dict[str, Any]
    ],
) -> List[
    Dict[str, Any]
]:

    timeline = []


    for session in sessions[
        -MAX_TIMELINE_ITEMS:
    ]:

        created_at = session.get(
            "created_at"
        )


        timeline.append(
            {

                "session_id":
                    session.get(
                        "id"
                    ),

                "created_at":
                    (
                        created_at.isoformat()

                        if created_at

                        else None
                    ),

                "symptom_text":
                    session.get(
                        "symptom_text",
                        "",
                    ),

                "symptom_concepts":
                    extract_symptom_concepts(
                        session.get(
                            "symptom_text",
                            "",
                        )
                    ),

                "pain_level":
                    (
                        session.get(
                            "pain_level"
                        )

                        or None
                    ),

                "suggested_department":
                    (
                        session.get(
                            "suggested_department"
                        )

                        or None
                    ),

                "possible_causes":
                    session.get(
                        "possible_causes",
                        [],
                    ),
            }
        )


    return timeline


# ============================================================
# Explainable Insights
# ============================================================

def build_longitudinal_insights(
    pain_analysis: Dict[
        str,
        Any,
    ],
    frequency_analysis: Dict[
        str,
        Any,
    ],
    recurring_symptoms: List[
        Dict[str, Any]
    ],
    department_patterns: List[
        Dict[str, Any]
    ],
    recurring_causes: List[
        Dict[str, Any]
    ],
) -> List[
    Dict[str, Any]
]:

    insights: List[
        Dict[str, Any]
    ] = []


    # ========================================================
    # 1. 相同症狀 Pain Trend
    # ========================================================

    for item in pain_analysis.get(
        "symptom_trends",
        [],
    )[
        :3
    ]:

        symptom = item.get(
            "symptom",
            "該症狀",
        )


        trend = item.get(
            "trend"
        )


        # ----------------------------------------------------
        # Increasing
        # ----------------------------------------------------

        if trend == "increasing":

            insights.append(
                {

                    "code":
                        "SYMPTOM_PAIN_TREND_INCREASING",

                    "level":
                        "attention",

                    "title":
                        (
                            f"「{symptom}」的不適程度呈上升趨勢"
                        ),

                    "description":
                        (
                            "只比較歷次出現相同症狀概念的問診後，"
                            "其不適程度有上升趨勢。"
                        ),

                    "evidence":
                        {

                            "symptom":
                                symptom,

                            "session_count":
                                item.get(
                                    "session_count"
                                ),

                            "latest_pain_level":
                                item.get(
                                    "latest"
                                ),

                            "average_pain_level":
                                item.get(
                                    "average"
                                ),

                            "maximum_pain_level":
                                item.get(
                                    "maximum"
                                ),

                            "trend_slope":
                                item.get(
                                    "slope"
                                ),
                        },

                    "recommendation":
                        (
                            "若相同症狀持續、加重或影響日常活動，"
                            "建議安排醫療評估。"
                        ),
                }
            )


        # ----------------------------------------------------
        # Variable
        # ----------------------------------------------------

        elif trend == "variable":

            insights.append(
                {

                    "code":
                        "SYMPTOM_PAIN_TREND_VARIABLE",

                    "level":
                        "info",

                    "title":
                        (
                            f"「{symptom}」的不適程度波動較大"
                        ),

                    "description":
                        (
                            "相同症狀在不同問診中的"
                            "不適程度差異較明顯。"
                        ),

                    "evidence":
                        {

                            "symptom":
                                symptom,

                            "minimum_pain_level":
                                item.get(
                                    "minimum"
                                ),

                            "maximum_pain_level":
                                item.get(
                                    "maximum"
                                ),
                        },

                    "recommendation":
                        (
                            "可持續記錄發作時間、"
                            "強度與可能誘因。"
                        ),
                }
            )


        # ----------------------------------------------------
        # Decreasing
        # ----------------------------------------------------

        elif trend == "decreasing":

            insights.append(
                {

                    "code":
                        "SYMPTOM_PAIN_TREND_DECREASING",

                    "level":
                        "info",

                    "title":
                        (
                            f"「{symptom}」的不適程度呈下降趨勢"
                        ),

                    "description":
                        (
                            "只比較相同症狀概念的歷史問診後，"
                            "其不適程度目前呈下降趨勢。"
                        ),

                    "evidence":
                        {

                            "symptom":
                                symptom,

                            "session_count":
                                item.get(
                                    "session_count"
                                ),

                            "latest_pain_level":
                                item.get(
                                    "latest"
                                ),

                            "average_pain_level":
                                item.get(
                                    "average"
                                ),
                        },

                    "recommendation":
                        (
                            "仍建議依實際症狀持續時間與"
                            "變化決定是否就醫。"
                        ),
                }
            )


    # ========================================================
    # 2. 系統問診頻率
    # ========================================================

    pattern = frequency_analysis.get(
        "pattern"
    )


    if pattern == "frequent":

        insights.append(
            {

                "code":
                    "FREQUENT_RECENT_CONSULTATIONS",

                "level":
                    "attention",

                "title":
                    "近期問診頻率較高",

                "description":
                    (
                        f"最近 30 天已有 "
                        f"{frequency_analysis.get('last_30_days', 0)} "
                        "次系統問診紀錄。"
                    ),

                "evidence":
                    {

                        "last_30_days":
                            frequency_analysis.get(
                                "last_30_days"
                            ),

                        "last_90_days":
                            frequency_analysis.get(
                                "last_90_days"
                            ),
                    },

                "recommendation":
                    (
                        "若多次問診與相同或相關症狀有關，"
                        "建議將歷史紀錄提供給醫療人員做整體評估。"
                    ),
            }
        )


    elif pattern == "recurrent":

        insights.append(
            {

                "code":
                    "RECURRENT_CONSULTATIONS",

                "level":
                    "info",

                "title":
                    "近三個月有多次問診紀錄",

                "description":
                    (
                        f"最近 90 天共有 "
                        f"{frequency_analysis.get('last_90_days', 0)} "
                        "次系統問診紀錄。"
                    ),

                "evidence":
                    {

                        "last_90_days":
                            frequency_analysis.get(
                                "last_90_days"
                            ),
                    },

                "recommendation":
                    (
                        "可將歷次症狀變化整理後"
                        "提供就醫時參考。"
                    ),
            }
        )


    # ========================================================
    # 3. 重複症狀
    # ========================================================

    for item in recurring_symptoms[
        :3
    ]:

        insights.append(
            {

                "code":
                    "RECURRING_SYMPTOM",

                "level":
                    "attention",

                "title":
                    (
                        f"「{item['symptom']}」曾重複出現"
                    ),

                "description":
                    (
                        f"此症狀概念在 "
                        f"{item['session_count']} "
                        "次不同問診中出現。"
                    ),

                "evidence":
                    {

                        "symptom":
                            item[
                                "symptom"
                            ],

                        "session_count":
                            item[
                                "session_count"
                            ],
                    },

                "recommendation":
                    (
                        "若為反覆或持續發作，"
                        "建議就醫時主動告知醫療人員"
                        "發作頻率與時間變化。"
                    ),
            }
        )


    # ========================================================
    # 4. 重複推薦科別
    #
    # 重要修正：
    # 不再只取 department_patterns[0]
    # ========================================================

    for item in department_patterns[
        :5
    ]:

        insights.append(
            {

                "code":
                    "REPEATED_DEPARTMENT_RECOMMENDATION",

                "level":
                    "info",

                "title":
                    (
                        f"多次問診曾建議「{item['department']}」"
                    ),

                "description":
                    (
                        f"歷史紀錄中共有 "
                        f"{item['session_count']} "
                        "次問診推薦此科別。"
                    ),

                "evidence":
                    {

                        "department":
                            item[
                                "department"
                            ],

                        "session_count":
                            item[
                                "session_count"
                            ],
                    },

                "recommendation":
                    (
                        "此結果只反映歷次 AI 分流紀錄；"
                        "實際就醫科別仍應依目前症狀"
                        "與醫療專業判斷。"
                    ),
            }
        )


    # ========================================================
    # 5. 重複可能原因
    # ========================================================

    for item in recurring_causes[
        :3
    ]:

        insights.append(
            {

                "code":
                    "RECURRING_POSSIBLE_CAUSE",

                "level":
                    "info",

                "title":
                    (
                        f"「{item['cause']}」"
                        "曾多次出現在可能原因"
                    ),

                "description":
                    (
                        f"此可能原因曾出現在 "
                        f"{item['session_count']} "
                        "次歷史 AI 問診結果中。"
                    ),

                "evidence":
                    {

                        "cause":
                            item[
                                "cause"
                            ],

                        "session_count":
                            item[
                                "session_count"
                            ],
                    },

                "recommendation":
                    (
                        "這不是疾病確診，"
                        "但可作為就醫時描述歷史症狀的參考。"
                    ),
            }
        )


    return insights


# ============================================================
# Overall Status
# ============================================================

def determine_longitudinal_status(
    insights: List[
        Dict[str, Any]
    ],
) -> Dict[
    str,
    str,
]:

    attention_count = sum(

        1

        for insight in insights

        if insight.get(
            "level"
        )
        ==
        "attention"
    )


    if attention_count >= 2:

        return {

            "status":
                "watch",

            "label":
                "建議持續關注",

            "description":
                (
                    "歷史問診中觀察到多項重複或變化趨勢，"
                    "建議持續追蹤並於就醫時提供完整歷史資訊。"
                ),
        }


    if attention_count == 1:

        return {

            "status":
                "watch",

            "label":
                "有值得注意的變化",

            "description":
                (
                    "歷史問診中觀察到一項"
                    "值得持續追蹤的變化。"
                ),
        }


    return {

        "status":
            "stable",

        "label":
            "目前未見明顯反覆或惡化趨勢",

        "description":
            (
                "依目前可用的歷史問診資料，"
                "未觀察到明確的反覆或惡化模式。"
            ),
    }


# ============================================================
# 主分析入口
# ============================================================

def analyze_longitudinal_sessions(
    raw_sessions: List[
        Dict[str, Any]
    ],
    analysis_window_days: int = (
        DEFAULT_ANALYSIS_WINDOW_DAYS
    ),
    now: Optional[
        datetime
    ] = None,
) -> Dict[
    str,
    Any,
]:

    if now is None:

        now = datetime.now(
            timezone.utc
        )


    # ========================================================
    # Normalize
    # ========================================================

    normalized_sessions = [

        normalize_session(
            session
        )

        for session in raw_sessions
    ]


    normalized_sessions = [

        session

        for session in normalized_sessions

        if (

            session.get(
                "symptom_text"
            )

            or

            session.get(
                "suggested_department"
            )

            or

            session.get(
                "possible_causes"
            )
        )
    ]


    normalized_sessions.sort(

        key=lambda item: (

            item.get(
                "created_at"
            )

            or

            datetime.min.replace(
                tzinfo=timezone.utc
            )
        )
    )


    # ========================================================
    # 沒有資料
    # ========================================================

    if not normalized_sessions:

        empty_pain = (
            summarize_pain_trends(
                []
            )
        )


        return {

            "analysis_status":
                "insufficient_data",

            "engine_version":
                LONGITUDINAL_ENGINE_VERSION,

            "overall":
                {

                    "status":
                        "insufficient_data",

                    "label":
                        "尚無足夠歷史資料",

                    "description":
                        (
                            "目前尚無可供縱向比較的"
                            "歷史問診紀錄。"
                        ),
                },

            "analysis_window_days":
                analysis_window_days,

            "total_sessions":
                0,

            "analyzed_sessions":
                0,

            "date_range":
                {

                    "first":
                        None,

                    "latest":
                        None,
                },

            "pain_trend":
                empty_pain,

            "symptom_pain_trends":
                [],

            "visit_frequency":
                analyze_visit_frequency(
                    [],
                    now=now,
                ),

            "recurring_symptoms":
                [],

            "department_patterns":
                [],

            "recurring_possible_causes":
                [],

            "insights":
                [],

            "timeline":
                [],

            "disclaimer":
                (
                    "縱向健康分析僅用於整理歷史問診變化，"
                    "不提供疾病確診，也不取代醫師評估。"
                ),
        }


    # ========================================================
    # 分析時間窗
    # ========================================================

    window_sessions: List[
        Dict[str, Any]
    ] = []


    for session in normalized_sessions:

        created_at = session.get(
            "created_at"
        )


        # ----------------------------------------------------
        # 無日期資料仍保留，
        # 但不能用來計算時間頻率。
        # ----------------------------------------------------

        if created_at is None:

            window_sessions.append(
                session
            )

            continue


        age_days = (
            now
            -
            created_at
        ).days


        if (
            0
            <=
            age_days
            <=
            analysis_window_days
        ):

            window_sessions.append(
                session
            )


    # --------------------------------------------------------
    # 若時間窗內完全沒有紀錄，
    # 至少保留最近紀錄供歷史呈現。
    # --------------------------------------------------------

    if not window_sessions:

        window_sessions = (
            normalized_sessions[
                -MAX_TIMELINE_ITEMS:
            ]
        )


    # ========================================================
    # 症狀別 Pain Trend
    # ========================================================

    symptom_pain_trends = (
        analyze_symptom_pain_trends(
            window_sessions
        )
    )


    pain_analysis = (
        summarize_pain_trends(
            symptom_pain_trends
        )
    )


    # ========================================================
    # Visit Frequency
    # ========================================================

    frequency_analysis = (
        analyze_visit_frequency(
            normalized_sessions,
            now=now,
        )
    )


    # ========================================================
    # Recurrent Patterns
    # ========================================================

    recurring_symptoms = (
        analyze_recurring_symptoms(
            window_sessions
        )
    )


    department_patterns = (
        analyze_department_patterns(
            window_sessions
        )
    )


    recurring_causes = (
        analyze_recurring_causes(
            window_sessions
        )
    )


    # ========================================================
    # Explainable Insights
    # ========================================================

    insights = (
        build_longitudinal_insights(

            pain_analysis=
                pain_analysis,

            frequency_analysis=
                frequency_analysis,

            recurring_symptoms=
                recurring_symptoms,

            department_patterns=
                department_patterns,

            recurring_causes=
                recurring_causes,
        )
    )


    overall = (
        determine_longitudinal_status(
            insights
        )
    )


    # ========================================================
    # 只有一筆資料不能稱為 Longitudinal Trend
    # ========================================================

    if len(
        window_sessions
    ) < 2:

        overall = {

            "status":
                "insufficient_data",

            "label":
                "歷史資料仍不足",

            "description":
                (
                    "目前只有一次可比較的問診紀錄，"
                    "需要至少兩次歷史問診才能進行"
                    "較有意義的變化分析。"
                ),
        }


    first_datetime = (
        normalized_sessions[
            0
        ].get(
            "created_at"
        )
    )


    latest_datetime = (
        normalized_sessions[
            -1
        ].get(
            "created_at"
        )
    )


    # ========================================================
    # Result
    # ========================================================

    return {

        "analysis_status":
            (
                "success"

                if len(
                    window_sessions
                ) >= 2

                else
                "insufficient_data"
            ),

        "engine_version":
            LONGITUDINAL_ENGINE_VERSION,

        "overall":
            overall,

        "analysis_window_days":
            analysis_window_days,

        "total_sessions":
            len(
                normalized_sessions
            ),

        "analyzed_sessions":
            len(
                window_sessions
            ),

        "date_range":
            {

                "first":
                    (
                        first_datetime.isoformat()

                        if first_datetime

                        else None
                    ),

                "latest":
                    (
                        latest_datetime.isoformat()

                        if latest_datetime

                        else None
                    ),
            },

        # ----------------------------------------------------
        # 症狀別疼痛趨勢摘要
        # ----------------------------------------------------

        "pain_trend":
            pain_analysis,

        # ----------------------------------------------------
        # 完整症狀別趨勢
        # ----------------------------------------------------

        "symptom_pain_trends":
            symptom_pain_trends,

        "visit_frequency":
            frequency_analysis,

        "recurring_symptoms":
            recurring_symptoms,

        "department_patterns":
            department_patterns,

        "recurring_possible_causes":
            recurring_causes,

        "insights":
            insights,

        "timeline":
            build_timeline(
                normalized_sessions
            ),

        "disclaimer":
            (
                "本功能分析的是使用者在 CarePath AI 中的"
                "歷史問診紀錄與變化模式。"
                "疼痛趨勢僅在相同症狀概念重複出現時比較，"
                "不會將不同健康問題的疼痛分數直接串接成單一趨勢。"
                "結果不是疾病診斷、預後預測或急診分級；"
                "即時危險症狀仍由 Red Flag Safety Engine 優先處理。"
            ),
    }