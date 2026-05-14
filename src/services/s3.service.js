const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const s3Client = require("../config/s3.config");
const appConfig = require("../config/app.config");
const S3Asset = require("../models/s3_asset.model");
const { AssetVisibility } = require("../common/enum/s3_asset.enum");

const BUCKET = appConfig.s3.bucketName;
const REGION = appConfig.s3.region;

/**
 * S3 Service – Wrapper cho các thao tác với AWS S3
 */
class S3Service {
  resolveAcl(visibility, acl) {
    if (acl) return acl;
    return visibility === AssetVisibility.PUBLIC ? "public-read" : "private";
  }

  async uploadToS3(params) {
    const uploader = new Upload({
      client: s3Client,
      params,
    });

    try {
      return await uploader.done();
    } catch (error) {
      if (params.ACL && error.name === "AccessControlListNotSupported") {
        const { ACL, ...paramsWithoutAcl } = params;
        const retryUploader = new Upload({
          client: s3Client,
          params: paramsWithoutAcl,
        });
        return retryUploader.done();
      }

      throw error;
    }
  }
  // ─── UPLOAD ─────────────────────────────────────────────────────────────────

  /**
   * Upload file buffer/stream lên S3 và tự động tạo record trong bảng s3_assets.
   * @param {Object} params
   * @param {string}            params.key          - Object key trong bucket (vd: "images/avatar.png")
   * @param {Buffer|Readable}   params.body         - Nội dung file
   * @param {string}            params.mimeType     - Content-Type (vd: "image/png")
   * @param {string}            params.originalName - Tên file gốc
   * @param {number}            params.fileSize     - Kích thước file (bytes)
   * @param {"public-read"|"private"} [params.acl="private"] - ACL trên S3
   * @param {string}            [params.folder]     - Thư mục logic (vd: "avatars")
   * @param {string}            [params.clientId]   - UUID của HubClient sở hữu file
   * @param {string}            [params.userId]     - UUID của User sở hữu file (vd: avatar)
   * @param {string}            [params.uploadedBy] - UUID của user đã upload
   * @param {string}            [params.description]- Mô tả ngắn về file
   * @param {"public"|"private"} [params.visibility="private"] - Visibility record DB
   * @param {Object}            [params.s3Metadata] - Metadata tuỳ chỉnh gửi lên S3
   * @returns {Promise<{key, url, etag, record: S3Asset}>}
   */
  async upload({
    key,
    body,
    mimeType,
    originalName,
    fileSize,
    acl,
    folder = "uploads",
    clientId = null,
    userId = null,
    uploadedBy = null,
    description = null,
    visibility = AssetVisibility.PRIVATE,
    s3Metadata = {},
  }) {
    // 1. Upload lên S3
    const resolvedAcl = this.resolveAcl(visibility, acl);
    const uploadParams = {
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: mimeType,
      Metadata: s3Metadata,
    };

    if (resolvedAcl) {
      uploadParams.ACL = resolvedAcl;
    }

    const result = await this.uploadToS3(uploadParams);
    const url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

    // 2. Tạo record trong DB
    const record = await S3Asset.create({
      clientId,
      userId,
      s3Key: key,
      s3Url: url,
      s3Bucket: BUCKET,
      s3Region: REGION,
      etag: result.ETag,
      originalName,
      mimeType,
      fileSize: fileSize || 0,
      visibility,
      folder,
      uploadedBy,
      description,
    });

    return {
      key,
      url,
      etag: result.ETag,
      record,
    };
  }

  // ─── PRESIGNED URL ───────────────────────────────────────────────────────────

  /**
   * Tạo presigned URL để tải file (GET) mà không cần xác thực.
   * @param {string} key          - Object key trong bucket
   * @param {number} [expiresIn=3600] - Thời gian hết hạn (giây)
   * @returns {Promise<string>}   - Presigned URL
   */
  async getPresignedUrl(key, expiresIn = 3600) {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    return getSignedUrl(s3Client, command, { expiresIn });
  }

  /**
   * Tạo presigned URL để upload file (PUT) từ client.
   * @param {string} key          - Object key trong bucket
   * @param {string} mimeType     - Content-Type của file sẽ upload
   * @param {number} [expiresIn=300] - Thời gian hết hạn (giây)
   * @returns {Promise<string>}   - Presigned upload URL
   */
  async getPresignedUploadUrl(key, mimeType, expiresIn = 300) {
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: mimeType,
    });
    return getSignedUrl(s3Client, command, { expiresIn });
  }

  // ─── DELETE ──────────────────────────────────────────────────────────────────

  /**
   * Xoá một object khỏi bucket (chỉ S3, không xoá DB record).
   * @param {string} key - Object key cần xoá
   * @returns {Promise<void>}
   */
  async delete(key) {
    await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  }

  /**
   * Xoá object khỏi S3 và đồng thời xoá record tương ứng trong DB.
   * @param {string} key - Object key cần xoá
   * @returns {Promise<void>}
   */
  async deleteAndRecord(key) {
    await Promise.all([
      s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })),
      S3Asset.destroy({ where: { s3Key: key, s3Bucket: BUCKET } }),
    ]);
  }

  /**
   * Xoá nhiều object cùng lúc (batch delete, tối đa 1000 key/lần).
   * @param {string[]} keys - Danh sách object key cần xoá
   * @returns {Promise<void>}
   */
  async deleteMany(keys) {
    if (!keys || keys.length === 0) return;

    // Chia thành các batch 1000 key
    const BATCH_SIZE = 1000;
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE);
      await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        }),
      );
    }
  }

  // ─── LIST ────────────────────────────────────────────────────────────────────

  /**
   * Liệt kê các object trong bucket theo prefix.
   * @param {string} [prefix=""]     - Prefix để lọc (vd: "images/")
   * @param {number} [maxKeys=1000]  - Số lượng tối đa object trả về
   * @returns {Promise<Array<{key: string, size: number, lastModified: Date}>>}
   */
  async list(prefix = "", maxKeys = 1000) {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      MaxKeys: maxKeys,
    });

    const response = await s3Client.send(command);
    return (response.Contents || []).map((item) => ({
      key: item.Key,
      size: item.Size,
      lastModified: item.LastModified,
    }));
  }

  // ─── HEAD / EXISTS ───────────────────────────────────────────────────────────

  /**
   * Kiểm tra object có tồn tại trong bucket không.
   * @param {string} key - Object key cần kiểm tra
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      return true;
    } catch (err) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Lấy metadata của một object.
   * @param {string} key - Object key
   * @returns {Promise<Object>} - Metadata object
   */
  async getMetadata(key) {
    const response = await s3Client.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    return {
      key,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      lastModified: response.LastModified,
      metadata: response.Metadata,
      etag: response.ETag,
    };
  }

  // ─── DATABASE ASSETS ────────────────────────────────────────────────────────
  /**
   * Lấy danh sách asset từ database kèm theo presigned URL nếu cần.
   * @param {Object} filter - Điều kiện lọc (clientId, userId, folder, etc.)
   * @param {Object} options - Phân trang và cấu hình (limit, offset, includeUrl)
   * @returns {Promise<{rows: S3Asset[], count: number}>}
   */
  async getAssetsFromDb(filter = {}, options = {}) {
    const { limit = 20, offset = 0, includeUrl = true, expiresIn = 3600 } = options;
    
    const { rows, count } = await S3Asset.findAndCountAll({
      where: filter,
      limit,
      offset,
      order: [["createdAt", "DESC"]],
    });

    if (includeUrl) {
      // Gán thêm presignedUrl cho từng item nếu là private hoặc theo yêu cầu
      for (const asset of rows) {
        if (asset.visibility === AssetVisibility.PRIVATE) {
          asset.setDataValue(
            "presignedUrl",
            await this.getPresignedUrl(asset.s3Key, expiresIn)
          );
        } else {
          asset.setDataValue("presignedUrl", asset.s3Url);
        }
      }
    }

    return { rows, count };
  }

  // ─── HELPER ──────────────────────────────────────────────────────────────────

  /**
   * Tạo object key từ folder + tên file gốc, tránh trùng tên bằng timestamp.
   * @param {string} folder   - Thư mục trong bucket (vd: "avatars")
   * @param {string} filename - Tên file gốc (vd: "photo.jpg")
   * @returns {string}        - Key (vd: "avatars/1715604000000_photo.jpg")
   */
  buildKey(folder, filename) {
    const timestamp = Date.now();
    const sanitized = filename.replace(/\s+/g, "_");
    return `${folder}/${timestamp}_${sanitized}`;
  }
}

module.exports = new S3Service();
