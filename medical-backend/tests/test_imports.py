import importlib.util
import sys
from pathlib import Path


def test_backend_app_imports_without_gemini_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)

    backend_dir = Path(__file__).resolve().parents[1]
    main_path = backend_dir / "main.py"

    spec = importlib.util.spec_from_file_location("backend_main_test", main_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    assert hasattr(module, "app")
