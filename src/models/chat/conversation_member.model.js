const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

/**
 * ConversationMember Model
 * Bảng trung gian thể hiện quan hệ N-N giữa User và Conversation.
 *
 * - role: phân quyền trong nhóm (owner, admin, member).
 * - nickname: biệt danh của thành viên trong cuộc hội thoại.
 * - lastReadAt: thời điểm đọc tin nhắn cuối cùng.
 * - lastReadMessageId: ID tin nhắn cuối cùng user đã đọc.
 * - unreadCount: số tin nhắn chưa đọc (denormalized để không cần COUNT(*) khi tải danh sách chat).
 * - mentionCount: số lần user được @mention chưa đọc.
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
    lastReadMessageId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "last_read_message_id",
      comment: "ID tin nhắn cuối cùng đã đọc",
    },
    unreadCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "unread_count",
      comment: "Số tin nhắn chưa đọc (denormalized)",
    },
    mentionCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "mention_count",
      comment: "Số lượt @mention chưa đọc",
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
    clearedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "cleared_at",
      comment:
        "Mốc thời gian user xoá lịch sử hội thoại ở phía mình (chỉ xem được tin nhắn tạo sau mốc này)",
    },
    hiddenAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "hidden_at",
      comment:
        "Mốc thời gian ẩn cuộc hội thoại ở phía user (tự mở lại khi có tin nhắn mới)",
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
      {
        fields: ["user_id", "left_at", "is_pinned"],
        name: "idx_conversation_members_active_user",
      },
    ],
  },
);

ConversationMember.associate = (models) => {
  if (models.Conversation) {
    ConversationMember.belongsTo(models.Conversation, {
      foreignKey: "conversationId",
      as: "conversation",
    });
  }
  if (models.User) {
    ConversationMember.belongsTo(models.User, {
      foreignKey: "userId",
      targetKey: "userId",
      as: "user",
      constraints: false,
    });
  }
};

module.exports = ConversationMember;
