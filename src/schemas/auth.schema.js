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
  body("role")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("Role không hợp lệ"),
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

module.exports = {
  loginSchema,
  registerSchema,
  logoutSchema,
  changePasswordSchema,
};
