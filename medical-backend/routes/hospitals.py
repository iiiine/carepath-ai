# hospitals.py (負責地圖 API 的檔案)

import math
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from psycopg2.extras import RealDictCursor
from routes.auth import get_current_user
# 🎯 1. 引入你們共用的 PostgreSQL 資料庫連線函式
from services import get_db_connection
from hospital_hours import build_opening_hours

router = APIRouter(prefix="/api/v1", tags=["Hospitals"])

def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """計算球面距離"""
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


@router.get("/hospitals")
def list_hospitals(lat: Optional[float] = None, lng: Optional[float] = None,current_user=Depends(get_current_user)):
    """
    🎯 直接從 PostgreSQL 抓取醫院清單並計算距離
    """
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="無法連線至資料庫")

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 🎯 2. 使用 SELECT 撈取 DB，並將 latitude/longitude 轉為 lat/lng 以符合前端地圖的格式
            cur.execute("""
                SELECT
                    hospital_code,
                    name,
                    phone,
                    address,
                    latitude AS lat,
                    longitude AS lng,
                    opening_sessions
                FROM hospitals;
            """)
            hospitals_data = cur.fetchall()

            # 🎯 官方固定看診時段解析成前端可直接顯示的結構，
            #    解析不出來就是 None，前端不顯示即可
            for h in hospitals_data:
                h["opening_hours"] = build_opening_hours(
                    h.pop("opening_sessions", None)
                )

            # 若前端沒傳使用者當前座標，直接回傳所有醫院
            if lat is None or lng is None:
                return {"hospitals": hospitals_data}

            # 🎯 3. 算距離並排序 (邏輯保持完全不變)
            result = []
            for h in hospitals_data:
                if h["lat"] is not None and h["lng"] is not None:
                    dist = round(haversine_meters(lat, lng, h["lat"], h["lng"]))
                else:
                    dist = 9999999
                
                result.append({**h, "distance_meters": dist})

            result.sort(key=lambda x: x["distance_meters"])
            return {"hospitals": result}

    finally:
        conn.close()