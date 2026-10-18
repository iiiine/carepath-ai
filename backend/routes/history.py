# routes/history.py
import json

from api_errors import log_failure

from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel
from psycopg2.extras import RealDictCursor
from typing import List

from routes.auth import get_current_user
from services import get_db_connection
from models import (
    ChatSessionResponse,
    ChatMessage,
    HospitalResponse
)


router = APIRouter(
    prefix="/api/v1/history",
    tags=["History"]
)


# 修改標題的請求格式
class UpdateTitleRequest(BaseModel):
    title: str


def parse_json_list(value):
    """
    將 PostgreSQL JSONB、JSON 字串或空值統一轉成 list。
    """
    if value is None:
        return []

    if isinstance(value, list):
        return value

    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []

    return []


# 1. 取得目前登入會員的所有歷史問診
@router.get(
    "",
    response_model=List[ChatSessionResponse]
)
# 註：這裡刻意用一般 def 而非 async def。函式內部呼叫的 Gemini、
# 資料庫、RAG 全是同步阻塞的，寫成 async def 會直接卡住 event loop，
# 連健康檢查都無法回應（Render 會因此判定服務死亡並重啟）。
# 用一般 def，FastAPI 會把它丟到 threadpool 執行，event loop 保持空閒。
def get_user_history(
    current_user=Depends(get_current_user)
):
    if current_user.get("is_guest"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="訪客模式無法檢視歷史對話"
        )

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
                    user_id,
                    title,
                    symptom_text,
                    original_symptom,
                    pain_level,
                    suggested_department,
                    possible_causes,
                    history_json,
                    medical_resources_json,
                    created_at
                FROM chat_sessions
                WHERE user_id = %s
                ORDER BY created_at DESC;
                """,
                (current_user["id"],)
            )

            rows = cur.fetchall()
            history_results = []

            for row in rows:
                history_data = parse_json_list(
                    row["history_json"]
                )

                causes_data = parse_json_list(
                    row["possible_causes"]
                )

                resources_data = parse_json_list(
                    row["medical_resources_json"]
                )

                parsed_messages = []

                for message in history_data:
                    try:
                        parsed_messages.append(
                            ChatMessage(**message)
                        )
                    except Exception as message_error:
                        log_failure("history", message_error)

                parsed_resources = []

                for hospital in resources_data:
                    try:
                        # 舊資料可能沒有醫師欄位
                        if isinstance(hospital, dict):
                            hospital.setdefault(
                                "available_doctors",
                                []
                            )

                        parsed_resources.append(
                            HospitalResponse(**hospital)
                        )

                    except Exception as hospital_error:
                        log_failure("history", hospital_error)

                history_results.append(
                    ChatSessionResponse(
                        id=row["id"],
                        user_id=row["user_id"],

                        title=(
                            row["title"]
                            or row["symptom_text"]
                            or "未命名問診"
                        ),

                        original_symptom=(
                            row["original_symptom"]
                            or row["symptom_text"]
                        ),

                        pain_level=row["pain_level"],

                        suggested_department=(
                            row["suggested_department"]
                        ),

                        possible_causes=causes_data,

                        created_at=(
                            row["created_at"].strftime(
                                "%Y-%m-%d %H:%M"
                            )
                            if row["created_at"]
                            else ""
                        ),

                        history=parsed_messages,

                        nearby_medical_resources=(
                            parsed_resources
                        )
                    )
                )

            return history_results

    except HTTPException:
        raise

    except Exception as error:
        log_failure("history", error)

        raise HTTPException(
            status_code=500,
            detail="抓取歷史對話失敗，請稍後再試。"
        )

    finally:
        conn.close()


# 2. 修改歷史問診標題
@router.patch("/{session_id}")
def update_session_title(
    session_id: int,
    payload: UpdateTitleRequest,
    current_user=Depends(get_current_user)
):
    if current_user.get("is_guest"):
        raise HTTPException(
            status_code=403,
            detail="訪客無法修改紀錄"
        )

    new_title = payload.title.strip()

    if not new_title:
        raise HTTPException(
            status_code=400,
            detail="標題不可為空"
        )

    if len(new_title) > 60:
        raise HTTPException(
            status_code=400,
            detail="標題不可超過 60 個字"
        )

    conn = get_db_connection()

    if not conn:
        raise HTTPException(
            status_code=500,
            detail="資料庫連線失敗"
        )

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE chat_sessions
                SET title = %s
                WHERE id = %s
                  AND user_id = %s;
                """,
                (
                    new_title,
                    session_id,
                    current_user["id"]
                )
            )

            if cur.rowcount == 0:
                raise HTTPException(
                    status_code=404,
                    detail="找不到該筆紀錄或無權限修改"
                )

        conn.commit()

        return {
            "status": "success",
            "message": "標題修改成功",
            "new_title": new_title
        }

    except HTTPException:
        conn.rollback()
        raise

    except Exception as error:
        conn.rollback()

        raise HTTPException(
            status_code=500,
            detail="標題修改失敗，請稍後再試。"
        )

    finally:
        conn.close()


# 3. 刪除單筆歷史紀錄
@router.delete("/{session_id}")
def delete_history_session(
    session_id: int,
    current_user=Depends(get_current_user)
):
    if current_user.get("is_guest"):
        raise HTTPException(
            status_code=403,
            detail="訪客無法刪除紀錄"
        )

    conn = get_db_connection()

    if not conn:
        raise HTTPException(
            status_code=500,
            detail="無法連線至資料庫"
        )

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM chat_sessions
                WHERE id = %s
                  AND user_id = %s;
                """,
                (
                    session_id,
                    current_user["id"]
                )
            )

            if cur.rowcount == 0:
                raise HTTPException(
                    status_code=404,
                    detail="紀錄不存在或無權限刪除"
                )

        conn.commit()

        return {
            "status": "success",
            "message": "已成功刪除紀錄"
        }

    except HTTPException:
        conn.rollback()
        raise

    except Exception as error:
        conn.rollback()

        raise HTTPException(
            status_code=500,
            detail="刪除紀錄失敗，請稍後再試。"
        )

    finally:
        conn.close()