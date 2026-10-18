from typing import Optional
from fastapi import APIRouter, Depends
from routes.auth import get_current_user
from routes.hospitals import parse_location
from emergency_resources import find_emergency_resources

router = APIRouter(prefix='/api/v1', tags=['Emergency resources'], dependencies=[Depends(get_current_user)])


@router.get('/emergency-resources')
def emergency_resources(lat: Optional[float] = None, lng: Optional[float] = None, city: Optional[str] = None):
    return find_emergency_resources(parse_location(lat, lng, city))
