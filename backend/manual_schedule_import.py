# manual_schedule_import.py

import csv
import json
from pathlib import Path
from typing import Any, Dict, List

from schedule_sync import (
    sync_schedule_records,
    ScheduleSyncError,
)


# ============================================================
# 支援格式
# ============================================================

SUPPORTED_EXTENSIONS = {
    ".csv",
    ".json",
}


# ============================================================
# 必填欄位
# ============================================================

REQUIRED_FIELDS = {
    "doctor_id",
    "hospital_id",
    "schedule_date",
    "session",
    "source_url",
}


# ============================================================
# 允許欄位
# ============================================================

ALLOWED_FIELDS = {
    "doctor_id",
    "hospital_id",

    "schedule_date",
    "session",

    "start_time",
    "end_time",

    "time_precision",

    "clinic_room",

    "registration_status",
    "substitute_doctor_name",

    "registration_url",

    "is_exception",
    "status_note",

    "raw_source_text",

    "source_type",
    "source_url",

    "source_updated_at",
}


# ============================================================
# Import Error
# ============================================================

class ManualScheduleImportError(Exception):
    pass


# ============================================================
# 字串清理
# ============================================================

def clean_value(
    value: Any
) -> Any:

    if value is None:
        return None

    if isinstance(
        value,
        str
    ):

        cleaned = (
            value.strip()
        )

        if cleaned == "":
            return None

        return cleaned

    return value


# ============================================================
# bool 解析
# ============================================================

def parse_bool(
    value: Any
) -> bool:

    if isinstance(
        value,
        bool
    ):
        return value

    if value is None:
        return False

    text = str(
        value
    ).strip().lower()

    if text in {
        "1",
        "true",
        "yes",
        "y",
        "是",
    }:
        return True

    if text in {
        "0",
        "false",
        "no",
        "n",
        "否",
        "",
    }:
        return False

    raise ManualScheduleImportError(
        f"無法解析布林值：{value}"
    )


# ============================================================
# 整數解析
# ============================================================

def parse_int(
    value: Any,
    field_name: str
) -> int:

    try:

        return int(
            value
        )

    except (
        TypeError,
        ValueError
    ) as exc:

        raise ManualScheduleImportError(
            (
                f"{field_name} "
                f"必須是整數，目前值：{value}"
            )
        ) from exc


# ============================================================
# 單筆資料標準化
# ============================================================

def normalize_import_record(
    record: Dict[str, Any],
    row_number: int
) -> Dict[str, Any]:

    if not isinstance(
        record,
        dict
    ):

        raise ManualScheduleImportError(
            (
                f"第 {row_number} 筆資料"
                "不是 JSON object"
            )
        )


    # ========================================================
    # 清理所有欄位
    # ========================================================

    cleaned = {}

    for key, value in (
        record.items()
    ):

        field = str(
            key
        ).strip()

        if not field:
            continue

        cleaned[
            field
        ] = clean_value(
            value
        )


    # ========================================================
    # 不允許未知欄位
    #
    # 防止 CSV 欄名打錯後靜默忽略
    # ========================================================

    unknown_fields = (
        set(
            cleaned.keys()
        )
        - ALLOWED_FIELDS
    )

    if unknown_fields:

        raise ManualScheduleImportError(
            (
                f"第 {row_number} 筆資料"
                "包含不支援欄位："
                + ", ".join(
                    sorted(
                        unknown_fields
                    )
                )
            )
        )


    # ========================================================
    # 必填欄位
    # ========================================================

    missing_fields = []

    for field in (
        REQUIRED_FIELDS
    ):

        if cleaned.get(
            field
        ) is None:

            missing_fields.append(
                field
            )


    if missing_fields:

        raise ManualScheduleImportError(
            (
                f"第 {row_number} 筆資料"
                "缺少必填欄位："
                + ", ".join(
                    sorted(
                        missing_fields
                    )
                )
            )
        )


    # ========================================================
    # ID
    # ========================================================

    cleaned[
        "doctor_id"
    ] = parse_int(
        cleaned.get(
            "doctor_id"
        ),
        "doctor_id"
    )


    cleaned[
        "hospital_id"
    ] = parse_int(
        cleaned.get(
            "hospital_id"
        ),
        "hospital_id"
    )


    # ========================================================
    # Boolean
    # ========================================================

    cleaned[
        "is_exception"
    ] = parse_bool(
        cleaned.get(
            "is_exception"
        )
    )


    # ========================================================
    # 預設值
    #
    # time_precision 不可以亂猜 exact
    # registration_status 不可以亂猜 available
    # ========================================================

    if not cleaned.get(
        "time_precision"
    ):

        cleaned[
            "time_precision"
        ] = "unknown"


    if not cleaned.get(
        "registration_status"
    ):

        cleaned[
            "registration_status"
        ] = "unknown"


    if not cleaned.get(
        "source_type"
    ):

        cleaned[
            "source_type"
        ] = "official_schedule"


    # ========================================================
    # registration_url
    # 沒有另外提供時，使用 source_url
    # ========================================================

    if not cleaned.get(
        "registration_url"
    ):

        cleaned[
            "registration_url"
        ] = cleaned[
            "source_url"
        ]


    # ========================================================
    # raw_source_text
    #
    # 如果 CSV / JSON 沒提供，
    # 自動保存目前這筆匯入資料的 JSON，
    # 方便日後稽核。
    # ========================================================

    if not cleaned.get(
        "raw_source_text"
    ):

        cleaned[
            "raw_source_text"
        ] = json.dumps(
            cleaned,
            ensure_ascii=False,
            default=str
        )


    return cleaned


# ============================================================
# CSV
# ============================================================

def load_csv_records(
    file_path: Path
) -> List[Dict[str, Any]]:

    records = []


    try:

        with file_path.open(
            "r",
            encoding="utf-8-sig",
            newline=""
        ) as file:

            reader = (
                csv.DictReader(
                    file
                )
            )


            if not reader.fieldnames:

                raise ManualScheduleImportError(
                    "CSV 沒有標題列"
                )


            for row_number, row in enumerate(
                reader,
                start=2
            ):

                # ============================================
                # 完全空白的 row 略過
                # ============================================

                if not any(
                    clean_value(
                        value
                    )
                    for value in row.values()
                ):

                    continue


                normalized = (
                    normalize_import_record(
                        dict(row),
                        row_number
                    )
                )


                records.append(
                    normalized
                )


    except UnicodeDecodeError as exc:

        raise ManualScheduleImportError(
            (
                "CSV 不是 UTF-8 編碼。"
                "請另存為 UTF-8 CSV。"
            )
        ) from exc


    return records


# ============================================================
# JSON
# ============================================================

def load_json_records(
    file_path: Path
) -> List[Dict[str, Any]]:

    try:

        with file_path.open(
            "r",
            encoding="utf-8-sig"
        ) as file:

            payload = json.load(
                file
            )


    except json.JSONDecodeError as exc:

        raise ManualScheduleImportError(
            (
                "JSON 格式錯誤："
                f"{exc}"
            )
        ) from exc


    # ========================================================
    # 支援：
    #
    # [
    #   {...},
    #   {...}
    # ]
    #
    # 或：
    #
    # {
    #   "schedules": [...]
    # }
    # ========================================================

    if isinstance(
        payload,
        list
    ):

        raw_records = payload


    elif (
        isinstance(
            payload,
            dict
        )
        and isinstance(
            payload.get(
                "schedules"
            ),
            list
        )
    ):

        raw_records = (
            payload[
                "schedules"
            ]
        )


    else:

        raise ManualScheduleImportError(
            (
                "JSON 必須是 array，"
                "或包含 schedules array。"
            )
        )


    records = []


    for index, record in enumerate(
        raw_records,
        start=1
    ):

        normalized = (
            normalize_import_record(
                record,
                index
            )
        )


        records.append(
            normalized
        )


    return records


# ============================================================
# 讀取檔案
# ============================================================

def load_import_file(
    file_path: str
) -> List[Dict[str, Any]]:

    path = Path(
        file_path
    ).resolve()


    if not path.exists():

        raise ManualScheduleImportError(
            (
                "找不到匯入檔案："
                f"{path}"
            )
        )


    if not path.is_file():

        raise ManualScheduleImportError(
            (
                "匯入路徑不是檔案："
                f"{path}"
            )
        )


    extension = (
        path.suffix.lower()
    )


    if (
        extension
        not in SUPPORTED_EXTENSIONS
    ):

        raise ManualScheduleImportError(
            (
                "只支援 CSV / JSON，"
                f"目前格式：{extension}"
            )
        )


    if extension == ".csv":

        records = (
            load_csv_records(
                path
            )
        )


    else:

        records = (
            load_json_records(
                path
            )
        )


    if not records:

        raise ManualScheduleImportError(
            "匯入檔案沒有有效門診資料"
        )


    return records


# ============================================================
# Preview
#
# 不寫 DB
# ============================================================

def preview_records(
    records: List[Dict[str, Any]],
    limit: int = 10
) -> None:

    print(
        "\n" + "=" * 70
    )

    print(
        "門診資料 Preview"
    )

    print(
        "=" * 70
    )


    print(
        f"總筆數：{len(records)}"
    )


    for index, record in enumerate(
        records[:limit],
        start=1
    ):

        print(
            "\n" + "-" * 70
        )

        print(
            f"第 {index} 筆"
        )


        print(
            "doctor_id           =",
            record.get(
                "doctor_id"
            )
        )


        print(
            "hospital_id         =",
            record.get(
                "hospital_id"
            )
        )


        print(
            "schedule_date       =",
            record.get(
                "schedule_date"
            )
        )


        print(
            "session             =",
            record.get(
                "session"
            )
        )


        print(
            "start_time          =",
            record.get(
                "start_time"
            )
        )


        print(
            "end_time            =",
            record.get(
                "end_time"
            )
        )


        print(
            "time_precision      =",
            record.get(
                "time_precision"
            )
        )


        print(
            "clinic_room         =",
            record.get(
                "clinic_room"
            )
        )


        print(
            "registration_status =",
            record.get(
                "registration_status"
            )
        )


        print(
            "substitute_doctor   =",
            record.get(
                "substitute_doctor_name"
            )
        )


        print(
            "is_exception        =",
            record.get(
                "is_exception"
            )
        )


        print(
            "source_type         =",
            record.get(
                "source_type"
            )
        )


        print(
            "source_url          =",
            record.get(
                "source_url"
            )
        )


    if len(records) > limit:

        print(
            f"\n...其餘 {len(records) - limit} 筆省略"
        )


    print(
        "\n" + "=" * 70
    )


# ============================================================
# 確認同一份匯入檔不能混多個 source_id
#
# sync_schedule_records() 是以 source_id 為單位同步。
# ============================================================

def validate_source_consistency(
    records: List[Dict[str, Any]],
    source_id: int
) -> None:

    if not isinstance(
        source_id,
        int
    ):

        raise ManualScheduleImportError(
            "source_id 必須是整數"
        )


    if source_id <= 0:

        raise ManualScheduleImportError(
            "source_id 必須大於 0"
        )


    # ========================================================
    # 這裡不直接查 source table。
    #
    # 真正的 doctor/hospital/source 一致性，
    # schedule_sync.normalize_schedule_record()
    # 會再做第二次驗證。
    # ========================================================

    if not records:

        raise ManualScheduleImportError(
            "沒有可同步的 records"
        )


# ============================================================
# 執行正式匯入
# ============================================================

def import_schedule_file(
    source_id: int,
    file_path: str,
    dry_run: bool = True
) -> Dict[str, Any]:

    print(
        "=" * 70
    )

    print(
        "官方門診 CSV / JSON 半自動匯入器"
    )

    print(
        "=" * 70
    )


    print(
        f"\nsource_id = {source_id}"
    )

    print(
        f"file      = {file_path}"
    )

    print(
        f"dry_run   = {dry_run}"
    )


    # ========================================================
    # Load
    # ========================================================

    records = (
        load_import_file(
            file_path
        )
    )


    validate_source_consistency(
        records,
        source_id
    )


    # ========================================================
    # Preview
    # ========================================================

    preview_records(
        records
    )


    # ========================================================
    # Dry Run
    # ========================================================

    if dry_run:

        print(
            "\n✅ Dry Run 完成"
        )

        print(
            "✅ 資料格式驗證成功"
        )

        print(
            "✅ 尚未寫入 doctor_schedules"
        )


        return {
            "status":
                "dry_run",

            "source_id":
                source_id,

            "records":
                len(records),

            "inserted":
                0,

            "updated":
                0,
        }


    # ========================================================
    # 正式同步
    # ========================================================

    print(
        "\n開始寫入 doctor_schedules..."
    )


    try:

        result = (
            sync_schedule_records(
                source_id=
                    source_id,

                records=
                    records
            )
        )


    except ScheduleSyncError as exc:

        raise ManualScheduleImportError(
            (
                "門診資料同步失敗："
                f"{exc}"
            )
        ) from exc


    print(
        "\n同步結果："
    )

    print(
        "status    =",
        result.get(
            "status"
        )
    )

    print(
        "processed =",
        result.get(
            "processed"
        )
    )

    print(
        "inserted  =",
        result.get(
            "inserted"
        )
    )

    print(
        "updated   =",
        result.get(
            "updated"
        )
    )


    print(
        "\n✅ 官方門診資料匯入完成"
    )


    return result


# ============================================================
# CLI
# ============================================================

def main():

    import argparse


    parser = (
        argparse.ArgumentParser(
            description=(
                "官方門診 CSV / JSON 半自動匯入器"
            )
        )
    )


    parser.add_argument(
        "--source-id",
        type=int,
        required=True,
        help="doctor_schedule_sources.id"
    )


    parser.add_argument(
        "--file",
        required=True,
        help="CSV 或 JSON 檔案路徑"
    )


    parser.add_argument(
        "--commit",
        action="store_true",
        help=(
            "真正寫入資料庫。"
            "未指定時只做 Dry Run。"
        )
    )


    args = (
        parser.parse_args()
    )


    try:

        import_schedule_file(
            source_id=
                args.source_id,

            file_path=
                args.file,

            dry_run=
                not args.commit
        )


    except ManualScheduleImportError as exc:

        print()

        print(
            "=" * 70
        )

        print(
            "❌ 匯入失敗"
        )

        print(
            f"錯誤：{exc}"
        )

        print(
            "=" * 70
        )

        raise SystemExit(
            1
        )


if __name__ == "__main__":

    main()