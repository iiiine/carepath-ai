"""
手動套用 schema 變更。

專案沒有 migration 工具，schema 一律手動同步。這支腳本只是讓
schema/*.sql 能被重複執行而不必開 psql，不是 migration 框架 ——
沒有版本表、沒有回滾，檔案本身就是唯一事實來源。

用法：
    cd medical-backend
    & $py schema/apply_schema.py schema/consultation_safety_state.sql

所有 schema/*.sql 都必須可重複執行（IF NOT EXISTS），
重跑不應該有副作用。
"""

import os
import sys

from pathlib import Path

import psycopg2

from dotenv import load_dotenv


def main() -> int:

    if len(sys.argv) != 2:

        print(
            "❌ 用法：apply_schema.py <path/to/file.sql>"
        )

        return 1


    sql_path = Path(
        sys.argv[1]
    )


    if not sql_path.is_file():

        print(
            f"❌ 找不到檔案：{sql_path}"
        )

        return 1


    # .env 在 medical-backend/ 底下，不在專案根目錄
    load_dotenv(
        Path(__file__).parent.parent / ".env"
    )


    database_url = os.getenv(
        "DATABASE_URL"
    )


    if not database_url:

        print(
            "❌ 找不到 DATABASE_URL，請確認 medical-backend/.env"
        )

        return 1


    # 只印主機名，不印帳密
    host = (
        database_url
        .split("@")[-1]
        .split("/")[0]
    )


    print(
        f"🛡️ 套用 {sql_path.name}\n"
        f"   目標：{host}"
    )


    sql = sql_path.read_text(
        encoding="utf-8"
    )


    conn = psycopg2.connect(
        database_url
    )


    try:

        with conn.cursor() as cur:

            cur.execute(
                sql
            )


        conn.commit()


        print(
            "✅ 完成"
        )


        return 0


    except Exception as exc:

        conn.rollback()

        print(
            f"❌ 套用失敗，已 rollback：{type(exc).__name__}: {exc}"
        )

        return 1


    finally:

        try:
            conn.close()

        except Exception:
            pass


if __name__ == "__main__":

    sys.exit(
        main()
    )
