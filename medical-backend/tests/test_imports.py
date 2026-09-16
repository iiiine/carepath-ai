def test_backend_app_imports_without_external_services(app):
    import services
    assert app.title
    assert services.DATABASE_URL == ""
    assert services.client is None
    assert services.vector_store is None
