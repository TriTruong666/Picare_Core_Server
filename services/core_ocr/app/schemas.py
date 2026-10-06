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


class OcrResult(BaseModel):
    documentType: str
    fields: dict[str, str]
    confidence: dict[str, float]
    warnings: list[str]
    extractorVersion: str = "1.3.1"
