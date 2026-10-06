"""Offline model smoke test. Only synthetic text, no personal documents or saved images."""
import io
import json
import sys
import numpy as np
import zxingcpp
from PIL import Image, ImageDraw, ImageFont
from app.engine import PaddleEngine
from app.handlers.vn_identity_card import IdentityCardHandler
from app.services import OcrService
from app.schemas import OcrInput

font = ImageFont.truetype(sys.argv[1] if len(sys.argv) > 1 else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 40)


def png(texts):
    image = Image.new("RGB", (1400, 850), "white")
    draw = ImageDraw.Draw(image)
    for index, text in enumerate(texts):
        draw.text((45, 35 + index * 75), text, font=font, fill="black")
    output = io.BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


images = {
    "front": png(["DỮ LIỆU KIỂM THỬ OCR", "CĂN CƯỚC CÔNG DÂN", "Số: 012345678901",
                  "Họ và tên: NGUYỄN VĂN KIỂM THỬ", "Ngày sinh: 02/03/1990", "Giới tính: Nam",
                  "Quốc tịch: Việt Nam", "Nơi thường trú: THÀNH PHỐ KIỂM THỬ"]),
    "back": png(["DỮ LIỆU KIỂM THỬ OCR - MẶT SAU", "Ngày cấp: 05/06/2021", "Nơi cấp: CỤC KIỂM THỬ"]),
}
engine = PaddleEngine()
read = [line for side, data in images.items() for line in engine.read(data, side)]
print(json.dumps([{"side": line.side, "text": line.text, "score": line.score} for line in read], ensure_ascii=False))
result = IdentityCardHandler().extract(read)
assert result.fields.get("number") == "012345678901", result.fields
assert result.fields.get("birthdate") == "1990-03-02", result.fields
assert result.fields.get("fullName") == "NGUYỄN VĂN KIỂM THỬ", result.fields
print(json.dumps(result.model_dump(), ensure_ascii=False))


qr_payload = ("012345678901|123456789|NGUYỄN VĂN KIỂM THỬ|02031990|Nam|"
              "Phường Thử Nghiệm, Thành phố Kiểm Thử|05062021")
barcode = zxingcpp.create_barcode(qr_payload, zxingcpp.BarcodeFormat.QRCode)
qr = Image.fromarray(np.asarray(zxingcpp.write_barcode_to_image(barcode, size_hint=240)))
qr = qr.resize((220, 220), Image.Resampling.NEAREST).convert("RGB")
with Image.open(io.BytesIO(images["front"])) as source:
    front_with_qr = source.copy()
front_with_qr.paste(qr, (1150, 600))
qr_output = io.BytesIO()
front_with_qr.save(qr_output, "PNG")
qr_result = OcrService(engine).recognize(
    OcrInput(document_type="vn_identity_card"),
    {"front": qr_output.getvalue(), "back": images["back"]},
)
assert qr_result.fields.get("fullName") == "NGUYỄN VĂN KIỂM THỬ", qr_result.model_dump()
assert qr_result.fields.get("address") == "Phường Thử Nghiệm, Thành phố Kiểm Thử", qr_result.model_dump()
print(json.dumps({"qrRecognizedFields": sorted(qr_result.fields)}, ensure_ascii=False))


def rotated(data, degrees):
    with Image.open(io.BytesIO(data)) as source:
        output = io.BytesIO()
        source.rotate(degrees, expand=True).save(output, "PNG")
        return output.getvalue()


# Different camera orientations for the two sides, as in real mobile uploads.
for front_angle, back_angle in ((90, 270), (270, 90), (180, 180)):
    parsed = OcrService(engine).recognize(OcrInput(document_type="vn_identity_card"), {
        "front": rotated(images["front"], front_angle),
        "back": rotated(images["back"], back_angle),
    })
    assert parsed.fields.get("number") == "012345678901", (front_angle, back_angle, parsed.model_dump())
    assert parsed.fields.get("birthdate") == "1990-03-02", (front_angle, back_angle, parsed.model_dump())
    assert parsed.fields.get("issuedDate") == "2021-06-05", (front_angle, back_angle, parsed.model_dump())
    print(json.dumps({"frontRotation": front_angle, "backRotation": back_angle,
                      "recognizedFields": sorted(parsed.fields)}, ensure_ascii=False))
