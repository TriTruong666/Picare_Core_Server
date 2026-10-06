import os
import hmac
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from starlette.exceptions import HTTPException
from .common import ApiError, failure
from .routes import router


@asynccontextmanager
async def lifespan(app):
    from .engine import PaddleEngine
    from .services import OcrService
    if not service_token():
        raise RuntimeError("Configure CORE_OCR_SERVICE_TOKEN or GRPC_STORAGE_SERVICE_TOKEN")
    app.state.ocr = OcrService(PaddleEngine())
    yield
    app.state.ocr = None


def service_token():
    return os.environ.get("CORE_OCR_SERVICE_TOKEN") or os.environ.get("GRPC_STORAGE_SERVICE_TOKEN", "")


class GuardMiddleware:
    """Authenticate before parsing files; bound chunked bodies as well as Content-Length."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        if scope["path"] != "/health/ready":
            expected, provided = service_token().encode(), headers.get(b"x-service-token", b"")
            if not expected or not hmac.compare_digest(expected, provided):
                return await failure(ApiError("Service token không hợp lệ", 401, "ERR_UNAUTHORIZED_001"))(scope, receive, send)
        limit, size = 21 * 1024 * 1024, 0

        async def limited_receive():
            nonlocal size
            message = await receive()
            size += len(message.get("body", b""))
            if size > limit:
                raise ApiError("Yêu cầu vượt quá 21 MB", 413, "ERR_BAD_REQUEST_001")
            return message

        async def private_send(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", []).append((b"cache-control", b"no-store"))
            await send(message)

        await self.app(scope, limited_receive, private_send)


def create_app(use_engine=True):
    app = FastAPI(title="Picare Core OCR", docs_url=None, redoc_url=None,
                  openapi_url=None, lifespan=lifespan if use_engine else None)
    app.state.ocr = None
    app.add_middleware(GuardMiddleware)
    app.include_router(router)

    @app.exception_handler(ApiError)
    async def api_error(request, error):
        return failure(error)

    async def validation_error(request, error):
        # Never echo input images, tokens or extracted personal data in errors.
        return failure(ApiError("Dữ liệu yêu cầu OCR không hợp lệ"))

    app.add_exception_handler(RequestValidationError, validation_error)
    app.add_exception_handler(ValidationError, validation_error)

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        return failure(ApiError("Yêu cầu không hợp lệ", error.status_code))

    @app.exception_handler(Exception)
    async def internal_error(request, error):
        return failure(ApiError("Không thể đọc ảnh lúc này. Bạn có thể nhập thông tin thủ công.", 503, "ERR_OCR_UNAVAILABLE"))

    return app


app = create_app()
