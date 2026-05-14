const { validationResult } = require("express-validator");
const ResponseHandler = require("../common/response.handler");
const S3Service = require("../services/s3.service");
const { BadRequestException } = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");
const HubClient = require("../models/hub_client.model");
const { validate: isUuid } = require("uuid");
const {
  S3UploadResultDTO,
  S3PresignedUrlDTO,
  S3ObjectMetaDTO,
} = require("../schemas/s3.schema");

class S3Controller {
  static extractObjectKey(req) {
    const rawKey = req.params?.key ?? req.params?.[0];
    const key = Array.isArray(rawKey) ? rawKey.join("/") : rawKey;
    return key ? decodeURIComponent(key) : key;
  }

  static async resolveClientId(clientId) {
    if (!clientId) return null;
    if (!isUuid(clientId)) {
      throw new BadRequestException("clientId không hợp lệ");
    }

    const client = await HubClient.findOne({
      where: { clientId },
      attributes: ["clientId"],
    });

    if (!client) {
      throw new BadRequestException("clientId không tồn tại");
    }

    return clientId;
  }

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
      const clientId = await S3Controller.resolveClientId(req.body.clientId);
      const description = req.body.description || null;
      const visibility = req.body.visibility || "private";
      const uploadedBy = req.user?.userId || null;

      const key = S3Service.buildKey(folder, req.file.originalname);

      const result = await S3Service.upload({
        key,
        body: req.file.buffer,
        mimeType: req.file.mimetype,
        originalName: req.file.originalname,
        fileSize: req.file.size,
        folder,
        clientId,
        uploadedBy,
        description,
        visibility,
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
      const key = S3Controller.extractObjectKey(req);
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

      const key = S3Controller.extractObjectKey(req);
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

      const key = S3Controller.extractObjectKey(req);
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

  /**
   * GET /api/v1/s3/view/:key
   * Redirect trực tiếp tới presigned URL của S3.
   * Giúp Client dùng thẳng trong thẻ <img> mà không cần gọi API lấy URL trước.
   */
  static async viewObject(req, res, next) {
    try {
      const key = S3Controller.extractObjectKey(req);
      const expiresIn = parseInt(req.query.expiresIn, 10) || 3600;

      const presignedUrl = await S3Service.getPresignedUrl(key, expiresIn);

      // Redirect 302 tới S3
      return res.redirect(presignedUrl);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/s3/assets
   * Lấy danh sách asset từ database.
   */
  static async getAssets(req, res, next) {
    try {
      const {
        clientId,
        userId,
        folder,
        assetType,
        limit = 20,
        offset = 0,
        includeUrl = "true",
        expiresIn = 3600,
      } = req.query;

      const filter = {};
      if (clientId) filter.clientId = clientId;
      if (userId) filter.userId = userId;
      if (folder) filter.folder = folder;
      if (assetType) filter.assetType = assetType;

      const result = await S3Service.getAssetsFromDb(filter, {
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        includeUrl: includeUrl === "true",
        expiresIn: parseInt(expiresIn, 10),
      });

      return ResponseHandler.success(
        res,
        result,
        "Lấy danh sách asset thành công",
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = S3Controller;
