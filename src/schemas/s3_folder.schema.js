const { body, param } = require("express-validator");

/**
 * Data Transfer Object (DTO) for S3Folder
 */
class S3FolderDTO {
  constructor(folder) {
    this.folderId = folder.folderId;
    this.name = folder.name;
    this.description = folder.description;
    this.assetCount = folder.assetCount;
    this.totalSize = folder.totalSize;
    this.createdAt = folder.createdAt;
    this.updatedAt = folder.updatedAt;
  }

  static fromFolder(folder) {
    return new S3FolderDTO(folder);
  }

  static fromFolders(folders) {
    return folders.map((f) => new S3FolderDTO(f));
  }
}

/**
 * Validation Schemas
 */
const createFolderSchema = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Tên thư mục không được để trống")
    .isLength({ max: 255 })
    .withMessage("Tên thư mục tối đa 255 ký tự"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("Mô tả tối đa 1000 ký tự"),
];

const updateFolderSchema = [
  param("folderId").isUUID(4).withMessage("ID thư mục không hợp lệ"),
  body("name")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Tên thư mục không được để trống")
    .isLength({ max: 255 })
    .withMessage("Tên thư mục tối đa 255 ký tự"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("Mô tả tối đa 1000 ký tự"),
];

const folderIdParamSchema = [
  param("folderId").isUUID(4).withMessage("ID thư mục không hợp lệ"),
];

module.exports = {
  S3FolderDTO,
  createFolderSchema,
  updateFolderSchema,
  folderIdParamSchema,
};
