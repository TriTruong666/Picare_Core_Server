const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

/**
 * MessageAttachment Model
 * Lưu trữ file đính kèm cho mỗi tin nhắn.
 * Một tin nhắn có thể có nhiều file đính kèm (ảnh, tài liệu, video...).
 *
 * - fileType: loại tổng quát (image, video, audio, document, other).
 * - fileUrl:  URL tới file (hoặc được ký động qua Presigned GET URL khi s3Key tồn tại).
 * - s3AssetId / s3Key: liên kết với s3_assets của Core (private visibility).
 * - width, height, blurhash: phục vụ hiển thị khung ảnh mượt mà trên UI không bị giật layout.
 */
const MessageAttachment = sequelize.define(
  "MessageAttachment",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    messageId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "message_id",
      comment: "FK tới messages.id",
    },
    fileName: {
      type: DataTypes.STRING(500),
      allowNull: false,
      field: "file_name",
      comment: "Tên file gốc khi upload",
    },
    fileUrl: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "file_url",
      comment: "URL tới file (hoặc đường dẫn cơ sở trước khi ký presigned URL)",
    },
    s3AssetId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "s3_asset_id",
      comment: "ID bản ghi s3_assets tương ứng tại Core",
    },
    s3Key: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "s3_key",
      comment: "Object key trên S3 (dùng để cấp Presigned GET URL cho file private)",
    },
    fileType: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "other",
      field: "file_type",
      validate: {
        isIn: [["image", "video", "audio", "document", "other"]],
      },
      comment: "Loại file: image, video, audio, document, other",
    },
    mimeType: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "mime_type",
      comment: "MIME type của file (vd: image/png, application/pdf)",
    },
    fileSize: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "file_size",
      comment: "Kích thước file (bytes)",
    },
    thumbnailUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "thumbnail_url",
      comment: "URL ảnh thumbnail/preview",
    },
    width: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "width",
      comment: "Chiều rộng ảnh/video (px)",
    },
    height: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "height",
      comment: "Chiều cao ảnh/video (px)",
    },
    blurhash: {
      type: DataTypes.STRING(120),
      allowNull: true,
      field: "blurhash",
      comment: "Chuỗi BlurHash dùng để hiển thị khung chờ ảnh tức thì",
    },
    durationMs: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "duration_ms",
      comment: "Thời lượng video/audio (ms)",
    },
    isEncrypted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_encrypted",
      comment: "Đánh dấu file đã được mã hoá nội dung",
    },
  },
  {
    tableName: "message_attachments",
    timestamps: true,
    updatedAt: false,
    indexes: [
      { fields: ["message_id"] },
      { fields: ["s3_key"], name: "idx_message_attachments_s3_key" },
    ],
  },
);

MessageAttachment.associate = (models) => {
  if (models.Message) {
    MessageAttachment.belongsTo(models.Message, {
      foreignKey: "messageId",
      as: "message",
    });
  }
};

module.exports = MessageAttachment;
