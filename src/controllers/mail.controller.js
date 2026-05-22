const { validationResult } = require("express-validator");
const ResponseHandler = require("../common/response.handler");
const { BadRequestException } = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");
const MailService = require("../services/mail.service");

class MailController {
  static async sendMail(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const result = await MailService.sendMail({
        to: req.body.to,
        cc: req.body.cc,
        bcc: req.body.bcc,
        subject: req.body.subject,
        text: req.body.text,
        html: req.body.html,
        replyTo: req.body.replyTo,
      });

      return ResponseHandler.success(res, result, "Gửi mail thành công");
    } catch (error) {
      next(error);
    }
  }

  static async sendTemplateMail(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const result = await MailService.sendTemplateMail({
        to: req.body.to,
        cc: req.body.cc,
        bcc: req.body.bcc,
        subject: req.body.subject,
        title: req.body.title,
        intro: req.body.intro,
        bodyLines: req.body.bodyLines,
        actionLabel: req.body.actionLabel,
        actionUrl: req.body.actionUrl,
        footer: req.body.footer,
        replyTo: req.body.replyTo,
      });

      return ResponseHandler.success(res, result, "Gửi mail template thành công");
    } catch (error) {
      next(error);
    }
  }

  static async verify(req, res, next) {
    try {
      const result = await MailService.verifyConnection();
      return ResponseHandler.success(res, result, "Kết nối SMTP thành công");
    } catch (error) {
      next(error);
    }
  }
}

module.exports = MailController;
