"""Offline model smoke test. Only synthetic text, no personal documents or saved images."""
import io
import json
import sys
from PIL import Image, ImageDraw, ImageFont
from app.engine import PaddleEngine
from app.handlers.vn_identity_card import IdentityCardHandler

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
