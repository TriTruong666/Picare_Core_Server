const { body } = require("express-validator");

/**
 * Validation Schemas for Authentication
 */

const loginSchema = [
  body("email").isEmail().withMessage("Email không hợp lệ").normalizeEmail(),
];

const registerSchema = [
  body("name").trim().notEmpty().withMessage("Tên không được để trống"),
  body("email").isEmail().withMessage("Email không hợp lệ").normalizeEmail(),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Mật khẩu phải có ít nhất 6 ký tự"),
  body("role")
    .optional()
    .isIn(["admin", "ecom", "logistics", "default"])
    .withMessage("Role không hợp lệ"),
];

const logoutSchema = [
  body("email").isEmail().withMessage("Email không hợp lệ").normalizeEmail(),
];

module.exports = {
  loginSchema,
  registerSchema,
  logoutSchema,
};
