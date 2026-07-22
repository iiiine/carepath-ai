import json
import math
from pathlib import Path
from typing import Optional

from fastapi import APIRouter

router = APIRouter(prefix="/api/v1", tags=["Hospitals"])

# 臺南市各醫院一覽表（政府開放資料，29 筆固定資料，啟動時讀一次）
DATA_PATH = Path(__file__).parent.parent / "data" / "tainan_hospitals.json"
HOSPITALS = json.loads(DATA_PATH.read_text(encoding="utf-8"))


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """兩座標間的球面距離（公尺）"""
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


@router.get("/hospitals")
def list_hospitals(lat: Optional[float] = None, lng: Optional[float] = None):
    """
    回傳臺南市醫院清單。
    帶 ?lat=&lng=（使用者位置）時，附上 distance_meters 並依距離由近到遠排序。
    """
    if lat is None or lng is None:
        return {"hospitals": HOSPITALS}

    result = [
        {**h, "distance_meters": round(haversine_meters(lat, lng, h["lat"], h["lng"]))}
        for h in HOSPITALS
    ]
    result.sort(key=lambda h: h["distance_meters"])
    return {"hospitals": result}
