from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
import uvicorn

app = FastAPI(
    title="醫療系統 AI 詢問後端 API",
    description="整合 AI 症狀分析、附近醫院搜尋與看診醫師資料的後端系統",
    version="1.0.0"
)

# --------------------------------------------------------------------------
# 1. 定義資料結構 (Pydantic Models)
# --------------------------------------------------------------------------

# 使用者發送請求的資料格式
class SymptomRequest(BaseModel):
    symptom_text: str = Field(..., description="使用者描述的症狀", example="我最近常常覺得頭痛，而且眼睛酸澀")
    user_latitude: float = Field(..., description="使用者目前所在緯度", example=23.1311)
    user_longitude: float = Field(..., description="使用者目前所在經度", example=120.2969)

# 醫生資料格式
class DoctorInfo(BaseModel):
    name: str
    department: str
    specialty: str  # 專長
    schedule: str   # 看診時間描述

# 醫院與看診醫師的整合資料格式
class HospitalResponse(BaseModel):
    name: str
    address: str
    distance_meters: int
    available_doctors: List[DoctorInfo]

# API 最終回傳給前端的完整格式
class DiagnosisResponse(BaseModel):
    symptom: str
    suggested_department: str
    ai_assessment: str
    possible_causes: List[str]
    nearby_medical_resources: List[HospitalResponse]


# --------------------------------------------------------------------------
# 2. 模擬假資料 (Mock Data) - 後續會替換成真實的 Google API 與 PostgreSQL
# --------------------------------------------------------------------------

# 模擬資料庫裡的醫師資料
MOCK_DOCTORS_DB = [
    {"name": "張醫生", "department": "神經內科", "specialty": "偏頭痛、腦血管疾病", "schedule": "週一上午、週三下午"},
    {"name": "李醫生", "department": "神經內科", "specialty": "失眠、頭暈、神經痛", "schedule": "週二下午、週五上午"},
    {"name": "王醫生", "department": "眼科", "specialty": "視力模糊、青光眼、黃斑部病變", "schedule": "週二上午、週四下午"},
    {"name": "陳醫生", "department": "家醫科", "specialty": "慢性病管理、一般感冒、健康檢查", "schedule": "天天有診"},
]

# 模擬 Google Places API 搜尋到的附近醫院
MOCK_HOSPITALS = [
    {"name": "台灣綜合醫院", "address": "台南市善化區前鋒路XX號", "distance_meters": 450},
    {"name": "健康活力診所", "address": "台南市善化區中山路XX號", "distance_meters": 800},
]


# --------------------------------------------------------------------------
# 3. API 路由實作 (Endpoints)
# --------------------------------------------------------------------------

@app.get("/")
def read_root():
    return {"status": "running", "message": "歡迎使用醫療系統後端 API，請訪問 /docs 查看 Swagger UI"}


@app.post("/api/v1/diagnose", response_model=DiagnosisResponse)
async def diagnose_symptom(payload: SymptomRequest):
    """
    接收使用者症狀與經緯度：
    1. 判斷可能疾病與就醫科別 (AI)
    2. 尋找附近醫院 (Google Places API)
    3. 媒合該醫院的醫師看診資料 (PostgreSQL)
    """
    try:
        # ------------------------------------------------------------------
        # STEP 1: AI 邏輯處理 (暫時用模擬邏輯，後續串接 OpenAI/Gemini)
        # ------------------------------------------------------------------
        # 這裡寫一個簡單的關鍵字模擬判斷，讓你沒串 API Key 也能跑
        text = payload.symptom_text
        if "眼睛" in text or "看東西" in text:
            suggested_dept = "眼科"
            possible_causes = ["眼壓過高", "視力疲勞", "結膜炎"]
            ai_assessment = "根據您的描述，症狀主要集中在眼部，伴隨酸澀或視力調整問題，建議優先至眼科進行詳細眼壓與眼底檢查。"
        elif "頭痛" in text or "暈" in text:
            suggested_dept = "神經內科"
            possible_causes = ["偏頭痛", "緊縮型頭痛", "睡眠不足引起的血管神經痛"]
            ai_assessment = "頻繁頭痛且伴隨其他不適時，可能與神經血管調控有關。建議記錄頭痛頻率並至神經內科諮詢。"
        else:
            suggested_dept = "家醫科"
            possible_causes = ["一般身體不適", "輕微感冒前兆"]
            ai_assessment = "症狀較為廣泛，建議先至家庭醫學科由醫師進行初步整體評估。"

        # ------------------------------------------------------------------
        # STEP 2 & 3: 媒合附近醫院與本機資料庫的醫師
        # ------------------------------------------------------------------
        matched_resources = []
        
        # 模擬從 Google 地圖撈出附近醫院後，走訪每家醫院
        for hospital in MOCK_HOSPITALS:
            # 去資料庫撈出這家醫院裡面，符合 AI 建議科別的醫生
            # （目前用模擬資料篩選：符合 suggested_dept 的醫生）
            available_docs = [
                DoctorInfo(**doc) for doc in MOCK_DOCTORS_DB 
                if doc["department"] == suggested_dept
            ]
            
            # 組裝成該醫院的完整回應格式
            hospital_resource = HospitalResponse(
                name=hospital["name"],
                address=hospital["address"],
                distance_meters=hospital["distance_meters"],
                available_doctors=available_docs
            )
            matched_resources.append(hospital_resource)

        # ------------------------------------------------------------------
        # STEP 4: 回傳整合結果
        # ------------------------------------------------------------------
        return DiagnosisResponse(
            symptom=payload.symptom_text,
            suggested_department=suggested_dept,
            ai_assessment=ai_assessment,
            possible_causes=possible_causes,
            nearby_medical_resources=matched_resources
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"系統處理失敗: {str(e)}")


# --------------------------------------------------------------------------
# 4. 啟動伺服器
# --------------------------------------------------------------------------
if __name__ == "__main__":
    # 啟動在本地 8000 端口
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)