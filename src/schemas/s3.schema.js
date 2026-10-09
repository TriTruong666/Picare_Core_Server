const { query, param, body } = require("express-validator");

// DTOs

/**
 * DTO cho thông tin object đã upload lên S3.
 */
class S3UploadResultDTO {
  constructor({ key, url, etag }) {
    this.key = key;
    this.url = url;
    this.etag = etag;
  }
  static from(data) {
    return new S3UploadResultDTO(data);
  }
}

/**
 * DTO cho presigned URL trả về client.
 */
class S3PresignedUrlDTO {
  constructor({ presignedUrl, key, expiresIn }) {
    this.presignedUrl = presignedUrl;
    this.key = key;
    this.expiresIn = expiresIn;
  }
  static from(data) {
    return new S3PresignedUrlDTO(data);
  }
}

/**
 * DTO cho object metadata.
 */
class S3ObjectMetaDTO {
  constructor({ key, contentType, contentLength, lastModified, etag }) {
    this.key = key;
    this.contentType = contentType;
    this.contentLength = contentLength;
    this.lastModified = lastModified;
    this.etag = etag;
  }
  static from(data) {
    return new S3ObjectMetaDTO(data);
  }
}

// Validation Schemas

/**
 * Validate query params cho endpoint lấy presigned URL upload/download.
 */
const getPresignedUrlSchema = [
  query("key")
    .notEmpty()
    .withMessage("key là bắt buộc")
    .isString()
    .withMessage("key phải là chuỗi"),
  query("expiresIn")
    .optional()
    .isInt({ min: 60, max: 604800 })
    .withMessage("expiresIn phải là số nguyên từ 60 đến 604800 (giây)")
    .toInt(),
];

/**
 * Validate query params cho endpoint tạo presigned PUT URL.
 */
const getPresignedUploadUrlSchema = [
  query("key")
    .notEmpty()
    .withMessage("key là bắt buộc")
    .isString()
    .withMessage("key phải là chuỗi"),
  query("mimeType")
    .notEmpty()
    .withMessage("mimeType là bắt buộc")
    .isString()
    .withMessage("mimeType phải là chuỗi"),
  query("expiresIn")
    .optional()
    .isInt({ min: 60, max: 3600 })
    .withMessage("expiresIn phải là số nguyên từ 60 đến 3600 (giây)")
    .toInt(),
];

/**
 * Validate param key khi delete / get metadata / check exists.
 */
const keyParamSchema = [
  param("key")
    .notEmpty()
    .withMessage("key là bắt buộc")
    .isString()
    .withMessage("key phải là chuỗi"),
];

const getAssetsSchema = [
  query("search")
    .optional({ checkFalsy: true })
    .isString()
    .trim()
    .isLength({ min: 1, max: 512 }),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
  query("offset").optional().isInt({ min: 0 }).toInt(),
  query("cursor").optional({ checkFalsy: true }).isString().isLength({ min: 1, max: 512 }),
  query("includeUrl").optional({ checkFalsy: true }).isBoolean().toBoolean(),
  query("includeTotal").optional({ checkFalsy: true }).isBoolean().toBoolean(),
  query("expiresIn").optional({ checkFalsy: true }).isInt({ min: 60, max: 604800 }).toInt(),
  query("clientId").optional({ checkFalsy: true }).isUUID(4),
  query("userId").optional({ checkFalsy: true }).isUUID(4),
  query("assetType")
    .optional({ checkFalsy: true })
    .isIn(["image", "video", "document", "audio", "other"]),
];

/**
 * DTO cho kết quả upload của thực tập sinh.
 */
class InternUploadDTO {
  constructor({ key, url, viewUrl, s3RawUrl, originalName, fileSize, mimeType, folder }) {
    this.key = key;
    this.url = url;
    this.viewUrl = viewUrl || url;
    this.s3RawUrl = s3RawUrl;
    this.originalName = originalName;
    this.fileSize = fileSize;
    this.mimeType = mimeType;
    this.folder = folder;
  }
  static from(data) {
    return new InternUploadDTO(data);
  }
}

/**
 * Schema xác thực dữ liệu khi thực tập sinh gọi upload
 */
const internUploadSchema = [
  body("folder")
    .optional()
    .isString()
    .trim()
    .matches(/^[a-zA-Z0-9_\-\/]*$/)
    .withMessage("folder chỉ được chứa ký tự chữ cái, chữ số, dấu gạch nối, gạch dưới và gạch chéo"),
  body("description")
    .optional()
    .isString()
    .trim()
    .isLength({ max: 500 })
    .withMessage("description không được vượt quá 500 ký tự"),
];

module.exports = {
  S3UploadResultDTO,
  S3PresignedUrlDTO,
  S3ObjectMetaDTO,
  InternUploadDTO,
  getPresignedUrlSchema,
  getPresignedUploadUrlSchema,
  keyParamSchema,
  getAssetsSchema,
  internUploadSchema,
};

