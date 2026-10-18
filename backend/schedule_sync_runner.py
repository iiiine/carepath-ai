# schedule_sync_runner.py

from typing import Any, Dict, List

from psycopg2.extras import RealDictCursor

from services import get_db_connection

from schedule_providers import (
    fetch_schedule_records,
    ScheduleProviderError,
)

from schedule_sync import (
    sync_schedule_records,
    ScheduleSyncError,
)


# ============================================================
# 找出「已啟用，而且現在該同步」的來源
#
# 安全限制：
# 只允許 official_api / official_feed 進入自動同步。
#
# 即使 official_page 或 manual 被誤設成
# auto_sync_enabled = TRUE，
# Runner 也不會執行。
# ============================================================

def get_due_sources() -> List[Dict[str, Any]]:

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
                    hospital_id,
                    doctor_id,

                    source_name,
                    source_method,
                    source_url,

                    auto_sync_enabled,
                    refresh_interval_minutes,

                    source_config,

                    last_sync_started_at,
                    last_sync_success_at,
                    last_sync_failed_at,
                    last_sync_status

                FROM doctor_schedule_sources

                WHERE
                    auto_sync_enabled = TRUE

                    AND source_method IN (
                        'official_api',
                        'official_feed'
                    )

                    AND
                    (
                        GREATEST(

                            COALESCE(
                                last_sync_success_at,
                                '-infinity'::timestamptz
                            ),

                            COALESCE(
                                last_sync_failed_at,
                                '-infinity'::timestamptz
                            ),

                            COALESCE(
                                last_sync_started_at,
                                '-infinity'::timestamptz
                            )
                        )

                        <=

                        NOW()
                        -
                        (
                            refresh_interval_minutes
                            * INTERVAL '1 minute'
                        )
                    )

                ORDER BY
                    id ASC;
                """
            )

            rows = cur.fetchall()

            return [
                dict(row)
                for row in rows
            ]

    finally:

        conn.close()


# ============================================================
# Provider 開始抓取
# ============================================================

def mark_fetch_started(
    source_id: int
) -> None:

    conn = get_db_connection()

    if not conn:
        print(
            "⚠️ 無法記錄同步開始時間"
        )
        return

    try:

        with conn.cursor() as cur:

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

        conn.commit()

    except Exception as exc:

        conn.rollback()

        print(
            "⚠️ 記錄同步開始時間失敗：",
            exc
        )

    finally:

        conn.close()


# ============================================================
# Provider 抓取失敗
#
# schedule_sync.py 自己的資料庫同步失敗
# 已經會記錄 failed。
#
# 這裡主要處理：
# Provider 還沒進 sync_schedule_records()
# 就已經抓資料失敗的情況。
# ============================================================

def mark_provider_failed(
    source_id: int,
    error_message: str
) -> None:

    conn = get_db_connection()

    if not conn:
        print(
            "⚠️ 無法寫入 Provider 失敗狀態"
        )
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
                    source_id
                )
            )

        conn.commit()

    except Exception as exc:

        conn.rollback()

        print(
            "⚠️ Provider 失敗狀態寫入失敗：",
            exc
        )

    finally:

        conn.close()


# ============================================================
# 是否允許官方來源回傳 0 筆
#
# 預設不允許。
#
# 因為官方 API 突然回傳 []，
# 可能代表：
#
# 1. API 暫時故障
# 2. 欄位格式改變
# 3. Provider parser 壞掉
# 4. 查詢參數錯誤
#
# 所以預設不能把 0 筆當成成功。
#
# 若某官方 API 確實允許合法空資料，
# source_config 可設定：
#
# {
#     "allow_empty": true
# }
# ============================================================

def allow_empty_result(
    source: Dict[str, Any]
) -> bool:

    config = (
        source.get(
            "source_config"
        )
        or {}
    )

    if not isinstance(
        config,
        dict
    ):
        return False

    return (
        config.get(
            "allow_empty"
        )
        is True
    )


# ============================================================
# 執行所有到期同步來源
# ============================================================

def run_due_schedule_syncs() -> Dict[str, Any]:

    print(
        "=" * 60
    )

    print(
        "醫師門診自動同步 Runner"
    )

    print(
        "=" * 60
    )


    # ========================================================
    # 1. 找出目前需要同步的來源
    # ========================================================

    sources = (
        get_due_sources()
    )


    print(
        f"\n目前需要同步的來源：{len(sources)} 個"
    )


    # ========================================================
    # 沒有任何來源需要同步
    # ========================================================

    if not sources:

        print(
            "\n✅ 目前沒有需要同步的來源"
        )

        print(
            "（只會自動處理已啟用的 official_api / official_feed）"
        )

        print(
            "\n" + "=" * 60
        )


        return {
            "status":
                "success",

            "due_sources":
                0,

            "successful":
                0,

            "failed":
                0,

            "processed_records":
                0,

            "inserted_records":
                0,

            "updated_records":
                0,
        }


    # ========================================================
    # 統計
    # ========================================================

    successful_count = 0
    failed_count = 0

    processed_records = 0
    inserted_records = 0
    updated_records = 0


    # ========================================================
    # 2. 一個來源一個來源處理
    # ========================================================

    for source in sources:

        source_id = (
            source["id"]
        )

        source_name = (
            source["source_name"]
        )

        source_method = (
            source["source_method"]
        )


        print(
            "\n" + "-" * 60
        )

        print(
            f"來源 ID：{source_id}"
        )

        print(
            f"來源名稱：{source_name}"
        )

        print(
            f"來源方式：{source_method}"
        )


        # ====================================================
        # 再做一次安全確認
        #
        # 正常來說 SQL 已經過濾，
        # 這裡是第二層保護。
        # ====================================================

        if source_method not in (
            "official_api",
            "official_feed",
        ):

            failed_count += 1

            error_message = (
                "安全限制："
                f"source_method={source_method} "
                "不允許自動同步"
            )

            print(
                f"❌ {error_message}"
            )

            mark_provider_failed(
                source_id,
                error_message
            )

            continue


        # ====================================================
        # 記錄 Provider 開始時間
        # ====================================================

        mark_fetch_started(
            source_id
        )


        # ====================================================
        # 3. Provider 取得官方資料
        # ====================================================

        try:

            records = (
                fetch_schedule_records(
                    source_id=source_id,
                    require_auto_sync=True
                )
            )


            if not isinstance(
                records,
                list
            ):

                raise ScheduleProviderError(
                    (
                        "Provider 回傳格式錯誤："
                        "預期 List"
                    )
                )


            print(
                f"Provider 取得 {len(records)} 筆資料"
            )


            # ================================================
            # 防止官方來源異常回傳 []
            # ================================================

            if (
                len(records) == 0
                and not allow_empty_result(
                    source
                )
            ):

                raise ScheduleProviderError(
                    (
                        "官方來源回傳 0 筆門診資料；"
                        "為避免將來源異常誤判為成功，"
                        "本次同步停止。"
                    )
                )


        except ScheduleProviderError as exc:

            failed_count += 1

            error_message = str(
                exc
            )


            print(
                "❌ Provider 取得資料失敗："
            )

            print(
                error_message
            )


            mark_provider_failed(
                source_id,
                error_message
            )


            continue


        except Exception as exc:

            failed_count += 1

            error_message = (
                "Provider 發生未預期錯誤："
                f"{exc}"
            )


            print(
                f"❌ {error_message}"
            )


            mark_provider_failed(
                source_id,
                error_message
            )


            continue


        # ====================================================
        # 4. Provider 成功後才寫入 doctor_schedules
        # ====================================================

        try:

            result = (
                sync_schedule_records(
                    source_id=source_id,
                    records=records
                )
            )


            successful_count += 1


            processed_records += (
                result.get(
                    "processed",
                    0
                )
            )


            inserted_records += (
                result.get(
                    "inserted",
                    0
                )
            )


            updated_records += (
                result.get(
                    "updated",
                    0
                )
            )


            print(
                "✅ 同步成功"
            )

            print(
                "   processed = "
                f"{result.get('processed', 0)}"
            )

            print(
                "   inserted  = "
                f"{result.get('inserted', 0)}"
            )

            print(
                "   updated   = "
                f"{result.get('updated', 0)}"
            )


        except ScheduleSyncError as exc:

            failed_count += 1


            # schedule_sync.py 本身已經：
            #
            # rollback
            # +
            # last_sync_status = failed
            #
            # 所以這裡不用再次寫入 failed。
            print(
                "❌ 資料庫同步失敗："
            )

            print(
                str(exc)
            )


        except Exception as exc:

            failed_count += 1

            error_message = (
                "同步發生未預期錯誤："
                f"{exc}"
            )


            print(
                f"❌ {error_message}"
            )


            # 未知錯誤仍寫入來源狀態
            mark_provider_failed(
                source_id,
                error_message
            )


    # ========================================================
    # 5. 最後統計
    # ========================================================

    print(
        "\n" + "=" * 60
    )

    print(
        "自動同步完成"
    )

    print(
        "=" * 60
    )


    print(
        f"來源總數     = {len(sources)}"
    )

    print(
        f"成功來源     = {successful_count}"
    )

    print(
        f"失敗來源     = {failed_count}"
    )

    print(
        f"處理門診     = {processed_records}"
    )

    print(
        f"新增門診     = {inserted_records}"
    )

    print(
        f"更新門診     = {updated_records}"
    )


    return {
        "status":
            (
                "success"
                if failed_count == 0
                else "partial_failure"
            ),

        "due_sources":
            len(sources),

        "successful":
            successful_count,

        "failed":
            failed_count,

        "processed_records":
            processed_records,

        "inserted_records":
            inserted_records,

        "updated_records":
            updated_records,
    }


# ============================================================
# CLI
# ============================================================

if __name__ == "__main__":

    run_due_schedule_syncs()