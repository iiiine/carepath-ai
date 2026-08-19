from fastapi import APIRouter, Depends, HTTPException, status
from psycopg2.extras import RealDictCursor

from services import get_db_connection
from routes.auth import get_current_user


router = APIRouter(
    prefix="/api/v1/dashboard",
    tags=["Dashboard"]
)


@router.get("/summary")
def get_dashboard_summary(
    current_user=Depends(get_current_user)
):
    """
    取得會員健康 Dashboard 基本摘要。

    回傳：
    - 最近 30 天問診次數
    - 最近一次有紀錄的不適程度
    - 最近一次建議科別
    - 最常建議科別
    - 最近一次問診時間
    """

    # Dashboard V1 先限定正式會員使用
    if current_user.get("is_guest"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="健康 Dashboard 僅提供正式會員使用"
        )

    user_id = current_user["id"]

    conn = get_db_connection()

    if not conn:
        raise HTTPException(
            status_code=500,
            detail="無法連線至資料庫"
        )

    try:
        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:

            # --------------------------------------------------
            # 1. 最近 30 天問診次數
            # --------------------------------------------------
            cur.execute(
                """
                SELECT COUNT(*) AS consultation_count_30d
                FROM chat_sessions
                WHERE user_id = %s
                AND created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days';
                """,
                (user_id,)
            )

            count_row = cur.fetchone()

            consultation_count_30d = (
                count_row["consultation_count_30d"]
                if count_row
                else 0
            )

            # --------------------------------------------------
            # 2. 最近一次問診
            # --------------------------------------------------
            cur.execute(
                """
                SELECT
                    id,
                    title,
                    symptom_text,
                    pain_level,
                    suggested_department,
                    created_at
                FROM chat_sessions
                WHERE user_id = %s
                ORDER BY created_at DESC
                LIMIT 1;
                """,
                (user_id,)
            )

            latest_session = cur.fetchone()

            # --------------------------------------------------
            # 3. 最近一次「有 pain_level」的紀錄
            #
            # 舊資料有部分 pain_level = NULL，
            # 所以不要單純拿最新一筆。
            # --------------------------------------------------
            cur.execute(
                """
                SELECT pain_level
                FROM chat_sessions
                WHERE user_id = %s
                AND pain_level IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 1;
                """,
                (user_id,)
            )

            latest_pain_row = cur.fetchone()

            latest_pain_level = (
                latest_pain_row["pain_level"]
                if latest_pain_row
                else None
            )

            # --------------------------------------------------
            # 4. 最常被建議的科別
            # --------------------------------------------------
            cur.execute(
                """
                SELECT
                    suggested_department,
                    COUNT(*) AS department_count
                FROM chat_sessions
                WHERE user_id = %s
                AND suggested_department IS NOT NULL
                AND TRIM(suggested_department) <> ''
                GROUP BY suggested_department
                ORDER BY
                    department_count DESC,
                    suggested_department ASC
                LIMIT 1;
                """,
                (user_id,)
            )

            most_common_row = cur.fetchone()

            most_common_department = (
                most_common_row["suggested_department"]
                if most_common_row
                else None
            )

        # ------------------------------------------------------
        # 沒有任何問診紀錄
        # ------------------------------------------------------
        if not latest_session:
            return {
                "consultation_count_30d": int(
                    consultation_count_30d
                ),
                "latest_pain_level": None,
                "latest_department": None,
                "most_common_department": None,
                "latest_consultation_at": None,
                "latest_title": None
            }

        # ------------------------------------------------------
        # 有問診紀錄
        # ------------------------------------------------------
        return {
            "consultation_count_30d": int(
                consultation_count_30d
            ),

            "latest_pain_level": (
                int(latest_pain_level)
                if latest_pain_level is not None
                else None
            ),

            "latest_department": (
                latest_session["suggested_department"]
            ),

            "most_common_department": (
                most_common_department
            ),

            "latest_consultation_at": (
                latest_session["created_at"].isoformat()
                if latest_session["created_at"]
                else None
            ),

            # 舊資料 title 可能是 NULL
            "latest_title": (
                latest_session["title"]
                or latest_session["symptom_text"]
                or "未命名問診"
            )
        }

    except HTTPException:
        raise

    except Exception as error:
        print(
            f"❌ Dashboard summary 查詢失敗：{error}"
        )

        raise HTTPException(
            status_code=500,
            detail="取得健康 Dashboard 資料失敗"
        )

    finally:
        conn.close()
@router.get("/pain-trend")
def get_pain_trend(
    current_user=Depends(get_current_user)
):
    """
    取得目前會員最近 30 天的不適程度趨勢。

    規則：
    - 只查目前登入會員自己的問診
    - 排除 pain_level = NULL 的舊資料
    - 同一天如果有多次問診，計算當日平均不適程度
    - 由舊到新排序，方便前端直接畫折線圖
    """

    # Dashboard 僅正式會員使用
    if current_user.get("is_guest"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="健康 Dashboard 僅提供正式會員使用"
        )

    user_id = current_user["id"]

    conn = get_db_connection()

    if not conn:
        raise HTTPException(
            status_code=500,
            detail="無法連線至資料庫"
        )

    try:
        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:

            cur.execute(
                """
                SELECT
                    DATE(created_at) AS consultation_date,

                    ROUND(
                        AVG(pain_level)::numeric,
                        2
                    ) AS average_pain_level,

                    MAX(pain_level) AS max_pain_level,

                    COUNT(*) AS consultation_count

                FROM chat_sessions

                WHERE user_id = %s
                AND pain_level IS NOT NULL
                AND created_at >=
                    CURRENT_TIMESTAMP - INTERVAL '30 days'

                GROUP BY DATE(created_at)

                ORDER BY consultation_date ASC;
                """,
                (user_id,)
            )

            rows = cur.fetchall()

        result = []

        for row in rows:
            result.append({
                "date": (
                    row["consultation_date"].isoformat()
                    if row["consultation_date"]
                    else None
                ),

                "average_pain_level": (
                    float(row["average_pain_level"])
                    if row["average_pain_level"] is not None
                    else None
                ),

                "max_pain_level": (
                    int(row["max_pain_level"])
                    if row["max_pain_level"] is not None
                    else None
                ),

                "consultation_count": int(
                    row["consultation_count"]
                )
            })

        return result

    except HTTPException:
        raise

    except Exception as error:
        print(
            f"❌ Dashboard pain trend 查詢失敗：{error}"
        )

        raise HTTPException(
            status_code=500,
            detail="取得不適程度趨勢失敗"
        )

    finally:
        conn.close()
@router.get("/recent-sessions")
def get_recent_sessions(
    current_user=Depends(get_current_user)
):
    """
    取得目前登入會員最近 5 筆問診紀錄。

    Dashboard 首頁使用。
    """

    # Dashboard V1 僅正式會員使用
    if current_user.get("is_guest"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="健康 Dashboard 僅提供正式會員使用"
        )

    user_id = current_user["id"]

    conn = get_db_connection()

    if not conn:
        raise HTTPException(
            status_code=500,
            detail="無法連線至資料庫"
        )

    try:
        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:

            cur.execute(
                """
                SELECT
                    id,
                    title,
                    symptom_text,
                    original_symptom,
                    pain_level,
                    suggested_department,
                    created_at
                FROM chat_sessions
                WHERE user_id = %s
                ORDER BY created_at DESC
                LIMIT 5;
                """,
                (user_id,)
            )

            rows = cur.fetchall()

        result = []

        for row in rows:

            # ------------------------------------------
            # 標題 fallback
            #
            # 1. title
            # 2. original_symptom
            # 3. symptom_text
            # 4. 未命名問診
            # ------------------------------------------
            display_title = (
                row["title"]
                or row["original_symptom"]
                or row["symptom_text"]
                or "未命名問診"
            )

            result.append({
                "id": row["id"],

                "title": display_title,

                "symptom": (
                    row["original_symptom"]
                    or row["symptom_text"]
                    or ""
                ),

                "pain_level": (
                    int(row["pain_level"])
                    if row["pain_level"] is not None
                    else None
                ),

                "suggested_department": (
                    row["suggested_department"]
                    or "尚未分類"
                ),

                "created_at": (
                    row["created_at"].isoformat()
                    if row["created_at"]
                    else None
                )
            })

        return result

    except HTTPException:
        raise

    except Exception as error:
        print(
            f"❌ Dashboard recent sessions 查詢失敗：{error}"
        )

        raise HTTPException(
            status_code=500,
            detail="取得最近問診紀錄失敗"
        )

    finally:
        conn.close()
@router.get("/departments")
def get_department_stats(
    current_user=Depends(get_current_user)
):
    """
    取得目前登入會員最近 90 天的建議科別統計。

    回傳：
    - 科別名稱
    - 問診次數
    - 百分比

    Dashboard 科別分布圖使用。
    """

    # Dashboard V1 僅正式會員使用
    if current_user.get("is_guest"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="健康 Dashboard 僅提供正式會員使用"
        )

    user_id = current_user["id"]

    conn = get_db_connection()

    if not conn:
        raise HTTPException(
            status_code=500,
            detail="無法連線至資料庫"
        )

    try:
        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:

            # --------------------------------------------------
            # 最近 90 天各科別問診次數
            # --------------------------------------------------
            cur.execute(
                """
                SELECT
                    suggested_department,
                    COUNT(*) AS consultation_count

                FROM chat_sessions

                WHERE user_id = %s

                AND created_at >=
                    CURRENT_TIMESTAMP - INTERVAL '90 days'

                AND suggested_department IS NOT NULL

                AND TRIM(suggested_department) <> ''

                GROUP BY suggested_department

                ORDER BY
                    consultation_count DESC,
                    suggested_department ASC;
                """,
                (user_id,)
            )

            rows = cur.fetchall()

        # ------------------------------------------------------
        # 計算總問診筆數
        # ------------------------------------------------------
        total_count = sum(
            int(row["consultation_count"])
            for row in rows
        )

        result = []

        for row in rows:

            count = int(
                row["consultation_count"]
            )

            percentage = (
                round(
                    (count / total_count) * 100,
                    1
                )
                if total_count > 0
                else 0
            )

            result.append({
                "department": (
                    row["suggested_department"]
                ),

                "consultation_count": count,

                "percentage": percentage
            })

        return result

    except HTTPException:
        raise

    except Exception as error:
        print(
            f"❌ Dashboard departments 查詢失敗：{error}"
        )

        raise HTTPException(
            status_code=500,
            detail="取得科別統計失敗"
        )

    finally:
        conn.close()