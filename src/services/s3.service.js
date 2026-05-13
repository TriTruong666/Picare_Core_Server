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

const BUCKET = appConfig.s3.bucketName;

/**
 * S3 Service – Wrapper cho các thao tác với AWS S3
 */
class S3Service {
  // ─── UPLOAD ─────────────────────────────────────────────────────────────────

  /**
   * Upload file buffer/stream lên S3 (hỗ trợ multipart tự động).
   * @param {Object} params
   * @param {string}          params.key        - Đường dẫn object trong bucket (vd: "images/avatar.png")
   * @param {Buffer|Readable} params.body       - Nội dung file
   * @param {string}          params.mimeType   - Content-Type (vd: "image/png")
   * @param {"public-read"|"private"} [params.acl="private"] - Quyền truy cập
   * @param {Object}          [params.metadata] - Metadata tuỳ chỉnh
   * @returns {Promise<{key: string, url: string, etag: string}>}
   */
  async upload({ key, body, mimeType, acl = "private", metadata = {} }) {
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: mimeType,
        ACL: acl,
        Metadata: metadata,
      },
    });

    const result = await upload.done();

    return {
      key,
      url: `https://${BUCKET}.s3.${appConfig.s3.region}.amazonaws.com/${key}`,
      etag: result.ETag,
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
   * Xoá một object khỏi bucket.
   * @param {string} key - Object key cần xoá
   * @returns {Promise<void>}
   */
  async delete(key) {
    await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
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
