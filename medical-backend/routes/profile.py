# routes/profile.py
from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel
from typing import Optional
from routes.auth import get_current_user
from services import get_db_connection

router = APIRouter(prefix="/api/v1/profile", tags=["Profile"])

class ProfileSchema(BaseModel):
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    birth_date: Optional[str] = None  # 格式: YYYY-MM-DD
    gender: Optional[str] = None
    past_medical_history: Optional[str] = None
    allergy_history: Optional[str] = None
    current_medications: Optional[str] = None

# 1. 取得使用者健康資料
@router.get("")
async def get_user_profile(current_user=Depends(get_current_user)):
    if current_user.get("is_guest"):
        raise HTTPException(status_code=403, detail="訪客無法使用此功能")

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="無法連線至資料庫")

    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT height_cm, weight_kg, birth_date, gender, 
                       past_medical_history, allergy_history, current_medications 
                FROM user_profiles WHERE user_id = %s;
            """, (current_user["id"],))
            row = cur.fetchone()
            
            if not row:
                return {} # 還沒填過回傳空物件

            return {
                "height_cm": float(row[0]) if row[0] else None,
                "weight_kg": float(row[1]) if row[1] else None,
                "birth_date": str(row[2]) if row[2] else None,
                "gender": row[3],
                "past_medical_history": row[4] or "",
                "allergy_history": row[5] or "",
                "current_medications": row[6] or ""
            }
    finally:
        conn.close()

# 2. 新增 / 更新健康資料 (Upsert)
@router.post("")
async def update_user_profile(payload: ProfileSchema, current_user=Depends(get_current_user)):
    if current_user.get("is_guest"):
        raise HTTPException(status_code=403, detail="訪客無法儲存健康資料")

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="無法連線至資料庫")

    # 💡 處理生日字串，若是空字串則轉為 None (資料庫的 NULL)
    birth_date_val = payload.birth_date.strip().replace('/', '-') if payload.birth_date and payload.birth_date.strip() else None

    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO user_profiles (user_id, height_cm, weight_kg, birth_date, gender, past_medical_history, allergy_history, current_medications)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id) DO UPDATE SET
                    height_cm = EXCLUDED.height_cm,
                    weight_kg = EXCLUDED.weight_kg,
                    birth_date = EXCLUDED.birth_date,
                    gender = EXCLUDED.gender,
                    past_medical_history = EXCLUDED.past_medical_history,
                    allergy_history = EXCLUDED.allergy_history,
                    current_medications = EXCLUDED.current_medications,
                    updated_at = CURRENT_TIMESTAMP;
            """, (
                current_user["id"], 
                payload.height_cm, 
                payload.weight_kg,
                birth_date_val,  # 👈 傳入處理後的 birth_date_val
                payload.gender, 
                payload.past_medical_history,
                payload.allergy_history, 
                payload.current_medications
            ))
            conn.commit()
            return {"status": "success", "message": "健康基本資料已更新"}
    except Exception as e:
        print(f"⚠️ 儲存 Profile 失敗: {e}")
        raise HTTPException(status_code=500, detail=f"資料庫寫入失敗: {str(e)}")
    finally:
        conn.close()