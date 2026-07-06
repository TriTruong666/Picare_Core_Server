const { body, param, query } = require("express-validator");

class SoftwareDTO {
  constructor(item) {
    this.id = item.id;
    this.licenseId = item.licenseId;
    this.softwareId = item.softwareId;
    this.name = item.name;
    this.price = item.price;
    this.status = item.status;
    this.domain = item.domain;
    this.type = item.type;
    this.serverConfig = item.serverConfig;
    this.note = item.note;
    this.createdAt = item.createdAt;
    this.updatedAt = item.updatedAt;
  }
}

class TicketDTO {
  constructor(item) {
    this.id = item.id;
    this.licenseId = item.licenseId;
    this.title = item.title;
    this.message = item.message;
    this.attachments = item.attachments || [];
    this.status = item.status;
    this.cancelReason = item.cancelReason;
    this.note = item.note;
    this.createdAt = item.createdAt;
    this.updatedAt = item.updatedAt;
  }
}

class LicenseDTO {
  constructor(item) {
    this.id = item.id;
    this.licenseId = item.licenseId;
    this.licenseKey = item.licenseKey;
    this.licenseContract = item.licenseContract ?? null;
    this.yearlyCost = item.yearlyCost;
    this.oncePaymentStatus = item.oncePaymentStatus;
    this.customerName = item.customerName;
    this.customerPhone = item.customerPhone;
    this.customerEmail = item.customerEmail;
    this.note = item.note;
    this.software = (item.software || []).map(
      (value) => new SoftwareDTO(value),
    );
    this.tickets = (item.tickets || []).map((value) => new TicketDTO(value));
    this.createdAt = item.createdAt;
    this.updatedAt = item.updatedAt;
  }
}

const nullableString = (field) =>
  body(field).optional({ nullable: true }).isString();

const softwareBodyRules = ({ optional = false, prefix = "" } = {}) => {
  const field = (name) => (prefix ? `${prefix}.${name}` : name);
  const base = (name) =>
    optional ? body(field(name)).optional() : body(field(name));
  return [
    base("softwareId")
      .trim()
      .notEmpty()
      .isLength({ max: 100 })
      .withMessage("Software ID là bắt buộc và tối đa 100 ký tự"),
    base("name").trim().notEmpty().withMessage("Tên phần mềm là bắt buộc"),
    base("price").isFloat({ min: 0 }).withMessage("Giá phần mềm không hợp lệ"),
    body(field("status")).optional().isIn(["active", "error"]),
    body(field("domain")).optional({ nullable: true }).isString(),
    base("type")
      .isIn(["client", "server"])
      .withMessage("Loại phần mềm không hợp lệ"),
    body(field("serverConfig"))
      .optional({ nullable: true })
      .custom((value) => {
        if (!Array.isArray(value)) {
          throw new Error("serverConfig phải là array");
        }
        if (value.some((item) =>
          !item ||
          typeof item.name !== "string" ||
          !item.name.trim() ||
          typeof item.active !== "boolean"
        )) {
          throw new Error("Mỗi feature cần name và active kiểu boolean");
        }
        return true;
      }),
    body(field("note")).optional({ nullable: true }).isString(),
  ];
};

const licenseIdSchema = [
  param("licenseId").isUUID(4).withMessage("License ID không hợp lệ"),
];
const softwareIdSchema = [
  ...licenseIdSchema,
  param("softwareId")
    .trim()
    .notEmpty()
    .isLength({ max: 100 })
    .withMessage("Software ID không hợp lệ"),
];
const ticketIdSchema = [
  ...licenseIdSchema,
  param("ticketId").isUUID(4).withMessage("Ticket ID không hợp lệ"),
];

const licenseContractRules = [
  body("licenseContract")
    .optional({ nullable: true })
    .isArray()
    .withMessage("licenseContract phải là array hoặc null"),
  body("licenseContract.*.name")
    .trim()
    .notEmpty()
    .withMessage("licenseContract.name là bắt buộc"),
  body("licenseContract.*.url")
    .isURL({ require_tld: false })
    .withMessage("licenseContract.url không hợp lệ"),
];

const createLicenseSchema = [
  body("customerName")
    .trim()
    .notEmpty()
    .withMessage("Tên khách hàng là bắt buộc"),
  body("customerPhone")
    .trim()
    .notEmpty()
    .withMessage("SĐT khách hàng là bắt buộc"),
  body("customerEmail")
    .isEmail()
    .normalizeEmail()
    .withMessage("Email không hợp lệ"),
  body("yearlyCost").optional().isFloat({ min: 0 }),
  body("oncePaymentStatus")
    .optional()
    .isIn(["paid", "partialy_paid", "unpaid"]),
  nullableString("note"),
  ...licenseContractRules,
  body("software")
    .isArray({ min: 1 })
    .withMessage("Phải có ít nhất một phần mềm"),
  ...softwareBodyRules({ prefix: "software.*" }),
];

const updateLicenseSchema = [
  ...licenseIdSchema,
  body("customerName").optional().trim().notEmpty(),
  body("customerPhone").optional().trim().notEmpty(),
  body("customerEmail").optional().isEmail().normalizeEmail(),
  body("yearlyCost").optional().isFloat({ min: 0 }),
  body("oncePaymentStatus")
    .optional()
    .isIn(["paid", "partialy_paid", "unpaid"]),
  nullableString("note"),
  ...licenseContractRules,
];

const listLicenseSchema = [
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
  query("search").optional().trim(),
];

const createSoftwareSchema = [...licenseIdSchema, ...softwareBodyRules()];
const updateSoftwareSchema = [
  ...softwareIdSchema,
  ...softwareBodyRules({ optional: true }),
];

const createTicketSchema = [
  ...licenseIdSchema,
  body("title").trim().notEmpty(),
  body("message").isString().notEmpty(),
  body("attachments").optional().isArray(),
  body("attachments.*").optional().isURL({ require_tld: false }),
  body("status").optional().isIn(["pending", "completed", "cancelled"]),
  nullableString("cancelReason"),
  nullableString("note"),
  body("cancelReason").if(body("status").equals("cancelled")).notEmpty(),
];

const updateTicketSchema = [
  ...ticketIdSchema,
  body("title").optional().trim().notEmpty(),
  body("message").optional().isString().notEmpty(),
  body("attachments").optional().isArray(),
  body("attachments.*").optional().isURL({ require_tld: false }),
  body("status").optional().isIn(["pending", "completed", "cancelled"]),
  nullableString("cancelReason"),
  nullableString("note"),
  body("cancelReason").if(body("status").equals("cancelled")).notEmpty(),
];

const listTicketSchema = [
  ...licenseIdSchema,
  query("status").optional().isIn(["pending", "completed", "cancelled"]),
];

module.exports = {
  LicenseDTO,
  SoftwareDTO,
  TicketDTO,
  createLicenseSchema,
  updateLicenseSchema,
  listLicenseSchema,
  licenseIdSchema,
  softwareIdSchema,
  createSoftwareSchema,
  updateSoftwareSchema,
  ticketIdSchema,
  createTicketSchema,
  updateTicketSchema,
  listTicketSchema,
};
