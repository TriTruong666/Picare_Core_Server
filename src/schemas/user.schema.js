const { body, param } = require("express-validator");
const { ROLES } = require("../common/enum/role.enum");

/**
 * Data Transfer Objects (DTOs) for User
 */
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

/**
 * Validation Schemas for User CRUD
 */
const createUserSchema = [
  body("name").trim().notEmpty().withMessage("Tên không được để trống"),
  body("email")
    .isEmail()
    .withMessage("Email không hợp lệ")
    .normalizeEmail(),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Mật khẩu phải có ít nhất 6 ký tự"),
  body("phone").optional().isMobilePhone().withMessage("Số điện thoại không hợp lệ"),
  body("role")
    .optional()
    .isIn(ROLES)
    .withMessage("Role không hợp lệ"),
];

const updateUserSchema = [
  param("userId").isUUID(4).withMessage("ID người dùng không hợp lệ"),
  body("name").optional().trim().notEmpty().withMessage("Tên không được để trống"),
  body("email")
    .optional()
    .isEmail()
    .withMessage("Email không hợp lệ")
    .normalizeEmail(),
  body("phone").optional().isMobilePhone().withMessage("Số điện thoại không hợp lệ"),
  body("role")
    .optional()
    .isIn(ROLES)
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
