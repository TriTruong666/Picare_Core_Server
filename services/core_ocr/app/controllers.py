from .common import success, ApiError


def recognize(service, schema, front, back):
    images = {}
    for side, upload in (("front", front), ("back", back)):
        if upload:
            images[side] = upload.file.read(10 * 1024 * 1024 + 1)
    if service is None:
        raise ApiError("OCR chưa sẵn sàng", 503, "ERR_OCR_UNAVAILABLE")
    return success(service.recognize(schema, images).model_dump())
