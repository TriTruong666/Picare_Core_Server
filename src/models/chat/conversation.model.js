const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

/**
 * Conversation Model
 * Đại diện cho một cuộc hội thoại (chat riêng hoặc chat nhóm).
 *
 * - type = "private": Chat riêng giữa 2 người (chỉ có đúng 2 members).
 * - type = "group":   Chat nhóm, nhiều thành viên, có tên nhóm và ảnh đại diện.
 */
const Conversation = sequelize.define(
  "Conversation",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    type: {
      type: DataTypes.STRING(10),
      allowNull: false,
      validate: {
        isIn: [["private", "group"]],
      },
      comment: "Loại cuộc hội thoại: private (1-1) hoặc group (nhóm)",
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "Tên nhóm chat (chỉ dùng cho group, private để null)",
    },
    avatarUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "avatar_url",
      comment: "URL ảnh đại diện nhóm",
    },
    createdBy: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "created_by",
      comment: "userId của người tạo cuộc hội thoại",
    },
    lastMessageId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "last_message_id",
      comment: "ID tin nhắn cuối cùng (denormalized để query nhanh)",
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "last_message_at",
      comment: "Thời điểm tin nhắn cuối cùng (dùng để sắp xếp danh sách chat)",
    },
  },
  {
    tableName: "conversations",
    timestamps: true,
    indexes: [
      { fields: ["type"] },
      { fields: ["created_by"] },
      { fields: ["last_message_at"] },
    ],
  }
);

module.exports = Conversation;
