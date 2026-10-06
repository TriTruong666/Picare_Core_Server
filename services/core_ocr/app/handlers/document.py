from ..schemas import OcrResult


class DocumentHandler:
    required_sides = ("front",)

    def extract(self, lines):
        return OcrResult(documentType="document", fields={
            "text": "\n".join(line.text for line in lines)
        }, confidence={}, warnings=[] if lines else ["Không đọc được chữ trong ảnh."])
