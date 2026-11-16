const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

/**
 * Message Model
 * Lưu trữ từng tin nhắn trong cuộc hội thoại với cơ chế mã hoá AES-256-GCM + AAD.
 *
 * - type: loại nội dung (text, image, file, system, entity_card, mixed).
 *   + "text":        Tin nhắn văn bản thuần.
 *   + "image":       Tin nhắn chứa ảnh (nội dung ảnh lưu ở MessageAttachment).
 *   + "file":        Tin nhắn chứa file đính kèm.
 *   + "system":      Tin nhắn hệ thống (thêm/xóa thành viên, đổi tên nhóm, ghim tin nhắn...).
 *   + "entity_card": Thẻ nghiệp vụ liên hệ thống (Đơn hàng SFA/OMS, Phiếu kho WMS, Đơn duyệt chi Office...).
 *   + "mixed":       Tin nhắn kết hợp văn bản + file + thẻ nghiệp vụ.
 *
 * - ciphertext, iv, authTag, keyVersion: Dữ liệu nội dung đã mã hoá AES-256-GCM.
 * - searchTokens: Mảng HMAC-SHA256 blind index để tìm kiếm từ khoá mà không lộ bản rõ.
 * - metadata / encryptedMetadata: Dữ liệu thẻ nghiệp vụ (Entity Card), mentions, v.v.
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
        isIn: [["text", "image", "file", "system", "entity_card", "mixed"]],
      },
      comment: "Loại tin nhắn: text, image, file, system, entity_card, mixed",
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Nội dung tin nhắn (để null khi đã bật mã hoá ciphertext, giữ tương thích ngược cho dữ liệu cũ)",
    },
    ciphertext: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "ciphertext",
      comment: "Bản mã AES-256-GCM (base64) của nội dung tin nhắn",
    },
    iv: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: "iv",
      comment: "Initialization Vector 12-byte (base64) dùng cho AES-256-GCM",
    },
    authTag: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: "auth_tag",
      comment: "Authentication Tag 16-byte (base64) xác thực toàn vẹn dữ liệu + AAD",
    },
    keyVersion: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      field: "key_version",
      comment: "Phiên bản khoá mã hoá tại thời điểm ghi tin nhắn",
    },
    searchTokens: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      allowNull: false,
      defaultValue: [],
      field: "search_tokens",
      comment: "Mảng blind-index HMAC-SHA256 phục vụ tìm kiếm trên dữ liệu mã hoá",
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "metadata",
      comment: "Metadata chỉ mục không nhạy cảm (entityType, sourceSystem, entityId, entityCode, mentions)",
    },
    encryptedMetadata: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "encrypted_metadata",
      comment: "Bản mã AES-256-GCM của toàn bộ payload Entity Card (bao gồm snapshot chi tiết)",
    },
    metadataIv: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: "metadata_iv",
      comment: "IV (base64) cho encrypted_metadata",
    },
    metadataAuthTag: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: "metadata_auth_tag",
      comment: "AuthTag (base64) cho encrypted_metadata",
    },
    clientMessageId: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "client_message_id",
      comment: "ID tạm phía client/gRPC caller dùng để chống gửi trùng (idempotency)",
    },
    replyToId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "reply_to_id",
      comment: "FK tới messages.id (tin nhắn được reply)",
    },
    isPinned: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_pinned",
      comment: "Đánh dấu tin nhắn đang được ghim trong cuộc hội thoại",
    },
    isEdited: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: "is_edited",
      comment: "Tin nhắn đã được chỉnh sửa",
    },
    isRecalled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_recalled",
      comment: "Đánh dấu tin nhắn đã được thu hồi bởi người gửi (áp dụng cho toàn bộ hội thoại)",
    },
    recalledAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "recalled_at",
      comment: "Thời điểm người gửi thu hồi tin nhắn",
    },
    recalledBy: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "recalled_by",
      comment: "User ID người thực hiện thu hồi tin nhắn",
    },
    deletedForUserIds: {
      type: DataTypes.ARRAY(DataTypes.UUID),
      allowNull: false,
      defaultValue: [],
      field: "deleted_for_user_ids",
      comment: "Danh sách user_id đã xoá tin nhắn này ở phía riêng của họ (xoá ở phía tôi)",
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
      {
        fields: ["conversation_id", "createdAt", "id"],
        name: "idx_messages_conv_cursor",
      },
      { fields: ["sender_id"] },
      { fields: ["reply_to_id"] },
      {
        unique: true,
        fields: ["conversation_id", "sender_id", "client_message_id"],
        name: "uq_messages_client_idempotency",
      },
    ],
  },
);

Message.associate = (models) => {
  if (models.Conversation) {
    Message.belongsTo(models.Conversation, {
      foreignKey: "conversationId",
      as: "conversation",
    });
  }
  if (models.User) {
    Message.belongsTo(models.User, {
      foreignKey: "senderId",
      targetKey: "userId",
      as: "sender",
      constraints: false,
    });
  }
  Message.belongsTo(Message, {
    foreignKey: "replyToId",
    as: "replyTo",
  });
  Message.hasMany(Message, {
    foreignKey: "replyToId",
    as: "replies",
  });
  if (models.MessageAttachment) {
    Message.hasMany(models.MessageAttachment, {
      foreignKey: "messageId",
      as: "attachments",
    });
  }
  if (models.PinnedMessage) {
    Message.hasOne(models.PinnedMessage, {
      foreignKey: "messageId",
      as: "pinDetail",
    });
  }
  if (models.MessageReaction) {
    Message.hasMany(models.MessageReaction, {
      foreignKey: "messageId",
      as: "reactions",
    });
  }
};

module.exports = Message;
