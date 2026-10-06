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
  async sendOfficeInvitationMail(call, callback) {
    try {
      const { timingSafeEqual } = require("node:crypto");
      const expected = Buffer.from(
        process.env.GRPC_OFFICE_MAIL_SERVICE_TOKEN || "",
      );
      const provided = Buffer.from(
        String(call.metadata?.get("x-service-token")?.[0] || ""),
      );
      if (
        !expected.length ||
        expected.length !== provided.length ||
        !timingSafeEqual(expected, provided)
      ) {
        return callback({
          code: grpc.status.UNAUTHENTICATED,
          details: "Office mail service token không hợp lệ",
        });
      }
      const request = call.request || {};
      if (
        [
          "to",
          "recipientName",
          "companyName",
          "accountEmail",
          "actionUrl",
          "expiresAt",
        ].some((field) => !String(request[field] || "").trim())
      )
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          details: "Thiếu thông tin lời mời Office",
        });
      const url = new URL(request.actionUrl);
      const origin = new URL(process.env.OFFICE_CLIENT_URL).origin;
      if (
        url.origin !== origin ||
        url.pathname !== "/member/setup" ||
        !/^#invitation=[a-f0-9]{64}$/.test(url.hash) ||
        !["http:", "https:"].includes(url.protocol) ||
        (process.env.NODE_ENV === "production" && url.protocol !== "https:")
      )
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          details: "Đường dẫn Office không hợp lệ",
        });
      if (
        !Number.isFinite(Date.parse(request.expiresAt)) ||
        Date.parse(request.expiresAt) <= Date.now()
      )
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          details: "Thời hạn lời mời không hợp lệ",
        });
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(request.to))
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          details: "Email người nhận không hợp lệ",
        });
      const result = await MailService.sendOfficeInvitationMail(request);
      if (!result.accepted?.length || result.rejected?.length)
        throw new Error("Máy chủ mail không chấp nhận người nhận");
      callback(null, {
        success: true,
        message: "Đã gửi lời mời tham gia Picare Office",
        messageId: result.messageId || "",
      });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        details: error.message || "Không gửi được lời mời Office",
      });
    }
  },
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
