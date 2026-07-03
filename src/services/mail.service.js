"use strict";

const nodemailer = require("nodemailer");
const appConfig = require("../config/app.config");
const ErrorCodes = require("../common/exceptions/error_codes");
const {
  BadRequestException,
  BaseException,
} = require("../common/exceptions/BaseException");

let cachedTransporter = null;

function assertMailConfig() {
  const { host, port, user, pass, from } = appConfig.mail;
  const missingFields = [
    !host && "SMTP_HOST",
    !port && "SMTP_PORT",
    !user && "SMTP_USER",
    !pass && "SMTP_PASS",
    !from && "MAIL_FROM",
  ].filter(Boolean);

  if (missingFields.length > 0) {
    throw new BaseException(ErrorCodes.MAIL_SMTP_CONFIG_MISSING(missingFields));
  }
}

function buildTransporter() {
  assertMailConfig();

  const { host, port, secure, user, pass, rejectUnauthorized } = appConfig.mail;

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
  static getTransporter() {
    if (!cachedTransporter) {
      cachedTransporter = buildTransporter();
    }

    return cachedTransporter;
  }

  static async verifyConnection() {
    const transporter = this.getTransporter();
    await transporter.verify();

    return {
      host: appConfig.mail.host,
      port: appConfig.mail.port,
      secure: appConfig.mail.secure,
      from: appConfig.mail.from,
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
    from,
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

    const transporter = this.getTransporter();
    const senderName = appConfig.mail.name || "Picare Core Hub";
    const senderAddress = from || appConfig.mail.from;

    try {
      const info = await transporter.sendMail({
        from: `"${senderName}" <${senderAddress}>`,
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

  static async sendTemplateMail({
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
    });
  }

  static resetTransporter() {
    cachedTransporter = null;
  }
}

module.exports = MailService;
