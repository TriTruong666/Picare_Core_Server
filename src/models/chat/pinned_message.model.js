const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

/**
 * PinnedMessage Model
 * Lưu danh sách các tin nhắn được ghim trong một cuộc hội thoại.
 */
const PinnedMessage = sequelize.define(
  "PinnedMessage",
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
    messageId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "message_id",
      comment: "FK tới messages.id",
    },
    pinnedBy: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "pinned_by",
      comment: "userId của người thực hiện ghim",
    },
    note: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "note",
      comment: "Ghi chú ngắn khi ghim tin nhắn",
    },
    pinOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "pin_order",
      comment: "Thứ tự ưu tiên hiển thị trên thanh ghim",
    },
  },
  {
    tableName: "pinned_messages",
    timestamps: true,
    updatedAt: false,
    indexes: [
      {
        unique: true,
        fields: ["conversation_id", "message_id"],
        name: "uq_pinned_messages_conv_msg",
      },
      {
        fields: ["conversation_id", "pin_order", "createdAt"],
        name: "idx_pinned_messages_conv_order",
      },
    ],
  },
);

PinnedMessage.associate = (models) => {
  if (models.Conversation) {
    PinnedMessage.belongsTo(models.Conversation, {
      foreignKey: "conversationId",
      as: "conversation",
    });
  }
  if (models.Message) {
    PinnedMessage.belongsTo(models.Message, {
      foreignKey: "messageId",
      as: "message",
    });
  }
  if (models.User) {
    PinnedMessage.belongsTo(models.User, {
      foreignKey: "pinnedBy",
      targetKey: "userId",
      as: "pinner",
      constraints: false,
    });
  }
};

module.exports = PinnedMessage;

