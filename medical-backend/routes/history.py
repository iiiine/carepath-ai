import json
from fastapi import APIRouter, HTTPException, Depends, status
from psycopg2.extras import RealDictCursor
from typing import List

from models import ChatSessionResponse, ChatMessage
from services import get_db_connection
from routes.auth import get_current_user

router = APIRouter(prefix="/api/v1/history", tags=["History"])

# 1. 取得目前登入會員的歷史紀錄
@router.get("", response_model=List[ChatSessionResponse])
def get_user_history(current_user=Depends(get_current_user)):
    # 訪客不可存取歷史對話
    if current_user.get("is_guest"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="訪客帳號無法使用歷史對話功能，請登入會員"
        )

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="無法連線至資料庫")

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, user_id, symptom_text, suggested_department, created_at, history_json
                FROM chat_sessions
                WHERE user_id = %s
                ORDER BY created_at DESC;
            """, (current_user["id"],))
            
            rows = cur.fetchall()
            results = []
            for row in rows:
                raw_history = row["history_json"]
                history_list = raw_history if isinstance(raw_history, list) else json.loads(raw_history)
                
                results.append(ChatSessionResponse(
                    id=row["id"],
                    user_id=row["user_id"],
                    symptom_text=row["symptom_text"],
                    suggested_department=row["suggested_department"],
                    created_at=row["created_at"].strftime("%Y-%m-%d %H:%M"),
                    history=[ChatMessage(**msg) for msg in history_list]
                ))
            return results
    finally:
        conn.close()

# 2.刪除單筆對話紀錄
@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_history_session(session_id: int, current_user=Depends(get_current_user)):
    if current_user.get("is_guest"):
        raise HTTPException(status_code=403, detail="訪客帳號無法使用此功能")

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="無法連線至資料庫")

    try:
        with conn.cursor() as cur:
            cur.execute("""
                DELETE FROM chat_sessions
                WHERE id = %s AND user_id = %s;
            """, (session_id, current_user["id"]))
            conn.commit()
    finally:
        conn.close()