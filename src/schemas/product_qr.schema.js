const { body } = require("express-validator");

const createProductQRSchema = [
  body("rawContent")
    .isString()
    .withMessage("rawContent phải là chuỗi rich text")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("rawContent không được để trống"),
  body("note")
    .optional({ nullable: true })
    .isString()
    .withMessage("note phải là chuỗi"),
];

module.exports = {
  createProductQRSchema,
};
