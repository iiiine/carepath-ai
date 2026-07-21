from pydantic import BaseModel, Field
from typing import List, Optional

# 1. 歷史對話訊息結構
class ChatMessage(BaseModel):
    role: str      # "user" 或 "model"
    content: str   # 對話內容

# 2. 前端傳入的 Request Payload
class SymptomRequest(BaseModel):
    pain_level: int = Field(default=3, ge=1, le=5, description="不舒服程度 (1-5分)")
    symptom_text: str
    user_latitude: Optional[float] = 23.0
    user_longitude: Optional[float] = 120.2
    history: Optional[List[ChatMessage]] = [] # 過去的對話歷史紀錄

# 3. 強制 Gemini 輸出的 JSON Schema
class GeminiOutputSchema(BaseModel):
    is_complete: bool        # True = 資訊足夠診斷；False = 需要繼續追問
    follow_up_question: str  # 當 is_complete 為 False 時要追問使用者的問題
    department: str          # 當 is_complete 為 True 時的推薦科別
    causes: List[str]        # 可能原因列表

# 4. 醫生與醫院資料結構
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

# 5. 最終完成診斷時的回應結構
class DiagnosisResponse(BaseModel):
    status: str = "completed"
    is_complete: bool = True
    symptom: str
    suggested_department: str
    possible_causes: List[str]
    nearby_medical_resources: List[HospitalResponse]
    message: str

# 6. 繼續追問時的回應結構
class FollowUpResponse(BaseModel):
    status: str = "asking"
    is_complete: bool = False
    message: str
    history: List[ChatMessage]