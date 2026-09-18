const grpc = require("@grpc/grpc-js");
const MailService = require("./mail.service");

const required = [
  "to",
  "signerName",
  "returnId",
  "orderId",
  "actionUrl",
  "expiresAt",
];

module.exports = {
  async sendOrderReturnSigningMail(call, callback) {
    try {
      const request = call.request || {};
      const missing = required.filter(
        (field) => !String(request[field] || "").trim(),
      );
      if (missing.length) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          details: `Thiếu dữ liệu gửi mail: ${missing.join(", ")}`,
        });
      }
      const expiresAt = new Date(request.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          details: "expiresAt không hợp lệ",
        });
      }
      const result = await MailService.sendOrderReturnSigningMail(request);
      callback(null, {
        success: true,
        message: "Đã gửi email yêu cầu ký biên bản trả hàng",
        messageId: result.messageId || "",
      });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        details: error.message || "Không gửi được email",
      });
    }
  },
};
