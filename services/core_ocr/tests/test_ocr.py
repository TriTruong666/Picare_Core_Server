import io
import os
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import create_app
from app.services import OcrService
from app.schemas import TextLine, OcrInput
from app.common import ApiError
from app.handlers.vn_identity_card import IdentityCardHandler, date_value


def lines(texts, side="front"):
    return [TextLine(text, .97, side) for text in texts]


class ParserTests(unittest.TestCase):
    def test_vietnamese_labels_dates_and_leading_zero(self):
        data = lines(["CĂN CƯỚC CÔNG DÂN", "Số / No.: 012345678901",
                      "Họ và tên / Full name:", "NGUYỄN VĂN KIỂM THỬ",
                      "Ngày sinh / Date of birth: 02/03/1990", "Giới tính / Sex: Nam",
                      "Quốc tịch / Nationality: Việt Nam", "Nơi thường trú / Place of residence:",
                      "Phường Thử Nghiệm", "Thành phố Kiểm Thử", "Có giá trị đến / Date of expiry: 02/03/2030"])
        data += lines(["Ngày 05 tháng 06 năm 2021", "Nơi cấp: CỤC KIỂM THỬ"], "back")
        result = IdentityCardHandler().extract(data)
        self.assertEqual(result.fields["number"], "012345678901")
        self.assertEqual(result.fields["fullName"], "NGUYỄN VĂN KIỂM THỬ")
        self.assertEqual(result.fields["birthdate"], "1990-03-02")
        self.assertEqual(result.fields["issuedDate"], "2021-06-05")
        self.assertEqual(result.fields["gender"], "MALE")
        self.assertEqual(result.fields["address"], "Phường Thử Nghiệm Thành phố Kiểm Thử")

    def test_unknown_document_does_not_fill_identity(self):
        self.assertEqual(IdentityCardHandler().extract(lines(["Invoice", "012345678901"])).fields, {})

    def test_ambiguous_numbers_are_not_guessed(self):
        result = IdentityCardHandler().extract(lines(["CĂN CƯỚC", "012345678901 012345678902"]))
        self.assertNotIn("number", result.fields)
        self.assertTrue(result.warnings)

    def test_invalid_dates_and_female(self):
        self.assertIsNone(date_value("31/02/2020"))
        result = IdentityCardHandler().extract(lines(["Căn cước", "Giới tính: Nữ", "Ngày sinh: 31/02/2020"]))
        self.assertEqual(result.fields["gender"], "FEMALE")
        self.assertNotIn("birthdate", result.fields)

    def test_busy_and_missing_side(self):
        service = OcrService(object())
        with self.assertRaises(ApiError):
            service.recognize(OcrInput(document_type="vn_identity_card"), {"front": b"test"})
        service.lock.acquire()
        try:
            with self.assertRaises(ApiError) as ctx:
                service.recognize(OcrInput(document_type="document"), {"front": b"test"})
            self.assertEqual(ctx.exception.status, 429)
        finally:
            service.lock.release()

    def test_lock_released_after_failure(self):
        class Engine:
            def read(self, *args):
                raise ApiError("Bad image")
        service = OcrService(Engine())
        with self.assertRaises(ApiError):
            service.recognize(OcrInput(document_type="document"), {"front": b"test"})
        self.assertFalse(service.lock.locked())


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"CORE_OCR_SERVICE_TOKEN": "test-only-secret"})
        self.env.start()
        self.addCleanup(self.env.stop)
        app = create_app(use_engine=False)
        class Engine:
            def read(self, data, side):
                return lines(["Căn cước", "Số: 012345678901"], side)
        app.state.ocr = OcrService(Engine())
        self.client = TestClient(app, raise_server_exceptions=False)
        self.headers = {"x-service-token": "test-only-secret"}

    def test_auth_fail_closed_envelope(self):
        response = self.client.post("/api/v1/ocr/recognize")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(set(response.json()), {"success", "message", "error_code", "details"})

    def test_unknown_type_and_missing_fields_are_normalized(self):
        for data in ({}, {"document_type": "arbitrary_module"}):
            response = self.client.post("/api/v1/ocr/recognize", headers=self.headers,
                                        data=data, files={"front": ("f.png", b"test")})
            self.assertEqual(response.status_code, 400)
            self.assertNotIn("test-only-secret", response.text)

    def test_success_envelope(self):
        response = self.client.post("/api/v1/ocr/recognize", headers=self.headers,
                                    data={"document_type": "vn_identity_card"},
                                    files={"front": ("f.png", b"test"), "back": ("b.png", b"test")})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["fields"]["number"], "012345678901")

    def test_oversized_chunked_body_is_rejected(self):
        response = self.client.post("/api/v1/ocr/recognize", headers=self.headers,
                                    data={"document_type": "document"}, files={"front": ("f.png", b"x" * (22 * 1024 * 1024))})
        self.assertIn(response.status_code, (400, 413))
        self.assertFalse(response.json()["success"])

    def test_real_decoder_rejects_fake_image(self):
        from app.engine import PaddleEngine
        with self.assertRaises(ApiError):
            PaddleEngine.decode(b"not an image")

    def test_real_decoder_accepts_png(self):
        from app.engine import PaddleEngine
        from PIL import Image
        data = io.BytesIO()
        Image.new("RGB", (300, 200), "white").save(data, format="PNG")
        self.assertEqual(PaddleEngine.decode(data.getvalue()).shape, (200, 300, 3))

    def test_overlap_uses_full_image_area_without_int16_overflow(self):
        from app.engine import PaddleEngine
        import numpy as np
        self.assertTrue(PaddleEngine.overlaps(np.array([0, 0, 2000, 1000], dtype=np.int16), (0, 0, 2000, 1000)))
        self.assertFalse(PaddleEngine.overlaps(np.array([0, 0, 2000, 1000], dtype=np.int16), (1999, 999, 2100, 1100)))


if __name__ == "__main__":
    unittest.main()
