const { body, param } = require("express-validator");

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
  body("clientName").trim().notEmpty().withMessage("Tên client không được để trống"),
  body("clientInternalUrl")
    .optional()
    .isURL()
    .withMessage("Internal URL không hợp lệ"),
  body("clientExternalUrl")
    .isURL()
    .withMessage("External URL không hợp lệ"),
  body("clientStatus")
    .notEmpty()
    .withMessage("Trạng thái client không được để trống"),
  body("allowedRoles")
    .optional()
    .isArray()
    .withMessage("Danh sách role cho phép phải là một mảng"),
  body("clientDescription").optional().trim(),
  body("clientLogoImage").optional().trim(),
  body("clientMockupImage").optional().trim(),
  body("note").optional().trim(),
];

const updateHubClientSchema = [
  param("clientId").isUUID(4).withMessage("ID client không hợp lệ"),
  body("clientName").optional().trim().notEmpty().withMessage("Tên client không được để trống"),
  body("clientInternalUrl")
    .optional()
    .isURL()
    .withMessage("Internal URL không hợp lệ"),
  body("clientExternalUrl")
    .optional()
    .isURL()
    .withMessage("External URL không hợp lệ"),
  body("clientStatus")
    .optional()
    .notEmpty()
    .withMessage("Trạng thái client không được để trống"),
  body("allowedRoles")
    .optional()
    .isArray()
    .withMessage("Danh sách role cho phép phải là một mảng"),
  body("clientDescription").optional().trim(),
  body("clientLogoImage").optional().trim(),
  body("clientMockupImage").optional().trim(),
  body("note").optional().trim(),
];

const clientIdSchema = [
  param("clientId").isUUID(4).withMessage("ID client không hợp lệ"),
];

const checkAccessSchema = [
  param("clientId").isUUID(4).withMessage("ID client không hợp lệ"),
];

module.exports = {
  HubClientDTO,
  createHubClientSchema,
  updateHubClientSchema,
  clientIdSchema,
  checkAccessSchema,
};
