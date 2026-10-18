"""確認 #62（凍結 APK 補救）與 #61（跨輪狀態）合併後彼此不衝突。"""

from locations import LEGACY_FALLBACK_COORDINATES

APK = {
    "pain_level": 3, "symptom_text": "喉嚨痛",
    "user_latitude": LEGACY_FALLBACK_COORDINATES[0],
    "user_longitude": LEGACY_FALLBACK_COORDINATES[1],
    "history": [],
}


def test_sentinel_and_conversation_id_coexist(client, member, diagnosis_setup, monkeypatch):
    """APK 封包：假座標被擋掉，同時仍拿得到 conversation_id。"""
    from routes import diagnose
    from safety_state import advance

    saved = {}

    def fake_save(conversation_id, user_id, state, **kwargs):
        saved["state"] = state
        return "55555555-5555-4555-8555-555555555555"

    def fake_pipeline(symptom_text, history=None, prior_state=None, prior_state_unavailable=False):
        result = {
            "assessment_status": "success", "risk_level": "standard",
            "risk_label": "一般", "should_stop_normal_flow": False,
            "requires_human_review": False, "has_red_flags": False,
            "safety_action": "", "red_flags": [], "indeterminate_rules": [],
            "engine_version": "test", "extractor_version": "test",
        }
        result["next_state"] = advance(prior_state, {}, result)
        return result

    monkeypatch.setattr(diagnose, "save_state", fake_save)
    monkeypatch.setattr(diagnose, "load_state", lambda *a, **k: (None, "new"))
    monkeypatch.setattr(diagnose, "run_safety_pipeline", fake_pipeline)

    data = client.post("/api/v1/diagnose", json=APK).json()

    # #62：哨兵座標被當成未定位
    assert data["location_context"]["source"] == "unavailable"
    for hospital in data["nearby_medical_resources"]:
        assert hospital["distance_meters"] is None

    # #61：conversation_id 仍然發得出來
    assert data["conversation_id"] == "55555555-5555-4555-8555-555555555555"
    assert saved["state"]["turn_count"] == 1


def test_emergency_keeps_both_help_line_and_conversation_id(client, member, diagnosis_setup, monkeypatch):
    """急症：#62 的 119 與 #61 的 conversation_id 必須同時存在。"""
    from routes import diagnose
    from safety_state import advance

    def fake_pipeline(symptom_text, history=None, prior_state=None, prior_state_unavailable=False):
        result = {
            "assessment_status": "success", "risk_level": "emergency",
            "risk_label": "緊急", "should_stop_normal_flow": True,
            "requires_human_review": True, "has_red_flags": True,
            "safety_action": "偵測到高風險警訊。", "indeterminate_rules": [],
            "red_flags": [{"code": "HIGH_RISK_CHEST_PAIN", "risk_level": "emergency",
                           "title": "高風險胸痛", "reason": "測試"}],
            "engine_version": "test", "extractor_version": "test",
        }
        result["next_state"] = advance(prior_state, {}, result)
        return result

    monkeypatch.setattr(diagnose, "save_state",
                        lambda *a, **k: "66666666-6666-4666-8666-666666666666")
    monkeypatch.setattr(diagnose, "load_state", lambda *a, **k: (None, "new"))
    monkeypatch.setattr(diagnose, "run_safety_pipeline", fake_pipeline)

    data = client.post("/api/v1/diagnose", json=APK).json()

    assert data["status"] == "safety_alert"
    assert "119" in data["safety"]["safety_action"]
    assert data["conversation_id"] == "66666666-6666-4666-8666-666666666666"
