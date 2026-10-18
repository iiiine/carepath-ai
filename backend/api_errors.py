"""Consistent API errors without exposing SQL, credentials or patient text."""
import logging
from contextvars import ContextVar
from uuid import uuid4

from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

request_id_context = ContextVar("request_id", default="unavailable")
logger = logging.getLogger("carepath.errors")


def log_failure(operation, exc):
    # Exception messages/traceback locals can contain SQL parameters and health data.
    # Log only server-controlled operation, request ID, exception type and code location.
    traceback = exc.__traceback__
    while traceback and traceback.tb_next:
        traceback = traceback.tb_next
    location = (
        f"{traceback.tb_frame.f_code.co_name}:{traceback.tb_lineno}"
        if traceback else "unavailable"
    )
    logger.error("operation=%s request_id=%s exception=%s location=%s",
                 operation, request_id_context.get(), type(exc).__name__, location)


def _server_error(request, exc, status_code=500):
    log_failure("request_failed", exc.__cause__ or exc.__context__ or exc)
    return JSONResponse(status_code=status_code, content={
        "detail": "服務暫時無法完成請求，請稍後再試。",
        "error_code": "INTERNAL_ERROR",
        "request_id": request.state.request_id,
    })


def install_error_handlers(app):
    @app.middleware("http")
    async def track_request(request, call_next):
        # Generate our own ID; do not trust arbitrary client-supplied log content.
        request.state.request_id = uuid4().hex
        token = request_id_context.set(request.state.request_id)
        try:
            try:
                response = await call_next(request)
            except Exception as exc:
                response = _server_error(request, exc)
            response.headers["X-Request-ID"] = request.state.request_id
            return response
        finally:
            request_id_context.reset(token)

    @app.exception_handler(HTTPException)
    async def safe_http_error(request, exc):
        if exc.status_code >= 500:
            return _server_error(request, exc, exc.status_code)
        # Keep existing login challenges, validation messages, 403s and 404s.
        return await http_exception_handler(request, exc)
