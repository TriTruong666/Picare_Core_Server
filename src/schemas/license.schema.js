const { body, param } = require("express-validator");

class LicenseDTO {
  constructor(license, { includeKey = true } = {}) {
    this.id = license.id;
    if (includeKey) this.licenseKey = license.licenseKey;
    this.customerName = license.customerName;
    this.customerPhone = license.customerPhone;
    this.customerEmail = license.customerEmail;
    this.note = license.note;
    this.software = license.software || [];
    this.createdAt = license.createdAt;
    this.updatedAt = license.updatedAt;
  }
}

const softwareRules = (path) => [
  body(`${path}.name`).trim().notEmpty().withMessage("Tên phần mềm là bắt buộc"),
  body(`${path}.price`).isFloat({ min: 0 }).withMessage("Giá phần mềm không hợp lệ"),
  body(`${path}.status`).optional().isIn(["active", "error"]),
  body(`${path}.domain`).optional({ nullable: true }).isString(),
  body(`${path}.type`).isIn(["client", "server"]).withMessage("Loại phần mềm không hợp lệ"),
  body(`${path}.serverConfig`).optional({ nullable: true }).isObject(),
  body(`${path}.note`).optional({ nullable: true }).isString(),
];

const createLicenseSchema = [
  body("customerName").trim().notEmpty().withMessage("Tên khách hàng là bắt buộc"),
  body("customerPhone").trim().notEmpty().withMessage("SĐT khách hàng là bắt buộc"),
  body("customerEmail").isEmail().normalizeEmail().withMessage("Email không hợp lệ"),
  body("note").optional({ nullable: true }).isString(),
  body("software").isArray({ min: 1 }).withMessage("Phải có ít nhất một phần mềm"),
  ...softwareRules("software.*"),
];

const checkLicenseSchema = [
  body("licenseKey").isUUID(4).withMessage("License key không hợp lệ"),
  body("softwareId").isUUID(4).withMessage("Software ID không hợp lệ"),
];

const activateLicenseSchema = [...checkLicenseSchema];

const licenseIdSchema = [param("licenseId").isUUID(4).withMessage("License ID không hợp lệ")];

const softwareIdSchema = [
  ...licenseIdSchema,
  param("softwareId").isUUID(4).withMessage("Software ID không hợp lệ"),
];

const updateSoftwareSchema = [
  ...softwareIdSchema,
  body("name").optional().trim().notEmpty(),
  body("price").optional().isFloat({ min: 0 }),
  body("status").optional().isIn(["active", "error"]),
  body("domain").optional({ nullable: true }).isString(),
  body("serverConfig").optional({ nullable: true }).isObject(),
  body("note").optional({ nullable: true }).isString(),
];

module.exports = {
  LicenseDTO,
  createLicenseSchema,
  checkLicenseSchema,
  activateLicenseSchema,
  licenseIdSchema,
  updateSoftwareSchema,
};
