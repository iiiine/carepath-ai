# hospitals.py (負責地圖 API 的檔案)

import math
from typing import Optional
from pydantic import ValidationError
from locations import UserLocation, valid_coordinates, in_city, distance_key
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
    return 2 * r * math.asin(math.sqrt(min(1.0, max(0.0, a))))


@router.get("/hospitals")
def list_hospitals(lat: Optional[float] = None, lng: Optional[float] = None, city: Optional[str] = None, current_user=Depends(get_current_user)):
    """
    🎯 直接從 PostgreSQL 抓取醫院清單並計算距離
    """
    location = parse_location(lat, lng, city)
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

            result = []
            for h in hospitals_data:
                if not in_city(h['address'], location.user_city):
                    continue
                dist = None
                if location.user_latitude is not None and valid_coordinates(h['lat'], h['lng']):
                    dist = round(haversine_meters(location.user_latitude, location.user_longitude, float(h['lat']), float(h['lng'])))
                result.append({**h, 'distance_meters': dist,
                               'distance_reference': 'provided_coordinates' if dist is not None else None})
            result.sort(key=lambda h: (distance_key(h['distance_meters']), h['hospital_code']))
            return {'hospitals': result, 'location_context': location.context()}

    finally:
        conn.close()

def parse_location(lat, lng, city):
    try:
        return UserLocation(user_latitude=lat, user_longitude=lng, user_city=city)
    except ValidationError:
        raise HTTPException(status_code=422, detail="請提供成對有效座標，或選擇一個縣市。") from None
