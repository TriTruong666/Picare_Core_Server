const { DataTypes } = require("sequelize");
const sequelize = require("../config/postgres.config");
const { ASSET_VISIBILITY, ASSET_TYPE, AssetVisibility } = require("../common/enum/s3_asset.enum");

/**
 * S3Asset – Lưu metadata của từng file đã upload lên AWS S3.
 *
 * Các UUID liên quan chỉ là metadata, không ràng buộc khóa ngoại.
 */
const S3Asset = sequelize.define(
  "S3Asset",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    assetId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      field: "asset_id",
      comment: "ID định danh duy nhất của asset",
    },

    // ── Liên kết client / User ──────────────────────────────────────────────
    clientId: {
      type: DataTypes.UUID,
      allowNull: true, // null = asset của hệ thống hoặc cá nhân
      field: "client_id",
      comment: "ID client sử dụng tài nguyên này, không ràng buộc khóa ngoại",
    },

    userId: {
      type: DataTypes.UUID,
      allowNull: true, // null = asset của hệ thống hoặc client-level
      field: "user_id",
      comment: "ID user sở hữu tài nguyên này, không ràng buộc khóa ngoại",
    },

    // ── Thông tin lưu trữ S3 ────────────────────────────────────────────────
    s3Key: {
      type: DataTypes.STRING(1024),
      allowNull: false,
      field: "s3_key",
      comment: "Object key trong S3 bucket (vd: avatars/1715604000000_photo.jpg)",
    },

    s3Url: {
      type: DataTypes.STRING(2048),
      allowNull: false,
      field: "s3_url",
      comment: "Public URL hoặc CDN URL của file",
    },

    s3Bucket: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "s3_bucket",
      comment: "Tên bucket chứa file (hỗ trợ multi-bucket sau này)",
    },

    s3Region: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: "s3_region",
      comment: "Region AWS của bucket",
    },

    etag: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "ETag trả về từ S3 sau khi upload thành công",
    },

    // ── Thông tin file ───────────────────────────────────────────────────────
    originalName: {
      type: DataTypes.STRING(512),
      allowNull: false,
      field: "original_name",
      comment: "Tên file gốc khi người dùng upload",
    },

    mimeType: {
      type: DataTypes.STRING(128),
      allowNull: false,
      field: "mime_type",
      comment: "MIME type của file (vd: image/png, application/pdf)",
    },

    assetType: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "other",
      field: "asset_type",
      validate: {
        isIn: [ASSET_TYPE],
      },
      comment: "Nhóm loại file: image | video | document | audio | other",
    },

    fileSize: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      field: "file_size",
      comment: "Kích thước file tính bằng byte",
    },

    visibility: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: AssetVisibility.PRIVATE,
      validate: {
        isIn: [ASSET_VISIBILITY],
      },
      comment: "public = ai cũng truy cập được, private = cần presigned URL",
    },

    // ── Tổ chức / phân loại ──────────────────────────────────────────────────
    folderId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "folder_id",
      comment: "ID thư mục logic, không ràng buộc khóa ngoại",
    },

    tags: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: [],
      comment: "Tags tuỳ chỉnh để tìm kiếm / lọc sau này",
    },

    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Mô tả ngắn về file (tuỳ chọn)",
    },

    // ── Người upload ─────────────────────────────────────────────────────────
    uploadedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "uploaded_by",
      comment: "ID người upload, không ràng buộc khóa ngoại",
    },
  },
  {
    tableName: "s3_assets",
    timestamps: true, // createdAt, updatedAt
    indexes: [
      { name: "s3_assets_asset_id_key", unique: true, fields: ["asset_id"] },
      { fields: ["client_id"] },
      { fields: ["user_id"] },
      { fields: ["asset_type"] },
      { fields: ["uploaded_by"] },
      { fields: ["folder_id"] },
      { unique: true, fields: ["s3_key", "s3_bucket"] }, // Không duplicate key trong cùng bucket
    ],
    hooks: {
      /**
       * Tự động phân loại assetType dựa trên mimeType trước khi tạo/cập nhật.
       */
      beforeSave: (asset) => {
        const mime = (asset.mimeType || "").toLowerCase();
        if (mime.startsWith("image/")) asset.assetType = "image";
        else if (mime.startsWith("video/")) asset.assetType = "video";
        else if (mime.startsWith("audio/")) asset.assetType = "audio";
        else if (
          mime === "application/pdf" ||
          mime.includes("word") ||
          mime.includes("excel") ||
          mime.includes("sheet") ||
          mime.includes("presentation") ||
          mime.startsWith("text/")
        ) {
          asset.assetType = "document";
        } else {
          asset.assetType = "other";
        }
      },
      /**
       * Cập nhật stats cho Folder sau khi tạo asset.
       */
      afterCreate: async (asset) => {
        if (asset.folderId) {
          const S3Folder = sequelize.models.S3Folder;
          await S3Folder.increment(
            { assetCount: 1, totalSize: asset.fileSize || 0 },
            { where: { folderId: asset.folderId } }
          );
        }
      },
      /**
       * Cập nhật stats cho Folder sau khi xóa asset.
       */
      afterDestroy: async (asset) => {
        if (asset.folderId) {
          const S3Folder = sequelize.models.S3Folder;
          await S3Folder.increment(
            { assetCount: -1, totalSize: -(asset.fileSize || 0) },
            { where: { folderId: asset.folderId } }
          );
        }
      },
    },
  },
);

// ─── Static helper ───────────────────────────────────────────────────────────

/**
 * Trả về kích thước file dạng human-readable.
 * @param {number} bytes
 * @returns {string}
 */
S3Asset.formatFileSize = (bytes) => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
};

S3Asset.associate = (db) => {
  S3Asset.belongsTo(db.S3Folder, {
    foreignKey: "folderId",
    targetKey: "folderId",
    as: "folder",
    constraints: false,
  });
};

module.exports = S3Asset;
