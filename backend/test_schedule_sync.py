# test_schedule_sync.py

from psycopg2.extras import RealDictCursor

from services import get_db_connection
from schedule_sync import sync_schedule_records


# ============================================================
# 測試設定
# ============================================================

SOURCE_ID = 1
DOCTOR_ID = 193
HOSPITAL_ID = 13


def load_existing_schedules():
    """
    從 doctor_schedules 讀取田智豪目前已存在的門診資料。

    這些資料會原封不動交給同步核心，
    因此不會建立任何假的門診日期。
    """

    conn = get_db_connection()

    if not conn:
        raise RuntimeError(
            "無法連線至資料庫"
        )

    try:
        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:

            cur.execute(
                """
                SELECT
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
                    source_updated_at

                FROM doctor_schedules

                WHERE
                    doctor_id = %s
                    AND hospital_id = %s

                ORDER BY
                    schedule_date ASC,
                    start_time ASC NULLS LAST;
                """,
                (
                    DOCTOR_ID,
                    HOSPITAL_ID
                )
            )

            rows = cur.fetchall()

            return [
                dict(row)
                for row in rows
            ]

    finally:
        conn.close()


def load_source_status():
    """
    讀取同步完成後的來源狀態。
    """

    conn = get_db_connection()

    if not conn:
        raise RuntimeError(
            "無法連線至資料庫"
        )

    try:
        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:

            cur.execute(
                """
                SELECT
                    id,
                    source_name,
                    auto_sync_enabled,
                    last_sync_started_at,
                    last_sync_success_at,
                    last_sync_failed_at,
                    last_sync_status,
                    last_error

                FROM doctor_schedule_sources

                WHERE id = %s;
                """,
                (
                    SOURCE_ID,
                )
            )

            row = cur.fetchone()

            return (
                dict(row)
                if row
                else None
            )

    finally:
        conn.close()


def main():

    print(
        "=" * 60
    )

    print(
        "第 22-5D：doctor_schedules 同步核心測試"
    )

    print(
        "=" * 60
    )


    # ========================================================
    # 1. 讀取目前資料
    # ========================================================

    records = (
        load_existing_schedules()
    )


    print(
        f"\n目前找到 {len(records)} 筆門診資料"
    )


    if not records:

        print(
            "❌ 找不到田智豪醫師的門診資料，停止測試。"
        )

        return


    print(
        "\n準備測試的資料："
    )


    for record in records:

        print(
            " - "
            f"{record['schedule_date']} "
            f"{record['session']} "
            f"{record['start_time']} ~ "
            f"{record['end_time']} "
            f"{record['clinic_room']} "
            f"[{record['registration_status']}]"
        )


    # ========================================================
    # 2. 執行同步
    # ========================================================

    print(
        "\n開始執行 sync_schedule_records..."
    )


    result = (
        sync_schedule_records(
            source_id=SOURCE_ID,
            records=records
        )
    )


    # ========================================================
    # 3. 顯示同步結果
    # ========================================================

    print(
        "\n同步結果："
    )


    print(
        f"status    = {result['status']}"
    )

    print(
        f"source_id = {result['source_id']}"
    )

    print(
        f"processed = {result['processed']}"
    )

    print(
        f"inserted  = {result['inserted']}"
    )

    print(
        f"updated   = {result['updated']}"
    )


    # ========================================================
    # 4. 驗證來源同步狀態
    # ========================================================

    source_status = (
        load_source_status()
    )


    print(
        "\n同步來源狀態："
    )


    if source_status:

        print(
            f"id = {source_status['id']}"
        )

        print(
            f"name = {source_status['source_name']}"
        )

        print(
            "auto_sync_enabled = "
            f"{source_status['auto_sync_enabled']}"
        )

        print(
            "last_sync_started_at = "
            f"{source_status['last_sync_started_at']}"
        )

        print(
            "last_sync_success_at = "
            f"{source_status['last_sync_success_at']}"
        )

        print(
            "last_sync_failed_at = "
            f"{source_status['last_sync_failed_at']}"
        )

        print(
            "last_sync_status = "
            f"{source_status['last_sync_status']}"
        )

        print(
            "last_error = "
            f"{source_status['last_error']}"
        )


    # ========================================================
    # 5. 自動判斷測試
    # ========================================================

    expected_count = (
        len(records)
    )


    if (
        result["status"] == "success"
        and result["processed"] == expected_count
        and result["inserted"] == 0
        and result["updated"] == expected_count
    ):

        print(
            "\n✅ 第 22-5D 測試成功"
        )

        print(
            "✅ 沒有新增重複門診"
        )

        print(
            f"✅ 成功更新既有 {expected_count} 筆資料"
        )

    else:

        print(
            "\n⚠️ 測試結果與預期不同"
        )


    print(
        "\n" + "=" * 60
    )


if __name__ == "__main__":
    main()