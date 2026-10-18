"""Offline tests: never load local secrets or contact Neon/Gemini."""
import importlib
import socket
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def app():
    with pytest.MonkeyPatch.context() as patch:
        for key in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "DATABASE_URL"):
            patch.setenv(key, "")
        patch.setenv("AUTH_SECRET_KEY", "offline-test-key-not-for-deployment")
        patch.setenv("AUTH_TOKEN_EXPIRE_MINUTES", "1440")
        patch.setattr("dotenv.load_dotenv", lambda *args, **kwargs: False)
        # Windows 的 ProactorEventLoop 會在 _make_self_pipe() 用 socket.socketpair()，
        # 而 socketpair() 在 Windows 沒有原生實作，會退回 loopback connect。
        # 無條件封鎖 connect 會讓 TestClient 連起都起不來（實測 65 個 error），
        # 因此放行 loopback；要擋的 Neon 與 Gemini 都是遠端，不受影響。
        real_connect = socket.socket.connect
        real_connect_ex = socket.socket.connect_ex

        def is_loopback(address):
            return (
                isinstance(address, tuple)
                and len(address) >= 1
                and address[0] in ("127.0.0.1", "::1", "localhost")
            )

        def no_network(self, address=None, *args, **kwargs):
            if is_loopback(address):
                return real_connect(self, address, *args, **kwargs)
            raise AssertionError("Network access is forbidden in offline tests")

        def no_network_ex(self, address=None, *args, **kwargs):
            if is_loopback(address):
                return real_connect_ex(self, address, *args, **kwargs)
            raise AssertionError("Network access is forbidden in offline tests")

        def no_database(*args, **kwargs):
            raise AssertionError("Network access is forbidden in offline tests")

        patch.setattr(socket.socket, "connect", no_network)
        patch.setattr(socket.socket, "connect_ex", no_network_ex)
        patch.setattr("psycopg2.connect", no_database)
        patch.setattr("psycopg.connect", no_database)
        services = importlib.import_module("services")
        patch.setattr(services, "run_health_check", lambda: None)
        yield importlib.import_module("main").app


@pytest.fixture
def client(app):
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client
    app.dependency_overrides.clear()


@pytest.fixture
def member(app):
    from routes.auth import get_current_user
    user = {"id": 7, "is_guest": False}
    app.dependency_overrides[get_current_user] = lambda: user
    yield user
    app.dependency_overrides.clear()


def connection(one=None, many=None):
    conn = MagicMock()
    cur = conn.cursor.return_value.__enter__.return_value
    cur.fetchone.return_value = one
    cur.fetchall.return_value = [] if many is None else many
    return conn, cur


@pytest.fixture
def diagnosis_setup(app, monkeypatch):
    from routes import diagnose
    profile, _ = connection()
    resources, _ = connection()
    saved, cursor = connection(one=(42,))
    monkeypatch.setattr(diagnose, "get_db_connection", MagicMock(side_effect=[profile, resources, saved]))
    monkeypatch.setattr(diagnose, "get_departments", lambda: ("家醫科",))
    monkeypatch.setattr(diagnose, "get_rag_context", lambda _: "")
    monkeypatch.setattr(diagnose, "run_safety_pipeline", lambda **_: {
        "assessment_status": "success", "risk_level": "standard", "risk_label": "一般", "should_stop_normal_flow": False,
        "requires_human_review": False, "has_red_flags": False, "safety_action": "",
    })
    ai = MagicMock(return_value=SimpleNamespace(text='{"is_complete": true, "department": "家醫科", "causes": [], "follow_up_question": ""}'))
    monkeypatch.setattr(diagnose, "call_gemini_with_retry", ai)
    return SimpleNamespace(module=diagnose, saved=saved, cursor=cursor, ai=ai,
                           profile=profile, resources=resources)
