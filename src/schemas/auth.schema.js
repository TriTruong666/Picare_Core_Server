const { body } = require("express-validator");

const loginSchema = [
  body("email").isEmail().withMessage("Email không hợp lệ").normalizeEmail(),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Mật khẩu phải có ít nhất 6 ký tự"),
];

const registerSchema = [
  body("name").trim().notEmpty().withMessage("Tên không được để trống"),
  body("email").isEmail().withMessage("Email không hợp lệ").normalizeEmail(),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Mật khẩu phải có ít nhất 6 ký tự"),
];

const logoutSchema = [
  body("email").isEmail().withMessage("Email không hợp lệ").normalizeEmail(),
];

const changePasswordSchema = [
  body("oldPassword")
    .isLength({ min: 6 })
    .withMessage("Mật khẩu cũ phải có ít nhất 6 ký tự"),
  body("newPassword")
    .isLength({ min: 6 })
    .withMessage("Mật khẩu mới phải có ít nhất 6 ký tự"),
];

const loginVerificationSchema = [
  body("challengeId")
    .isUUID(4)
    .withMessage("challengeId không hợp lệ"),
  body("code")
    .matches(/^\d{6}$/)
    .withMessage("Mã xác thực phải gồm đúng 6 chữ số"),
];

const resendLoginCodeSchema = [
  body("challengeId")
    .isUUID(4)
    .withMessage("challengeId không hợp lệ"),
];

const revokeTrustedIpSchema = [
  body("ipAddress")
    .isIP()
    .withMessage("Địa chỉ IP không hợp lệ"),
];

module.exports = {
  loginSchema,
  registerSchema,
  logoutSchema,
  changePasswordSchema,
  loginVerificationSchema,
  resendLoginCodeSchema,
  revokeTrustedIpSchema,
};
