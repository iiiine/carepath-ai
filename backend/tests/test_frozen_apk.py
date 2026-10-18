"""
針對已繳交、無法更新的 APK 所做的後端補救。

那個版本的行為是固定的：
- 定位失敗時送出寫死的 FALLBACK_LOCATION，而不是 null
- 急症畫面只渲染 safety_action 與 red_flags，不呼叫資源 API

兩者都只能從後端處理。等行動端重新打包之後，這些補救應該一併移除。
"""

import pytest

from locations import LEGACY_FALLBACK_COORDINATES, UserLocation


# ============================================================
# 假定位哨兵
# ============================================================

def test_fallback_coordinates_are_treated_as_no_location():
    latitude, longitude = LEGACY_FALLBACK_COORDINATES

    location = UserLocation(user_latitude=latitude, user_longitude=longitude)

    assert location.user_latitude is None
    assert location.user_longitude is None
    assert location.context()["source"] == "unavailable"


@pytest.mark.parametrize("latitude,longitude", [
    (22.99, 120.21),
    (23.0, 120.3),
    (23.1, 120.2),
    (25.033, 121.565),
])
def test_real_coordinates_are_untouched(latitude, longitude):
    """只認完全相同的那一組，不可波及真實定位。"""
    location = UserLocation(user_latitude=latitude, user_longitude=longitude)

    assert location.user_latitude == latitude
    assert location.context()["source"] == "coordinates"


def test_apk_payload_reports_no_distance(client, member, diagnosis_setup):
    """
    APK 定位失敗時的完整封包：距離必須是 null，不可回報編造的公里數。

    ConsultScreen.js:671 已有 distance_meters != null 的防護，所以畫面
    只會少一行公里數，不會壞掉。
    """
    latitude, longitude = LEGACY_FALLBACK_COORDINATES

    response = client.post("/api/v1/diagnose", json={
        "pain_level": 3, "symptom_text": "喉嚨痛",
        "user_latitude": latitude, "user_longitude": longitude, "history": [],
    })

    assert response.status_code == 200, response.text
    data = response.json()

    assert data["location_context"]["source"] == "unavailable"
    for hospital in data["nearby_medical_resources"]:
        assert hospital["distance_meters"] is None
        assert hospital["distance_reference"] is None


# ============================================================
# 求助資訊
# ============================================================

def _assessment(**overrides):
    base = {
        "assessment_status": "success", "risk_level": "emergency",
        "risk_label": "緊急", "should_stop_normal_flow": True,
        "requires_human_review": True, "has_red_flags": True,
        "safety_action": "偵測到可能需要立即處理的高風險警訊。", "red_flags": [],
    }
    base.update(overrides)
    return base


def test_emergency_action_carries_help_line(app):
    from routes.diagnose import build_safety_model

    action = build_safety_model(_assessment()).safety_action

    assert "119" in action


def test_self_harm_adds_emotional_support(app):
    from routes.diagnose import build_safety_model

    action = build_safety_model(_assessment(red_flags=[{
        "code": "SELF_HARM_INTENT_OR_PLAN", "risk_level": "emergency",
        "title": "自傷高風險", "reason": "測試",
    }])).safety_action

    assert "1925" in action


def test_normal_completion_is_not_augmented(app):
    from routes.diagnose import build_safety_model

    action = build_safety_model(_assessment(
        risk_level="standard", should_stop_normal_flow=False,
        safety_action="目前未偵測到警訊。",
    )).safety_action

    assert "119" not in action


def test_audit_snapshot_is_not_polluted(app):
    """
    safety_result 會原樣存進 safety_snapshot，
    面向使用者的文案不可混進稽核紀錄。
    """
    from routes.diagnose import build_safety_model

    source = _assessment()
    original = source["safety_action"]

    build_safety_model(source)

    assert source["safety_action"] == original
