from pydantic import BaseModel
from typing import List

#資料結構
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
    message: str