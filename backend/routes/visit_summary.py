# routes/visit_summary.py

import json

from typing import Any, Dict, Optional

from api_errors import log_failure

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
)

from psycopg2.extras import RealDictCursor

from routes.auth import get_current_user
from services import get_db_connection
from visit_summary import build_visit_summary


# ============================================================
# Router
# ============================================================

router = APIRouter(
    prefix="/api/v1/visit-summary",
    tags=["Visit Summary"],
)


# ============================================================
# JSON Helper
# ============================================================

def _parse_json_value(
    value: Any,
    default: Any,
) -> Any:
    """
    PostgreSQL JSON / JSONB 在 psycopg2 中
    通常已經會是 Python dict/list。

    但若資料庫舊資料仍為文字 JSON，
    這裡也可以安全解析。
    """

    if value is None:
        return default

    if isinstance(
        value,
        (
            dict,
            list,
        ),
    ):
        return value

    if isinstance(
        value,
        str,
    ):
        text = value.strip()

        if not text:
            return default

        try:
            return json.loads(
                text
            )

        except (
            json.JSONDecodeError,
            TypeError,
        ):
            return default

    return default


# ============================================================
# Stored Conversation History
# ============================================================

def _extract_stored_history(
    session: Dict[str, Any],
) -> list:
    """
    從 chat_sessions 讀取已保存的完整多輪問診紀錄。

    目前正式 diagnose.py 保存欄位為：

        history_json

    但為了相容舊 schema / 舊資料，
    仍保留：

        history

    讀取優先順序：

        1. history_json
        2. history

    只有真正解析為 list 才採用。
    """

    candidate_fields = [
        "history_json",
        "history",
    ]

    for field in candidate_fields:

        if field not in session:
            continue

        parsed = _parse_json_value(
            session.get(
                field
            ),
            default=[],
        )

        if (
            isinstance(
                parsed,
                list,
            )
            and
            len(parsed) > 0
        ):
            return parsed

    return []


# ============================================================
# Safety Snapshot
# ============================================================

def _extract_stored_safety(
    session: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """
    嘗試從 chat_sessions 中讀取已儲存的
    Safety Engine Snapshot。

    目前資料庫 schema 可能仍在演進，
    所以支援幾個可能欄位名稱。

    重要：
    此處不重新推論 Safety。

    如果歷史問診沒有儲存 safety snapshot，
    就回傳 None，而不是自行假設 standard。
    """

    candidate_fields = [
        "safety",
        "safety_result",
        "safety_assessment",
        "safety_snapshot",
    ]

    for field in candidate_fields:

        if field not in session:
            continue

        parsed = _parse_json_value(
            session.get(
                field
            ),
            default=None,
        )

        if isinstance(
            parsed,
            dict,
        ):
            return parsed

    return None


# ============================================================
# Profile
# ============================================================

def _load_user_profile(
    cur,
    user_id: int,
) -> Optional[Dict[str, Any]]:
    """
    讀取會員健康 Profile。

    使用 SELECT *，
    是因為目前 user_profiles schema
    仍可能持續擴充。

    visit_summary.py 只會取它認得的欄位；
    多餘欄位不會影響摘要。
    """

    # --------------------------------------------------------
    # 先確認資料表存在
    # --------------------------------------------------------

    cur.execute(
        """
        SELECT
            to_regclass(
                'public.user_profiles'
            ) AS table_name;
        """
    )

    table_result = (
        cur.fetchone()
    )

    if (
        not table_result
        or
        not table_result[
            "table_name"
        ]
    ):
        return None


    # --------------------------------------------------------
    # 讀取 Profile
    # --------------------------------------------------------

    cur.execute(
        """
        SELECT
            *
        FROM user_profiles
        WHERE user_id = %s
        LIMIT 1;
        """,
        (
            user_id,
        ),
    )

    profile = (
        cur.fetchone()
    )

    if not profile:
        return None

    return dict(
        profile
    )


# ============================================================
# GET Visit Summary
# ============================================================

@router.get(
    "/{session_id}"
)
def get_visit_summary(
    session_id: str,
    current_user=Depends(
        get_current_user
    ),
):
        # ========================================================
    # Session ID
    #
    # Swagger UI 某些版本對 integer path parameter
    # 會出現錯誤的前端驗證，因此 API 先以字串接收，
    # 再由後端嚴格轉成整數。
    # ========================================================

    try:

        session_id = int(
            session_id
        )

    except (
        TypeError,
        ValueError,
    ):

        raise HTTPException(
            status_code=(
                status.HTTP_422_UNPROCESSABLE_ENTITY
            ),
            detail="session_id 必須為整數",
        )
    """
    取得單筆 AI 問診的就醫摘要。

    ==========================================================
    Security
    ==========================================================

    查詢條件必須同時符合：

        session.id = session_id
        session.user_id = current_user.id

    因此使用者不能利用 session_id
    查看其他會員的健康資料。

    ==========================================================
    Data Sources
    ==========================================================

    - chat_sessions
    - user_profiles
    - 已儲存 Safety Snapshot（若存在）

    ==========================================================
    Safety
    ==========================================================

    如果舊歷史資料沒有 Safety Snapshot：

        safety = unavailable

    絕對不把「沒有資料」解讀成：

        risk = standard
    """

    user_id = (
        current_user.get(
            "id"
        )
    )


    # ========================================================
    # 身分類型檢查
    #
    # 目前正式使用中的 users-table Guest
    # actor_type 仍是 user，因此可以正常使用。
    #
    # guest_sessions UUID 架構目前沒有對應
    # chat_sessions.user_id，因此先拒絕，
    # 避免 UUID 被送進 integer user_id 欄位。
    # ========================================================

    if (
        current_user.get(
            "actor_type"
        )
        ==
        "guest"
    ):

        raise HTTPException(
            status_code=(
                status.HTTP_403_FORBIDDEN
            ),
            detail=(
                "此訪客 Session "
                "目前尚未支援就醫摘要。"
            ),
        )


    try:

        user_id = int(
            user_id
        )

    except (
        TypeError,
        ValueError,
    ):

        raise HTTPException(
            status_code=(
                status.HTTP_401_UNAUTHORIZED
            ),
            detail="登入身分格式錯誤",
        )


    # ========================================================
    # Database
    # ========================================================

    conn = get_db_connection()

    if not conn:

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail="無法連線至資料庫",
        )


    try:

        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:

            # =================================================
            # 1. 讀取指定問診
            #
            # SELECT * 的原因：
            # Safety Snapshot 欄位目前可能尚未統一命名。
            #
            # 但安全性仍由 user_id constraint 保證。
            # =================================================

            cur.execute(
                """
                SELECT
                    *
                FROM chat_sessions
                WHERE
                    id = %s
                    AND
                    user_id = %s
                LIMIT 1;
                """,
                (
                    session_id,
                    user_id,
                ),
            )

            session = (
                cur.fetchone()
            )


            # =================================================
            # Session Not Found
            # =================================================

            if not session:

                raise HTTPException(
                    status_code=(
                        status.HTTP_404_NOT_FOUND
                    ),
                    detail=(
                        "找不到此問診紀錄，"
                        "或您沒有權限查看此紀錄。"
                    ),
                )


            session_dict = dict(
                session
            )


            # =================================================
            # 2. Parse History
            #
            # 正式 diagnose.py 目前保存於 history_json。
            # 同時保留舊 history 欄位相容性。
            # =================================================

            history = (
                _extract_stored_history(
                    session_dict
                )
            )


            # =================================================
            # 3. Parse Possible Causes
            # =================================================

            possible_causes = (
                _parse_json_value(
                    session_dict.get(
                        "possible_causes"
                    ),
                    default=[],
                )
            )

            if isinstance(
                possible_causes,
                str,
            ):
                possible_causes = [
                    possible_causes
                ]

            if not isinstance(
                possible_causes,
                list,
            ):
                possible_causes = []


            # =================================================
            # 4. Safety Snapshot
            # =================================================

            safety = (
                _extract_stored_safety(
                    session_dict
                )
            )


            safety_source = (
                "stored_snapshot"
                if safety
                else
                "unavailable"
            )


            # =================================================
            # 5. Profile
            # =================================================

            profile = (
                _load_user_profile(
                    cur=cur,
                    user_id=user_id,
                )
            )


            # =================================================
            # 6. Chief Complaint
            #
            # 優先 original_symptom，
            # 因為它通常代表本次問診最初主訴。
            # =================================================

            chief_complaint = (
                session_dict.get(
                    "original_symptom"
                )
                or
                session_dict.get(
                    "symptom_text"
                )
                or
                ""
            )


            # =================================================
            # 7. Build Summary
            # =================================================

            summary = (
                build_visit_summary(

                    session_id=(
                        session_dict.get(
                            "id"
                        )
                    ),

                    created_at=(
                        session_dict.get(
                            "created_at"
                        )
                    ),

                    symptom_text=(
                        chief_complaint
                    ),

                    pain_level=(
                        session_dict.get(
                            "pain_level"
                        )
                    ),

                    history=(
                        history
                    ),

                    suggested_department=(
                        session_dict.get(
                            "suggested_department"
                        )
                    ),

                    possible_causes=(
                        possible_causes
                    ),

                    safety=(
                        safety
                    ),

                    profile=(
                        profile
                    ),
                )
            )


            # =================================================
            # 8. Audit Metadata
            # =================================================

            summary[
                "safety"
            ][
                "source"
            ] = (
                safety_source
            )


            history_source = (
                "history_json"
                if (
                    "history_json"
                    in session_dict
                    and
                    isinstance(
                        _parse_json_value(
                            session_dict.get(
                                "history_json"
                            ),
                            default=[],
                        ),
                        list,
                    )
                    and
                    len(
                        _parse_json_value(
                            session_dict.get(
                                "history_json"
                            ),
                            default=[],
                        )
                    ) > 0
                )
                else (
                    "history"
                    if (
                        "history"
                        in session_dict
                        and
                        isinstance(
                            _parse_json_value(
                                session_dict.get(
                                    "history"
                                ),
                                default=[],
                            ),
                            list,
                        )
                        and
                        len(
                            _parse_json_value(
                                session_dict.get(
                                    "history"
                                ),
                                default=[],
                            )
                        ) > 0
                    )
                    else "unavailable"
                )
            )


            summary[
                "data_sources"
            ] = {
                "chat_session":
                    True,

                "user_profile":
                    profile
                    is not None,

                "safety_snapshot":
                    safety
                    is not None,

                "history":
                    history_source,
            }


            # =================================================
            # Response
            # =================================================

            return {
                "status":
                    "success",

                "feature":
                    "visit_summary",

                "user_id":
                    user_id,

                "session_id":
                    session_id,

                "summary":
                    summary,
            }


    except HTTPException:

        raise


    except ValueError as exc:

        log_failure("visit_summary.invalid_data", exc)

        raise HTTPException(
            status_code=(
                status.HTTP_422_UNPROCESSABLE_ENTITY
            ),
            detail="問診資料不足或格式不正確，無法產生摘要。",
        )


    except Exception as exc:

        log_failure("visit_summary", exc)

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "就醫摘要產生失敗"
            ),
        )


    finally:

        conn.close()
