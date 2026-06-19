const { body, param } = require("express-validator");

class UserDTO {
  constructor(user) {
    this.userId = user.userId;
    this.name = user.name;
    this.email = user.email;
    this.phone = user.phone;
    this.role = user.role;
    this.isOnline = user.isOnline;
    this.note = user.note;
    this.createdAt = user.createdAt;
    this.updatedAt = user.updatedAt;
  }

  static fromUser(user) {
    return new UserDTO(user);
  }

  static fromUsers(users) {
    return users.map((user) => new UserDTO(user));
  }
}

const phoneValidator = body("phone")
  .optional({ values: "null" })
  .custom(
    (value) => value === null || value === "" || /^[0-9+\-\s().]{8,20}$/.test(value)
  )
  .withMessage("Số điện thoại không hợp lệ");

const createUserSchema = [
  body("name").trim().notEmpty().withMessage("Tên không được để trống"),
  body("email").isEmail().withMessage("Email không hợp lệ").normalizeEmail(),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Mật khẩu phải có ít nhất 6 ký tự"),
  phoneValidator,
  body("role")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("Role không hợp lệ"),
];

const updateUserSchema = [
  param("userId").isUUID(4).withMessage("ID người dùng không hợp lệ"),
  body("name").optional().trim().notEmpty().withMessage("Tên không được để trống"),
  body("email").optional().isEmail().withMessage("Email không hợp lệ").normalizeEmail(),
  phoneValidator,
  body("role")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("Role không hợp lệ"),
  body("isOnline").optional().isBoolean().withMessage("isOnline phải là boolean"),
  body("note").optional().trim(),
];

const userIdSchema = [
  param("userId").isUUID(4).withMessage("ID người dùng không hợp lệ"),
];

module.exports = {
  UserDTO,
  createUserSchema,
  updateUserSchema,
  userIdSchema,
};
