const Conversation = require("./conversation.model");
const ConversationMember = require("./conversation_member.model");
const Message = require("./message.model");
const MessageAttachment = require("./message_attachment.model");
const User = require("../user.model");

// ──────────────────────────────────────────────
// Conversation ↔ ConversationMember (1:N)
// ──────────────────────────────────────────────
Conversation.hasMany(ConversationMember, {
  foreignKey: "conversationId",
  as: "members",
});
ConversationMember.belongsTo(Conversation, {
  foreignKey: "conversationId",
  as: "conversation",
});

// ──────────────────────────────────────────────
// User ↔ ConversationMember (1:N)
// ──────────────────────────────────────────────
User.hasMany(ConversationMember, {
  foreignKey: "userId",
  sourceKey: "userId",
  as: "chatMemberships",
});
ConversationMember.belongsTo(User, {
  foreignKey: "userId",
  targetKey: "userId",
  as: "user",
});

// ──────────────────────────────────────────────
// Conversation ↔ Message (1:N)
// ──────────────────────────────────────────────
Conversation.hasMany(Message, {
  foreignKey: "conversationId",
  as: "messages",
});
Message.belongsTo(Conversation, {
  foreignKey: "conversationId",
  as: "conversation",
});

// ──────────────────────────────────────────────
// User ↔ Message (1:N) — Sender
// ──────────────────────────────────────────────
User.hasMany(Message, {
  foreignKey: "senderId",
  sourceKey: "userId",
  as: "sentMessages",
});
Message.belongsTo(User, {
  foreignKey: "senderId",
  targetKey: "userId",
  as: "sender",
});

// ──────────────────────────────────────────────
// Message ↔ Message (Self-referencing) — Reply
// ──────────────────────────────────────────────
Message.belongsTo(Message, {
  foreignKey: "replyToId",
  as: "replyTo",
});
Message.hasMany(Message, {
  foreignKey: "replyToId",
  as: "replies",
});

// ──────────────────────────────────────────────
// Message ↔ MessageAttachment (1:N)
// ──────────────────────────────────────────────
Message.hasMany(MessageAttachment, {
  foreignKey: "messageId",
  as: "attachments",
});
MessageAttachment.belongsTo(Message, {
  foreignKey: "messageId",
  as: "message",
});

// ──────────────────────────────────────────────
// Conversation ↔ Message — lastMessage (optional eager load)
// ──────────────────────────────────────────────
Conversation.belongsTo(Message, {
  foreignKey: "lastMessageId",
  as: "lastMessage",
  constraints: false,
});

// ──────────────────────────────────────────────
// Conversation ↔ User — createdBy
// ──────────────────────────────────────────────
Conversation.belongsTo(User, {
  foreignKey: "createdBy",
  targetKey: "userId",
  as: "creator",
  constraints: false,
});

module.exports = {
  Conversation,
  ConversationMember,
  Message,
  MessageAttachment,
};
