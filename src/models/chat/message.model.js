const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

/**
 * Message Model
 * Lưu trữ từng tin nhắn trong cuộc hội thoại.
 *
 * - type: loại nội dung (text, image, file, system).
 *   + "text":   Tin nhắn văn bản thuần.
 *   + "image":  Tin nhắn chứa ảnh (nội dung ảnh lưu ở MessageAttachment).
 *   + "file":   Tin nhắn chứa file đính kèm.
 *   + "system": Tin nhắn hệ thống (thêm/xóa thành viên, đổi tên nhóm...).
 *
 * - replyToId: nếu tin nhắn này reply (trích dẫn) một tin nhắn khác.
 * - isEdited:  đánh dấu tin nhắn đã được chỉnh sửa.
 * - deletedAt: soft-delete (null = chưa xóa).
 */
const Message = sequelize.define(
  "Message",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "conversation_id",
      comment: "FK tới conversations.id",
    },
    senderId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "sender_id",
      comment: "FK tới users.user_id (người gửi)",
    },
    type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "text",
      validate: {
        isIn: [["text", "image", "file", "system"]],
      },
      comment: "Loại tin nhắn: text, image, file, system",
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Nội dung tin nhắn (text hoặc mô tả system event)",
    },
    replyToId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "reply_to_id",
      comment: "FK tới messages.id (tin nhắn được reply)",
    },
    isEdited: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: "is_edited",
      comment: "Tin nhắn đã được chỉnh sửa",
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "deleted_at",
      comment: "Thời điểm xóa tin nhắn (soft-delete, null = chưa xóa)",
    },
  },
  {
    tableName: "messages",
    timestamps: true,
    updatedAt: "updatedAt",
    indexes: [
      { fields: ["conversation_id", "createdAt"] },
      { fields: ["sender_id"] },
      { fields: ["reply_to_id"] },
    ],
  }
);

module.exports = Message;
