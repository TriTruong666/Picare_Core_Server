const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

/**
 * MessageReaction Model
 * Lưu biểu cảm (emoji reactions) của thành viên trên từng tin nhắn.
 */
const MessageReaction = sequelize.define(
  "MessageReaction",
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
    emoji: {
      type: DataTypes.STRING(32),
      allowNull: false,
      field: "emoji",
      comment: "Ký tự hoặc mã emoji (VD: 👍, ❤️, ✅, 👀)",
    },
  },
  {
    tableName: "message_reactions",
    timestamps: true,
    updatedAt: false,
    indexes: [
      {
        unique: true,
        fields: ["message_id", "user_id", "emoji"],
        name: "uq_message_reactions_msg_user_emoji",
      },
      {
        fields: ["message_id"],
        name: "idx_message_reactions_msg",
      },
    ],
  },
);

MessageReaction.associate = (models) => {
  if (models.Message) {
    MessageReaction.belongsTo(models.Message, {
      foreignKey: "messageId",
      as: "message",
    });
  }
  if (models.User) {
    MessageReaction.belongsTo(models.User, {
      foreignKey: "userId",
      targetKey: "userId",
      as: "user",
      constraints: false,
    });
  }
};

module.exports = MessageReaction;

