# routes/doctor_schedules.py

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg2.extras import RealDictCursor

from services import get_db_connection
from routes.auth import get_current_user


router = APIRouter(
    prefix="/api/v1",
    tags=["Doctor Schedules"],
    dependencies=[Depends(get_current_user)],
)


TAIPEI_TZ = ZoneInfo("Asia/Taipei")


WEEKDAY_LABELS = {
    1: "星期一",
    2: "星期二",
    3: "星期三",
    4: "星期四",
    5: "星期五",
    6: "星期六",
    7: "星期日",
}


REGISTRATION_STATUS_LABELS = {
    "available": "可掛號",
    "full": "預約額滿",
    "closed": "停診",
    "substitute": "代診",
    "unknown": "請至院方確認",
}


TIME_PRECISION_LABELS = {
    "exact": "官方公布之醫師門診時間",
    "session_window": "院方公布之門診時段",
    "unknown": "官方未公布明確時間",
}


# ============================================================
# 時間文字
# ============================================================

def build_time_text(
    start_time,
    end_time,
):
    if start_time and end_time:
        return (
            f"{start_time.strftime('%H:%M')}"
            f"–"
            f"{end_time.strftime('%H:%M')}"
        )

    if start_time:
        return start_time.strftime("%H:%M")

    return None


# ============================================================
# 掛號資訊分類
#
# Neon booking_url 目前同時可能存：
#
# https://xxxx
# http://xxxx
# 僅提供現場及電話掛號
# 僅提供現場掛號
#
# 不需要修改 DB schema。
# API 統一拆成：
#
# booking_url
# booking_note
# booking_type
# ============================================================

def normalize_booking_info(
    booking_value,
):
    if booking_value is None:
        return {
            "booking_url": None,
            "booking_note": None,
            "booking_type": "none",
        }

    value = str(
        booking_value
    ).strip()

    if not value:
        return {
            "booking_url": None,
            "booking_note": None,
            "booking_type": "none",
        }

    lower_value = value.lower()

    if (
        lower_value.startswith("https://")
        or lower_value.startswith("http://")
    ):
        return {
            "booking_url": value,
            "booking_note": None,
            "booking_type": "url",
        }

    return {
        "booking_url": None,
        "booking_note": value,
        "booking_type": "note",
    }


# ============================================================
# 醫師門診 API
# ============================================================

@router.get(
    "/doctor-schedules"
)
def get_doctor_schedules(

    hospital_code: str,

    doctor_name: str,

    days: int = Query(
        default=60,
        ge=1,
        le=180,
    ),
):

    conn = get_db_connection()

    if not conn:
        raise HTTPException(
            status_code=500,
            detail="無法連線至資料庫",
        )

    try:

        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:

            # =================================================
            # 1. 找醫師與醫院
            # =================================================

            cur.execute(
                """
                SELECT
                    d.id AS doctor_id,
                    d.name AS doctor_name,
                    d.department,
                    d.specialty,

                    h.id AS hospital_id,
                    h.hospital_code,
                    h.name AS hospital_name,
                    h.booking_url

                FROM doctors d

                JOIN hospitals h
                    ON h.hospital_code = d.hospital_code

                WHERE
                    h.hospital_code = %s
                    AND d.name = %s

                LIMIT 1;
                """,
                (
                    hospital_code,
                    doctor_name,
                )
            )

            doctor = cur.fetchone()

            if not doctor:
                raise HTTPException(
                    status_code=404,
                    detail="找不到醫師或醫院資料",
                )

            # =================================================
            # 2. 處理掛號資訊
            # =================================================

            booking_info = (
                normalize_booking_info(
                    doctor["booking_url"]
                )
            )

            # =================================================
            # 3. 日期範圍
            # =================================================

            today = datetime.now(
                TAIPEI_TZ
            ).date()

            end_date = (
                today
                + timedelta(
                    days=days
                )
            )

            # =================================================
            # 4. 查近期門診
            # =================================================

            cur.execute(
                """
                SELECT
                    id,

                    schedule_date,
                    weekday,
                    session,

                    start_time,
                    end_time,

                    time_precision,

                    clinic_room,

                    registration_status,
                    substitute_doctor_name,

                    registration_url,

                    is_exception,
                    status_note,

                    source_type,
                    source_url,

                    source_updated_at,
                    last_verified_at

                FROM doctor_schedules

                WHERE
                    doctor_id = %s
                    AND hospital_id = %s
                    AND schedule_date BETWEEN %s AND %s

                ORDER BY
                    schedule_date ASC,
                    start_time ASC NULLS LAST,
                    id ASC;
                """,
                (
                    doctor["doctor_id"],
                    doctor["hospital_id"],
                    today,
                    end_date,
                )
            )

            rows = cur.fetchall()

            schedules = []

            # =================================================
            # 5. 整理前端格式
            # =================================================

            for row in rows:

                schedule = dict(row)

                schedule[
                    "weekday_label"
                ] = WEEKDAY_LABELS.get(
                    schedule.get(
                        "weekday"
                    ),
                    "",
                )

                schedule[
                    "time_text"
                ] = build_time_text(
                    schedule.get(
                        "start_time"
                    ),
                    schedule.get(
                        "end_time"
                    ),
                )

                schedule[
                    "time_precision_label"
                ] = TIME_PRECISION_LABELS.get(
                    schedule.get(
                        "time_precision"
                    ),
                    "官方未公布明確時間",
                )

                schedule[
                    "registration_status_label"
                ] = REGISTRATION_STATUS_LABELS.get(
                    schedule.get(
                        "registration_status"
                    ),
                    "請至院方確認",
                )

                schedules.append(
                    schedule
                )

            # =================================================
            # 6. Response
            # =================================================

            return {

                "doctor": {
                    "id":
                        doctor["doctor_id"],

                    "name":
                        doctor["doctor_name"],

                    "department":
                        doctor["department"],

                    "specialty":
                        doctor["specialty"],
                },

                "hospital": {
                    "id":
                        doctor["hospital_id"],

                    "hospital_code":
                        doctor["hospital_code"],

                    "name":
                        doctor["hospital_name"],

                    "booking_url":
                        booking_info[
                            "booking_url"
                        ],

                    "booking_note":
                        booking_info[
                            "booking_note"
                        ],

                    "booking_type":
                        booking_info[
                            "booking_type"
                        ],
                },

                "schedule_count":
                    len(schedules),

                "schedules":
                    schedules,

                "notice": (
                    "門診資訊可能因停診、代診、"
                    "額滿或院方臨時調整而變更，"
                    "實際門診與掛號狀態請以"
                    "院方官方資訊為準。"
                ),
            }

    finally:
        conn.close()
