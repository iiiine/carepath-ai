# schedule_sync.py

from datetime import date, datetime, time
from typing import Any, Dict, Iterable, Optional

from psycopg2.extras import RealDictCursor

from services import get_db_connection


# ============================================================
# 允許值
# ============================================================

VALID_TIME_PRECISION = {
    "exact",
    "session_window",
    "unknown",
}

VALID_REGISTRATION_STATUS = {
    "available",
    "full",
    "closed",
    "substitute",
    "unknown",
}

VALID_SOURCE_TYPE = {
    "official_booking",
    "official_schedule",
    "official_notice",
    "official_other",
    "unknown",
}


# ============================================================
# 自訂錯誤
# ============================================================

class ScheduleSyncError(Exception):
    pass


# ============================================================
# 基本轉換工具
# ============================================================

def _clean_text(
    value: Any
) -> Optional[str]:
    """
    將空字串轉成 None。
    """

    if value is None:
        return None

    text = str(value).strip()

    return text if text else None


def _parse_date(
    value: Any
) -> date:
    """
    支援：
    - date
    - datetime
    - YYYY-MM-DD
    """

    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    if isinstance(value, str):
        try:
            return date.fromisoformat(
                value.strip()
            )
        except ValueError:
            pass

    raise ScheduleSyncError(
        f"無效的 schedule_date：{value}"
    )


def _parse_time(
    value: Any
) -> Optional[time]:
    """
    支援：
    - time
    - datetime
    - HH:MM
    - HH:MM:SS
    """

    if value is None:
        return None

    if isinstance(value, datetime):
        return value.time()

    if isinstance(value, time):
        return value

    if isinstance(value, str):
        text = value.strip()

        if not text:
            return None

        try:
            return time.fromisoformat(
                text
            )
        except ValueError:
            pass

    raise ScheduleSyncError(
        f"無效的門診時間：{value}"
    )


def _parse_datetime(
    value: Any
) -> Optional[datetime]:
    """
    支援 ISO datetime。

    例如：
    2026-08-19T10:30:00+08:00
    """

    if value is None:
        return None

    if isinstance(value, datetime):
        return value

    if isinstance(value, str):

        text = value.strip()

        if not text:
            return None

        # 支援 ISO 的 Z
        if text.endswith("Z"):
            text = (
                text[:-1]
                + "+00:00"
            )

        try:
            return datetime.fromisoformat(
                text
            )
        except ValueError:
            pass

    raise ScheduleSyncError(
        f"無效的 source_updated_at：{value}"
    )


def _parse_bool(
    value: Any,
    default: bool = False
) -> bool:

    if value is None:
        return default

    if isinstance(value, bool):
        return value

    if isinstance(value, int):
        return value != 0

    if isinstance(value, str):

        normalized = (
            value
            .strip()
            .lower()
        )

        if normalized in {
            "true",
            "1",
            "yes",
            "y",
            "on",
        }:
            return True

        if normalized in {
            "false",
            "0",
            "no",
            "n",
            "off",
        }:
            return False

    return bool(value)


# ============================================================
# 正規化一筆門診資料
# ============================================================

def normalize_schedule_record(
    record: Dict[str, Any],
    source: Dict[str, Any]
) -> Dict[str, Any]:

    doctor_id = record.get(
        "doctor_id"
    )

    if doctor_id is None:
        doctor_id = source.get(
            "doctor_id"
        )

    hospital_id = record.get(
        "hospital_id"
    )

    if hospital_id is None:
        hospital_id = source.get(
            "hospital_id"
        )


    # --------------------------------------------------------
    # hospital_id 必須存在
    # --------------------------------------------------------

    if hospital_id is None:
        raise ScheduleSyncError(
            "門診資料缺少 hospital_id"
        )


    # --------------------------------------------------------
    # doctor_id 必須存在
    #
    # 目前 doctor_schedules 是醫師日期級資料，
    # 所以不能沒有 doctor_id。
    # --------------------------------------------------------

    if doctor_id is None:
        raise ScheduleSyncError(
            "門診資料缺少 doctor_id"
        )


    doctor_id = int(
        doctor_id
    )

    hospital_id = int(
        hospital_id
    )


    # --------------------------------------------------------
    # 防止來源綁定的醫院跟資料不一致
    # --------------------------------------------------------

    source_hospital_id = source.get(
        "hospital_id"
    )

    if (
        source_hospital_id is not None
        and hospital_id != int(
            source_hospital_id
        )
    ):
        raise ScheduleSyncError(
            "門診資料 hospital_id 與同步來源不一致"
        )


    # --------------------------------------------------------
    # 如果 source 本身綁定特定醫師，
    # 不允許同步其他醫師資料。
    # --------------------------------------------------------

    source_doctor_id = source.get(
        "doctor_id"
    )

    if (
        source_doctor_id is not None
        and doctor_id != int(
            source_doctor_id
        )
    ):
        raise ScheduleSyncError(
            "門診資料 doctor_id 與同步來源不一致"
        )


    # --------------------------------------------------------
    # 日期
    # --------------------------------------------------------

    schedule_date = _parse_date(
        record.get(
            "schedule_date"
        )
    )


    # --------------------------------------------------------
    # 診別
    # --------------------------------------------------------

    session = _clean_text(
        record.get(
            "session"
        )
    )

    if not session:
        raise ScheduleSyncError(
            "門診資料缺少 session"
        )


    # --------------------------------------------------------
    # 時間
    # --------------------------------------------------------

    start_time = _parse_time(
        record.get(
            "start_time"
        )
    )

    end_time = _parse_time(
        record.get(
            "end_time"
        )
    )


    if (
        start_time is not None
        and end_time is not None
        and start_time >= end_time
    ):
        raise ScheduleSyncError(
            (
                f"{schedule_date} "
                f"{session} 的 start_time "
                "必須早於 end_time"
            )
        )


    # --------------------------------------------------------
    # 時間精確度
    # --------------------------------------------------------

    time_precision = (
        record.get(
            "time_precision"
        )
        or "unknown"
    )


    if (
        time_precision
        not in VALID_TIME_PRECISION
    ):
        raise ScheduleSyncError(
            (
                "無效的 time_precision："
                f"{time_precision}"
            )
        )


    # --------------------------------------------------------
    # 掛號狀態
    # --------------------------------------------------------

    registration_status = (
        record.get(
            "registration_status"
        )
        or "unknown"
    )


    if (
        registration_status
        not in VALID_REGISTRATION_STATUS
    ):
        raise ScheduleSyncError(
            (
                "無效的 registration_status："
                f"{registration_status}"
            )
        )


    # --------------------------------------------------------
    # source_type
    # --------------------------------------------------------

    source_type = record.get(
        "source_type"
    )

    if not source_type:

        source_method = (
            source.get(
                "source_method"
            )
            or ""
        )

        if source_method.startswith(
            "official_"
        ):
            source_type = (
                "official_schedule"
            )
        else:
            source_type = "unknown"


    if (
        source_type
        not in VALID_SOURCE_TYPE
    ):
        raise ScheduleSyncError(
            (
                "無效的 source_type："
                f"{source_type}"
            )
        )


    # --------------------------------------------------------
    # 官方來源 URL
    # --------------------------------------------------------

    source_url = (
        _clean_text(
            record.get(
                "source_url"
            )
        )
        or
        _clean_text(
            source.get(
                "source_url"
            )
        )
    )


    if not source_url:
        raise ScheduleSyncError(
            "門診資料缺少官方 source_url"
        )


    # --------------------------------------------------------
    # 掛號 URL
    # --------------------------------------------------------

    registration_url = (
        _clean_text(
            record.get(
                "registration_url"
            )
        )
        or source_url
    )


    # --------------------------------------------------------
    # 例外狀態
    #
    # 停診 / 代診預設視為 exception。
    # --------------------------------------------------------

    if "is_exception" in record:
        is_exception = _parse_bool(
            record.get(
                "is_exception"
            )
        )
    else:
        is_exception = (
            registration_status
            in {
                "closed",
                "substitute",
            }
        )


    return {

        "doctor_id":
            doctor_id,

        "hospital_id":
            hospital_id,

        "schedule_date":
            schedule_date,

        "session":
            session,

        "start_time":
            start_time,

        "end_time":
            end_time,

        "time_precision":
            time_precision,

        "clinic_room":
            _clean_text(
                record.get(
                    "clinic_room"
                )
            ),

        "registration_status":
            registration_status,

        "substitute_doctor_name":
            _clean_text(
                record.get(
                    "substitute_doctor_name"
                )
            ),

        "registration_url":
            registration_url,

        "is_exception":
            is_exception,

        "status_note":
            _clean_text(
                record.get(
                    "status_note"
                )
            ),

        "raw_source_text":
            _clean_text(
                record.get(
                    "raw_source_text"
                )
            ),

        "source_type":
            source_type,

        "source_url":
            source_url,

        "source_updated_at":
            _parse_datetime(
                record.get(
                    "source_updated_at"
                )
            ),
    }


# ============================================================
# 同步失敗狀態
# ============================================================

def _mark_sync_failed(
    source_id: int,
    error_message: str
) -> None:

    conn = get_db_connection()

    if not conn:
        return

    try:

        with conn.cursor() as cur:

            cur.execute(
                """
                UPDATE doctor_schedule_sources

                SET
                    last_sync_failed_at = NOW(),
                    last_sync_status = 'failed',
                    last_error = %s

                WHERE id = %s;
                """,
                (
                    error_message[:5000],
                    source_id,
                )
            )

        conn.commit()

    except Exception as exc:

        conn.rollback()

        print(
            "⚠️ 無法寫入門診同步失敗狀態：",
            exc
        )

    finally:
        conn.close()


# ============================================================
# 核心同步函式
# ============================================================

def sync_schedule_records(
    source_id: int,
    records: Iterable[
        Dict[str, Any]
    ]
) -> Dict[str, Any]:

    """
    將已經由 provider 取得並解析好的門診資料
    同步至 doctor_schedules。

    重要原則：

    1. 不負責直接抓醫院網站。
    2. 不刪除資料庫中舊門診。
    3. 同一日期 / 診別 / 診間已存在時更新。
    4. 不存在時才新增。
    5. 整批同步使用 transaction。
    6. 任一筆失敗，整批 rollback。
    7. 同步失敗不會破壞原本資料。
    """

    conn = get_db_connection()

    if not conn:
        raise ScheduleSyncError(
            "無法連線至資料庫"
        )


    try:

        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:


            # =================================================
            # 1. 取得同步來源
            # =================================================

            cur.execute(
                """
                SELECT
                    id,
                    hospital_id,
                    doctor_id,
                    source_name,
                    source_url,
                    source_method,
                    auto_sync_enabled,
                    refresh_interval_minutes,
                    last_sync_status

                FROM doctor_schedule_sources

                WHERE id = %s

                FOR UPDATE;
                """,
                (
                    source_id,
                )
            )


            source = cur.fetchone()


            if not source:
                raise ScheduleSyncError(
                    (
                        "找不到 "
                        "doctor_schedule_sources "
                        f"id={source_id}"
                    )
                )


            # =================================================
            # 2. 記錄同步開始
            #
            # 注意：
            # last_sync_status 沒有 running，
            # 所以開始時只更新 started_at。
            # =================================================

            cur.execute(
                """
                UPDATE doctor_schedule_sources

                SET
                    last_sync_started_at = NOW(),
                    last_error = NULL

                WHERE id = %s;
                """,
                (
                    source_id,
                )
            )


            inserted_count = 0
            updated_count = 0
            processed_count = 0


            # =================================================
            # 3. 一筆一筆同步
            # =================================================

            for raw_record in records:

                record = (
                    normalize_schedule_record(
                        raw_record,
                        source
                    )
                )


                processed_count += 1


                # =============================================
                # 先找是否已有同一個：
                #
                # 醫師
                # 醫院
                # 日期
                # 診別
                # 診間
                # =============================================

                cur.execute(
                    """
                    SELECT id

                    FROM doctor_schedules

                    WHERE
                        doctor_id = %s

                        AND hospital_id = %s

                        AND schedule_date = %s

                        AND session = %s

                        AND COALESCE(
                            clinic_room,
                            ''
                        ) =
                        COALESCE(
                            %s,
                            ''
                        )

                    LIMIT 1

                    FOR UPDATE;
                    """,
                    (
                        record[
                            "doctor_id"
                        ],

                        record[
                            "hospital_id"
                        ],

                        record[
                            "schedule_date"
                        ],

                        record[
                            "session"
                        ],

                        record[
                            "clinic_room"
                        ],
                    )
                )


                existing = (
                    cur.fetchone()
                )


                # =============================================
                # 已存在 → UPDATE
                # =============================================

                if existing:

                    cur.execute(
                        """
                        UPDATE doctor_schedules

                        SET
                            start_time = %s,
                            end_time = %s,

                            time_precision = %s,

                            registration_status = %s,

                            substitute_doctor_name = %s,

                            registration_url = %s,

                            is_exception = %s,

                            status_note = %s,

                            raw_source_text = %s,

                            source_type = %s,

                            source_url = %s,

                            source_updated_at = %s,

                            last_verified_at = NOW()

                        WHERE id = %s;
                        """,
                        (
                            record[
                                "start_time"
                            ],

                            record[
                                "end_time"
                            ],

                            record[
                                "time_precision"
                            ],

                            record[
                                "registration_status"
                            ],

                            record[
                                "substitute_doctor_name"
                            ],

                            record[
                                "registration_url"
                            ],

                            record[
                                "is_exception"
                            ],

                            record[
                                "status_note"
                            ],

                            record[
                                "raw_source_text"
                            ],

                            record[
                                "source_type"
                            ],

                            record[
                                "source_url"
                            ],

                            record[
                                "source_updated_at"
                            ],

                            existing[
                                "id"
                            ],
                        )
                    )


                    updated_count += 1


                # =============================================
                # 不存在 → INSERT
                # =============================================

                else:

                    cur.execute(
                        """
                        INSERT INTO doctor_schedules (
                            doctor_id,
                            hospital_id,

                            schedule_date,
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

                            raw_source_text,

                            source_type,
                            source_url,

                            source_updated_at,

                            last_verified_at
                        )

                        VALUES (
                            %s,
                            %s,

                            %s,
                            %s,

                            %s,
                            %s,

                            %s,

                            %s,

                            %s,

                            %s,

                            %s,

                            %s,

                            %s,

                            %s,

                            %s,
                            %s,

                            %s,

                            NOW()
                        );
                        """,
                        (
                            record[
                                "doctor_id"
                            ],

                            record[
                                "hospital_id"
                            ],

                            record[
                                "schedule_date"
                            ],

                            record[
                                "session"
                            ],

                            record[
                                "start_time"
                            ],

                            record[
                                "end_time"
                            ],

                            record[
                                "time_precision"
                            ],

                            record[
                                "clinic_room"
                            ],

                            record[
                                "registration_status"
                            ],

                            record[
                                "substitute_doctor_name"
                            ],

                            record[
                                "registration_url"
                            ],

                            record[
                                "is_exception"
                            ],

                            record[
                                "status_note"
                            ],

                            record[
                                "raw_source_text"
                            ],

                            record[
                                "source_type"
                            ],

                            record[
                                "source_url"
                            ],

                            record[
                                "source_updated_at"
                            ],
                        )
                    )


                    inserted_count += 1


            # =================================================
            # 4. 整批完成後才標記 SUCCESS
            # =================================================

            cur.execute(
                """
                UPDATE doctor_schedule_sources

                SET
                    last_sync_success_at = NOW(),
                    last_sync_status = 'success',
                    last_error = NULL

                WHERE id = %s;
                """,
                (
                    source_id,
                )
            )


        # =====================================================
        # 5. 所有 SQL 都成功才 COMMIT
        # =====================================================

        conn.commit()


        return {

            "status":
                "success",

            "source_id":
                source_id,

            "source_name":
                source[
                    "source_name"
                ],

            "processed":
                processed_count,

            "inserted":
                inserted_count,

            "updated":
                updated_count,
        }


    except Exception as exc:

        # =====================================================
        # 任一筆失敗 → 整批 rollback
        # =====================================================

        conn.rollback()


        error_message = str(
            exc
        )


        # rollback 後用另一條 DB connection
        # 記錄此次同步失敗
        _mark_sync_failed(
            source_id,
            error_message
        )


        if isinstance(
            exc,
            ScheduleSyncError
        ):
            raise


        raise ScheduleSyncError(
            (
                "門診同步失敗："
                f"{error_message}"
            )
        ) from exc


    finally:

        conn.close()