import io
import os
import warnings
import csv
import re
import subprocess
from pathlib import Path
from PIL import Image, ImageOps
import numpy as np
from .common import ApiError
from .schemas import TextLine

Image.MAX_IMAGE_PIXELS = 20_000_000
MODEL_NAMES = ("PP-OCRv5_mobile_det", "latin_PP-OCRv5_mobile_rec")


class PaddleEngine:
    def __init__(self, download=False):
        from paddleocr import PaddleOCR
        root = Path(os.environ.get("OCR_MODEL_DIR", "/opt/ocr-models"))
        options = {}
        if not download:
            for option, name in zip(("text_detection_model_dir", "text_recognition_model_dir"), MODEL_NAMES):
                path = root / name
                if not (path / "inference.yml").is_file():
                    raise RuntimeError("OCR models missing; build the OCR image first")
                options[option] = str(path)
        self.model = PaddleOCR(
            text_detection_model_name=MODEL_NAMES[0],
            text_recognition_model_name=MODEL_NAMES[1],
            use_doc_orientation_classify=False, use_doc_unwarping=False,
            use_textline_orientation=False, device="cpu",
            enable_mkldnn=False, cpu_threads=int(os.environ.get("OCR_CPU_THREADS", "2")),
            **options,
        )

    @staticmethod
    def decode(data):
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data)) as source:
                    if source.format not in ("JPEG", "PNG", "WEBP") or getattr(source, "n_frames", 1) != 1:
                        raise ValueError()
                    if source.width * source.height > 20_000_000 or min(source.size) < 100:
                        raise ValueError()
                    image = ImageOps.exif_transpose(source).convert("RGB")
                    image.thumbnail((2200, 2200))
                    return np.asarray(image)[:, :, ::-1].copy()
        except Exception:
            raise ApiError("Ảnh không hợp lệ. Dùng JPEG, PNG hoặc WEBP, tối đa 20 megapixel.") from None

    def read(self, data, side, rotation=0):
        image = self.decode(data)
        if rotation not in (0, 90, 180, 270):
            raise ValueError("Unsupported image rotation")
        if rotation:
            # Rotate the pixels once for both Paddle and local Tesseract.
            # EXIF orientation was already applied in decode().
            image = np.rot90(image, k=rotation // 90).copy()
        items = []
        for result in self.model.predict(image):
            scores, texts = result.get("rec_scores", []), result.get("rec_texts", [])
            boxes = result.get("rec_boxes", [])
            items.extend(zip(texts, scores, boxes))
        # The upstream Latin dictionary lacks many accented Vietnamese capitals.
        # A local Vietnamese recognizer supplies complete glyphs; never restore
        # accents by guessing names. Paddle remains the detector/fallback reader.
        vietnamese = self.read_vietnamese(image)
        if vietnamese:
            items = self.merge_readers(items, vietnamese)
        items.sort(key=lambda item: (round(float(item[2][1]) / 12), float(item[2][0])))
        return [TextLine(str(text).strip(), float(score), side)
                for text, score, _ in items if str(text).strip()]

    def read_identity_regions(self, data, side, rotation=0):
        """Re-read small, known text areas only after the card orientation is chosen.

        This is a fallback for the two fields that the full-card detector often
        merges with neighbouring labels. It does not replace the main OCR pass.
        """
        image = self.decode(data)
        if rotation:
            image = np.rot90(image, k=rotation // 90).copy()
        height, width = image.shape[:2]
        if not 1.4 <= width / height <= 1.8:
            return {}
        regions = ({"placeOfOrigin": (.27, .72, .88, .91)} if side == "front"
                   else {"issuedPlace": (.11, .15, .49, .32)})
        output = {}
        for field, (left, top, right, bottom) in regions.items():
            crop = image[int(top * height):int(bottom * height),
                         int(left * width):int(right * width)]
            encoded = io.BytesIO()
            Image.fromarray(crop[:, :, ::-1]).save(encoded, "PNG")
            try:
                result = subprocess.run(
                    ["tesseract", "stdin", "stdout", "-l", "vie+eng", "--psm", "6"],
                    input=encoded.getvalue(), capture_output=True, timeout=10, check=True,
                )
                output[field] = result.stdout.decode("utf-8", errors="replace")
            except (subprocess.SubprocessError, OSError):
                continue
        return output

    @classmethod
    def merge_readers(cls, paddle, vietnamese):
        # A sparse Tesseract fragment must not erase a fuller Paddle line.
        # Tesseract still wins for complete Vietnamese text with diacritics.
        accepted = []
        for text, score, box in vietnamese:
            covered = [item for item in paddle if cls.overlaps(item[2], box)]
            paddle_letters = sum(char.isalnum() for item in covered for char in str(item[0]))
            vietnamese_letters = sum(char.isalnum() for char in str(text))
            full_date = r"\b\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{4}\b"
            if re.search(full_date, " ".join(str(item[0]) for item in covered)) and not re.search(full_date, str(text)):
                continue
            if paddle_letters and vietnamese_letters < .6 * paddle_letters:
                continue
            if len(covered) == 1:
                paddle_box = tuple(map(float, covered[0][2]))
                viet_box = tuple(map(float, box))
                paddle_width = max(1.0, paddle_box[2] - paddle_box[0])
                if viet_box[0] - paddle_box[0] > .2 * paddle_width:
                    # The Vietnamese reader missed the start of this line.
                    # Do not report its otherwise high OCR score as a reliable
                    # complete name or other personal field.
                    score = min(float(score), .79)
            accepted.append((text, score, box))
        return accepted + [item for item in paddle
                           if not any(cls.overlaps(item[2], other[2]) for other in accepted)]

    @staticmethod
    def overlaps(a, b):
        # Paddle boxes can be int16; cast before multiplying image areas.
        a, b = tuple(map(float, a)), tuple(map(float, b))
        width = max(0, min(a[2], b[2]) - max(a[0], b[0]))
        height = max(0, min(a[3], b[3]) - max(a[1], b[1]))
        area = max(1, min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])))
        return width * height / area > .4

    @staticmethod
    def read_vietnamese(image):
        encoded = io.BytesIO()
        Image.fromarray(image[:, :, ::-1]).save(encoded, "PNG")
        try:
            result = subprocess.run(["tesseract", "stdin", "stdout", "-l", "vie+eng", "--psm", "11", "tsv"],
                                    input=encoded.getvalue(), capture_output=True, timeout=20, check=True)
        except (subprocess.SubprocessError, OSError):
            return []
        groups = {}
        for row in csv.DictReader(io.StringIO(result.stdout.decode("utf-8")), delimiter="\t", quoting=csv.QUOTE_NONE):
            text = row.get("text", "").strip()
            if not text or int(row["level"]) != 5:
                continue
            key = (row["block_num"], row["par_num"], row["line_num"])
            groups.setdefault(key, []).append(row)
        lines = []
        for rows in groups.values():
            score = min(float(row["conf"]) for row in rows) / 100
            if score < .60:
                continue
            x = min(int(row["left"]) for row in rows)
            y = min(int(row["top"]) for row in rows)
            right = max(int(row["left"]) + int(row["width"]) for row in rows)
            bottom = max(int(row["top"]) + int(row["height"]) for row in rows)
            lines.append((" ".join(row["text"] for row in rows), score, (x, y, right, bottom)))
        return lines
