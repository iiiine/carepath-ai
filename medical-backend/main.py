import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
import uvicorn

# 載入 .env 檔案裡的環境變數 (例如資料庫密碼)
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

app = FastAPI(title="醫療系統 AI 詢問後端 (真實資料庫測試版)")

# --------------------------------------------------------------------------
# 1. 定義資料結構 (Pydantic Models)
# --------------------------------------------------------------------------
class SymptomRequest(BaseModel):
    symptom_text: str
    user_latitude: float
    user_longitude: float

class DoctorInfo(BaseModel):
    name: str
    department: str
    specialty: str
    schedule: str

class HospitalResponse(BaseModel):
    name: str
    address: str
    distance_meters: int
    available_doctors: List[DoctorInfo]

class DiagnosisResponse(BaseModel):
    symptom: str
    suggested_department: str
    possible_causes: List[str]
    nearby_medical_resources: List[HospitalResponse]

# --------------------------------------------------------------------------
# 2. 資料庫連線輔助函數
# --------------------------------------------------------------------------
def get_db_connection():
    """建立並回傳一個 PostgreSQL 資料庫連線"""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    except Exception as e:
        print(f"資料庫連線失敗: {e}")
        return None

# --------------------------------------------------------------------------
# 3. API 路由實作
# --------------------------------------------------------------------------
@app.post("/api/v1/diagnose", response_model=DiagnosisResponse)
async def diagnose_symptom(payload: SymptomRequest):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="無法連線到資料庫，請檢查 .env 設定或 PostgreSQL 狀態")
        
    try:
        # --------------------------------------------------------------------------
        # 【Step 1：高效內建語意分類器（替代卡死的外部向量庫）】
        # --------------------------------------------------------------------------
        text_lower = payload.symptom_text.lower()
        
        # 預設值（當使用者輸入完全沒有對到關鍵字時的防呆科別）
        suggested_dept = "家醫科"
        possible_causes = ["一般身體不適", "輕微感冒前兆"]

        # 定義核心醫療分流關鍵字庫
        neuro_keywords = ["頭痛", "偏頭痛", "頭暈", "暈", "後腦勺", "神經痛", "麻", "腦"]
        eye_keywords = ["眼", "視力", "模糊", "眼壓", "結膜", "看東西", "盲"]
        gi_keywords = ["胃", "肚子", "腸", "拉肚子", "上吐下瀉", "消化", "脹氣", "胃食道逆流", "痛"]
        med_keywords = ["咳", "發燒", "喉嚨", "流鼻水", "打噴嚏", "感冒", "流感"]

        # 依序精準比對關鍵字（排除原本向量庫不管如何都跑去腸胃科的 Bug）
        if any(keyword in text_lower for keyword in neuro_keywords):
            suggested_dept = "神經內科"
            possible_causes = ["偏頭痛", "緊縮型頭痛", "神經調控問題"]
        elif any(keyword in text_lower for keyword in eye_keywords):
            suggested_dept = "眼科"
            possible_causes = ["眼壓過高", "視力疲勞", "結膜炎"]
        elif any(keyword in text_lower for keyword in gi_keywords):
            # 如果文字中同時有痛但有上面其他關鍵字（如頭痛），會被上面的 if 攔截，這裡處理純腸胃不適
            suggested_dept = "腸胃科"
            possible_causes = ["急性腸胃炎", "胃食道逆流", "消化不良"]
        elif any(keyword in text_lower for keyword in med_keywords):
            suggested_dept = "家醫科"
            possible_causes = ["一般感冒", "流感前兆", "身體不適"]

        # 在終端機印出除錯訊息，讓你一目了然
        print("\n" + "="*50)
        print(f"🔍 使用者輸入的原始文字: {payload.symptom_text}")
        print(f"🚀 系統精準分類器最後決定交給：【{suggested_dept}】")
        print("="*50 + "\n")

        # --------------------------------------------------------------------------
        # 【Step 2：從真實 PostgreSQL 撈取該科別的醫生與醫院】
        # --------------------------------------------------------------------------
        matched_resources = []
        
        # 開啟資料庫指標 (使用 RealDictCursor 讓撈出來的資料自動變成 Dict 格式)
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 1. 撈取所有醫院資料
            cur.execute("SELECT name, address FROM hospitals;")
            hospitals_data = cur.fetchall()
            
            # 2. 根據剛剛分類出來的科別，動態去 SQL 撈取符合該科別的醫生
            cur.execute(
                "SELECT name, department, specialty, schedule FROM doctors WHERE department = %s;", 
                (suggested_dept,)
            )
            doctors_data = cur.fetchall()
            
            # 將 PostgreSQL 撈出來的醫生 List[dict] 轉成 Pydantic 的 DoctorInfo 物件清單
            available_docs = [DoctorInfo(**doc) for doc in doctors_data]
            
            # 3. 組合每家醫院的資料回傳給前端
            for hospital in hospitals_data:
                matched_resources.append(HospitalResponse(
                    name=hospital["name"],
                    address=hospital["address"],
                    distance_meters=500, # 預設距離，後續可串接經緯度計算
                    available_doctors=available_docs
                ))

        # --------------------------------------------------------------------------
        # 【Step 3：將標準 JSON Response 回傳給前端/使用者】
        # --------------------------------------------------------------------------
        return DiagnosisResponse(
            symptom=payload.symptom_text,
            suggested_department=suggested_dept,
            possible_causes=possible_causes,
            nearby_medical_resources=matched_resources
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"系統處理失敗: {str(e)}")
    finally:
        if conn:
            conn.close() # 確保無論成功或失敗，都會關閉 PostgreSQL 資料庫連線

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)