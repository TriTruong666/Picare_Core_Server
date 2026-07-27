const { query, param } = require("express-validator");

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

module.exports = {
  S3UploadResultDTO,
  S3PresignedUrlDTO,
  S3ObjectMetaDTO,
  getPresignedUrlSchema,
  getPresignedUploadUrlSchema,
  keyParamSchema,
  getAssetsSchema,
};
