const { body } = require("express-validator");

const loginSchema = [
  body("email").isEmail().withMessage("Email khong hop le").normalizeEmail(),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Mat khau phai co it nhat 6 ky tu"),
];

const registerSchema = [
  body("name").trim().notEmpty().withMessage("Ten khong duoc de trong"),
  body("email").isEmail().withMessage("Email khong hop le").normalizeEmail(),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Mat khau phai co it nhat 6 ky tu"),
  body("role")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("Role khong hop le"),
];

const logoutSchema = [
  body("email").isEmail().withMessage("Email khong hop le").normalizeEmail(),
];

const changePasswordSchema = [
  body("oldPassword")
    .isLength({ min: 6 })
    .withMessage("Mat khau cu phai co it nhat 6 ky tu"),
  body("newPassword")
    .isLength({ min: 6 })
    .withMessage("Mat khau moi phai co it nhat 6 ky tu"),
];

module.exports = {
  loginSchema,
  registerSchema,
  logoutSchema,
  changePasswordSchema,
};
