const { body } = require("express-validator");

function isEmailTarget(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) {
    return value.length > 0 && value.every((item) => typeof item === "string" && item.trim());
  }
  return false;
}

const optionalEmailTarget = (field) =>
  body(field)
    .optional()
    .custom((value) => isEmailTarget(value))
    .withMessage(`${field} phải là email hoặc danh sách email`);

const sendMailSchema = [
  body("to")
    .custom((value) => isEmailTarget(value))
    .withMessage("to là bắt buộc và phải là email hoặc danh sách email"),
  optionalEmailTarget("cc"),
  optionalEmailTarget("bcc"),
  body("subject")
    .trim()
    .notEmpty()
    .withMessage("subject là bắt buộc")
    .isLength({ max: 255 })
    .withMessage("subject tối đa 255 ký tự"),
  body("text")
    .optional()
    .isString()
    .withMessage("text phải là chuỗi"),
  body("html")
    .optional()
    .isString()
    .withMessage("html phải là chuỗi"),
  body("replyTo")
    .optional()
    .isEmail()
    .withMessage("replyTo không hợp lệ"),
  body().custom((value) => {
    if (!value.text && !value.html) {
      throw new Error("Phải có ít nhất text hoặc html");
    }
    return true;
  }),
];

const templateBaseSchema = () => [
  body("smtpUser")
    .optional()
    .isEmail()
    .withMessage("smtpUser phải là email hợp lệ"),
  body("mailFrom")
    .optional()
    .isEmail()
    .withMessage("mailFrom phải là email hợp lệ"),
  body("mailFromName")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("mailFromName không được để trống"),
  body("to")
    .custom((value) => isEmailTarget(value))
    .withMessage("to là bắt buộc và phải là email hoặc danh sách email"),
  optionalEmailTarget("cc"),
  optionalEmailTarget("bcc"),
  body("subject")
    .trim()
    .notEmpty()
    .withMessage("subject là bắt buộc")
    .isLength({ max: 255 })
    .withMessage("subject tối đa 255 ký tự"),
  body("title")
    .optional()
    .isString()
    .withMessage("title phải là chuỗi"),
  body("intro")
    .optional()
    .isString()
    .withMessage("intro phải là chuỗi"),
  body("bodyLines")
    .optional()
    .isArray()
    .withMessage("bodyLines phải là mảng chuỗi"),
  body("bodyLines.*")
    .optional()
    .isString()
    .withMessage("bodyLines chỉ được chứa chuỗi"),
  body("footer")
    .optional()
    .isString()
    .withMessage("footer phải là chuỗi"),
  body("replyTo")
    .optional()
    .isEmail()
    .withMessage("replyTo không hợp lệ"),
];

const sendEcontractTemplateMailSchema = [
  ...templateBaseSchema(),
  body("actionLabel")
    .optional()
    .isString()
    .withMessage("actionLabel phải là chuỗi"),
  body("actionUrl")
    .optional()
    .isURL({ require_protocol: true, require_tld: false })
    .withMessage("actionUrl phải là URL hợp lệ"),
];

const sendLicenseActivationMailSchema = [
  ...templateBaseSchema(),
  body("clientUrl")
    .isURL({ require_protocol: true, require_tld: false })
    .withMessage("clientUrl phải là URL hợp lệ"),
  body("softwareId")
    .trim()
    .notEmpty()
    .isLength({ max: 100 })
    .withMessage("softwareId là bắt buộc và tối đa 100 ký tự"),
  body("licenseKey")
    .trim()
    .notEmpty()
    .withMessage("licenseKey là bắt buộc"),
];

module.exports = {
  sendMailSchema,
  sendEcontractTemplateMailSchema,
  sendLicenseActivationMailSchema,
};
