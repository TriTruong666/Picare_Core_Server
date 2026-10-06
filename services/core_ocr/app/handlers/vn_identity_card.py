"""Conservative label-based extraction; no invented values or identity verification."""
import re
import unicodedata
from datetime import datetime
from ..schemas import OcrResult


def folded(text):
    text = text.replace("đ", "d").replace("Đ", "D")
    return "".join(c for c in unicodedata.normalize("NFD", text)
                   if unicodedata.category(c) != "Mn").lower()


LABELS = {
    "fullName": ("ho va ten", "ho, chu dem va ten khai sinh", "ho chu dem va ten khai sinh", "full name"),
    "birthdate": ("ngay sinh", "ngay, thang, nam sinh", "date of birth"),
    "gender": ("gioi tinh", "sex", "gender"),
    "nationality": ("quoc tich", "nationality"),
    "placeOfOrigin": ("que quan", "place of origin"),
    "address": ("noi thuong tru", "noi cu tru", "place of residence"),
    "issuedDate": ("ngay cap", "date of issue"),
    "expiryDate": ("co gia tri den", "ngay het han", "date of expiry"),
    "issuedPlace": ("noi cap", "issuing authority", "place of issue"),
}


def date_value(text):
    match = re.search(r"\b(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})\b", text)
    if not match:
        match = re.search(r"ngay\s*(\d{1,2})\s*thang\s*(\d{1,2})\s*nam\s*(\d{4})", folded(text))
    if match:
        try:
            return datetime.strptime("/".join(match.groups()), "%d/%m/%Y").date().isoformat()
        except ValueError:
            pass
    return None


def label_for(text):
    norm = folded(text)
    for field, labels in LABELS.items():
        if any(label in norm for label in labels):
            return field
    return None


def strip_label(text, field):
    # Match on accent-folded text, preserving the original Vietnamese value.
    norm = folded(text)
    ends = [norm.find(label) + len(label) for label in LABELS[field] if label in norm]
    value = text[max(ends):].lstrip(" :/.-") if ends else text.strip()
    # A neighbouring label may share the same OCR line (Sex / Nationality).
    norm = folded(value)
    other_starts = [norm.find(label) for key, labels in LABELS.items() if key != field
                    for label in labels if label in norm]
    if other_starts:
        value = value[:min(other_starts)]
    return value.strip(" :/.-")


class IdentityCardHandler:
    required_sides = ("front", "back")

    def extract(self, lines):
        fields, confidence, warnings = {}, {}, []
        front = [line for line in lines if line.side == "front"]
        back = [line for line in lines if line.side == "back"]
        front_text = " ".join(line.text for line in front)
        if not any(mark in folded(front_text) for mark in ("can cuoc", "identity card", "ho va ten", "full name")):
            return OcrResult(documentType="vn_identity_card", fields={}, confidence={},
                             warnings=["Chưa nhận diện được mặt trước căn cước. Kiểm tra ảnh hoặc nhập tay."])

        numbers = set(re.findall(r"(?<!\d)\d{12}(?!\d)", front_text))
        if len(numbers) == 1:
            fields["number"] = next(iter(numbers))
            confidence["number"] = min((line.score for line in front if fields["number"] in line.text), default=0)
        elif len(numbers) > 1:
            warnings.append("Có nhiều số căn cước trong ảnh; vui lòng nhập số chính xác.")

        for field in LABELS:
            source = back if field in ("issuedDate", "issuedPlace") else front
            for index, line in enumerate(source):
                if not any(label in folded(line.text) for label in LABELS[field]):
                    continue
                value, scores = strip_label(line.text, field), [line.score]
                # Addresses may span lines. Stop at the next label/header/date.
                for following in source[index + 1:index + 4]:
                    other = label_for(following.text)
                    if other and other != field:
                        break
                    if other == field:
                        fragment = strip_label(following.text, field)
                    elif value and field not in ("address", "placeOfOrigin"):
                        break
                    else:
                        fragment = following.text.strip()
                    if not fragment:
                        continue
                    if field in ("address", "placeOfOrigin") and (date_value(fragment) or "can cuoc" in folded(fragment)):
                        break
                    value = f"{value} {fragment}".strip()
                    scores.append(following.score)
                if field.endswith("Date") or field == "birthdate":
                    value = date_value(value)
                elif field == "gender":
                    norm = folded(value or "")
                    value = "FEMALE" if re.search(r"\b(nu|female)\b", norm) else "MALE" if re.search(r"\b(nam|male)\b", norm) else None
                elif field == "fullName" and (not value or re.search(r"\d", value)):
                    value = None
                if value:
                    fields[field], confidence[field] = value[:500], round(min(scores), 4)
                    break

        # The issue date is commonly printed as 'Ngày ... tháng ... năm ...' on the reverse.
        if "issuedDate" not in fields:
            dated = [(date_value(line.text), line.score) for line in back
                     if "ngay" in folded(line.text) and "thang" in folded(line.text)]
            if len(dated) == 1 and dated[0][0]:
                fields["issuedDate"], confidence["issuedDate"] = dated[0]
        if "issuedPlace" not in fields:
            authorities = [line for line in back if any(name in folded(line.text)
                           for name in ("cuc canh sat", "bo cong an", "giam doc cong an"))]
            if authorities:
                fields["issuedPlace"] = " ".join(line.text for line in authorities)[:500]
                confidence["issuedPlace"] = round(min(line.score for line in authorities), 4)
        reverse_numbers = set(re.findall(r"(?<!\d)\d{12}(?!\d)", " ".join(line.text for line in back)))
        if fields.get("number") and reverse_numbers and fields["number"] not in reverse_numbers:
            warnings.append("Số nhận diện ở hai mặt không khớp. Vui lòng kiểm tra lại hai ảnh.")
        for key, label in (("number", "số căn cước"), ("fullName", "họ tên"), ("birthdate", "ngày sinh"), ("issuedDate", "ngày cấp")):
            if key not in fields:
                warnings.append(f"Chưa đọc được {label}; bạn có thể nhập tay.")
        if any(value < .85 for value in confidence.values()):
            warnings.append("Một số thông tin có độ tin cậy thấp; vui lòng kiểm tra trước khi tiếp tục.")
        return OcrResult(documentType="vn_identity_card", fields=fields, confidence=confidence, warnings=warnings)
