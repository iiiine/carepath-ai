# routes/diagnose.py
import os
import json
import re
from functools import lru_cache
from fastapi import APIRouter, HTTPException, Depends
from psycopg2.extras import RealDictCursor
from typing import Union
from routes.auth import get_current_user
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

# 資料庫連不上時的備援科別清單（2026-07-28 的實際內容）
DEFAULT_DEPARTMENTS = (
    "家醫科", "婦產科", "心臟內科", "腸胃科", "牙科", "神經外科", "精神科", "眼科", "皮膚科",
)


@lru_cache(maxsize=1)
def get_departments() -> tuple:
    """資料庫實際有醫生的科別，用來限制 AI 只能從這些科別挑，避免推薦到查無醫生的科別。

    ponytail: 快取到重啟為止；組長匯入新科別後要重啟後端才會生效。
    回傳 tuple 是因為 lru_cache 要求可 hash。
    """
    conn = get_db_connection()
    if not conn:
        print("⚠️ 撈科別清單時資料庫連線失敗，改用備援清單")
        return DEFAULT_DEPARTMENTS
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT department FROM doctors ORDER BY department;")
            return tuple(r[0] for r in cur.fetchall()) or DEFAULT_DEPARTMENTS
    finally:
        conn.close()


def specialty_score(specialty: str, causes_text: str) -> int:
    """醫生專長與 AI 判定病因的相符程度：中文兩字詞重疊數，越高越相關。

    例：causes「胃食道逆流」vs specialty「胃食道逆流、消化性潰瘍」→ 命中「胃食」「食道」「道逆」「逆流」= 4。
    ponytail: 用 2-gram 硬比字，不做斷詞/語意比對；等實測發現排序不準再換 embedding。
    """
    if not specialty or not causes_text:
        return 0
    grams = {causes_text[i:i + 2] for i in range(len(causes_text) - 1)}
    return sum(1 for g in grams if g in specialty)

@router.post("/diagnose", response_model=Union[DiagnosisResponse, FollowUpResponse])
async def diagnose_symptom(payload: SymptomRequest,current_user=Depends(get_current_user)):
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
    - 在 department 中從以下科別精準選擇一個（這是本系統合作院所實際有的科別，不可自創）：{list(get_departments())}
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

        # 後端防線：prompt 限制不等於保證，AI 仍可能吐出資料庫沒有的科別，
        # 此時若直接查詢會回 0 筆，前端會退回顯示全部醫院。改推薦家醫科初步評估。
        departments = get_departments()
        unavailable_dept = None
        if suggested_dept not in departments:
            unavailable_dept = suggested_dept
            suggested_dept = "家醫科" if "家醫科" in departments else departments[0]
            print(f"⚠️ AI 判定的「{unavailable_dept}」不在資料庫科別內，改推薦 {suggested_dept}")

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

        # 拿 AI 判定的可能病因當作比對醫生專長的關鍵字來源
        causes_text = "".join(possible_causes)

        matched_resources = []
        scored_resources = []  # [(該院最佳專長匹配分數, HospitalResponse)]
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

                    # 院內醫生依專長相符度排序，最對症的醫生排最前面
                    hospital_docs.sort(
                        key=lambda d: -specialty_score(d.specialty, causes_text)
                    )
                    best_match = specialty_score(hospital_docs[0].specialty, causes_text)

                    scored_resources.append((best_match, HospitalResponse(
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
                    )))

                # 先用距離篩出附近 10 間候選，再從中挑專長最對症的 5 間（同分則近的優先）。
                # ponytail: 先距離後專長，避免為了專長把人導去 20 公里外的醫院。
                scored_resources.sort(key=lambda t: t[1].distance_meters)
                nearest = scored_resources[:10]
                nearest.sort(key=lambda t: (-t[0], t[1].distance_meters))
                matched_resources = [hosp for _, hosp in nearest[:5]]
        finally:
            conn.close()

        causes_str = "、".join(possible_causes) if possible_causes else "身體不適"
        custom_message = f"已收到您的完整描述，初步判斷您可能有 {causes_str} 的問題，推薦您看 {suggested_dept}。以下為您附近的診所與醫師資訊："
        if unavailable_dept:
            custom_message = (
                f"已收到您的完整描述，初步判斷您可能有 {causes_str} 的問題。"
                f"目前合作院所暫無 {unavailable_dept} 門診，先為您推薦 {suggested_dept} 做初步評估與轉診建議："
            )

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