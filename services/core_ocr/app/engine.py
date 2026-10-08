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
        paddle_boxes = []
        for result in self.model.predict(image):
            scores, texts = result.get("rec_scores", []), result.get("rec_texts", [])
            boxes = result.get("rec_boxes", [])
            items.extend(zip(texts, scores, boxes))
            paddle_boxes.extend(boxes)
        tall = sum(float(box[3] - box[1]) > 2 * float(box[2] - box[0]) for box in paddle_boxes)
        wide = sum(float(box[2] - box[0]) > 2 * float(box[3] - box[1]) for box in paddle_boxes)
        image_sideways = tall >= 4 and tall >= 2 * wide
        # The upstream Latin dictionary lacks many accented Vietnamese capitals.
        # A local Vietnamese recognizer supplies complete glyphs; never restore
        # accents by guessing names. Paddle remains the detector/fallback reader.
        vietnamese = [] if image_sideways else self.read_vietnamese(image)
        if vietnamese:
            items = self.merge_readers(items, vietnamese)
        items.sort(key=lambda item: (round(float(item[2][1]) / 12), float(item[2][0])))
        return [TextLine(str(text).strip(), float(score), side, image_sideways,
                         tuple(map(int, box)))
                for text, score, box in items if str(text).strip()]

    def read_identity_regions(self, data, side, rotation=0, lines=None):
        """Re-read small, known text areas only after the card orientation is chosen.

        This is a fallback for the two fields that the full-card detector often
        merges with neighbouring labels. It does not replace the main OCR pass.
        """
        image = self.decode(data)
        if rotation:
            image = np.rot90(image, k=rotation // 90).copy()
        height, width = image.shape[:2]
        lines = lines or []
        regions = {}
        if side == "front":
            from .handlers.vn_identity_card import label_for
            label = next((line for line in lines if line.box and label_for(line.text) == "placeOfOrigin"), None)
            if label:
                x0, y0, x1, y1 = label.box
                candidates = [line for line in lines if line.box and line is not label
                              and label_for(line.text) is None
                              and abs(line.box[0] - x0) < .12 * width
                              and y1 - .3 * (y1 - y0) <= line.box[1] <= y1 + 2 * (y1 - y0)]
                if candidates:
                    candidate = min(candidates, key=lambda line: line.box[1])
                    left, top, right, bottom = candidate.box
                    regions["placeOfOrigin"] = (
                        max(0, left - 30), max(0, top - 4),
                        min(width, right + 30), min(height, bottom + 4), "7")
        else:
            from .handlers.vn_identity_card import date_value
            date_line = next((line for line in lines if line.box and date_value(line.text)), None)
            if date_line:
                x0, y0, x1, y1 = date_line.box
                regions["issuedPlace"] = (
                    max(0, x0 + int(.09 * width)), max(0, y1 - 20),
                    min(width, x1 + int(.05 * width)), min(height, y1 + int(.10 * height)), "6")
        if not regions and 1.4 <= width / height <= 1.8:
            fallback = ({"placeOfOrigin": (.27, .72, .88, .91)} if side == "front"
                        else {"issuedPlace": (.11, .15, .49, .32)})
            regions = {field: (int(l * width), int(t * height),
                               int(r * width), int(b * height), "6")
                       for field, (l, t, r, b) in fallback.items()}
        output = {}
        for field, (left, top, right, bottom, psm) in regions.items():
            crop = image[top:bottom, left:right]
            if crop.size == 0:
                continue
            encoded = io.BytesIO()
            Image.fromarray(crop[:, :, ::-1]).save(encoded, "PNG")
            try:
                result = subprocess.run(
                    ["tesseract", "stdin", "stdout", "-l", "vie+eng", "--psm", psm],
                    input=encoded.getvalue(), capture_output=True, timeout=10, check=True,
                )
                value = result.stdout.decode("utf-8", errors="replace")
                output[field] = f"Quê quán:\n{value}" if field == "placeOfOrigin" and psm == "7" else value
            except (subprocess.SubprocessError, OSError):
                continue
        return output

    @classmethod
    def merge_readers(cls, paddle, vietnamese):
        # A sparse Tesseract fragment must not erase a fuller Paddle line.
        # Tesseract still wins for complete Vietnamese text with diacritics.
        from .handlers.vn_identity_card import label_for
        accepted = []
        for text, score, box in vietnamese:
            covered = [item for item in paddle if cls.overlaps(item[2], box)]
            if any(label_for(str(item[0])) and label_for(str(item[0])) != label_for(str(text))
                   for item in covered):
                continue
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
