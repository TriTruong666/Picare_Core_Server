const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

/**
 * ConversationMember Model
 * Bảng trung gian thể hiện quan hệ N-N giữa User và Conversation.
 *
 * - role: phân quyền trong nhóm (owner, admin, member).
 * - nickname: biệt danh của thành viên trong cuộc hội thoại.
 * - lastReadAt: thời điểm đọc tin nhắn cuối cùng (dùng để đếm tin chưa đọc).
 * - isMuted: tắt thông báo cho cuộc hội thoại này.
 * - isPinned: ghim cuộc hội thoại lên đầu danh sách.
 * - joinedAt: thời điểm tham gia cuộc hội thoại.
 * - leftAt: thời điểm rời nhóm (soft-leave, null nếu còn trong nhóm).
 */
const ConversationMember = sequelize.define(
  "ConversationMember",
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
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "user_id",
      comment: "FK tới users.user_id",
    },
    role: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "member",
      validate: {
        isIn: [["owner", "admin", "member"]],
      },
      comment: "Vai trò trong cuộc hội thoại: owner, admin, member",
    },
    nickname: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "Biệt danh trong cuộc hội thoại",
    },
    lastReadAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "last_read_at",
      comment: "Thời điểm đọc tin nhắn cuối cùng",
    },
    isMuted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: "is_muted",
      comment: "Tắt thông báo cho cuộc hội thoại",
    },
    isPinned: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: "is_pinned",
      comment: "Ghim cuộc hội thoại lên đầu danh sách",
    },
    joinedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false,
      field: "joined_at",
      comment: "Thời điểm tham gia cuộc hội thoại",
    },
    leftAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "left_at",
      comment: "Thời điểm rời nhóm (null = vẫn đang trong nhóm)",
    },
  },
  {
    tableName: "conversation_members",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["conversation_id", "user_id"],
        name: "uq_conversation_member",
      },
      { fields: ["user_id"] },
      { fields: ["conversation_id"] },
    ],
  }
);

module.exports = ConversationMember;
