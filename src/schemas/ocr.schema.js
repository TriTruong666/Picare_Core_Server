const { BadRequestException } = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");

function imageMime(buffer) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < 12 ||
    buffer.length > 10 * 1024 * 1024
  )
    return null;
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return "image/jpeg";
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}

function validate(request) {
  const fail = () => {
    throw new BadRequestException({
      ...ErrorCodes.BAD_REQUEST,
      message:
        "Ảnh OCR hoặc loại tài liệu không hợp lệ (PNG/JPEG/WEBP, tối đa 10 MB mỗi ảnh)",
    });
  };
  if (
    !["vn_identity_card", "document"].includes(request.documentType) ||
    typeof request.userId !== "string" ||
    !request.userId ||
    request.userId.length > 255
  )
    fail();
  if (!imageMime(request.front)) fail();
  if (request.documentType === "vn_identity_card" && !imageMime(request.back))
    fail();
  if (request.back?.length && !imageMime(request.back)) fail();
  return request;
}
module.exports = { validate, imageMime };
