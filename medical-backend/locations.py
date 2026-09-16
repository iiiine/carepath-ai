"""Location validation shared by diagnosis and resource queries."""
import math
import re
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

CITIES = (
    '臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市',
    '基隆市', '新竹市', '新竹縣', '苗栗縣', '彰化縣', '南投縣',
    '雲林縣', '嘉義市', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
    '臺東縣', '澎湖縣', '金門縣', '連江縣',
)


class UserLocation(BaseModel):
    user_latitude: Optional[float] = Field(None, ge=-90, le=90, allow_inf_nan=False)
    user_longitude: Optional[float] = Field(None, ge=-180, le=180, allow_inf_nan=False)
    user_city: Optional[str] = Field(None, max_length=10)

    @field_validator('user_city')
    @classmethod
    def valid_city(cls, value):
        if value is None:
            return None
        value = value.strip().replace('台', '臺')
        if value not in CITIES:
            raise ValueError('請選擇有效縣市')
        return value

    @model_validator(mode='after')
    def complete_location(self):
        if (self.user_latitude is None) != (self.user_longitude is None):
            raise ValueError('緯度與經度必須一起提供')
        if self.user_city and self.user_latitude is not None:
            raise ValueError('請擇一提供定位座標或手動選擇縣市')
        return self

    def context(self):
        return {
            'source': 'coordinates' if self.user_latitude is not None else 'city' if self.user_city else 'unavailable',
            'city': self.user_city,
        }


def valid_coordinates(lat, lng):
    if lat is None or lng is None:
        return False
    try:
        return math.isfinite(float(lat)) and math.isfinite(float(lng)) and -90 <= float(lat) <= 90 and -180 <= float(lng) <= 180
    except (ValueError, TypeError):
        return False


# 地址可能帶郵遞區號前綴（如 710臺南市中西區…），比對縣市前先去掉。
POSTAL_PREFIX = re.compile(r'^\d{3,6}')


def normalize_address(address):
    text = str(address or '').strip().replace('台', '臺')
    return POSTAL_PREFIX.sub('', text).lstrip()


def in_city(address, city):
    """依地址前綴判斷縣市。

    hospitals 資料表沒有結構化的縣市欄位，只能比對地址開頭，
    因此這個判斷依賴「地址以縣市名開頭」這個前提。
    有 city 欄位可用時請改用 hospital_in_city()。
    """
    return not city or normalize_address(address).startswith(city)


def hospital_in_city(hospital, city):
    """優先採用已核對的 city 欄位，缺值才退回地址前綴比對。"""
    if not city:
        return True

    recorded = str(hospital.get('city') or '').strip().replace('台', '臺')

    if recorded:
        return recorded == city

    return in_city(hospital.get('address'), city)


def distance_key(distance):
    return float('inf') if distance is None else distance
