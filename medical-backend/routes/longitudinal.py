"""
CarePath AI
Longitudinal Health Intelligence API

Competition Upgrade 02

API：
GET /api/v1/longitudinal

功能：
1. 驗證目前登入會員
2. 從 PostgreSQL 讀取該會員歷史 chat_sessions
3. 將歷史紀錄交給 Longitudinal Health Intelligence Engine
4. 回傳疼痛趨勢、反覆症狀、問診頻率、科別模式與時間軸

注意：
- 訪客沒有持久歷史資料，因此不可使用此功能
- 本 API 不進行疾病診斷
- 即時危險症狀仍由 Red Flag Safety Engine 處理
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)

from psycopg2.extras import RealDictCursor


from longitudinal_intelligence import (
    LONGITUDINAL_ENGINE_VERSION,
    analyze_longitudinal_sessions,
)

from routes.auth import get_current_user

from services import get_db_connection


# ============================================================
# Router
# ============================================================

router = APIRouter(
    prefix="/api/v1/longitudinal",
    tags=["Longitudinal Health Intelligence"],
)


# ============================================================
# JSON Helper
# ============================================================

def _safe_json_list(
    value: Any,
) -> list:
    """
    PostgreSQL JSONB 通常會由 psycopg2
    直接轉成 Python list。

    但為了相容舊資料或 TEXT 欄位，
    這裡仍做安全處理。
    """

    if value is None:
        return []

    if isinstance(
        value,
        list,
    ):
        return value

    if isinstance(
        value,
        tuple,
    ):
        return list(
            value
        )

    if isinstance(
        value,
        str,
    ):

        import json

        try:

            parsed = json.loads(
                value
            )

            if isinstance(
                parsed,
                list,
            ):
                return parsed

        except (
            json.JSONDecodeError,
            TypeError,
        ):
            pass

    return []


# ============================================================
# GET /api/v1/longitudinal
# ============================================================

@router.get("")
def get_longitudinal_health_analysis(

    window_days: int = Query(
        default=90,
        ge=30,
        le=365,
        description="縱向分析時間窗，單位為天",
    ),

    current_user=Depends(
        get_current_user
    ),
):
    """
    分析目前登入會員的歷史健康問診變化。

    回傳內容包含：
    - overall
    - pain_trend
    - visit_frequency
    - recurring_symptoms
    - department_patterns
    - recurring_possible_causes
    - insights
    - timeline
    """

    # ========================================================
    # 1. 訪客不可使用
    # ========================================================

    if current_user.get(
        "is_guest"
    ):

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "訪客帳號無法使用縱向健康分析功能，"
                "請登入正式會員後使用。"
            ),
        )


    user_id = current_user.get(
        "id"
    )


    if not user_id:

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="無法辨識目前登入會員",
        )


    # ========================================================
    # 2. DB Connection
    # ========================================================

    conn = get_db_connection()


    if not conn:

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法連線至資料庫",
        )


    try:

        # ====================================================
        # 3. 取得該會員歷史問診
        #
        # chronological order：
        # 舊 → 新
        #
        # 這樣 pain trend 等時間分析
        # 可以直接依照資料順序處理。
        # ====================================================

        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:

            cur.execute(
                """
                SELECT
                    id,
                    user_id,
                    symptom_text,
                    original_symptom,
                    COALESCE(
                        pain_level,
                        3
                    ) AS pain_level,
                    suggested_department,
                    possible_causes,
                    created_at
                FROM chat_sessions
                WHERE user_id = %s
                ORDER BY created_at ASC;
                """,
                (
                    user_id,
                ),
            )


            rows = cur.fetchall()


        # ====================================================
        # 4. Convert DB rows
        # ====================================================

        sessions = []


        for row in rows:

            sessions.append(
                {
                    "id":
                        row.get(
                            "id"
                        ),

                    "user_id":
                        row.get(
                            "user_id"
                        ),

                    "symptom_text":
                        row.get(
                            "symptom_text"
                        )
                        or
                        "",

                    "original_symptom":
                        row.get(
                            "original_symptom"
                        )
                        or
                        row.get(
                            "symptom_text"
                        )
                        or
                        "",

                    "pain_level":
                        row.get(
                            "pain_level"
                        ),

                    "suggested_department":
                        row.get(
                            "suggested_department"
                        )
                        or
                        "",

                    "possible_causes":
                        _safe_json_list(
                            row.get(
                                "possible_causes"
                            )
                        ),

                    "created_at":
                        row.get(
                            "created_at"
                        ),
                }
            )


        # ====================================================
        # 5. Longitudinal Intelligence Engine
        # ====================================================

        analysis = analyze_longitudinal_sessions(
            raw_sessions=sessions,
            analysis_window_days=window_days,
        )


        # ====================================================
        # 6. API Metadata
        # ====================================================

        return {

            "status":
                "success",

            "feature":
                "longitudinal_health_intelligence",

            "user_id":
                user_id,

            "engine_version":
                LONGITUDINAL_ENGINE_VERSION,

            "analysis":
                analysis,
        }


    except HTTPException:

        raise


    except Exception as exc:

        print(
            "❌ Longitudinal Health Intelligence API error:",
            repr(
                exc
            ),
        )


        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="縱向健康分析目前無法完成",
        )


    finally:

        conn.close()