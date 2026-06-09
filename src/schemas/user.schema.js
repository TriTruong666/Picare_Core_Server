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
  .withMessage("So dien thoai khong hop le");

const createUserSchema = [
  body("name").trim().notEmpty().withMessage("Ten khong duoc de trong"),
  body("email").isEmail().withMessage("Email khong hop le").normalizeEmail(),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Mat khau phai co it nhat 6 ky tu"),
  phoneValidator,
  body("role")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("Role khong hop le"),
];

const updateUserSchema = [
  param("userId").isUUID(4).withMessage("ID nguoi dung khong hop le"),
  body("name").optional().trim().notEmpty().withMessage("Ten khong duoc de trong"),
  body("email").optional().isEmail().withMessage("Email khong hop le").normalizeEmail(),
  phoneValidator,
  body("role")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("Role khong hop le"),
  body("isOnline").optional().isBoolean().withMessage("isOnline phai la boolean"),
  body("note").optional().trim(),
];

const userIdSchema = [
  param("userId").isUUID(4).withMessage("ID nguoi dung khong hop le"),
];

module.exports = {
  UserDTO,
  createUserSchema,
  updateUserSchema,
  userIdSchema,
};
