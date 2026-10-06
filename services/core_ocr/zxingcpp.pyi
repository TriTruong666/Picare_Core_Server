"""Minimal typing for the installed native zxing-cpp extension."""

from typing import Any


class BarcodeFormat:
    QRCode: Any


class Barcode:
    text: str
    format: Any


def read_barcodes(image: Any) -> list[Barcode]: ...
def create_barcode(content: str, format: Any, ec_level: str = "") -> Barcode: ...
def write_barcode_to_image(
    barcode: Barcode,
    size_hint: int = 0,
    with_hrt: bool = False,
    with_quiet_zones: bool = True,
) -> Any: ...
