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
const slugify = require("slugify");
const s3Client = require("../config/s3.config");
const appConfig = require("../config/app.config");
const S3Asset = require("../models/s3_asset.model");
const S3Folder = require("../models/s3_folder.model");
const { AssetVisibility } = require("../common/enum/s3_asset.enum");
const { BadRequestException } = require("../common/exceptions/BaseException");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const BUCKET = appConfig.s3.bucketName;
const REGION = appConfig.s3.region;

/**
 * S3 Service – Wrapper cho các thao tác với AWS S3
 */
class S3Service {
  async uploadToS3(params) {
    const uploader = new Upload({
      client: s3Client,
      params,
    });
    return uploader.done();
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
    folder = "uploads",
    clientId = null,
    userId = null,
    uploadedBy = null,
    description = null,
    visibility = AssetVisibility.PRIVATE,
    s3Metadata = {},
  }) {
    // 1. Upload lên S3 (không dùng ACL)
    const uploadParams = {
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: mimeType,
      Metadata: s3Metadata,
    };

    const result = await this.uploadToS3(uploadParams);
    const url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

    // 2. Resolve Folder
    let folderId = null;
    if (folder) {
      const [folderRecord] = await S3Folder.findOrCreate({
        where: { name: folder },
        defaults: {
          name: folder,
          description: `Auto-created folder for ${folder}`,
        },
      });
      folderId = folderRecord.folderId;
    }

    // 3. Tạo record trong DB
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
      folderId,
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
    const {
      limit = 20,
      offset = 0,
      includeUrl = true,
      expiresIn = 3600,
    } = options;

    const { rows, count } = await S3Asset.findAndCountAll({
      where: filter,
      limit,
      offset,
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: S3Folder,
          as: "folder",
          attributes: [
            "folderId",
            "name",
            "description",
            "assetCount",
            "totalSize",
          ],
        },
      ],
    });

    if (includeUrl) {
      // Gán thêm presignedUrl cho từng item nếu là private hoặc theo yêu cầu
      for (const asset of rows) {
        if (asset.visibility === AssetVisibility.PRIVATE) {
          asset.setDataValue(
            "presignedUrl",
            await this.getPresignedUrl(asset.s3Key, expiresIn),
          );
        } else {
          asset.setDataValue("presignedUrl", asset.s3Url);
        }
      }
    }

    return { rows, count };
  }

  // ─── DOWNLOAD & MERGE ────────────────────────────────────────────────────────

  /**
   * Lấy stream của một object từ S3.
   * @param {string} key - Object key
   * @returns {Promise<import("@aws-sdk/client-s3").GetObjectCommandOutput>}
   */
  async getDownloadStream(key) {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    return s3Client.send(command);
  }

  /**
   * Ghép 2 video bằng FFmpeg, upload video đã ghép lên S3 và tạo record trong DB.
   * @param {Object} params
   * @param {string} params.mainVideoKey
   * @param {string} params.secondVideoKey
   * @param {string} [params.clientId]
   * @param {string} [params.userId]
   * @param {string} [params.uploadedBy]
   * @param {"public"|"private"} [params.visibility="private"]
   * @returns {Promise<{key, url, etag, record: S3Asset}>}
   */
  async mergeVideos({
    mainVideoKey,
    secondVideoKey,
    clientId = null,
    userId = null,
    uploadedBy = null,
    visibility = AssetVisibility.PRIVATE,
  }) {
    // 1. Kiểm tra sự tồn tại của 2 video
    const [mainExists, secondExists] = await Promise.all([
      this.exists(mainVideoKey),
      this.exists(secondVideoKey),
    ]);

    if (!mainExists) {
      throw new BadRequestException(`Video chính không tồn tại: ${mainVideoKey}`);
    }
    if (!secondExists) {
      throw new BadRequestException(`Video phụ không tồn tại: ${secondVideoKey}`);
    }

    // Tạo thư mục tạm trong workspace
    const tempDir = path.join(process.cwd(), "temp_merged");
    await fs.promises.mkdir(tempDir, { recursive: true });

    const timestamp = Date.now();
    const localMainPath = path.join(tempDir, `main_${timestamp}.webm`);
    const localSecondPath = path.join(tempDir, `second_${timestamp}.webm`);
    const localOutputPath = path.join(tempDir, `merged_${timestamp}.webm`);

    try {
      // 2. Download 2 video về file tạm
      const downloadToFile = async (key, localPath) => {
        const streamData = await this.getDownloadStream(key);
        const writeStream = fs.createWriteStream(localPath);
        await pipeline(streamData.Body, writeStream);
      };

      await Promise.all([
        downloadToFile(mainVideoKey, localMainPath),
        downloadToFile(secondVideoKey, localSecondPath),
      ]);

      // Helper phát hiện stream âm thanh của từng video bằng FFmpeg
      const hasAudio = (localPath) => {
        return new Promise((resolve) => {
          execFile(ffmpegPath, ["-i", localPath], (error, stdout, stderr) => {
            const output = (stderr || "") + (stdout || "");
            const match = /Audio:/i.test(output);
            resolve(match);
          });
        });
      };

      const [mainHasAudio, secondHasAudio] = await Promise.all([
        hasAudio(localMainPath),
        hasAudio(localSecondPath),
      ]);

      // 3. Xây dựng bộ lọc FFmpeg Picture-in-Picture (PiP)
      // Scale video phụ bằng 25% (1/4) chiều rộng video chính và overlay ở góc trên bên phải (cách lề 20px)
      let filterComplex = "[1:v][0:v]scale2ref=w=iw/4:h=-1[pip][mainv]; [mainv][pip]overlay=W-w-20:20[outv]";
      const mapArgs = ["-map", "[outv]"];

      if (mainHasAudio && secondHasAudio) {
        // Trộn âm thanh từ cả 2 video
        filterComplex += "; [0:a][1:a]amix=inputs=2:duration=longest[outa]";
        mapArgs.push("-map", "[outa]");
      } else if (mainHasAudio) {
        // Chỉ lấy âm thanh từ video chính
        mapArgs.push("-map", "0:a");
      } else if (secondHasAudio) {
        // Chỉ lấy âm thanh từ video phụ
        mapArgs.push("-map", "1:a");
      }

      const ffmpegArgs = [
        "-y",
        "-i", localMainPath,
        "-i", localSecondPath,
        "-filter_complex", filterComplex,
        ...mapArgs,
        "-c:v", "libvpx-vp9",
        "-crf", "32",
        "-b:v", "1500k",
        "-deadline", "realtime",
        "-cpu-used", "8",
      ];

      if (mainHasAudio || secondHasAudio) {
        ffmpegArgs.push("-c:a", "libopus");
      }

      ffmpegArgs.push(localOutputPath);

      // 4. Chạy FFmpeg xử lý ghép nối PiP
      await new Promise((resolve, reject) => {
        execFile(
          ffmpegPath,
          ffmpegArgs,
          (error, stdout, stderr) => {
            if (error) {
              reject(new Error(`FFmpeg PIP merge error: ${error.message}. Stderr: ${stderr}`));
            } else {
              resolve({ stdout, stderr });
            }
          }
        );
      });

      // 5. Upload video đã ghép lên S3 và lưu vào DB
      const mergedKey = this.buildKey("merged_videos", `merged_${timestamp}.webm`);
      const fileStream = fs.createReadStream(localOutputPath);
      const fileSize = fs.statSync(localOutputPath).size;

      const result = await this.upload({
        key: mergedKey,
        body: fileStream,
        mimeType: "video/webm",
        originalName: `merged_${timestamp}.webm`,
        fileSize,
        folder: "merged_videos",
        clientId,
        userId,
        uploadedBy,
        visibility,
      });

      return result;
    } finally {
      // 6. Clean up: Xoá tất cả file tạm một cách an toàn
      const cleanFile = async (filePath) => {
        try {
          if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
          }
        } catch (err) {
          console.error(`Lỗi khi xoá file tạm ${filePath}:`, err.message);
        }
      };

      await Promise.all([
        cleanFile(localMainPath),
        cleanFile(localSecondPath),
        cleanFile(localOutputPath),
      ]);
    }
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
    // Tách extension trước khi slugify để không bị mất dấu chấm
    const lastDot = filename.lastIndexOf(".");
    const ext = lastDot !== -1 ? filename.slice(lastDot) : "";
    const name = lastDot !== -1 ? filename.slice(0, lastDot) : filename;
    const slug = slugify(name, { lower: true, strict: true, locale: "vi" });
    return `${folder}/${timestamp}_${slug}${ext}`;
  }
}

module.exports = new S3Service();
