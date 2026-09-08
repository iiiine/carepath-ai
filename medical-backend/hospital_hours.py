# hospital_hours.py

"""
醫院固定看診時段解析。

資料來源是健保署「健保特約醫事機構」開放資料的「固定看診時段」欄位，
原文固定為 21 段（7 天 × 上午/下午/晚上），例如：

    星期一上午看診、星期二上午看診、…、星期日晚上休診

這個模組只做「原文 → 結構化」的機械轉換，不做任何推論。

重要界線：

    這是「院方公告的一般門診時段」，
    不是「今天一定有診」，
    更不是「某位醫師的門診時間」。

    停診、代診、國定假日、特別門診都不在這份資料裡，
    因此對外文案一律要帶上「實際以院方公告為準」。

醫師層級的門診時間是另一套資料（doctor_schedules），兩者不可混用。

本模組為純函式，不依賴 FastAPI 與資料庫，可獨立測試：

    $env:PYTHONPATH="."; & $py hospital_hours.py
"""

import re


# ============================================================
# 版本常數
#
# 解析或摘要規則有變動時必須同步更新，
# 否則事後無法回推當時產生的文字是哪一版規則。
# ============================================================

HOSPITAL_HOURS_VERSION = "hospital_hours_v1"


# ============================================================
# 對外提示
#
# 與 routes/doctor_schedules.py 的 notice 用途一致：
# 提醒使用者這不是即時看診狀態。
# ============================================================

OPENING_HOURS_NOTICE = (
    "此為院方公告之一般門診時段，"
    "不代表當日必定開診。"
    "停診、代診、例假日與特別門診"
    "請以院方官方公告為準。"
)


# ============================================================
# 星期與時段對照
# ============================================================

WEEKDAY_CHARS = (
    "一",
    "二",
    "三",
    "四",
    "五",
    "六",
    "日",
)

WEEKDAY_LABELS = {
    1: "星期一",
    2: "星期二",
    3: "星期三",
    4: "星期四",
    5: "星期五",
    6: "星期六",
    7: "星期日",
}

# 摘要用的短標籤
WEEKDAY_SHORT = {
    1: "週一",
    2: "週二",
    3: "週三",
    4: "週四",
    5: "週五",
    6: "週六",
    7: "週日",
}

SESSION_KEYS = (
    ("上午", "morning"),
    ("下午", "afternoon"),
    ("晚上", "night"),
)

SESSION_LABELS = {
    "morning": "上午",
    "afternoon": "下午",
    "night": "晚上",
}


# 星期一上午看診 / 星期日晚上休診
SEGMENT_PATTERN = re.compile(
    r"^星期([一二三四五六日])"
    r"(上午|下午|晚上)"
    r"(看診|休診)$"
)


# ============================================================
# 解析
# ============================================================

def parse_opening_sessions(
    raw
):
    """
    把官方原文解析成每日三時段的結構。

    回傳：

        [
            {
                "weekday": 1,
                "label": "星期一",
                "morning": True,
                "afternoon": True,
                "night": False,
            },
            ...
        ]

    解析不出任何一段就回 None ——
    寧可不顯示，也不要顯示半套或猜出來的時段。

    只認得官方格式，
    出現沒看過的寫法就整筆放棄，
    因為部分解析出來的時段會誤導使用者。
    """

    if not raw or not isinstance(
        raw,
        str,
    ):
        return None

    week = {
        index: {
            "weekday": index,
            "label": WEEKDAY_LABELS[index],
            "morning": None,
            "afternoon": None,
            "night": None,
        }
        for index in range(1, 8)
    }

    matched_count = 0

    for segment in raw.split("、"):

        segment = segment.strip()

        if not segment:
            continue

        matched = SEGMENT_PATTERN.match(
            segment
        )

        # 出現無法辨識的寫法就整筆放棄
        if not matched:
            return None

        weekday = (
            WEEKDAY_CHARS.index(
                matched.group(1)
            )
            + 1
        )

        session_key = next(
            key
            for text, key in SESSION_KEYS
            if text == matched.group(2)
        )

        week[weekday][session_key] = (
            matched.group(3) == "看診"
        )

        matched_count += 1

    if not matched_count:
        return None

    # 官方資料固定 21 段；
    # 少寫的時段一律當成沒有資訊（False），
    # 不臆測成有診。
    for day in week.values():
        for _, key in SESSION_KEYS:
            if day[key] is None:
                day[key] = False

    return [
        week[index]
        for index in range(1, 8)
    ]


# ============================================================
# 摘要
# ============================================================

def _session_text(
    day: dict
) -> str:
    """
    單日的時段文字，例：上午、下午
    """

    parts = [
        SESSION_LABELS[key]
        for _, key in SESSION_KEYS
        if day[key]
    ]

    return "、".join(parts)


def summarize_opening_sessions(
    weekly
) -> str:
    """
    把每日時段壓成一行摘要，
    連續且時段相同的日子會合併。

    例：
        週一至週五 上午、下午；週六 上午；週日休診
    """

    if not weekly:
        return ""

    # --------------------------------------------------------
    # 依「時段組合」把連續的日子分組
    # --------------------------------------------------------

    groups = []

    for day in weekly:

        text = _session_text(day)

        if (
            groups
            and groups[-1]["text"] == text
        ):
            groups[-1]["end"] = day["weekday"]

        else:
            groups.append(
                {
                    "start": day["weekday"],
                    "end": day["weekday"],
                    "text": text,
                }
            )

    # --------------------------------------------------------
    # 組成文字
    # --------------------------------------------------------

    parts = []

    for group in groups:

        if group["start"] == group["end"]:
            days = WEEKDAY_SHORT[
                group["start"]
            ]

        elif (
            group["end"]
            - group["start"]
            == 1
        ):
            days = (
                f"{WEEKDAY_SHORT[group['start']]}"
                f"、"
                f"{WEEKDAY_SHORT[group['end']]}"
            )

        else:
            days = (
                f"{WEEKDAY_SHORT[group['start']]}"
                f"至"
                f"{WEEKDAY_SHORT[group['end']]}"
            )

        if group["text"]:
            parts.append(
                f"{days} {group['text']}"
            )

        else:
            parts.append(
                f"{days}休診"
            )

    return "；".join(parts)


def build_opening_hours(
    raw
):
    """
    給 route 用的單一入口。

    解析失敗回 None，
    呼叫端不顯示時段資訊即可。
    """

    weekly = parse_opening_sessions(
        raw
    )

    if not weekly:
        return None

    return {
        "weekly": weekly,
        "summary": summarize_opening_sessions(
            weekly
        ),
        "notice": OPENING_HOURS_NOTICE,
        "version": HOSPITAL_HOURS_VERSION,
    }


# ============================================================
# Smoke Test
# ============================================================

if __name__ == "__main__":

    def build_raw(pattern: str) -> str:
        """
        用 21 個字元（看=看診 / 休=休診）產生官方格式原文。
        排列順序與官方一致：先跑完 7 天的上午，再下午，再晚上。
        """

        segments = []

        index = 0

        for session_text, _ in SESSION_KEYS:
            for char in WEEKDAY_CHARS:
                state = (
                    "看診"
                    if pattern[index] == "看"
                    else "休診"
                )
                segments.append(
                    f"星期{char}"
                    f"{session_text}"
                    f"{state}"
                )
                index += 1

        return "、".join(segments)

    # --------------------------------------------------------
    # 台大醫院實際資料：平日上下午看診，六日全休，晚上全休
    # --------------------------------------------------------

    ntuh = build_raw(
        "看看看看看休休"
        "看看看看看休休"
        "休休休休休休休"
    )

    result = build_opening_hours(ntuh)

    assert result is not None
    assert result["summary"] == (
        "週一至週五 上午、下午；週六、週日休診"
    ), result["summary"]
    assert result["weekly"][0]["morning"] is True
    assert result["weekly"][0]["night"] is False
    assert result["weekly"][5]["morning"] is False

    print("✅ 平日上下午：", result["summary"])

    # --------------------------------------------------------
    # 含週六上午與平日夜診
    # --------------------------------------------------------

    with_saturday = build_raw(
        "看看看看看看休"
        "看看看看看休休"
        "看看看看看休休"
    )

    summary = build_opening_hours(
        with_saturday
    )["summary"]

    assert summary == (
        "週一至週五 上午、下午、晚上；"
        "週六 上午；"
        "週日休診"
    ), summary

    print("✅ 含週六與夜診：", summary)

    # --------------------------------------------------------
    # 單日不同：只有週三停診
    # --------------------------------------------------------

    wednesday_off = build_raw(
        "看看休看看休休"
        "看看休看看休休"
        "休休休休休休休"
    )

    summary = build_opening_hours(
        wednesday_off
    )["summary"]

    assert summary == (
        "週一、週二 上午、下午；"
        "週三休診；"
        "週四、週五 上午、下午；"
        "週六、週日休診"
    ), summary

    print("✅ 單日停診：", summary)

    # --------------------------------------------------------
    # 全週無休
    # --------------------------------------------------------

    everyday = build_raw("看" * 21)

    summary = build_opening_hours(
        everyday
    )["summary"]

    assert summary == (
        "週一至週日 上午、下午、晚上"
    ), summary

    print("✅ 全週無休：", summary)

    # --------------------------------------------------------
    # 壞資料一律回 None，不做半套解析
    # --------------------------------------------------------

    assert build_opening_hours(None) is None
    assert build_opening_hours("") is None
    assert build_opening_hours("不定時") is None
    assert build_opening_hours(
        "星期一上午看診、每週三公休"
    ) is None
    assert build_opening_hours(
        ["星期一上午看診"]
    ) is None

    print("✅ 壞資料全部回 None")

    print(
        "============================================================"
    )
    print(
        "✅ Hospital Hours smoke test finished"
    )
