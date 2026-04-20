const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

/**
 * MessageAttachment Model
 * Lưu trữ file đính kèm cho mỗi tin nhắn.
 * Một tin nhắn có thể có nhiều file đính kèm (ảnh, tài liệu, video...).
 *
 * - fileType: loại tổng quát (image, video, audio, document, other).
 * - fileUrl:  URL đầy đủ tới file (S3, CDN, hoặc local storage).
 * - fileSize: kích thước file tính bằng bytes.
 * - thumbnailUrl: ảnh preview/thumbnail (cho image và video).
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
      comment: "URL đầy đủ tới file",
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
  },
  {
    tableName: "message_attachments",
    timestamps: true,
    updatedAt: false,
    indexes: [{ fields: ["message_id"] }],
  }
);

module.exports = MessageAttachment;
