"""
真實 pipeline → 真實引擎 → 追問路由 的整合測試。

只 mock 最外層的 LLM 抽取器與問診 Gemini，其餘全部是正式程式碼。

這一層先前完全沒測到：API 層測試都把整個 run_safety_pipeline 換成假函式，
假函式直接回傳 indeterminate_rules，於是「pipeline 漏帶這個欄位」
這件事在測試裡永遠看不到。上線後安全追問因此從未觸發過。
"""

import pytest

# symptom_flag_extractor 會連帶匯入 services，不可在模組層載入 ——
# 那會讓 services 在 app fixture 的 monkeypatch 生效前就讀取環境變數，
# 弄壞 test_imports 的離線隔離斷言（test_batch_c 也是同樣處理）。


APK = {
    "pain_level": 3,
    "user_latitude": 23.0,
    "user_longitude": 120.2,
    "history": [],
}


def _extraction(**present):
    """模擬抽取器輸出：39 個旗標全 unknown，指定的設為 present。"""
    from symptom_flag_extractor import SymptomFlagsSchema

    states = {key: "unknown" for key in SymptomFlagsSchema.model_fields}
    states.update({key: "present" for key in present})
    return {
        "extractor_version": "test",
        "states": states,
        "safety_flags": {k: v == "present" for k, v in states.items()},
        "present_flags": sorted(present),
        "absent_flags": [],
        "unknown_flags": sorted(k for k, v in states.items() if v == "unknown"),
        "evidence": [],
        "ambiguous_information": [],
    }


@pytest.fixture
def real_pipeline(monkeypatch, diagnosis_setup):
    """換回真正的 pipeline，只控制抽取器的輸出。"""
    import safety_pipeline
    from routes import diagnose

    monkeypatch.setattr(diagnose, "run_safety_pipeline", safety_pipeline.run_safety_pipeline)
    monkeypatch.setattr(diagnose, "load_state", lambda *a, **k: (None, "new"))
    monkeypatch.setattr(diagnose, "save_state",
                        lambda *a, **k: "88888888-8888-4888-8888-888888888888")
    monkeypatch.setattr(diagnose, "fetch_biological_sex", lambda user_id: None)

    box = {}

    def set_extraction(**present):
        box["value"] = _extraction(**present)

    monkeypatch.setattr(safety_pipeline, "extract_symptom_flags",
                        lambda **kwargs: box["value"])
    return set_extraction


# ============================================================
# pipeline 的輸出契約
# ============================================================

def test_pipeline_forwards_indeterminate_rules(monkeypatch):
    """下游三個消費者（追問、懷孕抑制、觀測）都靠這個欄位。"""
    import safety_pipeline

    monkeypatch.setattr(safety_pipeline, "extract_symptom_flags",
                        lambda **kwargs: _extraction(head_injury=True))

    result = safety_pipeline.run_safety_pipeline("我頭撞到了")

    engaged = [r for r in result["indeterminate_rules"] if r["engaged"]]
    assert [r["code"] for r in engaged] == ["HIGH_RISK_HEAD_INJURY"]


# ============================================================
# 端到端：真的經過 pipeline 之後，追問有沒有出現
# ============================================================

def test_head_injury_triggers_safety_followup(client, member, diagnosis_setup, real_pipeline):
    real_pipeline(head_injury=True)

    data = client.post("/api/v1/diagnose", json={**APK, "symptom_text": "我頭撞到了"}).json()

    assert data["status"] == "asking"
    assert "安全評估尚未完成" in data["message"]
    assert "抗凝血" in data["message"]          # 優先序：病人不會主動提的先問
    diagnosis_setup.ai.assert_not_called()      # 安全追問時不進一般問診


def test_unrelated_complaint_falls_through_to_consultation(client, member, diagnosis_setup, real_pipeline):
    real_pipeline()   # 沒有任何旗標被帶動

    data = client.post("/api/v1/diagnose", json={**APK, "symptom_text": "頭痛"}).json()

    assert "安全評估尚未完成" not in data.get("message", "")
    diagnosis_setup.ai.assert_called()


def test_pregnancy_question_asked_when_sex_unknown(client, member, diagnosis_setup, real_pipeline):
    real_pipeline(severe_abdominal_pain=True)

    data = client.post("/api/v1/diagnose", json={**APK, "symptom_text": "我肚子非常痛"}).json()

    assert data["status"] == "asking"
    assert "懷孕" in data["message"]


def test_pregnancy_question_suppressed_for_male(client, member, diagnosis_setup, real_pipeline, monkeypatch):
    from routes import diagnose

    real_pipeline(severe_abdominal_pain=True)
    monkeypatch.setattr(diagnose, "fetch_biological_sex", lambda user_id: "男")

    data = client.post("/api/v1/diagnose", json={**APK, "symptom_text": "我肚子非常痛"}).json()

    assert "懷孕" not in data.get("message", "")
    assert "陰道" not in data.get("message", "")
