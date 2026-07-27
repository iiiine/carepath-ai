# routes/diagnose.py
import os
import json
import re
from fastapi import APIRouter, HTTPException
from psycopg2.extras import RealDictCursor
from typing import Union

from models import (
    SymptomRequest, 
    DiagnosisResponse, 
    FollowUpResponse, 
    DoctorInfo, 
    HospitalResponse,
    ChatMessage
)
from services import get_db_connection, call_gemini_with_retry, get_rag_context
from routes.hospitals import haversine_meters

GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-3.1-flash-lite")

router = APIRouter(prefix="/api/v1", tags=["Diagnose"])

@router.post("/diagnose", response_model=Union[DiagnosisResponse, FollowUpResponse])
async def diagnose_symptom(payload: SymptomRequest):
    """
    AI 多輪問診 API (結合 RAG 衛教知識庫):
    1. 若資訊不足，回傳 is_complete=False 與追問問題 (FollowUpResponse)。
    2. 若資訊足夠，檢索 PostgreSQL 向量衛教庫與醫療資源，回傳診斷結果 (DiagnosisResponse)。
    """
    
    # 組合完整的對話歷史脈絡，讓向量搜尋更精準
    full_context_text = " ".join([msg.content for msg in payload.history]) + f" {payload.symptom_text}"
    
    # 檢索 RAG 衛教資料庫
    rag_knowledge = get_rag_context(full_context_text)

    # 2. 組合 Prompt（加入 RAG 衛教資訊參考）
    prompt = f"""
    【參考醫療衛教知識庫】
    {rag_knowledge}

    【任務目標】
    請根據【參考醫療衛教知識庫】、使用者描述的症狀與他們自評的「不舒服程度（1-5分）」，評估資訊是否足夠判斷科別：

    目前使用者自評不舒服程度為：【{payload.pain_level} 分】

    1. 根據不舒服程度的處理原則：
    - 【5 分 (極度不適/劇痛)】：情況可能很緊急。如果症狀有致命危險（如胸悶、劇烈頭痛），請直接將 is_complete 設為 true，department 設為 "家醫科"（或建議急診），並在 custom_message 中強烈建議盡速就醫，不要過度追問。
    - 【3-4 分 (中度不適)】：需要詳細評估。如果描述模糊，請將 is_complete 設為 false，務必追問發作時間、頻率等關鍵資訊。
    - 【1-2 分 (輕微不適)】：情況較緩和。如果描述模糊，請將 is_complete 設為 false，可以用較輕鬆、關心的語氣簡單追問一個相關問題。

    2. 如果資訊不足 (is_complete = false)：
    - 在 follow_up_question 中提出 1 個具體且親切的追問。
    - department 給予 "家醫科"，causes 給予空陣列 []。

    3. 如果資訊足夠 (is_complete = true)：
    - 在 department 中從以下九個科別精準選擇一個：["骨科", "眼科", "腸胃科", "家醫科","心臟內科","婦產科","耳鼻喉科","精神科","牙科"]
    - 在 causes 中參考衛教知識庫與症狀，列出 2-3 個可能的原因。
    - follow_up_question 給予空字串 ""。

    【過往對話紀錄】
    """
    
    for msg in payload.history:
        role_name = "使用者" if msg.role == "user" else "AI"
        prompt += f"{role_name}: {msg.content}\n"
        
    prompt += f"\n使用者最新的描述：\"{payload.symptom_text}\"\n"

    try:
        # 呼叫 Gemini AI
        response = call_gemini_with_retry(prompt)
        
        # 💡 防禦性解析：避免 AI 回覆帶有 ```json ``` 導致 json.loads 失敗
        clean_text = re.sub(r"```(?:json)?", "", response.text).strip()
        ai_result = json.loads(clean_text)

        is_complete = ai_result.get("is_complete", False)
        follow_up_q = ai_result.get("follow_up_question", "請問這個情況持續多久了呢？")

        updated_history = payload.history + [
            ChatMessage(role="user", content=payload.symptom_text),
        ]

        # ------------------------------------------------------------------
        # 情境 A：資訊不足，需要 AI 繼續追問
        # ------------------------------------------------------------------
        if not is_complete:
            updated_history.append(ChatMessage(role="model", content=follow_up_q))
            print(f"🔄 [多輪問診中] AI 決定進行追問：{follow_up_q}")
            
            return FollowUpResponse(
                status="asking",
                is_complete=False,
                message=follow_up_q,
                history=updated_history
            )

        # ------------------------------------------------------------------
        # 情境 B：資訊已足夠，進入資料庫查詢流程
        # ------------------------------------------------------------------
        suggested_dept = ai_result.get("department", "家醫科")
        possible_causes = ai_result.get("causes", ["一般身體不適"])

        print("\n" + "="*50)
        print(f"🔍 經過多輪評估，最終症狀描述: {payload.symptom_text}")
        print(f"📚 RAG 檢索到的衛教知識摘要: {rag_knowledge[:100]}...")
        print(f"✨ AI 結構化判定最終結果：【{suggested_dept}】")
        print(f"📋 評估可能原因: {possible_causes}")
        print("="*50 + "\n")

        # 連線 PostgreSQL 資料庫撈取診所與醫生
        conn = get_db_connection()
        if not conn:
            raise HTTPException(status_code=500, detail="無法連線到資料庫")

        matched_resources = []
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # 1. 撈取所有醫院
                cur.execute("SELECT hospital_code, name, address, phone, latitude, longitude, booking_url FROM hospitals;")
                hospitals_data = cur.fetchall()
                
                # 2. 撈取指定科別的醫生
                cur.execute(
                    "SELECT hospital_code, name, department, specialty FROM doctors WHERE department = %s;", 
                    (suggested_dept,)
                )
                doctors_data = cur.fetchall()
                
                all_doctors = [DoctorInfo(**doc) for doc in doctors_data]
                
                for hospital in hospitals_data:
                    hospital_docs = [
                        doc for doc in all_doctors
                        if doc.hospital_code == hospital["hospital_code"]
                    ]

                    # 只推薦有該科醫生的醫院
                    if not hospital_docs:
                        continue

                    if hospital["latitude"] is None or hospital["longitude"] is None:
                        continue

                    matched_resources.append(HospitalResponse(
                        hospital_code=hospital["hospital_code"],
                        name=hospital["name"],
                        phone=hospital["phone"] or "暫無提供",
                        address=hospital["address"],
                        booking_url=hospital.get("booking_url"),
                        latitude=hospital["latitude"],   
                        longitude=hospital["longitude"], 
                        distance_meters=round(haversine_meters(
                            payload.user_latitude, payload.user_longitude,
                            float(hospital["latitude"]), float(hospital["longitude"]),
                        )),
                        available_doctors=hospital_docs
                    ))

                # ponytail: 先用「有該科醫生 + 距離最近」挑前 5 筆；
                # 等組長的醫生專長(specialty)資料庫寫好後，再改成依專長匹配度排序
                matched_resources.sort(key=lambda h: h.distance_meters)
                matched_resources = matched_resources[:5]
        finally:
            conn.close()

        causes_str = "、".join(possible_causes) if possible_causes else "身體不適"
        custom_message = f"已收到您的完整描述，初步判斷您可能有 {causes_str} 的問題，推薦您看 {suggested_dept}。以下為您附近的診所與醫師資訊："

        return DiagnosisResponse(
            status="completed",
            is_complete=True,
            symptom=payload.symptom_text,
            suggested_department=suggested_dept,
            possible_causes=possible_causes,
            nearby_medical_resources=matched_resources,
            message=custom_message
        )

    except Exception as e:
        print(f"系統錯誤：{e}")
        raise HTTPException(status_code=500, detail=f"系統處理失敗: {str(e)}")