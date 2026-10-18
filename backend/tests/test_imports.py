import pytest


def test_backend_app_imports_without_external_services(app):
    import services
    assert app.title
    assert services.DATABASE_URL == ""
    assert services.client is None
    assert services.vector_store is None


def test_remote_network_is_still_blocked(app):
    """
    conftest 為了 Windows 的 ProactorEventLoop 放行了 loopback，
    這裡確認遠端連線仍然被擋住 —— 不可因為那個放行而整道防線失效。
    """
    import socket

    for address in (
        ("ep-example.ap-southeast-1.aws.neon.tech", 5432),
        ("generativelanguage.googleapis.com", 443),
        ("8.8.8.8", 53),
    ):
        probe = socket.socket()
        # 防線若失效，這裡會真的連出去；設短逾時讓它快速失敗而不是卡住。
        probe.settimeout(0.05)
        try:
            with pytest.raises(AssertionError):
                probe.connect(address)
            with pytest.raises(AssertionError):
                probe.connect_ex(address)
        finally:
            probe.close()


def test_database_drivers_are_blocked(app):
    import psycopg2

    with pytest.raises(AssertionError):
        psycopg2.connect("postgresql://user:pw@ep-example.neon.tech/db")
