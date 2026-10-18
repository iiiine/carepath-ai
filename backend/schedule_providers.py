# schedule_providers.py

import json
from typing import Any, Dict, List
from urllib.request import Request, urlopen
from urllib.error import (
    HTTPError,
    URLError,
)

from psycopg2.extras import RealDictCursor

from services import get_db_connection


# ============================================================
# Provider 錯誤
# ============================================================

class ScheduleProviderError(Exception):
    pass


# ============================================================
# 讀取同步來源設定
# ============================================================

def get_schedule_source(
    source_id: int
) -> Dict[str, Any]:

    conn = get_db_connection()

    if not conn:
        raise ScheduleProviderError(
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
                    source_url,
                    source_method,

                    auto_sync_enabled,
                    refresh_interval_minutes,

                    source_config,

                    last_sync_status,
                    last_sync_success_at

                FROM doctor_schedule_sources

                WHERE id = %s;
                """,
                (
                    source_id,
                )
            )

            row = cur.fetchone()

            if not row:
                raise ScheduleProviderError(
                    f"找不到同步來源 id={source_id}"
                )

            return dict(row)

    finally:

        conn.close()


# ============================================================
# JSON 路徑讀取
#
# records_path 例如：
#
# data.schedules
#
# JSON：
#
# {
#   "data": {
#       "schedules": [...]
#   }
# }
# ============================================================

def _extract_by_path(
    data: Any,
    path: str | None
) -> Any:

    if not path:
        return data

    current = data

    for key in path.split("."):

        if not isinstance(
            current,
            dict
        ):
            raise ScheduleProviderError(
                (
                    "records_path 無法解析："
                    f"{path}"
                )
            )

        if key not in current:
            raise ScheduleProviderError(
                (
                    "JSON 找不到欄位："
                    f"{key}"
                )
            )

        current = current[key]

    return current


# ============================================================
# 欄位 mapping
#
# source_config：
#
# {
#   "field_mapping": {
#       "schedule_date": "date",
#       "session": "period",
#       "clinic_room": "room"
#   }
# }
#
# 左邊 = 我們系統欄位
# 右邊 = 官方 API 欄位
# ============================================================

def _map_record(
    raw_record: Dict[str, Any],
    field_mapping: Dict[str, str]
) -> Dict[str, Any]:

    if not field_mapping:
        return dict(
            raw_record
        )

    result = {}

    for target_field, source_field in (
        field_mapping.items()
    ):

        result[target_field] = (
            raw_record.get(
                source_field
            )
        )

    return result


# ============================================================
# Official API Provider
#
# 只供：
#
# source_method = official_api
#
# 使用。
#
# 不會拿 official_page 偷偷當 API 抓。
# ============================================================

def fetch_official_api(
    source: Dict[str, Any]
) -> List[Dict[str, Any]]:

    source_config = (
        source.get(
            "source_config"
        )
        or {}
    )


    # --------------------------------------------------------
    # API URL
    #
    # 可以放在：
    #
    # source_config.api_url
    #
    # 若沒填，才 fallback source_url。
    # --------------------------------------------------------

    api_url = (
        source_config.get(
            "api_url"
        )
        or source.get(
            "source_url"
        )
    )


    if not api_url:
        raise ScheduleProviderError(
            "official_api 缺少 API URL"
        )


    # --------------------------------------------------------
    # Timeout
    # --------------------------------------------------------

    timeout_seconds = int(
        source_config.get(
            "timeout_seconds",
            15
        )
    )


    timeout_seconds = max(
        3,
        min(
            timeout_seconds,
            60
        )
    )


    # --------------------------------------------------------
    # Headers
    # --------------------------------------------------------

    configured_headers = (
        source_config.get(
            "headers"
        )
        or {}
    )


    if not isinstance(
        configured_headers,
        dict
    ):
        raise ScheduleProviderError(
            "source_config.headers 必須是 JSON object"
        )


    headers = {
        "Accept":
            "application/json",

        "User-Agent":
            (
                "MedicalAISystem/1.0 "
                "(official-schedule-integration)"
            ),
    }


    for key, value in (
        configured_headers.items()
    ):

        headers[
            str(key)
        ] = str(value)


    # --------------------------------------------------------
    # Request
    # --------------------------------------------------------

    request = Request(
        api_url,
        headers=headers,
        method="GET"
    )


    try:

        with urlopen(
            request,
            timeout=timeout_seconds
        ) as response:

            status_code = getattr(
                response,
                "status",
                200
            )


            if (
                status_code < 200
                or status_code >= 300
            ):

                raise ScheduleProviderError(
                    (
                        "官方 API 回傳非成功狀態："
                        f"{status_code}"
                    )
                )


            raw_body = (
                response
                .read()
                .decode(
                    "utf-8"
                )
            )


    except HTTPError as exc:

        raise ScheduleProviderError(
            (
                "官方 API HTTP 錯誤："
                f"{exc.code}"
            )
        ) from exc


    except URLError as exc:

        raise ScheduleProviderError(
            (
                "官方 API 連線失敗："
                f"{exc.reason}"
            )
        ) from exc


    except TimeoutError as exc:

        raise ScheduleProviderError(
            "官方 API 連線逾時"
        ) from exc


    # --------------------------------------------------------
    # JSON
    # --------------------------------------------------------

    try:

        payload = json.loads(
            raw_body
        )

    except json.JSONDecodeError as exc:

        raise ScheduleProviderError(
            "官方 API 回傳內容不是合法 JSON"
        ) from exc


    # --------------------------------------------------------
    # 找 records
    # --------------------------------------------------------

    records_path = (
        source_config.get(
            "records_path"
        )
    )


    raw_records = (
        _extract_by_path(
            payload,
            records_path
        )
    )


    if not isinstance(
        raw_records,
        list
    ):

        raise ScheduleProviderError(
            (
                "官方 API 的門診資料"
                "不是 JSON array"
            )
        )


    # --------------------------------------------------------
    # Field mapping
    # --------------------------------------------------------

    field_mapping = (
        source_config.get(
            "field_mapping"
        )
        or {}
    )


    if not isinstance(
        field_mapping,
        dict
    ):

        raise ScheduleProviderError(
            (
                "source_config.field_mapping "
                "必須是 JSON object"
            )
        )


    records = []


    for raw_record in (
        raw_records
    ):

        if not isinstance(
            raw_record,
            dict
        ):
            continue


        mapped = _map_record(
            raw_record,
            field_mapping
        )


        # ================================================
        # 自動補來源本身綁定的 doctor / hospital
        # ================================================

        if (
            mapped.get(
                "doctor_id"
            )
            is None
            and source.get(
                "doctor_id"
            )
            is not None
        ):

            mapped[
                "doctor_id"
            ] = source[
                "doctor_id"
            ]


        if (
            mapped.get(
                "hospital_id"
            )
            is None
        ):

            mapped[
                "hospital_id"
            ] = source[
                "hospital_id"
            ]


        # ================================================
        # 官方來源網址
        # ================================================

        if not mapped.get(
            "source_url"
        ):

            mapped[
                "source_url"
            ] = source[
                "source_url"
            ]


        records.append(
            mapped
        )


    return records


# ============================================================
# Official Feed Provider
#
# 目前先保留接口。
#
# 未來若院方提供：
#
# CSV
# XML
# FHIR
# RSS
# 公開資料 feed
#
# 再依實際格式實作。
# ============================================================

def fetch_official_feed(
    source: Dict[str, Any]
) -> List[Dict[str, Any]]:

    raise ScheduleProviderError(
        (
            "此來源標記為 official_feed，"
            "但目前尚未設定對應 feed parser。"
        )
    )


# ============================================================
# Official Page
#
# 故意禁止自動擷取。
#
# 這是設計上的安全限制，
# 不是程式錯誤。
# ============================================================

def fetch_official_page(
    source: Dict[str, Any]
) -> List[Dict[str, Any]]:

    raise ScheduleProviderError(
        (
            "此來源為 official_page。"
            "目前系統不會自動爬取官方網站頁面；"
            "必須取得院方允許的官方 API、"
            "官方 feed 或其他授權資料介面後才能啟用。"
        )
    )


# ============================================================
# Manual
# ============================================================

def fetch_manual_source(
    source: Dict[str, Any]
) -> List[Dict[str, Any]]:

    raise ScheduleProviderError(
        (
            "manual 來源不能由自動同步器抓取。"
        )
    )


# ============================================================
# Provider Dispatcher
# ============================================================

def fetch_schedule_records(
    source_id: int,
    require_auto_sync: bool = True
) -> List[Dict[str, Any]]:

    """
    根據 doctor_schedule_sources.source_method
    自動選擇 provider。
    """

    source = get_schedule_source(
        source_id
    )


    # --------------------------------------------------------
    # 自動排程執行時，
    # 必須確認來源真的有開 auto_sync_enabled。
    # --------------------------------------------------------

    if (
        require_auto_sync
        and not source[
            "auto_sync_enabled"
        ]
    ):

        raise ScheduleProviderError(
            (
                f"來源 id={source_id} "
                "尚未啟用 auto_sync_enabled"
            )
        )


    source_method = (
        source[
            "source_method"
        ]
    )


    # --------------------------------------------------------
    # Official API
    # --------------------------------------------------------

    if (
        source_method ==
        "official_api"
    ):

        return fetch_official_api(
            source
        )


    # --------------------------------------------------------
    # Official Feed
    # --------------------------------------------------------

    if (
        source_method ==
        "official_feed"
    ):

        return fetch_official_feed(
            source
        )


    # --------------------------------------------------------
    # Official Page
    # --------------------------------------------------------

    if (
        source_method ==
        "official_page"
    ):

        return fetch_official_page(
            source
        )


    # --------------------------------------------------------
    # Manual
    # --------------------------------------------------------

    if (
        source_method ==
        "manual"
    ):

        return fetch_manual_source(
            source
        )


    raise ScheduleProviderError(
        (
            "不支援的 source_method："
            f"{source_method}"
        )
    )