const { DataTypes } = require("sequelize");
const sequelize = require("../config/postgres.config");
const { ASSET_VISIBILITY, ASSET_TYPE, AssetVisibility } = require("../common/enum/s3_asset.enum");

/**
 * S3Asset – Lưu metadata của từng file đã upload lên AWS S3.
 *
 * Quan hệ:
 *   - BelongsTo HubClient (clientId) → Biết app nào sở hữu tài nguyên này.
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
      unique: true,
      field: "asset_id",
      comment: "ID định danh duy nhất của asset",
    },

    // ── Liên kết client / User ──────────────────────────────────────────────
    clientId: {
      type: DataTypes.UUID,
      allowNull: true, // null = asset của hệ thống hoặc cá nhân
      field: "client_id",
      references: {
        model: "hub_clients",
        key: "client_id",
      },
      comment: "FK → hub_clients.client_id – App sử dụng tài nguyên này",
    },

    userId: {
      type: DataTypes.UUID,
      allowNull: true, // null = asset của hệ thống hoặc client-level
      field: "user_id",
      references: {
        model: "users",
        key: "user_id",
      },
      comment: "FK → users.user_id – User sở hữu tài nguyên này (vd: avatar)",
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
      type: DataTypes.ENUM(...ASSET_TYPE),
      allowNull: false,
      defaultValue: "other",
      field: "asset_type",
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
      type: DataTypes.ENUM(...ASSET_VISIBILITY),
      allowNull: false,
      defaultValue: AssetVisibility.PRIVATE,
      comment: "public = ai cũng truy cập được, private = cần presigned URL",
    },

    // ── Tổ chức / phân loại ──────────────────────────────────────────────────
    folder: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "Thư mục logic trong bucket (vd: avatars, documents)",
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
      references: {
        model: "users",
        key: "user_id",
      },
      comment: "userId của người đã upload file",
    },
  },
  {
    tableName: "s3_assets",
    timestamps: true, // createdAt, updatedAt
    indexes: [
      { fields: ["client_id"] },
      { fields: ["user_id"] },
      { fields: ["asset_type"] },
      { fields: ["uploaded_by"] },
      { fields: ["folder"] },
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

// ─── Associations ────────────────────────────────────────────────────────────
S3Asset.associate = (db) => {
  // S3Asset thuộc về một HubClient
  S3Asset.belongsTo(db.HubClient, {
    foreignKey: "clientId",
    targetKey: "clientId",
    as: "client",
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  });

  // S3Asset thuộc về một User (nếu là tài nguyên cá nhân)
  S3Asset.belongsTo(db.User, {
    foreignKey: "userId",
    targetKey: "userId",
    as: "user",
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  });

  // S3Asset được upload bởi một User
  S3Asset.belongsTo(db.User, {
    foreignKey: "uploadedBy",
    targetKey: "userId",
    as: "uploader",
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  });
};

module.exports = S3Asset;
