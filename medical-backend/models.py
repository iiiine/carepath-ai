from pydantic import BaseModel, Field, EmailStr
from locations import UserLocation
from typing import List, Literal, Optional, Union


# ============================================================
# 輸入長度上限
#
# history 由用戶端送回、後端全盤信任，而且會整段串進 prompt。
# 沒有上限等於讓任何人決定我們要送多少 token 給 Gemini。
#
# 數字刻意訂得寬，因為**已上架的 APK 改不了，絕不可以因此收到 422**：
#
#   MAX_SYMPTOM_CHARS   一次主訴 2000 字。高齡使用者實際輸入遠少於此。
#   MAX_MESSAGE_CHARS   單則訊息 5000 字。後端自己產生的訊息最長是完成
#                       訊息（diagnose.py 1376-1409 那幾句），數百字而已；
#                       院所清單走 nearby_medical_resources，不在這裡。
#   MAX_HISTORY_MESSAGES  100 則。一次問診的追問輪次遠低於這個數。
#
# 也就是說，正常使用碰不到這些上限；碰到的是刻意灌量的請求。
# ============================================================

MAX_SYMPTOM_CHARS = 2000
MAX_MESSAGE_CHARS = 5000
MAX_HISTORY_MESSAGES = 100


# ============================================================
# 1. 歷史對話訊息結構
# ============================================================

class ChatMessage(BaseModel):
    # 收斂成列舉。history 是用戶端送回來的，role 若是自由字串，
    # 就可以偽造成「AI 說過的話」去影響後續判斷。
    # 兩個用戶端實際只會送這兩個值（ConsultScreen.js、SymptomChecker.jsx），
    # 後端自己組 history 時也只用這兩個，所以收斂不會影響相容性。
    role: Literal["user", "model"]

    content: str = Field(
        max_length=MAX_MESSAGE_CHARS,
    )


# ============================================================
# 2. 前端傳入的 Request Payload
# ============================================================

class SymptomRequest(UserLocation):
    pain_level: int = Field(
        default=3,
        ge=1,
        le=5,
        description="不舒服程度 (1-5分)"
    )

    # 刻意不設 min_length：空字串目前是會走完流程的，
    # 在這裡擋掉等於改變既有行為，不屬於本次範圍。
    symptom_text: str = Field(
        max_length=MAX_SYMPTOM_CHARS,
    )

    history: List[ChatMessage] = Field(
        default_factory=list,
        max_length=MAX_HISTORY_MESSAGES,
    )


# ============================================================
# 3. Gemini 問診 Structured Output Schema
# ============================================================

class GeminiOutputSchema(BaseModel):
    # True = 資訊足夠
    # False = 需要繼續追問
    is_complete: bool

    # is_complete=False 時的追問
    follow_up_question: str

    # is_complete=True 時推薦科別
    department: str

    # 可能原因
    causes: List[str]


# ============================================================
# 4. 醫師資料結構
# ============================================================

class DoctorInfo(BaseModel):
    hospital_code: str
    name: str
    department: str
    specialty: str


# ============================================================
# 5. 醫院固定看診時段
#
# 來源為健保署開放資料的「固定看診時段」，
# 由 hospital_hours.py 解析。
#
# 注意：
# 這是院方公告的一般門診時段，
# 不是即時看診狀態，
# 也不是醫師個人的門診時間
# （後者是 doctor_schedules）。
# ============================================================

class OpeningSession(BaseModel):
    # 1=星期一 … 7=星期日
    weekday: int

    label: str

    morning: bool
    afternoon: bool
    night: bool


class HospitalOpeningHours(BaseModel):
    # 一行摘要，例：
    # 週一至週五 上午、下午；週六 上午；週日休診
    summary: str

    weekly: List[OpeningSession] = Field(
        default_factory=list
    )

    # 提醒使用者這不是當日看診保證
    notice: str

    version: Optional[str] = None


# ============================================================
# 6. 醫院資料結構
# ============================================================

class HospitalResponse(BaseModel):
    hospital_code: str

    name: str
    address: str
    phone: str

    distance_meters: Optional[int] = Field(None, ge=0)
    distance_reference: Optional[Literal["provided_coordinates"]] = None

    booking_url: Optional[str] = None

    latitude: Optional[float] = None
    longitude: Optional[float] = None

    available_doctors: List[DoctorInfo] = Field(
        default_factory=list
    )

    # 官方未提供或解析失敗時為 None，
    # 呼叫端不顯示即可。
    opening_hours: Optional[
        HospitalOpeningHours
    ] = None


# ============================================================
# 7. Medical Safety Response Models
#
# 注意：
# SafetyAssessmentResponse 必須放在
# DiagnosisResponse / FollowUpResponse 前面，
# 因為後面會引用它。
# ============================================================

class SafetyRuleMatch(BaseModel):
    """
    Safety Engine 命中的單一規則。
    """

    code: str
    risk_level: str
    title: str
    reason: str


class SafetyAssessmentResponse(BaseModel):
    """
    每一次問診的安全風險篩檢結果。

    注意：
    這是安全風險篩檢，
    不是疾病診斷結果。
    """

    # success / unavailable
    assessment_status: str

    # standard / urgent / emergency / unknown
    risk_level: str

    # 一般 / 儘快就醫 / 緊急 / 無法完成安全評估
    risk_label: str

    # 是否應停止一般 AI 問診流程
    should_stop_normal_flow: bool

    # 是否建議真人醫療評估
    requires_human_review: bool

    # 是否命中任何 Safety Rule
    has_red_flags: bool

    matched_rule_count: int = 0

    red_flags: List[SafetyRuleMatch] = Field(
        default_factory=list
    )

    safety_action: str

    # --------------------------------------------------------
    # Symptom Extraction Audit
    # --------------------------------------------------------

    present_flags: List[str] = Field(
        default_factory=list
    )

    absent_flags: List[str] = Field(
        default_factory=list
    )

    unknown_flags: List[str] = Field(
        default_factory=list
    )

    evidence: List[str] = Field(
        default_factory=list
    )

    ambiguous_information: List[str] = Field(
        default_factory=list
    )

    # --------------------------------------------------------
    # Version Tracking
    # --------------------------------------------------------

    pipeline_version: Optional[str] = None

    extractor_version: Optional[str] = None

    engine_version: Optional[str] = None

    # Safety Pipeline 是否發生技術性錯誤
    technical_failure: bool = False


# ============================================================
# 8. 最終完成問診時的 Response
# ============================================================

class DiagnosisResponse(BaseModel):
    status: str = "completed"

    is_complete: bool = True

    # --------------------------------------------------------
    # Step 3B-2A
    #
    # 一般完成問診成功寫入 chat_sessions 後，
    # 回傳新建立的 session ID。
    #
    # Guest 或歷史保存失敗時可能為 None。
    # --------------------------------------------------------
    session_id: Optional[int] = None

    # 僅描述歷史保存結果，不影響本次問診結果是否完成。
    save_status: Literal["saved", "failed", "not_applicable"] = "not_applicable"
    location_context: dict = Field(default_factory=lambda: {"source": "unavailable", "city": None})

    symptom: str

    suggested_department: str

    possible_causes: List[str] = Field(
        default_factory=list
    )

    nearby_medical_resources: List[HospitalResponse] = Field(
        default_factory=list
    )

    message: str

    # 每次正常完成問診也保留 Safety Assessment
    safety: Optional[SafetyAssessmentResponse] = None


# ============================================================
# 9. AI 繼續追問時的 Response
# ============================================================

class FollowUpResponse(BaseModel):
    status: str = "asking"

    is_complete: bool = False

    message: str

    history: List[ChatMessage] = Field(
        default_factory=list
    )

    # 即使還在多輪追問，
    # 也可以保留這一輪的 Safety Assessment
    safety: Optional[SafetyAssessmentResponse] = None


# ============================================================
# 10. Safety Layer 中止一般問診流程時的 Response
# ============================================================

class SafetyAlertResponse(BaseModel):
    """
    Safety Layer 阻斷一般 AI 問診流程時使用。

    例如：

    emergency
        → 發現高風險警訊

    unknown + technical_failure
        → Safety Pipeline 無法完成安全評估
    """

    status: str = "safety_alert"

    is_complete: bool = True

    message: str

    # Safety Alert 一定必須有安全評估內容，
    # 因此這裡不要設 Optional。
    safety: SafetyAssessmentResponse

    history: List[ChatMessage] = Field(
        default_factory=list
    )

    # 警示先回傳，前端另外取得已核對急救責任院所，不等待資源查詢。
    resources_endpoint: str = "/api/v1/emergency-resources"

    # 保留既有欄位相容性；急症不使用一般門診清單。
    nearby_medical_resources: List[HospitalResponse] = Field(
        default_factory=list
    )


# ============================================================
# 11. 使用者註冊
# ============================================================

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

    # 訪客註冊成正式會員時，
    # 可用此 token 搬移原本訪客問診資料。
    guest_transfer_token: Optional[str] = None


# ============================================================
# 12. 使用者登入
# ============================================================

class UserLogin(BaseModel):
    identifier: str = Field(
        min_length=3,
        max_length=255
    )

    password: str = Field(
        min_length=8,
        max_length=128
    )

    # 訪客登入既有會員時，
    # 可用此 token 搬移訪客問診資料。
    guest_transfer_token: Optional[str] = None


# ============================================================
# 13. 對外 User Model
# ============================================================

class UserPublic(BaseModel):
    # 正式會員是 int
    # 訪客可能是 UUID 字串
    id: Union[int, str]

    username: str

    # 訪客沒有真正 Email
    email: Optional[str] = None

    is_guest: bool = False


# ============================================================
# 14. JWT Token Response
# ============================================================

class TokenResponse(BaseModel):
    access_token: str

    token_type: str = "bearer"

    user: UserPublic


# ============================================================
# 15. 歷史問診 Session Response
# ============================================================

class ChatSessionResponse(BaseModel):
    id: int

    user_id: int

    title: str

    original_symptom: Optional[str] = None

    pain_level: Optional[int] = None

    suggested_department: Optional[str] = None

    possible_causes: List[str] = Field(
        default_factory=list
    )

    created_at: str

    history: List[ChatMessage] = Field(
        default_factory=list
    )

    nearby_medical_resources: List[HospitalResponse] = Field(
        default_factory=list
    )


# ============================================================
# 16. 個人健康資料 Profile
# ============================================================

class ProfileSchema(BaseModel):
    height_cm: Optional[float] = Field(
        None,
        ge=30,
        le=250,
        description="身高 (cm)，限制 30~250"
    )

    weight_kg: Optional[float] = Field(
        None,
        ge=2,
        le=300,
        description="體重 (kg)，限制 2~300"
    )

    birth_date: Optional[str] = Field(
        None,
        description="生日 (YYYY-MM-DD)"
    )

    gender: Optional[str] = Field(
        None,
        description="性別"
    )

    past_medical_history: Optional[str] = Field(
        "",
        description="既往病史"
    )

    allergy_history: Optional[str] = Field(
        "",
        description="過敏史"
    )

    current_medications: Optional[str] = Field(
        "",
        description="目前長期用藥"
    )
