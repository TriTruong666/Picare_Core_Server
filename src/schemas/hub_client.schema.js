const { body, param, query } = require("express-validator");

/**
 * Data Transfer Objects (DTOs) for HubClient
 */
class HubClientDTO {
  constructor(client) {
    this.clientId = client.clientId;
    this.clientName = client.clientName;
    this.clientDescription = client.clientDescription;
    this.clientLogoImage = client.clientLogoImage;
    this.clientMockupImage = client.clientMockupImage;
    this.clientInternalUrl = client.clientInternalUrl;
    this.clientExternalUrl = client.clientExternalUrl;
    this.clientStatus = client.clientStatus;
    this.allowedRoles = client.allowedRoles;
    this.note = client.note;
    this.createdAt = client.createdAt;
    this.updatedAt = client.updatedAt;
  }

  static fromClient(client) {
    return new HubClientDTO(client);
  }

  static fromClients(clients) {
    return clients.map((client) => new HubClientDTO(client));
  }
}

/**
 * Validation Schemas for HubClient CRUD
 */
const createHubClientSchema = [
  body("clientName").trim().notEmpty().withMessage("Ten client khong duoc de trong"),
  body("clientInternalUrl")
    .optional()
    .isURL({ require_tld: false })
    .withMessage("Internal URL khong hop le"),
  body("clientExternalUrl")
    .isURL({ require_tld: false })
    .withMessage("External URL khong hop le"),
  body("clientStatus")
    .notEmpty()
    .withMessage("Trang thai client khong duoc de trong"),
  body("allowedRoles")
    .optional()
    .isArray()
    .withMessage("Danh sach role cho phep phai la mot mang"),
  body("clientDescription").optional().trim(),
  body("clientLogoImage").optional().trim(),
  body("clientMockupImage").optional().trim(),
  body("note").optional().trim(),
];

const updateHubClientSchema = [
  param("clientId").isUUID(4).withMessage("ID client khong hop le"),
  body("clientName").optional().trim().notEmpty().withMessage("Ten client khong duoc de trong"),
  body("clientInternalUrl")
    .optional()
    .isURL({ require_tld: false })
    .withMessage("Internal URL khong hop le"),
  body("clientExternalUrl")
    .optional()
    .isURL({ require_tld: false })
    .withMessage("External URL khong hop le"),
  body("clientStatus")
    .optional()
    .notEmpty()
    .withMessage("Trang thai client khong duoc de trong"),
  body("allowedRoles")
    .optional()
    .isArray()
    .withMessage("Danh sach role cho phep phai la mot mang"),
  body("clientDescription").optional().trim(),
  body("clientLogoImage").optional().trim(),
  body("clientMockupImage").optional().trim(),
  body("note").optional().trim(),
];

const clientIdSchema = [
  param("clientId").isUUID(4).withMessage("ID client khong hop le"),
];

const checkAccessSchema = [
  param("clientId").isUUID(4).withMessage("ID client khong hop le"),
];

const checkAccessByUrlSchema = [
  query("externalUrl")
    .notEmpty()
    .withMessage("externalUrl khong duoc de trong")
    .bail()
    .isURL({ require_tld: false })
    .withMessage("externalUrl khong hop le"),
];

module.exports = {
  HubClientDTO,
  createHubClientSchema,
  updateHubClientSchema,
  clientIdSchema,
  checkAccessSchema,
  checkAccessByUrlSchema,
};
