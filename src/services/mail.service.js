"use strict";

const nodemailer = require("nodemailer");
const appConfig = require("../config/app.config");
const ErrorCodes = require("../common/exceptions/error_codes");
const {
  BadRequestException,
  BaseException,
} = require("../common/exceptions/BaseException");

const cachedTransporters = new Map();

function getSenderConfig(sender, overrides = {}) {
  const configured = appConfig.mail.senders?.[sender] || {};
  return {
    user: overrides.smtpUser || configured.user,
    from: overrides.mailFrom || configured.from,
    name: overrides.mailFromName || configured.name,
  };
}

function assertMailConfig(sender, overrides) {
  const { host, port, pass } = appConfig.mail;
  const { user, from } = getSenderConfig(sender, overrides);
  const userEnvName =
    sender === "salesforce"
      ? "SALEFORCE_MAIL_USER"
      : `${sender.toUpperCase()}_SMTP_USER`;
  const missingFields = [
    !host && "SMTP_HOST",
    !port && "SMTP_PORT",
    !user && userEnvName,
    !pass && "SMTP_PASS",
    !from && `${sender.toUpperCase()}_MAIL_FROM`,
  ].filter(Boolean);

  if (missingFields.length > 0) {
    throw new BaseException(ErrorCodes.MAIL_SMTP_CONFIG_MISSING(missingFields));
  }
}

function buildTransporter(sender, overrides) {
  assertMailConfig(sender, overrides);

  const { host, port, secure, pass, rejectUnauthorized } = appConfig.mail;
  const { user } = getSenderConfig(sender, overrides);

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized,
    },
  });
}

class MailService {
  static getTransporter(sender = "econtract", overrides = {}) {
    const senderConfig = getSenderConfig(sender, overrides);
    const cacheKey = `${sender}:${senderConfig.user}`;
    if (!cachedTransporters.has(cacheKey)) {
      cachedTransporters.set(cacheKey, buildTransporter(sender, overrides));
    }

    return cachedTransporters.get(cacheKey);
  }

  static async verifyConnection(sender = "econtract") {
    const transporter = this.getTransporter(sender);
    await transporter.verify();
    const senderConfig = getSenderConfig(sender);

    return {
      host: appConfig.mail.host,
      port: appConfig.mail.port,
      secure: appConfig.mail.secure,
      sender,
      from: senderConfig.from,
    };
  }

  static async sendMail({
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    attachments,
    replyTo,
    sender = "econtract",
    smtpUser,
    mailFrom,
    mailFromName,
  }) {
    if (!to) {
      throw new BadRequestException(ErrorCodes.MAIL_TO_REQUIRED);
    }

    if (!subject) {
      throw new BadRequestException(ErrorCodes.MAIL_SUBJECT_REQUIRED);
    }

    if (!text && !html) {
      throw new BadRequestException(ErrorCodes.MAIL_CONTENT_REQUIRED);
    }

    const senderOverrides = { smtpUser, mailFrom, mailFromName };
    const transporter = this.getTransporter(sender, senderOverrides);
    const senderConfig = getSenderConfig(sender, senderOverrides);

    try {
      const info = await transporter.sendMail({
        from: `"${senderConfig.name}" <${senderConfig.from}>`,
        to,
        cc,
        bcc,
        subject,
        text,
        html,
        attachments,
        replyTo,
      });

      return {
        messageId: info.messageId,
        accepted: info.accepted || [],
        rejected: info.rejected || [],
        response: info.response || "",
      };
    } catch (error) {
      throw new BaseException(ErrorCodes.MAIL_SEND_FAILED(error.message));
    }
  }

  static async sendEcontractTemplateMail({
    to,
    subject,
    title,
    intro,
    bodyLines = [],
    actionLabel,
    actionUrl,
    footer,
    replyTo,
    cc,
    bcc,
    smtpUser,
    mailFrom,
    mailFromName,
  }) {
    const safeLines = bodyLines.filter(Boolean);
    const html = [
      "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:680px\">",
      title ? `<h2 style="margin:0 0 16px">${title}</h2>` : "",
      intro ? `<p style="margin:0 0 16px">${intro}</p>` : "",
      ...safeLines.map((line) => `<p style="margin:0 0 12px">${line}</p>`),
      actionUrl && actionLabel
        ? `<p style="margin:24px 0"><a href="${actionUrl}" style="display:inline-block;padding:12px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px">${actionLabel}</a></p>`
        : "",
      footer
        ? `<p style="margin:24px 0 0;color:#6b7280;font-size:13px">${footer}</p>`
        : "",
      "</div>",
    ].join("");
    const textLines = [
      title,
      intro,
      ...safeLines,
      actionUrl && actionLabel ? `${actionLabel}: ${actionUrl}` : "",
      footer,
    ].filter(Boolean);

    return this.sendMail({
      to,
      cc,
      bcc,
      replyTo,
      subject,
      text: textLines.join("\n\n"),
      html,
      sender: "econtract",
      smtpUser,
      mailFrom,
      mailFromName,
    });
  }

  static async sendLoginVerificationMail({
    to,
    code,
    expiresInMinutes,
    ipAddress,
  }) {
    const escape = this.escapeHtml;
    const safeCode = escape(code);
    const safeIpAddress = escape(ipAddress);
    const safeExpiresInMinutes = escape(expiresInMinutes);
    const subject = "Mã xác thực đăng nhập Picare Client";
    const text = [
      "Xác thực đăng nhập Picare",
      `Mã xác thực của bạn: ${code}`,
      `Thời gian hiệu lực: ${expiresInMinutes} phút`,
      `Địa chỉ IP yêu cầu: ${ipAddress}`,
      "Lưu ý: Không chia sẻ mã xác thực này. Nếu bạn không thực hiện yêu cầu đăng nhập, vui lòng đổi mật khẩu ngay.",
    ].join("\n\n");

    const html = [
      '<div style="background-color:#f8fafc;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;color:#334155;line-height:1.5">',
      '<div style="max-width:460px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:36px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">',
      '<div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#64748b;margin-bottom:12px">Picare Security</div>',
      '<h1 style="margin:0 0 10px;font-size:20px;font-weight:600;color:#0f172a;letter-spacing:-0.2px">Xác thực đăng nhập</h1>',
      '<p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:22px">Sử dụng mã OTP dưới đây để hoàn tất đăng nhập vào hệ thống Picare:</p>',
      `<div style="margin:0 0 24px;padding:16px 20px;text-align:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#0f172a">${safeCode}</div>`,
      '<table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px">',
      '<tr>',
      '<td style="padding:7px 0;color:#64748b">Thời gian hiệu lực</td>',
      `<td style="padding:7px 0;text-align:right;font-weight:600;color:#0f172a">${safeExpiresInMinutes} phút</td>`,
      '</tr>',
      '<tr>',
      '<td style="padding:7px 0;color:#64748b;border-top:1px solid #f1f5f9">Địa chỉ IP</td>',
      `<td style="padding:7px 0;text-align:right;font-weight:500;font-family:ui-monospace,SFMono-Regular,monospace;color:#0f172a;border-top:1px solid #f1f5f9">${safeIpAddress}</td>`,
      '</tr>',
      '</table>',
      '<div style="padding:12px 14px;background:#fefce8;border:1px solid #fef08a;border-radius:6px;font-size:12px;line-height:18px;color:#854d0e">',
      '<strong>Lưu ý:</strong> Không chia sẻ mã này với bất kỳ ai. Nếu bạn không thực hiện đăng nhập, hãy đổi mật khẩu ngay để bảo vệ tài khoản.',
      '</div>',
      '</div>',
      '<div style="text-align:center;margin-top:20px;font-size:12px;color:#94a3b8">© Picare • Email tự động, vui lòng không phản hồi</div>',
      '</div>',
    ].join("");

    return this.sendMail({
      to,
      subject,
      text,
      html,
      sender: "auth",
    });
  }

  static async sendOrderReturnSigningMail({
    to,
    signerName,
    returnId,
    orderId,
    actionUrl,
    expiresAt,
  }) {
    const escape = this.escapeHtml;
    const expiresText = new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date(expiresAt));
    const subject = `Yêu cầu ký biên bản trả hàng ${returnId}`;
    const text = [
      `Kính gửi ${signerName},`,
      `Picare gửi Quý khách biên bản trả hàng ${returnId} của đơn hàng ${orderId}.`,
      "Vui lòng mở liên kết, kiểm tra danh sách hàng, nhập lý do trả và ký tay để hoàn tất yêu cầu.",
      `Ký biên bản: ${actionUrl}`,
      `Liên kết có hiệu lực đến ${expiresText} và chỉ dành cho yêu cầu này.`,
      "Nếu Quý khách không thực hiện yêu cầu trả hàng, vui lòng bỏ qua email và liên hệ nhân viên phụ trách.",
    ].join("\n\n");
    const html = [
      '<div style="font-family:Arial,sans-serif;line-height:1.65;color:#111827;max-width:680px">',
      '<h2 style="margin:0 0 16px">Ký biên bản trả hàng</h2>',
      `<p style="margin:0 0 12px">Kính gửi <strong>${escape(signerName)}</strong>,</p>`,
      `<p style="margin:0 0 12px">Picare gửi Quý khách biên bản trả hàng <strong>${escape(returnId)}</strong> của đơn hàng <strong>${escape(orderId)}</strong>.</p>`,
      '<p style="margin:0 0 12px">Vui lòng kiểm tra danh sách hàng, nhập lý do trả và ký tay để hoàn tất yêu cầu.</p>',
      `<p style="margin:24px 0"><a href="${escape(actionUrl)}" style="display:inline-block;padding:12px 20px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Mở và ký biên bản</a></p>`,
      `<p style="margin:0 0 8px;color:#4b5563">Liên kết có hiệu lực đến <strong>${escape(expiresText)}</strong> và chỉ dành cho yêu cầu này.</p>`,
      '<p style="margin:20px 0 0;color:#6b7280;font-size:13px">Nếu Quý khách không thực hiện yêu cầu trả hàng, vui lòng bỏ qua email và liên hệ nhân viên phụ trách.</p>',
      "</div>",
    ].join("");
    return this.sendMail({ to, subject, text, html, sender: "salesforce" });
  }

  static escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;",
    })[character]);
  }

  static async sendLicenseActivationMail({
    to, cc, bcc, subject, title, intro, bodyLines = [], clientUrl,
    softwareId, licenseKey, footer, replyTo,
    smtpUser, mailFrom, mailFromName,
  }) {
    const escape = this.escapeHtml;
    const safeLines = bodyLines.filter(Boolean);
    const html = [
      '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:680px">',
      `<h2 style="margin:0 0 16px">${escape(title || "Kích hoạt bản quyền phần mềm")}</h2>`,
      `<p style="margin:0 0 16px">${escape(intro || "Thông tin kích hoạt và truy cập phần mềm của Quý khách như sau:")}</p>`,
      ...safeLines.map((line) => `<p style="margin:0 0 12px">${escape(line)}</p>`),
      '<div style="margin:20px 0;padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb">',
      `<p style="margin:0 0 10px">ID phần mềm: <strong>${escape(softwareId)}</strong></p>`,
      `<p style="margin:0 0 10px">Key kích hoạt: <strong>${escape(licenseKey)}</strong></p>`,
      `<p style="margin:0">Đường dẫn phần mềm: <a href="${escape(clientUrl)}" style="color:#2563eb;text-decoration:underline">${escape(clientUrl)}</a></p>`,
      "</div>",
      '<p style="margin:16px 0 0">Vui lòng truy cập đường dẫn trên và sử dụng ID phần mềm cùng key kích hoạt khi hệ thống yêu cầu.</p>',
      footer ? `<p style="margin:24px 0 0;color:#6b7280;font-size:13px">${escape(footer)}</p>` : "",
      "</div>",
    ].join("");
    const text = [
      title || "Kích hoạt bản quyền phần mềm",
      intro || "Thông tin kích hoạt và truy cập phần mềm:",
      ...safeLines,
      `ID phần mềm: ${softwareId}`,
      `Key kích hoạt: ${licenseKey}`,
      `Đường dẫn phần mềm: ${clientUrl}`,
      footer,
    ].filter(Boolean).join("\n\n");

    return this.sendMail({
      to, cc, bcc, subject, text, html, replyTo, sender: "license",
      smtpUser, mailFrom, mailFromName,
    });
  }

  static resetTransporter() {
    cachedTransporters.clear();
  }
}

module.exports = MailService;
