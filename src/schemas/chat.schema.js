const { body, param, query } = require("express-validator");

// ─── DTOs ────────────────────────────────────────────────────────────────────

class MessageDTO {
  constructor(msg) {
    this.id = msg.id;
    this.conversationId = msg.conversationId;
    this.type = msg.type;
    this.content = msg.content;
    this.isEdited = msg.isEdited;
    this.replyToId = msg.replyToId;
    this.replyTo = msg.replyTo || null;
    this.sender = msg.sender
      ? {
          userId: msg.sender.userId,
          name: msg.sender.name,
          role: msg.sender.role,
          isOnline: msg.sender.isOnline,
        }
      : null;
    this.attachments = msg.attachments || [];
    this.createdAt = msg.createdAt;
    this.updatedAt = msg.updatedAt;
  }

  static from(msg) {
    return new MessageDTO(msg);
  }
}

class ConversationDTO {
  constructor(conv) {
    this.id = conv.id;
    this.type = conv.type;
    this.name = conv.name;
    this.avatarUrl = conv.avatarUrl;
    this.lastMessageAt = conv.lastMessageAt;
    this.lastMessage = conv.lastMessage ? MessageDTO.from(conv.lastMessage) : null;
    this.members = (conv.members || []).map((m) => ({
      userId: m.user?.userId || m.userId,
      name: m.user?.name || null,
      role: m.user?.role || "default",
      isOnline: m.user?.isOnline || false,
      chatRole: m.role,
      nickname: m.nickname,
      isMuted: m.isMuted,
      isPinned: m.isPinned,
      lastReadAt: m.lastReadAt,
    }));
    this.myMembership = conv.myMembership || null;
    this.createdAt = conv.createdAt;
  }

  static from(conv) {
    return new ConversationDTO(conv);
  }
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createConversationSchema = [
  body("type")
    .isIn(["private", "group"])
    .withMessage("type phải là 'private' hoặc 'group'"),
  body("memberIds")
    .isArray({ min: 1 })
    .withMessage("memberIds phải là mảng chứa ít nhất 1 phần tử"),
  body("memberIds.*").isUUID().withMessage("Mỗi memberId phải là UUID hợp lệ"),
  body("name")
    .if(body("type").equals("group"))
    .notEmpty()
    .withMessage("Nhóm chat phải có tên"),
];

const getMessagesSchema = [
  param("conversationId").isUUID().withMessage("conversationId không hợp lệ"),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("limit phải từ 1-100"),
  query("before").optional().isISO8601().withMessage("before phải là ISO 8601"),
];

const sendMessageSchema = [
  param("conversationId").isUUID().withMessage("conversationId không hợp lệ"),
  body("type")
    .optional()
    .isIn(["text", "image", "file"])
    .withMessage("type phải là 'text', 'image' hoặc 'file'"),
  body("content")
    .if(body("type").not().isIn(["image", "file"]))
    .notEmpty()
    .withMessage("content không được để trống với tin nhắn text"),
  body("replyToId").optional().isUUID().withMessage("replyToId phải là UUID hợp lệ"),
];

const editMessageSchema = [
  param("messageId").isUUID().withMessage("messageId không hợp lệ"),
  body("content").notEmpty().withMessage("content không được để trống"),
];

const addMembersSchema = [
  param("conversationId").isUUID().withMessage("conversationId không hợp lệ"),
  body("memberIds").isArray({ min: 1 }).withMessage("memberIds phải là mảng không rỗng"),
  body("memberIds.*").isUUID().withMessage("Mỗi memberId phải là UUID hợp lệ"),
];

const updateConversationSchema = [
  param("conversationId").isUUID().withMessage("conversationId không hợp lệ"),
  body("name").optional().notEmpty().withMessage("Tên nhóm không được để trống"),
];

module.exports = {
  MessageDTO,
  ConversationDTO,
  createConversationSchema,
  getMessagesSchema,
  sendMessageSchema,
  editMessageSchema,
  addMembersSchema,
  updateConversationSchema,
};
