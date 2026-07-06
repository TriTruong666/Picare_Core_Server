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
  const missingFields = [
    !host && "SMTP_HOST",
    !port && "SMTP_PORT",
    !user && `${sender.toUpperCase()}_SMTP_USER`,
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
