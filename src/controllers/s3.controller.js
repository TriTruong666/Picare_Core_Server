const { validationResult } = require("express-validator");
const ResponseHandler = require("../common/response.handler");
const S3Service = require("../services/s3.service");
const { BadRequestException } = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");
const HubClient = require("../models/hub_client.model");
const S3Asset = require("../models/s3_asset.model");
const S3Folder = require("../models/s3_folder.model");
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
      let fileBuffer, mimeType, originalName, fileSize;

      // 1. Trường hợp 1: Upload qua multipart/form-data (multer)
      if (req.file) {
        fileBuffer = req.file.buffer;
        mimeType = req.file.mimetype;
        originalName = req.file.originalname;
        fileSize = req.file.size;
      } 
      // 2. Trường hợp 2: Upload qua JSON (base64 string trong body.file)
      else if (req.body.file && typeof req.body.file === "string") {
        const fileData = req.body.file;
        
        // Kiểm tra xem có phải data URI không (vd: data:image/png;base64,...)
        const matches = fileData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        
        if (matches && matches.length === 3) {
          mimeType = matches[1];
          fileBuffer = Buffer.from(matches[2], "base64");
          fileSize = fileBuffer.length;
          // Lấy tên file từ body hoặc tạo tên mặc định dựa trên mimetype
          originalName = req.body.filename || `upload_${Date.now()}.${mimeType.split("/")[1]}`;
        } else {
          // Nếu không phải data URI, giả định là base64 raw (cần mimeType trong body)
          fileBuffer = Buffer.from(fileData, "base64");
          fileSize = fileBuffer.length;
          mimeType = req.body.mimeType || "application/octet-stream";
          originalName = req.body.filename || `upload_${Date.now()}`;
        }
      }

      if (!fileBuffer) {
        throw new BadRequestException("Không tìm thấy file trong request (hỗ trợ multipart hoặc base64 JSON)");
      }

      const folder = req.body.folder || "uploads";
      const clientId = await S3Controller.resolveClientId(req.body.clientId);
      const description = req.body.description || null;
      const visibility = req.body.visibility || "private";
      const uploadedBy = req.user?.userId || null;

      const key = S3Service.buildKey(folder, originalName);

      const result = await S3Service.upload({
        key,
        body: fileBuffer,
        mimeType,
        originalName,
        fileSize,
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
      if (assetType) filter.assetType = assetType;
      
      // Nếu folder là UUID thì filter theo folderId, nếu là string thì filter theo name của Folder
      if (folder) {
        if (isUuid(folder)) {
          filter.folderId = folder;
        } else {
          // Sequelize include filter
          filter["$folder.name$"] = folder;
        }
      }

      const result = await S3Service.getAssetsFromDb(filter, {
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        includeUrl: includeUrl === "true",
        expiresIn: parseInt(expiresIn, 10),
      });

      const currentPage = Math.floor(parseInt(offset, 10) / parseInt(limit, 10)) + 1;

      return ResponseHandler.paginate(
        res,
        result.rows,
        result.count,
        currentPage,
        limit,
        "Lấy danh sách asset thành công",
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = S3Controller;
