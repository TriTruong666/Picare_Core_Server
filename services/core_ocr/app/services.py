import threading
import time
from .common import ApiError
from .registry import HandlerRegistry
from .handlers.document import DocumentHandler
from .handlers.vn_identity_card import IdentityCardHandler
from .handlers.vn_identity_qr import read_identity_qr


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
            if request.document_type == "vn_identity_card":
                return self.read_identity(handler, images)
            lines = []
            for side in handler.required_sides:
                lines.extend(self.engine.read(images[side], side))
            return handler.extract(lines)
        finally:
            self.lock.release()

    def read_identity(self, handler, images):
        # Most photos need one pass. Try other pixel orientations only when the
        # relevant side is not recognized; front and back may be shot differently.
        deadline = time.monotonic() + 70
        qr_fields = read_identity_qr(images["front"])
        front = self.engine.read(images["front"], "front")
        front_rotation = 0
        front_fields = handler.extract(front).fields
        front_score = self.front_score(front_fields)
        for rotation in (90, 270, 180):
            if (all(front_fields.get(key) for key in ("number", "fullName", "birthdate"))
                    or (qr_fields and front_fields.get("number") == qr_fields["number"]
                        and front_fields.get("birthdate") and front_score >= 7)
                    or time.monotonic() >= deadline):
                break
            candidate = self.engine.read(images["front"], "front", rotation=rotation)
            candidate_fields = handler.extract(candidate).fields
            score = self.front_score(candidate_fields)
            if score > front_score:
                front, front_fields, front_score = candidate, candidate_fields, score
                front_rotation = rotation

        back = self.engine.read(images["back"], "back")
        back_rotation = 0
        back_score = self.back_score(back)
        for rotation in (90, 270, 180):
            if back_score >= 3 or time.monotonic() >= deadline:
                break
            candidate = self.engine.read(images["back"], "back", rotation=rotation)
            score = self.back_score(candidate)
            if score > back_score:
                back, back_score = candidate, score
                back_rotation = rotation
        preliminary = handler.extract(front + back, qr_fields=qr_fields)
        regions = {}
        region_reader = getattr(self.engine, "read_identity_regions", None)
        if region_reader and "placeOfOrigin" not in preliminary.fields:
            regions.update(region_reader(
                images["front"], "front", front_rotation))
        if region_reader and "issuedPlace" not in preliminary.fields:
            regions.update(region_reader(
                images["back"], "back", back_rotation))
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
