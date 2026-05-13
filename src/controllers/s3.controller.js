const { validationResult } = require("express-validator");
const ResponseHandler = require("../common/response.handler");
const S3Service = require("../services/s3.service");
const { BadRequestException } = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");
const {
  S3UploadResultDTO,
  S3PresignedUrlDTO,
  S3ObjectMetaDTO,
} = require("../schemas/s3.schema");

class S3Controller {
  /**
   * POST /api/v1/s3/upload
   * Upload một file lên S3 qua multipart/form-data.
   * File được attach qua field "file", folder được chỉ định qua body.folder.
   */
  static async uploadFile(req, res, next) {
    try {
      if (!req.file) {
        throw new BadRequestException("Không tìm thấy file trong request");
      }

      const folder = req.body.folder || "uploads";
      const key = S3Service.buildKey(folder, req.file.originalname);

      const result = await S3Service.upload({
        key,
        body: req.file.buffer,
        mimeType: req.file.mimetype,
      });

      return ResponseHandler.created(
        res,
        S3UploadResultDTO.from(result),
        "Upload file thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/s3/presigned-url?key=...&expiresIn=...
   * Tạo presigned URL để download file (GET) từ S3.
   */
  static async getPresignedDownloadUrl(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { key, expiresIn = 3600 } = req.query;
      const presignedUrl = await S3Service.getPresignedUrl(key, expiresIn);

      return ResponseHandler.success(
        res,
        S3PresignedUrlDTO.from({ presignedUrl, key, expiresIn }),
        "Tạo presigned download URL thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/s3/presigned-upload-url?key=...&mimeType=...&expiresIn=...
   * Tạo presigned URL để client upload trực tiếp lên S3 (PUT).
   */
  static async getPresignedUploadUrl(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { key, mimeType, expiresIn = 300 } = req.query;
      const presignedUrl = await S3Service.getPresignedUploadUrl(
        key,
        mimeType,
        expiresIn,
      );

      return ResponseHandler.success(
        res,
        S3PresignedUrlDTO.from({ presignedUrl, key, expiresIn }),
        "Tạo presigned upload URL thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/s3/objects/:key
   * Xoá một object khỏi S3 theo key (key truyền qua param, encode nếu có "/").
   */
  static async deleteObject(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      // Cho phép key có chứa "/" bằng cách dùng wildcard route
      const key = req.params[0] || req.params.key;
      await S3Service.delete(key);

      return ResponseHandler.success(res, null, "Xoá object thành công");
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/s3/objects?prefix=...&maxKeys=...
   * Liệt kê các object trong bucket theo prefix.
   */
  static async listObjects(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { prefix = "", maxKeys = 100 } = req.query;
      const objects = await S3Service.list(prefix, maxKeys);

      return ResponseHandler.success(
        res,
        objects,
        "Lấy danh sách object thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/s3/objects/exists/:key
   * Kiểm tra object có tồn tại trong bucket không.
   */
  static async checkExists(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const key = req.params[0] || req.params.key;
      const exists = await S3Service.exists(key);

      return ResponseHandler.success(
        res,
        { key, exists },
        exists ? "Object tồn tại" : "Object không tồn tại",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/s3/objects/metadata/:key
   * Lấy metadata của một object trong S3.
   */
  static async getMetadata(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const key = req.params[0] || req.params.key;
      const metadata = await S3Service.getMetadata(key);

      return ResponseHandler.success(
        res,
        S3ObjectMetaDTO.from(metadata),
        "Lấy metadata thành công",
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = S3Controller;
