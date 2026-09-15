"""Read-only emergency directory snapshot; never query DB or Gemini."""
import json
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from locations import in_city, valid_coordinates, distance_key
from routes.hospitals import haversine_meters

DIRECTORY_PATH = Path(__file__).parent / 'data' / 'emergency_hospitals.json'
OFFICIAL_DIRECTORY = 'https://dep.mohw.gov.tw/DOMA/cp-2710-7581-106.html'
# Only show nearby entries within this straight-line radius, not a claim of coverage.
NEARBY_RADIUS_METERS = 30000


def find_emergency_resources(location):
    metadata = {
        'hospitals': [], 'status': 'unavailable', 'official_directory_url': OFFICIAL_DIRECTORY,
        'location_context': location.context(), 'radius_meters': NEARBY_RADIUS_METERS,
        'notice': '僅列已核對的部分急救責任醫院；距離為直線距離，非行車距離或急診入口。收治情況請向院方確認，急需救護請撥 119。',
    }
    if location.user_latitude is None and not location.user_city:
        return {**metadata, 'status': 'location_required'}
    try:
        snapshot = json.loads(DIRECTORY_PATH.read_text(encoding='utf-8'))
        today = datetime.now(ZoneInfo('Asia/Taipei')).date()
        if today > date.fromisoformat(snapshot['review_after']):
            return {**metadata, 'status': 'needs_review'}
        result = []
        for h in snapshot['hospitals']:
            if not in_city(h['address'], location.user_city):
                continue
            distance = None
            if location.user_latitude is not None:
                if not valid_coordinates(h['latitude'], h['longitude']):
                    continue
                distance = round(haversine_meters(location.user_latitude, location.user_longitude, h['latitude'], h['longitude']))
                if distance > NEARBY_RADIUS_METERS:
                    continue
            result.append({**h, 'distance_meters': distance,
                           'distance_reference': 'provided_coordinates' if distance is not None else None})
        result.sort(key=lambda h: (distance_key(h['distance_meters']), h['name']))
        return {**metadata, 'hospitals': result[:5], 'status': 'available' if result else 'no_verified_match',
                'source_url': snapshot['source_url'], 'source_updated_on': snapshot['source_updated_on'],
                'verified_on': snapshot['verified_on'], 'coverage': snapshot['coverage']}
    except (OSError, ValueError, KeyError, TypeError):
        return metadata
