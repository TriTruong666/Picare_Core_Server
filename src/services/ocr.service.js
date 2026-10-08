const { BaseException } = require("../common/exceptions/BaseException");
const { imageMime } = require("../schemas/ocr.schema");
const { randomUUID } = require("node:crypto");
const limits = new Map();
let active = 0;
const fail = (message, statusCode, code) =>
  new BaseException({ message, statusCode, code });

class OcrService {
  static async recognize(input) {
    const requestId = randomUUID().replaceAll("-", "");
    const started = Date.now();
    const secret =
      process.env.CORE_OCR_SERVICE_TOKEN ||
      process.env.GRPC_STORAGE_SERVICE_TOKEN;
    if (!secret)
      throw fail("Chưa cấu hình OCR service token", 503, "ERR_OCR_UNAVAILABLE");
    const now = Date.now();
    for (const [key, value] of limits)
      if (now >= value.until) limits.delete(key);
    const limit = limits.get(input.userId) || { count: 0, until: now + 60_000 };
    if (limit.count >= 5 || active >= 2 || limits.size >= 10000)
      throw fail(
        "OCR đang bận hoặc bạn đã thử quá nhiều lần. Vui lòng thử lại sau một phút.",
        429,
        "ERR_OCR_BUSY",
      );
    limit.count++;
    limits.set(input.userId, limit);
    active++;
    console.info(
      `[ocr] request_id=${requestId} status=start document_type=${input.documentType} front_bytes=${input.front?.length || 0} back_bytes=${input.back?.length || 0} timeout_ms=90000`,
    );
    try {
      const form = new FormData();
      form.set("document_type", input.documentType);
      for (const side of ["front", "back"]) {
        if (input[side]?.length)
          form.set(
            side,
            new Blob([input[side]], { type: imageMime(input[side]) }),
            `${side}.image`,
          );
      }
      const base = process.env.CORE_OCR_URL || "http://127.0.0.1:8010";
      const response = await fetch(
        `${base.replace(/\/$/, "")}/api/v1/ocr/recognize`,
        {
          method: "POST",
          body: form,
          headers: { "x-service-token": secret, "x-request-id": requestId },
          signal: AbortSignal.timeout(90_000),
          redirect: "error",
        },
      );
      if (response.status === 429)
        throw fail(
          "OCR đang xử lý ảnh khác. Vui lòng thử lại sau.",
          429,
          "ERR_OCR_BUSY",
        );
      if (response.status === 400 || response.status === 413)
        throw fail(
          "Ảnh không đọc được. Kiểm tra định dạng, kích thước hoặc nhập thông tin thủ công.",
          400,
          "ERR_BAD_REQUEST_001",
        );
      if (response.status === 504)
        throw fail(
          "OCR đã quá thời gian xử lý. Vui lòng thử lại hoặc nhập tay.",
          504,
          "ERR_OCR_TIMEOUT",
        );
      if (!response.ok)
        throw fail(
          "Dịch vụ OCR chưa sẵn sàng. Bạn vẫn có thể nhập thông tin thủ công.",
          503,
          "ERR_OCR_UNAVAILABLE",
        );
      const body = await response.json();
      if (
        !body.success ||
        !body.data?.fields ||
        body.data.documentType !== input.documentType
      )
        throw fail("Kết quả OCR không hợp lệ", 503, "ERR_OCR_UNAVAILABLE");
      console.info(
        `[ocr] request_id=${requestId} status=ok elapsed_ms=${Date.now() - started} fields=${Object.keys(body.data.fields).length} warnings=${body.data.warnings?.length || 0}`,
      );
      return body.data;
    } catch (error) {
      console.warn(
        `[ocr] request_id=${requestId} status=error code=${error.errorCode || (error?.name === "TimeoutError" ? "ERR_OCR_TIMEOUT" : "ERR_OCR_UNAVAILABLE")} elapsed_ms=${Date.now() - started}`,
      );
      if (error instanceof BaseException) throw error;
      if (error?.name === "TimeoutError")
        throw fail(
          "OCR đã quá thời gian xử lý. Vui lòng thử lại hoặc nhập tay.",
          504,
          "ERR_OCR_TIMEOUT",
        );
      throw fail(
        "Không kết nối được OCR hoặc đã quá thời gian chờ. Bạn có thể thử lại hoặc nhập tay.",
        503,
        "ERR_OCR_UNAVAILABLE",
      );
    } finally {
      active--;
    }
  }
}
module.exports = OcrService;
