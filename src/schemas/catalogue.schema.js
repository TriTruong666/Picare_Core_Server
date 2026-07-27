const { body, param, query } = require("express-validator");

class CatalogueDetailDTO {
  constructor(detail) {
    this.catalogueDetailId = detail.catalogueDetailId;
    this.imageUrl = detail.imageUrl;
    this.imageKey = detail.imageKey;
    this.sortOrder = detail.sortOrder;
    this.note = detail.note;
    this.createdAt = detail.createdAt;
    this.updatedAt = detail.updatedAt;
  }
}

class CatalogueDTO {
  constructor(catalogue) {
    this.catalogueId = catalogue.catalogueId;
    this.catalogueName = catalogue.catalogueName;
    this.status = catalogue.status;
    this.note = catalogue.note;
    this.details = (catalogue.details || []).map(
      (detail) => new CatalogueDetailDTO(detail),
    );
    this.createdAt = catalogue.createdAt;
    this.updatedAt = catalogue.updatedAt;
  }

  static fromCatalogue(catalogue) {
    return new CatalogueDTO(catalogue);
  }
}

// Lightweight shape for the management list. It deliberately preserves the
// details array contract, but contains only details[0] as the cover image.
class CatalogueListDTO {
  constructor(catalogue) {
    this.catalogueId = catalogue.catalogueId;
    this.catalogueName = catalogue.catalogueName;
    this.status = catalogue.status;
    this.note = catalogue.note;
    this.details = (catalogue.details || [])
      .slice(0, 1)
      .map((detail) => new CatalogueDetailDTO(detail));
    this.createdAt = catalogue.createdAt;
    this.updatedAt = catalogue.updatedAt;
  }

  static fromCatalogue(catalogue) {
    return new CatalogueListDTO(catalogue);
  }
}

const catalogueIdSchema = [
  param("catalogueId").isUUID(4).withMessage("catalogueId không hợp lệ"),
];

const createCatalogueSchema = [
  body("catalogueName")
    .isString()
    .trim()
    .notEmpty()
    .withMessage("catalogueName không được để trống"),
  body("status")
    .optional()
    .isIn(["ACTIVE", "INACTIVE"])
    .withMessage("status phải là ACTIVE hoặc INACTIVE"),
  body("note").optional({ nullable: true }).isString(),
];

const updateCatalogueSchema = [
  ...catalogueIdSchema,
  body("catalogueName").optional().isString().trim().notEmpty(),
  body("status").optional().isIn(["ACTIVE", "INACTIVE"]),
  body("note").optional({ nullable: true }).isString(),
  body("details").optional().isString(),
  body("removeDetailIds").optional().isString(),
];

const catalogueListSchema = [
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("search").optional().isString().trim(),
  query("status").optional().isIn(["ACTIVE", "INACTIVE"]),
  query("sortBy").optional().isIn(["createdAt", "updatedAt", "catalogueName"]),
  query("sortOrder").optional().isIn(["ASC", "DESC"]),
];

module.exports = {
  CatalogueDTO,
  CatalogueListDTO,
  catalogueIdSchema,
  createCatalogueSchema,
  updateCatalogueSchema,
  catalogueListSchema,
};
