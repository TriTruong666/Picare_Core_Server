const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

/**
 * Conversation Model
 * Đại diện cho một cuộc hội thoại (chat riêng hoặc chat nhóm) trong Central Chat Hub.
 *
 * - type = "private": Chat riêng giữa 2 người (chỉ có đúng 2 members).
 * - type = "group":   Chat nhóm, nhiều thành viên, có tên nhóm và ảnh đại diện.
 * - scopeSystem:      Hệ thống khởi tạo hoặc quản lý ngữ cảnh (CORE, OFFICE, OMS, WMS, SFA).
 * - encryptedDek:     Khoá mã hoá dữ liệu (Data Encryption Key - 32 bytes) của riêng cuộc hội thoại,
 *                     đã được bọc (wrapped) bằng Master KEK theo chuẩn Envelope Encryption AES-256-GCM.
 */
const Conversation = sequelize.define(
  "Conversation",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    isSecure: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_secure" },
    securityCodeHash: { type: DataTypes.STRING(100), allowNull: true, field: "security_code_hash" },
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
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Mô tả nhóm chat",
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
    scopeSystem: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "CORE",
      field: "scope_system",
      validate: {
        isIn: [["CORE", "OFFICE", "OMS", "WMS", "SFA"]],
      },
      comment: "Hệ thống ngữ cảnh: CORE, OFFICE, OMS, WMS, SFA",
    },
    companyId: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "company_id",
      comment: "Mã công ty liên kết (VD: từ Picare Office / SFA / WMS / OMS)",
    },
    contextType: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "context_type",
      comment: "Loại ngữ cảnh nghiệp vụ (DEPARTMENT, COMPANY_GENERAL, PROJECT, TEAM, ORDER...)",
    },
    contextId: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "context_id",
      comment: "ID thực thể ngữ cảnh nghiệp vụ (departmentId, teamId, orderId...)",
    },
    encryptedDek: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "encrypted_dek",
      comment: "Data Encryption Key (DEK) của hội thoại đã được bọc bằng Master KEK (AES-256-GCM)",
    },
    dekVersion: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      field: "dek_version",
      comment: "Phiên bản Master KEK dùng để bọc DEK (hỗ trợ Key Rotation)",
    },
    pinnedCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "pinned_count",
      comment: "Số lượng tin nhắn đang được ghim trong cuộc hội thoại",
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
      {
        fields: ["scope_system", "company_id", "context_type", "context_id"],
        name: "idx_conversations_scope_context",
      },
    ],
  },
);

Conversation.associate = (models) => {
  if (models.ConversationMember) {
    Conversation.hasMany(models.ConversationMember, {
      foreignKey: "conversationId",
      as: "members",
    });
  }
  if (models.Message) {
    Conversation.hasMany(models.Message, {
      foreignKey: "conversationId",
      as: "messages",
    });
    Conversation.belongsTo(models.Message, {
      foreignKey: "lastMessageId",
      as: "lastMessage",
      constraints: false,
    });
  }
  if (models.PinnedMessage) {
    Conversation.hasMany(models.PinnedMessage, {
      foreignKey: "conversationId",
      as: "pinnedMessages",
    });
  }
};

module.exports = Conversation;
