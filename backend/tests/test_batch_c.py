"""批次 C：跨輪安全狀態的 API 層行為，含已上架 APK 的相容硬條件。"""

import pytest

from safety_state import empty_state

# safety_state_store 會 import services，不可以在模組層載入 ——
# 那會讓 services 在 app fixture 的 monkeypatch 生效前就被匯入，
# 連帶弄壞 test_imports 的離線隔離斷言。
LOAD_NEW = "new"
LOAD_OK = "loaded"
LOAD_UNAVAILABLE = "unavailable"


# 已上架 APK 的實際封包（ConsultScreen.js:373）：永遠成對座標，不送 conversation_id
APK_PAYLOAD = {
    "pain_level": 3,
    "symptom_text": "喉嚨痛兩天",
    "user_latitude": 23.0,
    "user_longitude": 120.2,
    "history": [],
}


@pytest.fixture
def store(monkeypatch, diagnosis_setup):
    """
    攔截狀態讀寫，讓路由邏輯不必碰資料庫。

    假 pipeline 走真實的 safety_state.advance，
    這樣「prior_state 有沒有真的參與合併」才驗得出來。
    """

    from routes import diagnose
    from safety_state import advance

    calls = {"load": [], "save": []}
    box = {
        "status": LOAD_NEW,
        "state": empty_state(),
        "saved_id": "11111111-1111-4111-8111-111111111111",
        "incoming": {},
    }

    def fake_load(conversation_id, user_id, **kwargs):
        calls["load"].append((conversation_id, user_id))
        return box["state"], box["status"]

    def fake_save(conversation_id, user_id, state, **kwargs):
        calls["save"].append((conversation_id, user_id, state))
        return box["saved_id"]

    def fake_pipeline(symptom_text, history=None, prior_state=None,
                      prior_state_unavailable=False):
        if prior_state_unavailable:
            import safety_pipeline
            return safety_pipeline.run_safety_pipeline(
                symptom_text, history, prior_state, True
            )

        assessment = {
            "assessment_status": "success", "risk_level": "standard",
            "risk_label": "一般", "should_stop_normal_flow": False,
            "requires_human_review": False, "has_red_flags": False,
            "safety_action": "", "red_flags": [],
            "engine_version": "test", "extractor_version": "test",
        }
        assessment["next_state"] = advance(prior_state, box["incoming"], assessment)
        return assessment

    monkeypatch.setattr(diagnose, "load_state", fake_load)
    monkeypatch.setattr(diagnose, "save_state", fake_save)
    monkeypatch.setattr(diagnose, "run_safety_pipeline", fake_pipeline)

    calls["box"] = box
    return calls


# ============================================================
# APK 硬條件
# ============================================================

def test_apk_payload_without_conversation_id_is_accepted(client, member, diagnosis_setup, store):
    """APK 不送 conversation_id，缺少時必須退回單輪評估而不是回 422。"""
    response = client.post("/api/v1/diagnose", json=APK_PAYLOAD)

    assert response.status_code == 200, response.text
    assert store["load"] == [(None, 7)]


def test_apk_response_shape_is_unchanged(client, member, diagnosis_setup, store):
    """新增欄位必須是純新增，APK 既有讀取的欄位一個都不能少。"""
    data = client.post("/api/v1/diagnose", json=APK_PAYLOAD).json()

    for key in ("status", "is_complete", "message", "session_id",
                "save_status", "suggested_department", "nearby_medical_resources"):
        assert key in data, f"APK 依賴的欄位 {key} 消失了"

    assert "conversation_id" in data


def test_follow_up_still_uses_is_complete_false(client, member, diagnosis_setup, store):
    """追問必須維持 is_complete:false，APK 第 389 行只認這個。"""
    diagnosis_setup.ai.return_value.text = (
        '{"is_complete": false, "follow_up_question": "持續多久了？"}'
    )

    data = client.post("/api/v1/diagnose", json=APK_PAYLOAD).json()

    assert data["status"] == "asking"
    assert data["is_complete"] is False
    assert "conversation_id" in data


@pytest.mark.parametrize("bad", ["", "not-a-uuid", "../../etc", "00000000"])
def test_malformed_conversation_id_does_not_error(client, member, diagnosis_setup, store, bad):
    """格式錯誤的 conversation_id 視為新對話重新評估，不可回 4xx/5xx。"""
    response = client.post("/api/v1/diagnose", json={**APK_PAYLOAD, "conversation_id": bad})

    assert response.status_code == 200, response.text


# ============================================================
# 跨輪保護
# ============================================================

def test_conversation_id_is_returned_and_state_saved(client, member, diagnosis_setup, store):
    data = client.post("/api/v1/diagnose", json=APK_PAYLOAD).json()

    assert data["conversation_id"] == store["box"]["saved_id"]
    assert len(store["save"]) == 1

    _, user_id, state = store["save"][0]
    assert user_id == 7
    assert state["turn_count"] == 1


def test_prior_state_reaches_the_engine(client, member, diagnosis_setup, store):
    """先前成立的 present 必須參與本輪判斷，否則跨輪保護等於沒做。"""
    store["box"]["state"] = {
        **empty_state(),
        "flag_states": {"one_sided_weakness": "present"},
        "turn_count": 1,
    }
    store["box"]["status"] = LOAD_OK
    store["box"]["incoming"] = {"one_sided_weakness": "absent"}   # 本輪說「好了」

    data = client.post(
        "/api/v1/diagnose",
        json={**APK_PAYLOAD, "conversation_id": "22222222-2222-4222-8222-222222222222"},
    ).json()

    # conftest 的 safety pipeline 是 mock 的，這裡驗的是狀態確實被帶進來並推進
    assert store["load"] == [("22222222-2222-4222-8222-222222222222", 7)]
    saved_state = store["save"][0][2]
    # 本輪被否認，但先前是 present —— 合併後必須維持 present（症狀消失不等於風險解除）
    assert saved_state["flag_states"]["one_sided_weakness"] == "present"
    assert saved_state["resolved_recently"] == ["one_sided_weakness"]
    assert saved_state["turn_count"] == 2


def test_state_unavailable_fails_safe(client, member, diagnosis_setup, monkeypatch, store):
    """
    帶了 conversation_id 但狀態讀不到時，不可以當成新對話繼續。

    「讀不到」不等於「沒有危險」—— 先前很可能已經有成立的警訊。
    """
    from routes import diagnose
    import safety_pipeline

    store["box"]["status"] = LOAD_UNAVAILABLE

    # 這個案例要跑真實 pipeline 的 fail-safe，不用 conftest 的 mock
    monkeypatch.setattr(diagnose, "run_safety_pipeline", safety_pipeline.run_safety_pipeline)

    data = client.post(
        "/api/v1/diagnose",
        json={**APK_PAYLOAD, "conversation_id": "33333333-3333-4333-8333-333333333333"},
    ).json()

    assert data["status"] == "safety_alert"
    assert data["safety"]["risk_level"] == "unknown"
    assert data["safety"]["should_stop_normal_flow"] is True
    assert data["safety"]["technical_failure"] is True


def test_guest_never_touches_the_state_store(client, app, diagnosis_setup, store):
    """訪客維持現況每輪重算，不讀也不寫跨輪狀態。"""
    from routes.auth import get_current_user

    app.dependency_overrides[get_current_user] = lambda: {"id": 99, "is_guest": True}

    data = client.post("/api/v1/diagnose", json=APK_PAYLOAD).json()

    assert store["load"] == []
    assert store["save"] == []
    assert data["conversation_id"] is None


def test_load_status_constants_match_the_store(app):
    """
    上面為了避免在模組層匯入 services 而複製了常數字串，
    這裡確認它們沒有跟真實模組漂移。
    """
    import safety_state_store as s

    assert (LOAD_NEW, LOAD_OK, LOAD_UNAVAILABLE) == (
        s.LOAD_NEW, s.LOAD_OK, s.LOAD_UNAVAILABLE,
    )


# ============================================================
# 安全追問的 API 形狀
# ============================================================

def _pipeline_with_clarification(monkeypatch):
    """讓 pipeline 回傳一條「已帶動」的 emergency 未定案規則。"""
    from routes import diagnose
    from safety_observability import assessment_completeness
    from safety_state import advance

    def fake(symptom_text, history=None, prior_state=None, prior_state_unavailable=False):
        result = {
            "assessment_status": "success", "risk_level": "urgent",
            "risk_label": "儘快就醫", "should_stop_normal_flow": False,
            "requires_human_review": True, "has_red_flags": False,
            "safety_action": "", "red_flags": [],
            "engine_version": "test", "extractor_version": "test",
            "indeterminate_rules": [
                {"code": "HIGH_RISK_HEAD_INJURY", "risk_level": "emergency",
                 "engaged": True, "swing_set": ["taking_anticoagulants"]},
            ],
        }
        # 用真實函式算，讓測試驗到的是正式邏輯而不是假值
        result["assessment_completeness"] = assessment_completeness(result)
        result["next_state"] = advance(prior_state, {"head_injury": "present"}, result)
        return result

    monkeypatch.setattr(diagnose, "run_safety_pipeline", fake)


def test_safety_followup_uses_asking_not_safety_alert(client, member, diagnosis_setup, store, monkeypatch):
    """
    追問絕不可走 safety_alert：
    已上架 APK 的警示徽章寫死是「緊急」，不讀 risk_level，
    「資訊不足」走那條路徑會被誤標成緊急。
    """
    _pipeline_with_clarification(monkeypatch)

    data = client.post("/api/v1/diagnose", json=APK_PAYLOAD).json()

    assert data["status"] == "asking"
    assert data["status"] != "safety_alert"
    assert data["is_complete"] is False
    assert "安全評估尚未完成" in data["message"]


def test_safety_followup_skips_the_consultation_model(client, member, diagnosis_setup, store, monkeypatch):
    """安全資訊沒問清楚前不做科別推薦，也省一次 Gemini 呼叫。"""
    _pipeline_with_clarification(monkeypatch)

    client.post("/api/v1/diagnose", json=APK_PAYLOAD)

    diagnosis_setup.ai.assert_not_called()


def test_asked_flags_are_persisted(client, member, diagnosis_setup, store, monkeypatch):
    """問過的項目要寫進狀態，否則下一輪會重複問。"""
    _pipeline_with_clarification(monkeypatch)

    client.post("/api/v1/diagnose", json=APK_PAYLOAD)

    saved_state = store["save"][0][2]
    assert "taking_anticoagulants" in saved_state["asked_flags"]


# ============================================================
# review 指出的問題
# ============================================================

def test_version_change_restarts_the_conversation(app, monkeypatch):
    """
    規則或抽取換版後，舊狀態裡的旗標語意可能已經不同，不可沿用。

    方向與過期處理一致：重算而非沿用陳舊狀態。
    """
    import safety_state_store as store
    from tests.conftest import connection

    # 舊狀態的 engine_version 與目前不同
    conn, cur = connection(one=({}, [], [], [], 3, False, "2026.01.0", "x"))
    monkeypatch.setattr(store, "get_db_connection", lambda *a, **k: conn)

    _, status = store.load_state(
        "44444444-4444-4444-8444-444444444444", 7,
        engine_version="2026.09.3", extractor_version="x",
    )

    assert status == store.LOAD_RESTART


def test_same_version_is_reused(app, monkeypatch):
    import safety_state_store as store
    from tests.conftest import connection

    conn, _ = connection(one=({"chest_pain": "present"}, [], [], [], 3, False, "2026.09.3", "x"))
    monkeypatch.setattr(store, "get_db_connection", lambda *a, **k: conn)

    state, status = store.load_state(
        "44444444-4444-4444-8444-444444444444", 7,
        engine_version="2026.09.3", extractor_version="x",
    )

    assert status == store.LOAD_OK
    assert state["flag_states"] == {"chest_pain": "present"}


def test_audit_flag_lists_share_one_basis():
    """
    present / absent / unknown 三份清單必須同樣反映合併後的狀態。

    只有部分改成合併後的話，同一個旗標會同時出現在兩份清單裡。
    """
    from safety_state import merge_flag_states
    from symptom_flag_extractor import SymptomFlagsSchema

    schema = SymptomFlagsSchema()
    states = {k: getattr(schema, k) for k in SymptomFlagsSchema.model_fields}
    merged = merge_flag_states({"chest_pain": "present"}, states)

    present = {k for k, v in merged.items() if v == "present"}
    absent = {k for k, v in merged.items() if v == "absent"}
    unknown = {k for k, v in merged.items() if v == "unknown"}

    assert present & unknown == set()
    assert absent & unknown == set()
    assert present | absent | unknown == set(merged)


def test_pregnancy_question_does_not_presume_the_subject():
    """腹痛會帶動 PREGNANCY_EMERGENCY，任何性別的使用者都可能看到這題。"""
    from safety_followup import QUESTIONS

    for flag in ("pregnant", "vaginal_bleeding", "heavy_vaginal_bleeding"):
        assert "您" not in QUESTIONS[flag], QUESTIONS[flag]
        assert "不適用" in QUESTIONS[flag]


# ============================================================
# 步驟 4：觀測與評估完整度
# ============================================================

def test_incomplete_assessment_is_a_field_not_just_prose(client, member, diagnosis_setup, store, monkeypatch):
    """
    「資訊不足」與「已確認低風險」的 risk_level 都可能是 standard，
    必須用獨立欄位分開，不能只寫在文案裡。
    """
    _pipeline_with_clarification(monkeypatch)

    data = client.post("/api/v1/diagnose", json=APK_PAYLOAD).json()

    assert data["safety"]["assessment_completeness"] == "insufficient"


def test_completeness_does_not_touch_risk_level(app):
    """新欄位與 risk_level 正交，不可改動既有四值。"""
    from safety_observability import COMPLETE, INSUFFICIENT, assessment_completeness

    engaged = {"indeterminate_rules": [
        {"code": "X", "risk_level": "emergency", "engaged": True},
    ]}
    assert assessment_completeness(engaged) == INSUFFICIENT

    not_engaged = {"indeterminate_rules": [
        {"code": "X", "risk_level": "emergency", "engaged": False},
    ]}
    assert assessment_completeness(not_engaged) == COMPLETE


def test_observation_failure_never_breaks_the_consultation(client, member, diagnosis_setup, store, monkeypatch):
    """觀測是旁路，壞掉不可以影響問診。"""
    from routes import diagnose

    def boom(*args, **kwargs):
        raise RuntimeError("觀測炸了")

    monkeypatch.setattr(diagnose, "observe_turn", boom)

    response = client.post("/api/v1/diagnose", json=APK_PAYLOAD)

    assert response.status_code == 200, response.text


def test_completed_consultation_can_report_insufficient(client, member, diagnosis_setup, store, monkeypatch):
    """
    問診「完成」但評估未完成，是真的會發生的狀態 ——
    該問的都問過了卻仍未得到答案，追問不會無限重複。

    這是網頁端那段「安全評估尚未完成」提示的前提；
    若永遠不可能發生，那段 UI 就是死碼。
    """
    from routes import diagnose
    from safety_observability import assessment_completeness
    from safety_state import advance

    def fake(symptom_text, history=None, prior_state=None, prior_state_unavailable=False):
        result = {
            "assessment_status": "success", "risk_level": "standard",
            "risk_label": "一般", "should_stop_normal_flow": False,
            "requires_human_review": False, "has_red_flags": False,
            "safety_action": "", "red_flags": [],
            "engine_version": "test", "extractor_version": "test",
            # 規則仍被帶動且未定案，但 swing_set 的項目都問過了
            "indeterminate_rules": [
                {"code": "HIGH_RISK_HEAD_INJURY", "risk_level": "emergency",
                 "engaged": True, "swing_set": ["taking_anticoagulants"]},
            ],
        }
        result["assessment_completeness"] = assessment_completeness(result)
        result["next_state"] = advance(prior_state, {}, result)
        return result

    monkeypatch.setattr(diagnose, "run_safety_pipeline", fake)
    store["box"]["state"] = {
        "flag_states": {}, "established_rules": [],
        "asked_flags": ["taking_anticoagulants"],   # 已經問過，不再問
        "resolved_recently": [], "turn_count": 1,
    }
    store["box"]["status"] = LOAD_OK

    data = client.post(
        "/api/v1/diagnose",
        json={**APK_PAYLOAD, "conversation_id": "77777777-7777-4777-8777-777777777777"},
    ).json()

    # 問診完成，但安全評估並未完成
    assert data["is_complete"] is True
    assert data["status"] == "completed"
    assert data["safety"]["risk_level"] == "standard"
    assert data["safety"]["assessment_completeness"] == "insufficient"
