import os
import json
from fastapi import APIRouter, HTTPException
from psycopg2.extras import RealDictCursor

from models import SymptomRequest, DiagnosisResponse, DoctorInfo, HospitalResponse
from services import get_db_connection, call_gemini_with_retry

GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-3.1-flash-lite")

# 使用 APIRouter 將路由模組化
router = APIRouter(prefix="/api/v1", tags=["Diagnose"])

@router.post("/diagnose", response_model=DiagnosisResponse)
async def diagnose_symptom(payload: SymptomRequest):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="無法連線到資料庫")
        
    try:
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

        ai_result = json.loads(response.text)
        suggested_dept = ai_result.get("department", "家醫科")
        possible_causes = ai_result.get("causes", ["一般身體不適"])

        print("\n" + "="*50)
        print(f"🔍 使用者輸入的原始文字: {payload.symptom_text}")
        print(f"✨ 經由模型【{GEMINI_MODEL_NAME}】結構化判定結果：【{suggested_dept}】")
        print(f"📋 AI 評估可能原因: {possible_causes}")
        print("="*50 + "\n")

        matched_resources = []
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT name, address, latitude, longitude FROM hospitals;")
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

        causes_str = "、".join(possible_causes)
        custom_message = f"已收到您的問題，通過初步判斷您可能有 {causes_str} 的問題，推薦您看 {suggested_dept}，請輸入您的大概位子以找出您附近符合要求的診所"

        return DiagnosisResponse(
            symptom=payload.symptom_text,
            suggested_department=suggested_dept,
            possible_causes=possible_causes,
            nearby_medical_resources=matched_resources,
            message=custom_message
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"系統處理失敗: {str(e)}")
    finally:
        if conn:
            conn.close()