const grpc = require("@grpc/grpc-js");
const { timingSafeEqual } = require("node:crypto");
const schema = require("../schemas/ocr.schema");
const service = require("../services/ocr.service");

exports.recognize = async (call, callback) => {
  const expected = Buffer.from(
    process.env.GRPC_OCR_SERVICE_TOKEN ||
      process.env.GRPC_STORAGE_SERVICE_TOKEN ||
      "",
  );
  const provided = Buffer.from(
    String(call.metadata?.get("x-service-token")?.[0] || ""),
  );
  if (
    !expected.length ||
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  )
    return callback({
      code: grpc.status.UNAUTHENTICATED,
      details: "OCR service token không hợp lệ",
    });
  try {
    const data = await service.recognize(schema.validate(call.request || {}));
    callback(null, {
      success: true,
      message: "Thành công",
      dataJson: JSON.stringify(data),
    });
  } catch (error) {
    const code =
      error.statusCode === 400
        ? grpc.status.INVALID_ARGUMENT
        : error.statusCode === 429
          ? grpc.status.RESOURCE_EXHAUSTED
          : grpc.status.UNAVAILABLE;
    callback({
      code,
      details: error.statusCode ? error.message : "Dịch vụ OCR chưa sẵn sàng",
    });
  }
};
