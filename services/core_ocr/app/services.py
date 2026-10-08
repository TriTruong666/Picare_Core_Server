import threading
import time
import logging
import os
import uuid
from .common import ApiError
from .registry import HandlerRegistry
from .handlers.document import DocumentHandler
from .handlers.vn_identity_card import IdentityCardHandler
from .handlers.vn_identity_qr import read_identity_qr

logger = logging.getLogger("uvicorn.error")


class OcrService:
    def __init__(self, engine, timeout_seconds=None):
        self.engine = engine
        self.lock = threading.Lock()
        configured = timeout_seconds if timeout_seconds is not None else os.environ.get("OCR_REQUEST_TIMEOUT_SECONDS", "75")
        self.timeout_seconds = max(10, min(80, float(configured)))
        self.hard_timeout_grace_seconds = 5
        self.registry = HandlerRegistry()
        self.registry.register("vn_identity_card", IdentityCardHandler())
        self.registry.register("document", DocumentHandler())

    @staticmethod
    def check_deadline(deadline):
        if time.monotonic() >= deadline:
            raise ApiError("OCR đã quá thời gian xử lý. Vui lòng thử lại hoặc nhập tay.", 504, "ERR_OCR_TIMEOUT")

    def stage(self, request_id, name, deadline, operation):
        self.check_deadline(deadline)
        started = time.monotonic()
        try:
            result = operation()
        except Exception:
            logger.warning("ocr_stage request_id=%s stage=%s status=error elapsed_ms=%d",
                           request_id, name, round((time.monotonic() - started) * 1000))
            raise
        elapsed_ms = round((time.monotonic() - started) * 1000)
        logger.info("ocr_stage request_id=%s stage=%s status=ok elapsed_ms=%d",
                    request_id, name, elapsed_ms)
        self.check_deadline(deadline)
        return result

    @staticmethod
    def watchdog(request_id, started):
        logger.error("ocr_watchdog request_id=%s status=hard_timeout elapsed_ms=%d action=restart",
                     request_id, round((time.monotonic() - started) * 1000))
        for handler in logger.handlers:
            handler.flush()
        os._exit(124)

    def recognize(self, request, images, request_id=None):
        request_id = request_id or uuid.uuid4().hex
        handler = self.registry.get(request.document_type)
        if any(not images.get(side) for side in handler.required_sides):
            raise ApiError("Thiếu ảnh cần đọc; căn cước yêu cầu cả mặt trước và mặt sau.")
        if any(len(data) > 10 * 1024 * 1024 for data in images.values()):
            raise ApiError("Mỗi ảnh không được vượt quá 10 MB")
        if not self.lock.acquire(blocking=False):
            logger.warning("ocr_request request_id=%s status=busy", request_id)
            raise ApiError("OCR đang bận. Vui lòng thử lại sau.", 429, "ERR_OCR_BUSY")
        started = time.monotonic()
        deadline = started + self.timeout_seconds
        watchdog = threading.Timer(self.timeout_seconds + self.hard_timeout_grace_seconds,
                                   self.watchdog, args=(request_id, started))
        watchdog.daemon = True
        watchdog.start()
        logger.info("ocr_request request_id=%s status=start document_type=%s front_bytes=%d back_bytes=%d timeout_s=%.0f",
                    request_id, request.document_type, len(images.get("front", b"")),
                    len(images.get("back", b"")), self.timeout_seconds)
        try:
            if request.document_type == "vn_identity_card":
                result = self.read_identity(handler, images, request_id, deadline)
            else:
                lines = []
                for side in handler.required_sides:
                    lines.extend(self.stage(request_id, f"read_{side}_0", deadline,
                                            lambda side=side: self.engine.read(images[side], side)))
                result = handler.extract(lines)
            self.check_deadline(deadline)
            logger.info("ocr_request request_id=%s status=ok elapsed_ms=%d fields=%d warnings=%d",
                        request_id, round((time.monotonic() - started) * 1000),
                        len(result.fields), len(result.warnings))
            return result
        except ApiError as error:
            logger.warning("ocr_request request_id=%s status=error code=%s elapsed_ms=%d",
                           request_id, error.code, round((time.monotonic() - started) * 1000))
            raise
        except Exception as error:
            logger.error("ocr_request request_id=%s status=error code=ERR_OCR_UNAVAILABLE error_type=%s elapsed_ms=%d",
                         request_id, type(error).__name__, round((time.monotonic() - started) * 1000))
            raise
        finally:
            watchdog.cancel()
            self.lock.release()

    def read_identity(self, handler, images, request_id, deadline):
        # Most photos need one pass. Try other pixel orientations only when the
        # relevant side is not recognized; front and back may be shot differently.
        qr_fields = self.stage(request_id, "qr", deadline,
                               lambda: read_identity_qr(images["front"]))
        front = self.stage(request_id, "read_front_0", deadline,
                           lambda: self.engine.read(images["front"], "front"))
        front_rotation = 0
        front_fields = handler.extract(front).fields
        front_score = self.front_score(front_fields)
        front_sideways = any(line.image_sideways for line in front)
        for rotation in (90, 270, 180):
            # A number and date read from the printed front establish its
            # orientation. Missing text then needs a focused fallback, not
            # three more full-card Paddle and Tesseract passes.
            if (not front_sideways and all(front_fields.get(key) for key in ("number", "birthdate"))
                    or time.monotonic() >= deadline):
                break
            candidate = self.stage(request_id, f"read_front_{rotation}", deadline,
                                   lambda rotation=rotation: self.engine.read(images["front"], "front", rotation=rotation))
            candidate_fields = handler.extract(candidate).fields
            score = self.front_score(candidate_fields)
            candidate_sideways = any(line.image_sideways for line in candidate)
            if (score > front_score or (front_sideways and not candidate_sideways
                                       and score >= front_score - 2)):
                front, front_fields, front_score = candidate, candidate_fields, score
                front_sideways = candidate_sideways
                front_rotation = rotation

        back = self.stage(request_id, "read_back_0", deadline,
                          lambda: self.engine.read(images["back"], "back"))
        back_rotation = 0
        back_score = self.back_score(back)
        back_sideways = any(line.image_sideways for line in back)
        for rotation in (90, 270, 180):
            # The issue date is enough evidence that this side is upright.
            # Rotating cannot recover a missing agency name on an upright card.
            if (not back_sideways and (back_score >= 3 or self.back_has_issue_date(back))
                    or time.monotonic() >= deadline):
                break
            candidate = self.stage(request_id, f"read_back_{rotation}", deadline,
                                   lambda rotation=rotation: self.engine.read(images["back"], "back", rotation=rotation))
            score = self.back_score(candidate)
            candidate_sideways = any(line.image_sideways for line in candidate)
            if (score > back_score or (back_sideways and not candidate_sideways
                                      and score >= back_score - 1)):
                back, back_score = candidate, score
                back_sideways = candidate_sideways
                back_rotation = rotation
        preliminary = handler.extract(front + back, qr_fields=qr_fields)
        regions = {}
        region_reader = getattr(self.engine, "read_identity_regions", None)
        if region_reader and "placeOfOrigin" not in preliminary.fields:
            regions.update(self.stage(request_id, "region_front", deadline,
                                      lambda: region_reader(images["front"], "front", front_rotation, front)))
        if region_reader and "issuedPlace" not in preliminary.fields:
            regions.update(self.stage(request_id, "region_back", deadline,
                                      lambda: region_reader(images["back"], "back", back_rotation, back)))
        if regions:
            return handler.extract(front + back, qr_fields=qr_fields, regions=regions)
        return preliminary

    @staticmethod
    def front_score(fields):
        return (3 * bool(fields.get("number")) + 3 * bool(fields.get("fullName"))
                + 2 * bool(fields.get("birthdate"))
                + sum(bool(fields.get(key)) for key in
                      ("gender", "nationality", "placeOfOrigin", "address", "expiryDate")))

    @staticmethod
    def back_score(lines):
        # On some Vietnamese cards the issuing agency has no explicit label.
        # The date and agency are extracted by the same handler as the final pass.
        from .schemas import TextLine
        placeholder = TextLine("CĂN CƯỚC CÔNG DÂN", 1.0, "front")
        fields = IdentityCardHandler().extract([placeholder] + lines).fields
        from .handlers.vn_identity_card import folded
        text = folded(" ".join(line.text for line in lines))
        agency_visible = "cuc" in text and "canh sat" in text
        return (2 * bool(fields.get("issuedDate")) + bool(fields.get("issuedPlace"))
                + 2 * agency_visible)

    @staticmethod
    def back_has_issue_date(lines):
        from .schemas import TextLine
        placeholder = TextLine("CĂN CƯỚC CÔNG DÂN", 1.0, "front")
        return bool(IdentityCardHandler().extract([placeholder] + lines).fields.get("issuedDate"))
