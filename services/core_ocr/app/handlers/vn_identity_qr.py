"""Decode locally printed CCCD QR data as editable suggestions, not identity proof."""

import io
import re
from datetime import datetime

import numpy as np
import zxingcpp
from PIL import Image, ImageOps

from .vn_identity_card import folded, plausible_name


def qr_date(value):
    if not re.fullmatch(r"\d{8}", value):
        return None
    try:
        return datetime.strptime(value, "%d%m%Y").date().isoformat()
    except ValueError:
        return None


def parse_identity_qr(value):
    # Printed Vietnamese identity QR: number|old number|name|DDMMYYYY|sex|address|DDMMYYYY.
    parts = [part.strip() for part in value.split("|")]
    if len(parts) != 7 or any(len(part) > 500 for part in parts):
        return None
    number, old_number, name, born, sex, address, issued = parts
    if not re.fullmatch(r"\d{12}", number):
        return None
    if old_number and not re.fullmatch(r"\d{9,12}", old_number):
        return None
    birthdate, issued_date = qr_date(born), qr_date(issued)
    if not birthdate or not issued_date or not plausible_name(name, 1.0):
        return None
    if len(re.findall(r"[^\W\d_]", address, re.UNICODE)) < 8:
        return None
    gender = {"nam": "MALE", "nu": "FEMALE"}.get(folded(sex))
    if gender is None:
        return None
    return {
        "number": number,
        "fullName": name,
        "birthdate": birthdate,
        "gender": gender,
        "address": address,
        "issuedDate": issued_date,
    }


def read_identity_qr(data):
    try:
        with Image.open(io.BytesIO(data)) as source:
            if source.format not in ("JPEG", "PNG", "WEBP") or source.width * source.height > 20_000_000:
                return None
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((2200, 2200))
            barcodes = zxingcpp.read_barcodes(np.asarray(image))
    except (OSError, ValueError, RuntimeError, Image.DecompressionBombError):
        return None
    parsed = [parse_identity_qr(barcode.text) for barcode in barcodes
              if barcode.format == zxingcpp.BarcodeFormat.QRCode]
    parsed = [value for value in parsed if value is not None]
    return parsed[0] if len(parsed) == 1 else None
