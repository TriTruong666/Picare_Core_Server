const { body, param } = require("express-validator");

class ProductQRDTO {
  constructor(productQR) {
    this.productId = productQR.productId;
    this.rawContent = productQR.rawContent;
    this.jsonContent = productQR.jsonContent;
    this.qrImage = productQR.qrImage;
    this.linkUrl = productQR.linkUrl;
    this.imageUrl = productQR.imageUrl;
    this.note = productQR.note;
    this.createdAt = productQR.createdAt;
    this.updatedAt = productQR.updatedAt;
  }

  static fromProductQR(productQR) {
    return new ProductQRDTO(productQR);
  }

  static fromProductQRs(productQRs) {
    return productQRs.map((productQR) => new ProductQRDTO(productQR));
  }
}

const createProductQRSchema = [
  body("linkUrl")
    .optional()
    .isURL({ require_tld: false })
    .withMessage("linkUrl phải là URL hợp lệ"),
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

const updateProductQRSchema = [
  param("productId").isUUID(4).withMessage("productId không hợp lệ"),
  body("linkUrl")
    .optional()
    .isURL({ require_tld: false })
    .withMessage("linkUrl phải là URL hợp lệ"),
  body("rawContent")
    .optional()
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

const productIdSchema = [
  param("productId").isUUID(4).withMessage("productId không hợp lệ"),
];

module.exports = {
  ProductQRDTO,
  createProductQRSchema,
  updateProductQRSchema,
  productIdSchema,
};
