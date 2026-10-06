"""Build-time downloads only. Runtime always uses these explicit local directories."""
import os
import shutil
from pathlib import Path
from app.engine import PaddleEngine, MODEL_NAMES

PaddleEngine(download=True)
root = Path(os.environ.get("OCR_MODEL_DIR", "/opt/ocr-models"))
root.mkdir(parents=True, exist_ok=True)
for name in MODEL_NAMES:
    source = Path.home() / ".paddlex" / "official_models" / name
    if not (source / "inference.yml").is_file():
        raise RuntimeError(f"Model not downloaded: {name}")
    shutil.copytree(source, root / name, dirs_exist_ok=True)
# Verify that the image can initialize using local model paths.
PaddleEngine()
