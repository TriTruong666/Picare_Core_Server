import io
import os
import subprocess
import sys
import time
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import create_app
from app.services import OcrService
from app.schemas import TextLine, OcrInput
from app.common import ApiError
from app.handlers.vn_identity_card import IdentityCardHandler, date_value, plausible_vietnamese_place
from app.handlers.vn_identity_qr import parse_identity_qr, read_identity_qr


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

    def test_rejects_name_and_address_fragments_without_discarding_valid_fields(self):
        result = IdentityCardHandler().extract(lines([
            "CĂN CƯỚC CÔNG DÂN", "Số: 012345678901", "Họ và tên: SN",
            "Giới tính: Nam", "Nơi thường trú: T 8, Ap 4",
            "Quê quán: 'Tỉnh Mẫu", "Có giá trị đến: 02/03/2030",
        ]))
        self.assertEqual(result.fields["number"], "012345678901")
        self.assertNotIn("fullName", result.fields)
        self.assertNotIn("address", result.fields)
        self.assertEqual(result.fields["placeOfOrigin"], "Tỉnh Mẫu")
        self.assertIn("Chưa đọc được họ tên; bạn có thể nhập tay.", result.warnings)

    def test_short_but_valid_name_is_allowed(self):
        result = IdentityCardHandler().extract(lines([
            "CĂN CƯỚC CÔNG DÂN", "Họ và tên: LÊ AN",
        ]))
        self.assertEqual(result.fields["fullName"], "LÊ AN")

    def test_name_skips_fragment_but_never_uses_card_header(self):
        handler = IdentityCardHandler()
        valid = handler.extract([
            TextLine("CĂN CƯỚC CÔNG DÂN", .98, "front"),
            TextLine("Họ và tên / Full name:", .98, "front"),
            TextLine("SN", .65, "front"),
            TextLine("NGUYỄN VĂN MẪU", .92, "front"),
        ])
        self.assertEqual(valid.fields["fullName"], "NGUYỄN VĂN MẪU")
        invalid = handler.extract(lines([
            "CĂN CƯỚC CÔNG DÂN", "Họ và tên / Full name:",
            "SOCIALIST REPUBLIC OF VIET NAM", "Independence - Freedom - Happiness",
        ]))
        self.assertNotIn("fullName", invalid.fields)

    def test_birthdate_reads_next_unlabelled_line(self):
        result = IdentityCardHandler().extract(lines([
            "CĂN CƯỚC CÔNG DÂN", "Ngày sinh / Date of birth:", "02/03/1990",
        ]))
        self.assertEqual(result.fields["birthdate"], "1990-03-02")

    def test_expiry_date_accepts_dropped_character_in_label(self):
        result = IdentityCardHandler().extract(lines([
            "CĂN CƯỚC CÔNG DÂN", "Số: 012345678901",
            "Co giá tr dén 26/03/2029", "Date of expiry",
        ]))
        self.assertEqual(result.fields["expiryDate"], "2029-03-26")

    def test_region_refinement_reads_origin_and_complete_issuing_authority(self):
        data = lines(["CĂN CƯỚC CÔNG DÂN", "Số: 012345678901", "Ngày sinh: 02/03/1990"])
        data += lines(["Ngày cấp: 05/06/2021"], "back")
        result = IdentityCardHandler().extract(data, regions={
            "placeOfOrigin": "Quê quán / Place of origin:\nPhường Mẫu, Thành phố Thử Nghiệm\nNơi thường trú: Khác",
            "issuedPlace": "CỤC TRƯỞNG CỤC CÀNH SÁT\nQUẢN LÝ HÀNH CHÍNH VỀ TRAT TỰ XÃ HỘI",
        })
        self.assertEqual(result.fields["placeOfOrigin"], "Phường Mẫu, Thành phố Thử Nghiệm")
        self.assertEqual(result.fields["issuedPlace"],
                         "Cục trưởng Cục Cảnh sát quản lý hành chính về trật tự xã hội")
        self.assertEqual(result.fields["birthdate"], "1990-03-02")

    def test_region_refinement_rejects_missing_label_and_partial_agency(self):
        result = IdentityCardHandler().extract(
            lines(["CĂN CƯỚC CÔNG DÂN", "Số: 012345678901"]),
            regions={"placeOfOrigin": "Phường Mẫu, Thành phố Thử Nghiệm",
                     "issuedPlace": "CỤC TRƯỞNG CỤC CẢNH SÁT"})
        self.assertNotIn("placeOfOrigin", result.fields)
        self.assertNotIn("issuedPlace", result.fields)

    def test_region_refinement_accepts_complete_agency_with_ocr_punctuation(self):
        result = IdentityCardHandler().extract(lines(["CĂN CƯỚC"]), regions={
            "issuedPlace": "CỤC TRƯỜNG CỤC CANH SÁT\n"
                           "UÄN LÝ HÀNH'CHÍNH VE TRAT TỰ XA HỘI",
        })
        self.assertEqual(result.fields["issuedPlace"],
                         "Cục trưởng Cục Cảnh sát quản lý hành chính về trật tự xã hội")

    def test_identity_qr_parser_and_decoder(self):
        import numpy as np
        import zxingcpp
        from PIL import Image
        payload = ("012345678901|123456789|NGUYỄN VĂN MẪU|02031990|Nam|"
                   "Phường Mẫu, Thành phố Thử Nghiệm|05062021")
        parsed = parse_identity_qr(payload)
        if parsed is None:
            self.fail("Synthetic QR payload should parse")
        self.assertEqual(parsed["fullName"], "NGUYỄN VĂN MẪU")
        self.assertEqual(parsed["birthdate"], "1990-03-02")
        self.assertIsNone(parse_identity_qr(payload.replace("012345678901", "bad")))
        barcode = zxingcpp.create_barcode(payload, zxingcpp.BarcodeFormat.QRCode)
        image = Image.fromarray(np.asarray(zxingcpp.write_barcode_to_image(barcode, size_hint=600)))
        output = io.BytesIO()
        image.rotate(90, expand=True).save(output, "PNG")
        self.assertEqual(read_identity_qr(output.getvalue()), parsed)

    def test_small_printed_qr_survives_high_resolution_retry(self):
        import numpy as np
        import zxingcpp
        from PIL import Image
        payload = ("012345678901|123456789|NGUYỄN VĂN MẪU|02031990|Nam|"
                   "Phường Mẫu, Thành phố Thử Nghiệm|05062021")
        barcode = zxingcpp.create_barcode(payload, zxingcpp.BarcodeFormat.QRCode)
        qr = Image.fromarray(np.asarray(zxingcpp.write_barcode_to_image(barcode, size_hint=600)))
        card = Image.new("RGB", (1920, 2560), "white")
        card.paste(qr.resize((80, 80), Image.Resampling.NEAREST), (1300, 1900))
        output = io.BytesIO()
        card.save(output, "JPEG", quality=85)
        self.assertEqual(read_identity_qr(output.getvalue()), parse_identity_qr(payload))

    def test_qr_requires_visible_number_match_and_flags_conflicting_dates(self):
        qr = parse_identity_qr("012345678901|123456789|NGUYỄN VĂN MẪU|02031990|Nam|"
                               "Phường Mẫu, Thành phố Thử Nghiệm|05062021")
        data = lines(["CĂN CƯỚC CÔNG DÂN", "Số: 012345678901",
                      "Ngày sinh: 02/03/1990", "Quốc tịch: Vit Nam",
                      "Quê quán: Phường Mẫu"])
        data += lines(["Ngày cấp: 05/06/2021", "Nơi cấp: CỤC KIỂM THỬ"], "back")
        result = IdentityCardHandler().extract(data, qr_fields=qr)
        self.assertEqual(result.fields["fullName"], "NGUYỄN VĂN MẪU")
        self.assertEqual(result.fields["address"], "Phường Mẫu, Thành phố Thử Nghiệm")
        self.assertEqual(result.fields["nationality"], "Việt Nam")
        self.assertNotIn("address", IdentityCardHandler().extract(
            lines(["CĂN CƯỚC", "Số: 012345678902"]), qr_fields=qr).fields)
        conflicted = IdentityCardHandler().extract(
            lines(["CĂN CƯỚC", "Số: 012345678901", "Ngày sinh: 03/03/1990"]),
            qr_fields=qr)
        self.assertEqual(conflicted.fields["birthdate"], "1990-03-02")
        self.assertTrue(any("ngày sinh" in warning and "không khớp" in warning
                            for warning in conflicted.warnings))

    def test_qr_can_use_matching_reverse_number_when_front_number_is_unreadable(self):
        qr = parse_identity_qr("012345678901|123456789|NGUYỄN VĂN MẪU|02031990|Nam|"
                               "Phường Mẫu, Thành phố Thử Nghiệm|05062021")
        front = lines(["CĂN CƯỚC", "Số: 01234567890?", "Ngày sinh: 02/03/1990"])
        back = lines(["Số: 012345678901", "Ngày cấp: 05/06/2021"], "back")
        result = IdentityCardHandler().extract(front + back, qr_fields=qr)
        self.assertEqual(result.fields["number"], "012345678901")
        self.assertEqual(result.fields["fullName"], "NGUYỄN VĂN MẪU")
        self.assertTrue(any("mặt sau" in warning for warning in result.warnings))
        # A conflicting printed number, including one of several numbers on
        # the front, must never authorize QR suggestions.
        conflict = IdentityCardHandler().extract(front + lines(["Số: 012345678902"], "back"), qr_fields=qr)
        self.assertNotIn("number", conflict.fields)
        ambiguous = IdentityCardHandler().extract(
            lines(["CĂN CƯỚC", "012345678901 012345678902"]) + back, qr_fields=qr)
        self.assertNotIn("fullName", ambiguous.fields)

    def test_confirmed_qr_recovers_card_when_header_is_unreadable(self):
        qr = parse_identity_qr("012345678901|123456789|NGUYỄN VĂN MẪU|02031990|Nam|"
                               "Phường Mẫu, Thành phố Thử Nghiệm|05062021")
        result = IdentityCardHandler().extract(
            lines(["Số: 012345678901", "Ngày sinh: 02/03/1990"]), qr_fields=qr)
        self.assertEqual(result.fields["fullName"], "NGUYỄN VĂN MẪU")
        self.assertEqual(IdentityCardHandler().extract(
            lines(["Số: 012345678901", "Ngày sinh: 02/03/1990"])).fields, {})

    def test_qr_is_merged_through_service_only_after_visible_number(self):
        qr = parse_identity_qr("012345678901|123456789|NGUYỄN VĂN MẪU|02031990|Nam|"
                               "Phường Mẫu, Thành phố Thử Nghiệm|05062021")
        class Engine:
            def read(self, data, side, rotation=0):
                if side == "front":
                    return lines(["CĂN CƯỚC CÔNG DÂN", "Số: 012345678901",
                                  "Ngày sinh: 02/03/1990"], side)
                return lines(["Ngày cấp: 05/06/2021"], side)
        with patch("app.services.read_identity_qr", return_value=qr):
            result = OcrService(Engine()).recognize(
                OcrInput(document_type="vn_identity_card"),
                {"front": b"image", "back": b"image"})
        self.assertEqual(result.fields["fullName"], "NGUYỄN VĂN MẪU")
        self.assertIn("address", result.fields)

    def test_place_quality_rejects_foreign_ocr_glyphs(self):
        self.assertFalse(plausible_vietnamese_place("Phường Çhử, Tỉnh Mẫu ề"))
        self.assertTrue(plausible_vietnamese_place("Phường Mẫu, Thành phố Thử Nghiệm"))

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

    def test_soft_deadline_returns_timeout_and_releases_lock(self):
        class Engine:
            def read(self, data, side, rotation=0):
                time.sleep(.06)
                return []
        service = OcrService(Engine())
        service.timeout_seconds = .02
        with self.assertRaises(ApiError) as ctx:
            service.recognize(OcrInput(document_type="document"), {"front": b"test"})
        self.assertEqual(ctx.exception.status, 504)
        self.assertEqual(ctx.exception.code, "ERR_OCR_TIMEOUT")
        self.assertFalse(service.lock.locked())

    def test_hard_watchdog_exits_a_stuck_worker(self):
        script = """
import time
from app.services import OcrService
from app.schemas import OcrInput
class Engine:
    def read(self, data, side, rotation=0):
        time.sleep(1)
service = OcrService(Engine())
service.timeout_seconds = .02
service.hard_timeout_grace_seconds = .02
service.recognize(OcrInput(document_type='document'), {'front': b'test'})
"""
        completed = subprocess.run([sys.executable, "-c", script], capture_output=True,
                                   text=True, timeout=3, check=False)
        self.assertEqual(completed.returncode, 124)

    def test_rotated_front_and_back_are_selected_independently(self):
        calls = []
        class Engine:
            def read(self, data, side, rotation=0):
                calls.append((side, rotation))
                if side == "front" and rotation == 270:
                    return lines(["CĂN CƯỚC CÔNG DÂN", "Số: 012345678901", "Họ và tên: NGUYỄN VĂN A"], side)
                if side == "back" and rotation == 90:
                    return lines(["Ngày cấp: 05/06/2021", "Nơi cấp: BỘ CÔNG AN"], side)
                return []
        result = OcrService(Engine()).recognize(
            OcrInput(document_type="vn_identity_card"), {"front": b"image", "back": b"image"})
        self.assertEqual(result.fields["number"], "012345678901")
        self.assertEqual(result.fields["issuedDate"], "2021-06-05")
        self.assertIn(("front", 270), calls)
        self.assertIn(("back", 90), calls)
        self.assertNotIn(("back", 270), calls)

    def test_false_name_does_not_stop_orientation_search(self):
        calls = []
        class Engine:
            def read(self, data, side, rotation=0):
                calls.append((side, rotation))
                if side == "front" and rotation == 90:
                    return lines(["CĂN CƯỚC CÔNG DÂN", "Số: 012345678901",
                                  "Họ và tên: NGUYỄN VĂN AN", "Ngày sinh: 01/02/1988"], side)
                if side == "front":
                    return lines(["CĂN CƯỚC CÔNG DÂN", "Số: 012345678901",
                                  "Họ và tên: SN"], side)
                return lines(["Ngày cấp: 27/04/2021"], side)
        result = OcrService(Engine()).recognize(
            OcrInput(document_type="vn_identity_card"), {"front": b"image", "back": b"image"})
        self.assertEqual(result.fields["fullName"], "NGUYỄN VĂN AN")
        self.assertEqual(result.fields["birthdate"], "1988-02-01")
        self.assertIn(("front", 90), calls)

    def test_upright_number_and_dates_skip_extra_full_card_passes(self):
        calls = []
        class Engine:
            def read(self, data, side, rotation=0):
                calls.append((side, rotation))
                if side == "front":
                    return lines(["CĂN CƯỚC", "Số: 012345678901",
                                  "Ngày sinh: 02/03/1990", "Họ và tên: SN"], side)
                return lines(["Ngày cấp: 05/06/2021"], side)
        with patch("app.services.read_identity_qr", return_value=None):
            result = OcrService(Engine()).recognize(
                OcrInput(document_type="vn_identity_card"),
                {"front": b"image", "back": b"image"})
        self.assertEqual(calls, [("front", 0), ("back", 0)])
        self.assertNotIn("fullName", result.fields)

    def test_sideways_lines_force_orientation_search_even_with_number_and_date(self):
        calls = []
        class Engine:
            def read(self, data, side, rotation=0):
                calls.append((side, rotation))
                if side == "front" and rotation == 0:
                    return [TextLine("CĂN CƯỚC", .9, side, True),
                            TextLine("Số: 012345678901", .9, side, True),
                            TextLine("Ngày sinh: 02/03/1990", .9, side, True)]
                if side == "front" and rotation == 270:
                    return lines(["CĂN CƯỚC", "Số: 012345678901",
                                  "Ngày sinh: 02/03/1990", "Họ và tên: NGUYỄN VĂN AN"], side)
                if side == "back" and rotation == 0:
                    return [TextLine("Ngày cấp: 05/06/2021", .9, side, True)]
                if side == "back" and rotation == 90:
                    return lines(["Ngày cấp: 05/06/2021", "Nơi cấp: BỘ CÔNG AN"], side)
                return []
        with patch("app.services.read_identity_qr", return_value=None):
            result = OcrService(Engine()).recognize(
                OcrInput(document_type="vn_identity_card"),
                {"front": b"image", "back": b"image"})
        self.assertEqual(result.fields["fullName"], "NGUYỄN VĂN AN")
        self.assertIn(("front", 270), calls)
        self.assertIn(("back", 90), calls)

    def test_vietnamese_fragment_cannot_erase_paddle_field_label(self):
        from app.engine import PaddleEngine
        merged = PaddleEngine.merge_readers(
            [("Quê quán / Place of origin:", .96, (10, 10, 400, 60))],
            [("Place of orlgin", .93, (10, 10, 400, 60))])
        self.assertEqual([item[0] for item in merged], ["Quê quán / Place of origin:"])


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"CORE_OCR_SERVICE_TOKEN": "test-only-secret"})
        self.env.start()
        self.addCleanup(self.env.stop)
        app = create_app(use_engine=False)
        class Engine:
            def read(self, data, side, rotation=0):
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

    def test_sparse_vietnamese_fragment_does_not_erase_full_paddle_line(self):
        from app.engine import PaddleEngine
        paddle = [("NGUYEN VAN AN", .95, (0, 0, 200, 30))]
        sparse = [("SN", .65, (0, 0, 200, 30))]
        self.assertEqual(PaddleEngine.merge_readers(paddle, sparse), paddle)
        complete = [("NGUYỄN VĂN AN", .88, (0, 0, 200, 30))]
        self.assertEqual(PaddleEngine.merge_readers(paddle, complete), complete)
        paddle_date = [("02/03/1990", .98, (0, 40, 200, 70))]
        short_date = [("02/03/90", .97, (0, 40, 200, 70))]
        self.assertEqual(PaddleEngine.merge_readers(paddle_date, short_date), paddle_date)
        clipped = [("NGUYỄN VĂN AN", .95, (65, 0, 200, 30))]
        self.assertLess(PaddleEngine.merge_readers(paddle, clipped)[0][1], .80)


if __name__ == "__main__":
    unittest.main()
