from typing import Annotated
from fastapi import APIRouter, File, Form, Request, UploadFile
from . import controllers
from .schemas import OcrInput
from .common import success, ApiError

router = APIRouter()


@router.get("/health/ready")
def ready(request: Request):
    if not getattr(request.app.state, "ocr", None):
        raise ApiError("OCR chưa sẵn sàng", 503, "ERR_OCR_UNAVAILABLE")
    return success({"ready": True})


@router.post("/api/v1/ocr/recognize")
def recognize(request: Request, document_type: Annotated[str, Form()],
              front: Annotated[UploadFile, File()], back: Annotated[UploadFile | None, File()] = None):
    return controllers.recognize(request.app.state.ocr, OcrInput.model_validate({"document_type": document_type}), front, back)
