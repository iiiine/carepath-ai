import os
import json
import time
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
import uvicorn
from google import genai
from google.genai import types
from google.genai.errors import APIError

# 載入 .env 檔案裡的環境變數
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# 核心優化：從環境變數讀取模型名稱，若讀不到則以 gemini-3.1-flash-lite 備用
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-3.1-flash-lite")

# 初始化 Gemini 客戶端
client = genai.Client(api_key=GEMINI_API_KEY)

app = FastAPI(title="醫療系統 AI 詢問後端 (解耦架構完美版)")

# --------------------------------------------------------------------------
# 1. 定義資料結構 (Pydantic Models)
# --------------------------------------------------------------------------
class GeminiOutputSchema(BaseModel):
    department: str
    causes: List[str]

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
    try:
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    except Exception as e:
        print(f"資料庫連線失敗: {e}")
        return None

# --------------------------------------------------------------------------
# 3. 具備自動重試與動態模型加載的 Gemini 呼叫函數
# --------------------------------------------------------------------------
def call_gemini_with_retry(prompt: str, max_retries: int = 5):
    """當遇到 503 伺服器過載時，自動退避並重試"""
    delay = 2  # 初始等待 2 秒
    for attempt in range(max_retries):
        try:
            # 🎯 這裡改由動態變數帶入，跟 .env 檔綁定
            response = client.models.generate_content(
                model=GEMINI_MODEL_NAME,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=GeminiOutputSchema,
                ),
            )
            return response  # 成功直接回傳
        except APIError as e:
            # 偵測到 503 (Unavailable) 或 429
            if e.code in [503, 429] and attempt < max_retries - 1:
                print(f"Gemini 伺服器回傳 {e.code}。將於 {delay} 秒後進行第 {attempt + 2} 次重試...")
                time.sleep(delay)
                delay *= 2  # 漸進式延長等待時間 (4秒, 8秒...)
            else:
                raise e
        except Exception as ex:
            raise ex

# --------------------------------------------------------------------------
# 啟動健康檢查
# --------------------------------------------------------------------------
print("\n" + "開始測試 Gemini 連線狀態")
print(f"目前載入的模型設定：【{GEMINI_MODEL_NAME}】")
try:
    if not GEMINI_API_KEY:
        raise ValueError("在 .env 檔案中完全找不到 GEMINI_API_KEY")
    
    # 測試連線
    test_response = call_gemini_with_retry('Hello, respond with OK if you can hear me.')
    print(f"Gemini 連線成功！測試回應：{test_response.text.strip()}")
except Exception as e:
    print(f"Gemini 連線失敗！錯誤原因：{str(e)}")
print("Gemini 連線測試結束" + "\n")

# --------------------------------------------------------------------------
# 4. API 路由實作
# --------------------------------------------------------------------------
@app.post("/api/v1/diagnose", response_model=DiagnosisResponse)
async def diagnose_symptom(payload: SymptomRequest):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="無法連線到資料庫")
        
    try:
        # 【Step 1：呼叫 Gemini API（享環境變數動態配置）】
        prompt = f"""
        你是一位專業的醫院導診分流 AI。
        請根據使用者的症狀描述，判斷最適合推薦去哪一個科別，並列出 2-3 個可能的病因。

        你只能從以下四個科別中選擇一個最合適的：
        - "神經內科"
        - "眼科"
        - "腸胃科"
        - "家醫科"

        使用者症狀描述："{payload.symptom_text}"
        """

        response = call_gemini_with_retry(prompt)

        # 解析 Gemini 回傳的內容
        ai_result = json.loads(response.text)
        suggested_dept = ai_result.get("department", "家醫科")
        possible_causes = ai_result.get("causes", ["一般身體不適"])

        print("\n" + "="*50)
        print(f"使用者輸入的原始文字: {payload.symptom_text}")
        print(f"經由模型【{GEMINI_MODEL_NAME}】結構化判定結果：【{suggested_dept}】")
        print(f"AI 評估可能原因: {possible_causes}")
        print("="*50 + "\n")

        # 【Step 2：從真實 PostgreSQL 撈取該科別的醫生與醫院】
        matched_resources = []
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT name, address FROM hospitals;")
            hospitals_data = cur.fetchall()
            
            cur.execute(
                "SELECT name, department, specialty, schedule FROM doctors WHERE department = %s;", 
                (suggested_dept,)
            )
            doctors_data = cur.fetchall()
            
            available_docs = [DoctorInfo(**doc) for doc in doctors_data]
            
            for hospital in hospitals_data:
                matched_resources.append(HospitalResponse(
                    name=hospital["name"],
                    address=hospital["address"],
                    distance_meters=500,
                    available_doctors=available_docs
                ))

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
            conn.close()

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)