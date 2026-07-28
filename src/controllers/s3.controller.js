const { validationResult } = require("express-validator");
const { randomUUID } = require("crypto");
const mime = require("mime-types");
const ResponseHandler = require("../common/response.handler");
const S3Service = require("../services/s3.service");
const UploadStagingService = require("../services/upload_staging.service");
const { packageVideoQueue, s3UploadQueue } = require("../jobs/queues");
const {
  BadRequestException,
  NotFoundException,
} = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");
const HubClient = require("../models/hub_client.model");
const S3Asset = require("../models/s3_asset.model");
const S3Folder = require("../models/s3_folder.model");
const { validate: isUuid } = require("uuid");
const {
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
        } else {
          // Nếu không phải data URI, giả định là base64 raw (cần mimeType trong body)
          fileBuffer = Buffer.from(fileData, "base64");
          fileSize = fileBuffer.length;
          mimeType = req.body.mimeType || "application/octet-stream";
        }
        
        const ext = mime.extension(mimeType) || mimeType.split("/")[1] || "bin";
        originalName = req.body.filename || `upload_${Date.now()}.${ext}`;
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

      const jobId = `s3-upload-${Date.now()}-${randomUUID()}`;
      const tempFilePath =
        await UploadStagingService.stageBuffer(fileBuffer);
      let job;
      try {
        job = await s3UploadQueue.add(
          "upload-file",
          {
            key,
            tempFilePath,
            mimeType,
            originalName,
            fileSize,
            folder,
            clientId,
            uploadedBy,
            description,
            visibility,
            allowExisting: true,
            requestedAt: new Date().toISOString(),
          },
          { jobId },
        );
      } catch (error) {
        await UploadStagingService.remove(tempFilePath).catch(() => {});
        throw error;
      }

      return ResponseHandler.created(
        res,
        {
          jobId: job.id,
          key,
          status: "queued",
        },
        "Yêu cầu upload đã được tiếp nhận và đang xử lý trong nền",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/s3/upload/jobs/:jobId
   * Get the status and result of a background upload.
   */
  static async getUploadJobStatus(req, res, next) {
    try {
      const job = await s3UploadQueue.getJob(req.params.jobId);
      if (!job) {
        throw new NotFoundException("Không tìm thấy job upload");
      }

      const status = await job.getState();
      const isTerminal = status === "completed" || status === "failed";

      return ResponseHandler.success(res, {
        jobId: job.id,
        status,
        shouldPoll: !isTerminal,
        progress: job.progress,
        result: job.returnvalue || null,
        failedReason: job.failedReason || null,
        requestedAt: job.data?.requestedAt || null,
        createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
        processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
        finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      }, "Lấy trạng thái job upload thành công");
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
      await S3Service.deleteAndRecord(key);

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
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const {
        clientId,
        userId,
        folder,
        assetType,
        search,
        limit = 20,
        offset,
        cursor,
        includeTotal = "false",
        includeUrl = "false",
        expiresIn = 3600,
      } = req.query;

      if (offset !== undefined && cursor) {
        throw new BadRequestException("Chỉ dùng cursor hoặc offset, không dùng đồng thời cả hai");
      }

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
        limit: Number(limit),
        offset: Number(offset || 0),
        cursor: cursor || null,
        // Passing offset explicitly preserves the old count/offset response.
        // New calls use cursor pagination and skip COUNT(*) by default.
        useCursor: offset === undefined,
        includeTotal: includeTotal === true || includeTotal === "true",
        includeUrl: includeUrl === true || includeUrl === "true",
        expiresIn: Number(expiresIn),
        search,
      });

      if (offset !== undefined) {
        const currentPage = Math.floor(Number(offset) / Number(limit)) + 1;
        return ResponseHandler.paginate(
          res,
          result.rows,
          result.count,
          currentPage,
          limit,
          "Lấy danh sách asset thành công",
        );
      }

      return ResponseHandler.success(
        res,
        {
          assets: result.rows,
          pagination: {
            limit: Number(limit),
            hasNext: result.hasNext,
            nextCursor: result.nextCursor,
            ...((includeTotal === true || includeTotal === "true") && {
              totalRecords: result.count,
            }),
          },
        },
        "Lấy danh sách asset thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/s3/download/:key
   * Tải một file trực tiếp từ S3 về máy client (hỗ trợ mọi loại file).
   */
  static async downloadObject(req, res, next) {
    try {
      const key = req.query.key || S3Controller.extractObjectKey(req);
      if (!key) {
        throw new BadRequestException("Thiếu key file cần tải");
      }

      // Tìm tên file gốc trong DB nếu có
      const asset = await S3Asset.findOne({
        where: { s3Key: key }
      });
      let filename = key.split("/").pop();
      if (asset && asset.originalName) {
        filename = asset.originalName;
      }

      const streamData = await S3Service.getDownloadStream(key);

      res.setHeader("Content-Type", streamData.ContentType || "application/octet-stream");
      if (streamData.ContentLength) {
        res.setHeader("Content-Length", streamData.ContentLength);
      }
      
      const encodedFilename = encodeURIComponent(filename);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`
      );

      streamData.Body.pipe(res);
    } catch (error) {
      if (error.name === "NoSuchKey") {
        return next(new BadRequestException("File không tồn tại trên S3"));
      }
      next(error);
    }
  }

  /**
   * POST /api/v1/s3/merge-videos
   * Ghép 2 video bằng FFmpeg và upload lên S3.
   */
  static async mergeVideos(req, res, next) {
    try {
      const mainVideoKey = req.body.mainVideoKey || req.body.firstVideoKey || req.body.videoKey1;
      const secondVideoKey = req.body.secondVideoKey || req.body.videoKey2;

      if (!mainVideoKey || !secondVideoKey) {
        throw new BadRequestException("Thiếu mainVideoKey hoặc secondVideoKey");
      }

      const clientId = await S3Controller.resolveClientId(req.body.clientId);
      const visibility = req.body.visibility || "private";
      const uploadedBy = req.user?.userId || null;
      const rawOverlayText =
        req.body.overlayText || req.body.mergeText || req.body.captionText;
      const overlayText =
        typeof rawOverlayText === "string" ? rawOverlayText : null;
      const jobId = `merge-videos-${Date.now()}-${randomUUID()}`;

      console.log("[S3]: merge-videos enqueue", {
        jobId,
        mainVideoKey,
        secondVideoKey,
        hasOverlayText: Boolean(overlayText),
        overlayText,
        visibility,
        uploadedBy,
      });

      const job = await packageVideoQueue.add(
        "merge-videos",
        {
          mainVideoKey,
          secondVideoKey,
          overlayText,
          clientId,
          uploadedBy,
          visibility,
          requestedAt: new Date().toISOString(),
        },
        { jobId },
      );

      return ResponseHandler.created(
        res,
        {
          jobId: job.id,
          clientId,
        },
        "Yêu cầu ghép video đã được tiếp nhận. Kết quả sẽ được thông báo qua hệ thống.",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/s3/merge-videos/jobs/:jobId
   * Lấy trạng thái job ghép video.
   */
  static async getMergeVideoJobStatus(req, res, next) {
    try {
      const { jobId } = req.params;
      const job = await packageVideoQueue.getJob(jobId);

      if (!job) {
        throw new NotFoundException("Không tìm thấy job ghép video");
      }

      const state = await job.getState();
      const progress = job.progress;
      const result = job.returnvalue || null;
      const isTerminal = state === "completed" || state === "failed";

      if (isTerminal) {
        res.once("finish", () => {
          job.remove().catch((error) => {
            console.error("[S3]: failed to remove terminal merge job", {
              jobId: job.id,
              message: error.message,
            });
          });
        });
      }

      return ResponseHandler.success(
        res,
        {
          jobId: job.id,
          status: state,
          shouldPoll: !isTerminal,
          progress,
          result,
          failedReason: job.failedReason || null,
          requestedAt: job.data?.requestedAt || null,
          createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
          processedAt: job.processedOn
            ? new Date(job.processedOn).toISOString()
            : null,
          finishedAt: job.finishedOn
            ? new Date(job.finishedOn).toISOString()
            : null,
        },
        "Lấy trạng thái job ghép video thành công",
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = S3Controller;
