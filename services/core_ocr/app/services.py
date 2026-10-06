import threading
from .common import ApiError
from .registry import HandlerRegistry
from .handlers.document import DocumentHandler
from .handlers.vn_identity_card import IdentityCardHandler


class OcrService:
    def __init__(self, engine):
        self.engine = engine
        self.lock = threading.Lock()
        self.registry = HandlerRegistry()
        self.registry.register("vn_identity_card", IdentityCardHandler())
        self.registry.register("document", DocumentHandler())

    def recognize(self, request, images):
        handler = self.registry.get(request.document_type)
        if any(not images.get(side) for side in handler.required_sides):
            raise ApiError("Thiếu ảnh cần đọc; căn cước yêu cầu cả mặt trước và mặt sau.")
        if any(len(data) > 10 * 1024 * 1024 for data in images.values()):
            raise ApiError("Mỗi ảnh không được vượt quá 10 MB")
        if not self.lock.acquire(blocking=False):
            raise ApiError("OCR đang bận. Vui lòng thử lại sau.", 429, "ERR_OCR_BUSY")
        try:
            lines = []
            for side in handler.required_sides:
                lines.extend(self.engine.read(images[side], side))
            return handler.extract(lines)
        finally:
            self.lock.release()
