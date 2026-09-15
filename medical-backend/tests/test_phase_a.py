from datetime import datetime, timezone

import pytest
from conftest import connection

PAYLOAD = {"symptom_text": "鼻塞兩天", "pain_level": 2}


def test_completed_returns_committed_id(client, member, diagnosis_setup):
    response = client.post("/api/v1/diagnose", json=PAYLOAD)
    assert response.status_code == 200, response.text
    assert response.json()["session_id"] == 42
    assert response.json()["save_status"] == "saved"
    assert "RETURNING id" in diagnosis_setup.cursor.execute.call_args.args[0]
    diagnosis_setup.saved.commit.assert_called_once()
    diagnosis_setup.saved.close.assert_called_once()


@pytest.mark.parametrize("failure", ["execute", "commit", "missing_id", "no_connection"])
def test_save_failure_keeps_result_without_id(client, member, diagnosis_setup, failure):
    setup = diagnosis_setup
    if failure == "no_connection":
        setup.module.get_db_connection.side_effect = [setup.profile, setup.resources, None]
    elif failure == "missing_id":
        setup.cursor.fetchone.return_value = None
    else:
        target = setup.cursor if failure == "execute" else setup.saved
        getattr(target, failure).side_effect = RuntimeError("SECRET_DB_TABLE")
    response = client.post("/api/v1/diagnose", json=PAYLOAD)
    assert response.status_code == 200, response.text
    assert response.json()["session_id"] is None
    assert response.json()["save_status"] == "failed"
    assert response.json()["status"] == "completed"
    assert "SECRET_DB_TABLE" not in response.text
    if failure != "no_connection":
        setup.saved.rollback.assert_called_once()
        setup.saved.close.assert_called_once()


def test_guest_does_not_save(client, member, diagnosis_setup):
    member["is_guest"] = True
    diagnosis_setup.module.get_db_connection.side_effect = [diagnosis_setup.resources]
    response = client.post("/api/v1/diagnose", json=PAYLOAD)
    assert response.status_code == 200, response.text
    assert response.json()["session_id"] is None
    assert response.json()["save_status"] == "not_applicable"
    diagnosis_setup.saved.commit.assert_not_called()
    assert diagnosis_setup.module.get_db_connection.call_count == 1


def test_safety_alert_still_stops_normal_ai(client, member, diagnosis_setup, monkeypatch):
    monkeypatch.setattr(diagnosis_setup.module, "run_safety_pipeline", lambda **_: {
        "assessment_status": "success", "risk_level": "emergency", "risk_label": "緊急", "should_stop_normal_flow": True,
        "requires_human_review": True, "has_red_flags": True,
        "safety_action": "安全警示測試",
    })
    response = client.post("/api/v1/diagnose", json=PAYLOAD)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "safety_alert"
    diagnosis_setup.ai.assert_not_called()
    diagnosis_setup.module.get_db_connection.assert_not_called()


def test_followup_does_not_save(client, member, diagnosis_setup):
    diagnosis_setup.ai.return_value.text = '{"is_complete": false, "follow_up_question": "持續多久？"}'
    response = client.post("/api/v1/diagnose", json=PAYLOAD)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "asking"
    diagnosis_setup.saved.commit.assert_not_called()


@pytest.mark.parametrize("token", [None, "invalid-token"])
def test_schedule_requires_valid_login(client, token):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    response = client.get("/api/v1/doctor-schedules", params={"hospital_code": "H1", "doctor_name": "測試醫師"}, headers=headers)
    assert response.status_code == 401, response.text


@pytest.mark.parametrize("guest", [False, True])
def test_schedule_can_return_empty_for_authenticated_users(client, member, monkeypatch, guest):
    from routes import doctor_schedules
    member["is_guest"] = guest
    conn, cur = connection(one={
        "doctor_id": 1, "doctor_name": "測試醫師", "department": "家醫科", "specialty": "一般",
        "hospital_id": 2, "hospital_code": "H1", "hospital_name": "測試院所", "booking_url": None,
    })
    monkeypatch.setattr(doctor_schedules, "get_db_connection", lambda: conn)
    response = client.get("/api/v1/doctor-schedules", params={"hospital_code": "H1", "doctor_name": "測試醫師"})
    assert response.status_code == 200, response.text
    assert response.json()["schedules"] == []
    assert response.json()["schedule_count"] == 0
    conn.close.assert_called_once()


def test_summary_uses_exact_id_and_owner(client, member, monkeypatch, diagnosis_setup):
    completed = client.post("/api/v1/diagnose", json=PAYLOAD)
    assert completed.status_code == 200
    session_id = completed.json()["session_id"]
    assert session_id == 42
    from routes import visit_summary
    conn, cur = connection()
    def fetch():
        sql, params = cur.execute.call_args.args
        assert "user_id = %s" in sql
        assert params == (42, member["id"])
        if member["id"] != 7:
            return None
        return {"id": 42, "user_id": 7, "original_symptom": "鼻塞兩天", "pain_level": 2,
                "suggested_department": "家醫科", "created_at": datetime(2026, 9, 16, tzinfo=timezone.utc)}
    cur.fetchone.side_effect = fetch
    monkeypatch.setattr(visit_summary, "get_db_connection", lambda: conn)
    monkeypatch.setattr(visit_summary, "_load_user_profile", lambda **_: {})
    response = client.get(f"/api/v1/visit-summary/{session_id}")
    assert response.status_code == 200, response.text
    member["id"] = 8
    response = client.get(f"/api/v1/visit-summary/{session_id}")
    assert response.status_code == 404, response.text


def test_unexpected_error_is_sanitized(client, member, diagnosis_setup):
    diagnosis_setup.ai.side_effect = RuntimeError("SECRET_DB_TABLE token=private")
    response = client.post("/api/v1/diagnose", json=PAYLOAD)
    assert response.status_code == 500
    assert "SECRET_DB_TABLE" not in response.text
    assert "private" not in response.text
    assert response.json()["error_code"] == "INTERNAL_ERROR"
    assert response.headers["x-request-id"] == response.json()["request_id"]


@pytest.mark.parametrize("failure", ["connect", "rollback", "close"])
def test_save_cleanup_failure_does_not_discard_diagnosis(client, member, diagnosis_setup, failure):
    setup = diagnosis_setup
    if failure == "connect":
        setup.module.get_db_connection.side_effect = [setup.profile, setup.resources, RuntimeError("private")]
    elif failure == "rollback":
        setup.saved.commit.side_effect = RuntimeError("private")
        setup.saved.rollback.side_effect = RuntimeError("private")
    else:
        setup.saved.close.side_effect = RuntimeError("private")
    response = client.post("/api/v1/diagnose", json=PAYLOAD)
    assert response.status_code == 200, response.text
    assert response.json()["save_status"] == ("saved" if failure == "close" else "failed")
    assert response.json()["session_id"] == (42 if failure == "close" else None)


@pytest.mark.parametrize("module,method,path,payload", [
    ("auth", "post", "/api/v1/auth/guest-login", {}),
    ("auth", "post", "/api/v1/auth/register", {"username": "testuser", "email": "test@example.com", "password": "testpassword"}),
    ("profile", "post", "/api/v1/profile", {"height_cm": 170}),
    ("history", "get", "/api/v1/history", None),
    ("hospitals", "get", "/api/v1/hospitals", None),
    ("doctor_schedules", "get", "/api/v1/doctor-schedules?hospital_code=H1&doctor_name=test", None),
    ("visit_summary", "get", "/api/v1/visit-summary/42", None),
])
def test_database_errors_do_not_leak(client, member, monkeypatch, caplog, capsys, module, method, path, payload):
    import importlib
    route = importlib.import_module(f"routes.{module}")
    conn, cur = connection()
    cur.execute.side_effect = RuntimeError("SECRET_DB_TABLE token=private patient=private")
    monkeypatch.setattr(route, "get_db_connection", lambda: conn)
    response = client.request(method, path, **({"json": payload} if payload is not None else {}))
    assert response.status_code == 500, response.text
    assert response.json()["error_code"] == "INTERNAL_ERROR"
    request_id = response.json()["request_id"]
    assert request_id == response.headers["x-request-id"]
    assert request_id in caplog.text
    logs = caplog.text + capsys.readouterr().out
    for secret in ("SECRET_DB_TABLE", "token=private", "patient=private"):
        assert secret not in response.text
        assert secret not in logs
    conn.close.assert_called_once()


def test_schedule_expired_token_is_rejected_before_db(client, monkeypatch):
    import jwt
    from routes import auth, doctor_schedules
    from unittest.mock import MagicMock
    db = MagicMock(side_effect=AssertionError("must not query DB"))
    monkeypatch.setattr(doctor_schedules, "get_db_connection", db)
    monkeypatch.setattr(auth, "get_db_connection", db)
    token = jwt.encode({"sub": "7", "exp": 1}, auth.SECRET_KEY, algorithm=auth.ALGORITHM)
    response = client.get("/api/v1/doctor-schedules?hospital_code=H1&doctor_name=test", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    db.assert_not_called()


def test_validation_and_missing_schedule_preserve_status(client, member, monkeypatch):
    from routes import doctor_schedules
    conn, _ = connection()
    monkeypatch.setattr(doctor_schedules, "get_db_connection", lambda: conn)
    response = client.get("/api/v1/doctor-schedules?hospital_code=H1&doctor_name=test&days=0")
    assert response.status_code == 422
    conn.cursor.assert_not_called()
    response = client.get("/api/v1/doctor-schedules?hospital_code=H1&doctor_name=test")
    assert response.status_code == 404


def test_error_request_ids_are_unique_and_ignore_client_value(client, member, diagnosis_setup):
    diagnosis_setup.ai.side_effect = RuntimeError("private")
    ids = []
    for _ in range(2):
        diagnosis_setup.module.get_db_connection.side_effect = [diagnosis_setup.profile]
        response = client.post("/api/v1/diagnose", json=PAYLOAD, headers={"X-Request-ID": "client-controlled"})
        ids.append(response.json()["request_id"])
    assert ids[0] != ids[1]
    assert "client-controlled" not in ids


def test_repeated_symptoms_get_distinct_insert_ids(client, member, diagnosis_setup):
    setup = diagnosis_setup
    ids = []
    for inserted_id in (42, 43):
        setup.module.get_db_connection.side_effect = [setup.profile, setup.resources, setup.saved]
        setup.cursor.fetchone.return_value = (inserted_id,)
        response = client.post("/api/v1/diagnose", json=PAYLOAD)
        assert response.status_code == 200
        ids.append(response.json()["session_id"])
    assert ids == [42, 43]


def test_schedule_rows_and_date_range(client, member, monkeypatch):
    from datetime import date, time
    from routes import doctor_schedules
    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 9, 16, 9, tzinfo=tz)
    monkeypatch.setattr(doctor_schedules, "datetime", FixedDatetime)
    conn, cur = connection(one={
        "doctor_id": 1, "doctor_name": "測試醫師", "department": "家醫科", "specialty": "一般",
        "hospital_id": 2, "hospital_code": "H1", "hospital_name": "測試院所", "booking_url": "僅提供現場掛號",
    }, many=[{
        "id": 3, "schedule_date": date(2026, 9, 16), "weekday": 3,
        "start_time": time(9), "end_time": time(12), "time_precision": "exact",
        "registration_status": "full",
    }])
    monkeypatch.setattr(doctor_schedules, "get_db_connection", lambda: conn)
    response = client.get("/api/v1/doctor-schedules?hospital_code=H1&doctor_name=test&days=7")
    assert response.status_code == 200, response.text
    assert response.json()["schedules"][0]["time_text"] == "09:00–12:00"
    assert response.json()["schedules"][0]["registration_status_label"] == "預約額滿"
    assert response.json()["hospital"]["booking_type"] == "note"
    assert cur.execute.call_args.args[1] == (1, 2, date(2026, 9, 16), date(2026, 9, 23))


def test_openapi_includes_schedule_security_and_save_status(client):
    schema = client.get('/openapi.json').json()
    assert schema['paths']['/api/v1/doctor-schedules']['get']['security']
    assert schema['components']['schemas']['DiagnosisResponse']['properties']['save_status']['enum'] == [
        'saved', 'failed', 'not_applicable',
    ]
