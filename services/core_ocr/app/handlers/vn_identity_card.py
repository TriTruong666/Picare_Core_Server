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
    "expiryDate": ("co gia tri den", "co gia tr den", "ngay het han", "date of expiry"),
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


def plausible_name(value, score):
    # A two-letter OCR fragment such as "SN" is not a person's full name.
    # Reject uncertain suggestions instead of overwriting the member's name.
    if score < .80 or re.search(r"\d", value) or label_for(value) or is_header(value):
        return False
    words = re.findall(r"[^\W\d_]+", value, re.UNICODE)
    return len(words) >= 2 and sum(map(len, words)) >= 4 and all(len(word) >= 2 for word in words)


def plausible_address(value, minimum_letters=8):
    # A few isolated glyphs are commonly produced by OCR on a busy card.
    return len(re.findall(r"[^\W\d_]", value, re.UNICODE)) >= minimum_letters


def plausible_vietnamese_place(value):
    # Reject recognizer artifacts such as cedillas or isolated accent glyphs;
    # OCR confidence can still be high for those wrong characters.
    allowed_marks = {"\u0300", "\u0301", "\u0303", "\u0309", "\u0323", "\u0302", "\u0306", "\u031b"}
    for char in unicodedata.normalize("NFD", value):
        if unicodedata.category(char) == "Mn" and char not in allowed_marks:
            return False
    words = re.findall(r"[^\W\d_]+", value, re.UNICODE)
    return len(words) >= 2 and all(len(word) >= 2 for word in words)


def is_header(value):
    norm = folded(value)
    return any(mark in norm for mark in (
        "socialist republic", "cong hoa xa hoi", "independence", "freedom",
        "doc lap", "hanh phuc", "identity card", "can cuoc cong dan",
    ))


class IdentityCardHandler:
    required_sides = ("front", "back")

    @staticmethod
    def refine_regions(fields, confidence, regions, warnings):
        origin = regions.get("placeOfOrigin", "")
        origin_lines = [line.strip(" \t'\"`_.,;:-") for line in origin.splitlines()]
        label_index = next((index for index, line in enumerate(origin_lines)
                            if "que quan" in folded(line)), None)
        if "placeOfOrigin" not in fields and label_index is not None:
            # Only the first text line after the printed label is the origin;
            # the following line already belongs to the residence address.
            for candidate in origin_lines[label_index + 1:label_index + 3]:
                if not candidate:
                    continue
                if label_for(candidate) or is_header(candidate) or date_value(candidate):
                    break
                candidate = candidate.strip(" \t'\"`_.,;:-")
                if ("," in candidate and plausible_vietnamese_place(candidate)
                        and plausible_address(candidate, 10)):
                    fields["placeOfOrigin"] = candidate[:500]
                    confidence["placeOfOrigin"] = .86
                    warnings.append("Quê quán được đọc từ vùng chữ trên thẻ; vui lòng đối chiếu lại dấu và địa danh.")
                break

        issuer = re.sub(r"[^a-z0-9]+", " ", folded(regions.get("issuedPlace", "")))
        if ("issuedPlace" not in fields and "cuc truong cuc" in issuer
                and "canh sat" in issuer and "hanh chinh" in issuer
                and "trat tu xa hoi" in issuer):
            # All parts must be visible. This normalizes OCR diacritic errors
            # against the complete agency title printed on the reverse side.
            fields["issuedPlace"] = (
                "Cục trưởng Cục Cảnh sát quản lý hành chính về trật tự xã hội"
            )
            confidence["issuedPlace"] = .86
            warnings.append("Nơi cấp được chuẩn hóa từ dòng cơ quan trên mặt sau; vui lòng đối chiếu với thẻ.")

    def extract(self, lines, qr_fields=None, regions=None):
        fields, confidence, warnings = {}, {}, []
        rejected_fields = set()
        front = [line for line in lines if line.side == "front"]
        back = [line for line in lines if line.side == "back"]
        front_text = " ".join(line.text for line in front)
        numbers = set(re.findall(r"(?<!\d)\d{12}(?!\d)", front_text))
        reverse_numbers = set(re.findall(r"(?<!\d)\d{12}(?!\d)", " ".join(line.text for line in back)))
        has_card_label = any(mark in folded(front_text) for mark in
                             ("can cuoc", "identity card", "ho va ten", "full name"))
        qr_confirmed = qr_fields and (numbers == {qr_fields["number"]}
                                      or (not numbers and reverse_numbers == {qr_fields["number"]}))
        if not has_card_label and not qr_confirmed:
            return OcrResult(documentType="vn_identity_card", fields={}, confidence={},
                             warnings=["Chưa nhận diện được mặt trước căn cước. Kiểm tra ảnh hoặc nhập tay."])

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
                if field in ("fullName", "birthdate", "issuedDate", "expiryDate"):
                    candidates = [(value, line.score)]
                    for following in source[index + 1:index + 4]:
                        if label_for(following.text) or is_header(following.text):
                            break
                        candidates.append((following.text.strip(), following.score))
                    for candidate, score in candidates:
                        if field == "fullName":
                            parsed = candidate if plausible_name(candidate, score) else None
                        else:
                            parsed = date_value(candidate)
                        if parsed:
                            fields[field], confidence[field] = parsed[:500], round(score, 4)
                            break
                    if field in fields:
                        break
                    rejected_fields.add(field)
                    continue
                # Addresses may span lines. Stop at the next label/header/date.
                for following in source[index + 1:index + 4]:
                    other = label_for(following.text)
                    if other and other != field:
                        break
                    if is_header(following.text):
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
                if field == "gender":
                    norm = folded(value or "")
                    value = "FEMALE" if re.search(r"\b(nu|female)\b", norm) else "MALE" if re.search(r"\b(nam|male)\b", norm) else None
                elif field in ("address", "placeOfOrigin") and not plausible_address(
                    value or "", 5 if field == "placeOfOrigin" else 8
                ):
                    value = None
                if value:
                    fields[field], confidence[field] = value.strip(" '\".,:;-")[:500], round(min(scores), 4)
                    break
                rejected_fields.add(field)

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
        if fields.get("number") and reverse_numbers and fields["number"] not in reverse_numbers:
            warnings.append("Số nhận diện ở hai mặt không khớp. Vui lòng kiểm tra lại hai ảnh.")
        if qr_fields:
            qr_number = qr_fields["number"]
            # When the front number is unreadable, the printed number on the
            # reverse can independently bind the QR to this pair of photos.
            # Never use QR if the front has conflicting or ambiguous numbers.
            reverse_match = (not numbers and reverse_numbers == {qr_number})
            if fields.get("number") != qr_number and not reverse_match:
                warnings.append("Không đối chiếu được số căn cước với mã QR; không dùng dữ liệu QR.")
            else:
                if reverse_match:
                    fields["number"] = qr_number
                    confidence["number"] = 1.0
                    warnings.append("Số căn cước được đối chiếu bằng mã QR và mặt sau; vui lòng kiểm tra với mặt trước.")
                for key in ("fullName", "address", "birthdate", "gender", "issuedDate"):
                    value = qr_fields[key]
                    if key in ("birthdate", "gender", "issuedDate") and fields.get(key) and fields[key] != value:
                        label = {"birthdate": "ngày sinh", "gender": "giới tính", "issuedDate": "ngày cấp"}[key]
                        warnings.append(f"Thông tin {label} giữa chữ in và mã QR không khớp; đã gợi ý theo mã QR, vui lòng đối chiếu với thẻ.")
                    if key in ("fullName", "address") and fields.get(key) and fields[key] != value:
                        warnings.append(f"Thông tin {('họ tên' if key == 'fullName' else 'địa chỉ')} được sửa theo mã QR; vui lòng đối chiếu với thẻ.")
                    fields[key], confidence[key] = value, 1.0
                warnings.append("Họ tên và địa chỉ được gợi ý từ mã QR; vui lòng đối chiếu với thẻ trước khi tiếp tục.")

        if "nationality" in fields:
            if folded(fields["nationality"]).strip() in ("viet nam", "vit nam"):
                fields["nationality"] = "Việt Nam"
            else:
                fields.pop("nationality")
                confidence.pop("nationality", None)
        for key, label in (("placeOfOrigin", "quê quán"), ("issuedPlace", "nơi cấp")):
            if key in fields and (confidence.get(key, 0) < .85 or not plausible_vietnamese_place(fields[key])):
                fields.pop(key)
                confidence.pop(key, None)
                warnings.append(f"Chưa đọc rõ {label}; vui lòng kiểm tra hoặc nhập tay.")
        if regions:
            self.refine_regions(fields, confidence, regions, warnings)
            if "placeOfOrigin" in fields:
                warnings = [warning for warning in warnings if not warning.startswith("Chưa đọc rõ quê quán")]
            if "issuedPlace" in fields:
                warnings = [warning for warning in warnings if not warning.startswith("Chưa đọc rõ nơi cấp")]
        for key, label in (("number", "số căn cước"), ("fullName", "họ tên"), ("birthdate", "ngày sinh"), ("issuedDate", "ngày cấp")):
            if key not in fields:
                warnings.append(f"Chưa đọc được {label}; bạn có thể nhập tay.")
        if "address" in rejected_fields and "address" not in fields:
            warnings.append("Địa chỉ trong ảnh chưa đủ rõ; vui lòng nhập hoặc kiểm tra lại.")
        if any(value < .85 for value in confidence.values()):
            warnings.append("Một số thông tin có độ tin cậy thấp; vui lòng kiểm tra trước khi tiếp tục.")
        return OcrResult(documentType="vn_identity_card", fields=fields, confidence=confidence, warnings=warnings)
