from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Union

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
    history: List[ChatMessage] = Field(default_factory=list)

# 3. 強制 Gemini 輸出的 JSON Schema
class GeminiOutputSchema(BaseModel):
    is_complete: bool        # True = 資訊足夠診斷；False = 需要繼續追問
    follow_up_question: str  # 當 is_complete 為 False 時要追問使用者的問題
    department: str          # 當 is_complete 為 True 時的推薦科別
    causes: List[str]        # 可能原因列表

# 4. 醫生與醫院資料結構
class DoctorInfo(BaseModel):
    hospital_code: str
    name: str
    department: str
    specialty: str
    

class HospitalResponse(BaseModel):
    hospital_code: str
    name: str
    address: str
    phone: str
    distance_meters: int
    booking_url: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None 
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
    # ==============================
# 使用者註冊 / 登入 Model
# ==============================

class UserRegister(BaseModel):
    username: str = Field(
        min_length=3,
        max_length=50
    )

    email: EmailStr

    password: str = Field(
        min_length=8,
        max_length=128
    )

    # 訪客註冊時，用來把原本訪客資料搬到新會員
    guest_transfer_token: Optional[str] = None


class UserLogin(BaseModel):
    identifier: str = Field(
        min_length=3,
        max_length=255
    )

    password: str = Field(
        min_length=8,
        max_length=128
    )

    # 訪客登入既有會員時，用來搬移訪客紀錄
    guest_transfer_token: Optional[str] = None


class UserPublic(BaseModel):
    # 正式會員是 int，訪客是 UUID 字串
    id: Union[int, str]

    username: str

    # 訪客沒有真正 Email
    email: Optional[str] = None

    is_guest: bool = False

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic

class ChatSessionResponse(BaseModel):
    id: int
    user_id: int

    title: str
    original_symptom: Optional[str] = None
    pain_level: Optional[int] = None

    suggested_department: Optional[str] = None
    possible_causes: List[str] = Field(default_factory=list)

    created_at: str
    history: List[ChatMessage] = Field(default_factory=list)

    nearby_medical_resources: List[HospitalResponse] = Field(
        default_factory=list
    )

class ProfileSchema(BaseModel):
    height_cm: Optional[float] = Field(None, ge=30, le=250, description="身高 (cm)，限制 30~250")
    weight_kg: Optional[float] = Field(None, ge=2, le=300, description="體重 (kg)，限制 2~300")
    birth_date: Optional[str] = Field(None, description="生日 (YYYY-MM-DD)")
    gender: Optional[str] = Field(None, description="性別")
    past_medical_history: Optional[str] = Field("", description="既往病史")
    allergy_history: Optional[str] = Field("", description="過敏史")
    current_medications: Optional[str] = Field("", description="目前長期用藥")