from dataclasses import dataclass
from typing import Literal
from pydantic import BaseModel, ConfigDict


class OcrInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_type: Literal["vn_identity_card", "document"]


@dataclass(frozen=True)
class TextLine:
    text: str
    score: float
    side: str
    image_sideways: bool = False
    box: tuple[int, int, int, int] | None = None


class OcrResult(BaseModel):
    documentType: str
    fields: dict[str, str]
    confidence: dict[str, float]
    warnings: list[str]
    extractorVersion: str = "1.4.3"
