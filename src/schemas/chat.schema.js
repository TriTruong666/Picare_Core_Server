const { body, param, query } = require("express-validator");
const {
  toPublicConversationId,
  isValidConversationIdentifier,
} = require("../common/chat_constants");

// DTOs

class MessageDTO {
  constructor(msg) {
    this.id = msg.id;
    this.conversationId = toPublicConversationId(msg.conversationId);
    this.type = msg.type;
    this.content = msg.content;
    this.metadata = msg.metadata || null;
    this.isPinned = Boolean(msg.isPinned);
    this.isEdited = Boolean(msg.isEdited);
    this.isRecalled = Boolean(msg.isRecalled);
    this.recalledAt = msg.recalledAt || null;
    this.recalledBy = msg.recalledBy || null;
    this.clientMessageId = msg.clientMessageId || null;
    this.replyToId = msg.replyToId;
    this.replyTo = msg.replyTo ? MessageDTO.from(msg.replyTo) : null;
    this.sender = msg.sender
      ? {
          userId: msg.sender.userId,
          name: msg.sender.name,
          role: msg.sender.role,
          isOnline: msg.sender.isOnline,
        }
      : { userId: msg.senderId };
    this.attachments = (msg.attachments || []).map((att) => ({
      id: att.id,
      messageId: att.messageId,
      fileName: att.fileName,
      fileUrl: att.fileUrl,
      s3AssetId: att.s3AssetId || null,
      s3Key: att.s3Key || null,
      fileType: att.fileType,
      mimeType: att.mimeType,
      fileSize: att.fileSize !== undefined && att.fileSize !== null ? Number(att.fileSize) : null,
      thumbnailUrl: att.thumbnailUrl || null,
      width: att.width || null,
      height: att.height || null,
      blurhash: att.blurhash || null,
      durationMs: att.durationMs || null,
      isEncrypted: Boolean(att.isEncrypted),
    }));
    this.reactions = msg.reactions || [];
    this.createdAt = msg.createdAt;
    this.updatedAt = msg.updatedAt;
  }

  static from(msg) {
    if (!msg) return null;
    return new MessageDTO(msg);
  }
}

class ConversationDTO {
  constructor(conv) {
    this.id = toPublicConversationId(conv.id);
    this.type = conv.type;
    this.isSecure = Boolean(conv.isSecure);
    this.createdBy = conv.createdBy;
    this.requiresUnlock = Boolean(conv.isSecure);
    this.name = conv.name;
    this.description = conv.description || null;
    this.avatarUrl = conv.avatarUrl;
    this.scopeSystem = conv.scopeSystem || "CORE";
    this.companyId = conv.companyId || null;
    this.contextType = conv.contextType || null;
    this.contextId = conv.contextId || null;
    this.pinnedCount = Number(conv.pinnedCount || 0);
    this.lastMessageAt = conv.lastMessageAt;
    this.lastMessage = conv.lastMessage
      ? MessageDTO.from(conv.lastMessage)
      : null;
    this.members = (conv.members || []).map((m) => ({
      userId: m.user?.userId || m.userId,
      name: m.user?.name || null,
      role: m.user?.role || "default",
      isOnline: m.user?.isOnline || false,
      chatRole: m.role,
      nickname: m.nickname,
      isMuted: Boolean(m.isMuted),
      isPinned: Boolean(m.isPinned),
      lastReadAt: m.lastReadAt,
      lastReadMessageId: m.lastReadMessageId || null,
      unreadCount: Number(m.unreadCount || 0),
      mentionCount: Number(m.mentionCount || 0),
    }));
    this.myMembership = conv.myMembership || null;
    this.createdAt = conv.createdAt;
  }

  static from(conv) {
    if (!conv) return null;
    return new ConversationDTO(conv);
  }
}

// Validation Schemas

const createConversationSchema = [
  body("isSecure").optional().isBoolean().toBoolean(),
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
  body("description")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 1000 })
    .withMessage("Mô tả nhóm tối đa 1000 ký tự"),
  body("avatarUrl")
    .optional({ nullable: true })
    .isString()
    .withMessage("avatarUrl phải là chuỗi hợp lệ"),
  body("scopeSystem")
    .optional()
    .isIn(["CORE", "OFFICE", "OMS", "WMS", "SFA"])
    .withMessage("scopeSystem không hợp lệ"),
];

const ensureContextConversationSchema = [
  body("contextType").notEmpty().withMessage("contextType là bắt buộc"),
  body("contextId").notEmpty().withMessage("contextId là bắt buộc"),
  body("scopeSystem")
    .optional()
    .isIn(["CORE", "OFFICE", "OMS", "WMS", "SFA"])
    .withMessage("scopeSystem không hợp lệ"),
  body("memberIds")
    .optional()
    .isArray()
    .withMessage("memberIds phải là mảng UUID"),
];

const getMessagesSchema = [
  param("conversationId")
    .custom(isValidConversationIdentifier)
    .withMessage("conversationId không hợp lệ"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit phải từ 1-100"),
  query("before").optional().isISO8601().withMessage("before phải là ISO 8601"),
  query("beforeId")
    .optional()
    .isUUID()
    .withMessage("beforeId phải là UUID hợp lệ"),
];

const searchMessagesSchema = [
  param("conversationId")
    .custom(isValidConversationIdentifier)
    .withMessage("conversationId không hợp lệ"),
  query("q").notEmpty().withMessage("Từ khoá tìm kiếm (q) không được để trống"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage("limit phải từ 1-50"),
];

const sendMessageSchema = [
  param("conversationId")
    .custom(isValidConversationIdentifier)
    .withMessage("conversationId không hợp lệ"),
  body("type")
    .optional()
    .isIn(["text", "image", "file", "system", "entity_card", "sticker", "mixed"])
    .withMessage(
      "type phải là 'text', 'image', 'file', 'system', 'entity_card', 'sticker' hoặc 'mixed'",
    ),
  body("content")
    .if(
      (value, { req }) =>
        ["text", undefined].includes(req.body?.type) &&
        (!Array.isArray(req.body?.attachments) || req.body.attachments.length === 0),
    )
    .notEmpty()
    .withMessage("content không được để trống với tin nhắn text"),
  body("metadata")
    .if(body("type").isIn(["entity_card", "sticker"]))
    .isObject()
    .withMessage("metadata là bắt buộc khi gửi entity_card hoặc sticker"),
  body("replyToId")
    .optional({ nullable: true })
    .isUUID()
    .withMessage("replyToId phải là UUID hợp lệ"),
  body("replyToMessageId")
    .optional({ nullable: true })
    .isUUID()
    .withMessage("replyToMessageId phải là UUID hợp lệ"),
];

const editMessageSchema = [
  param("messageId").isUUID().withMessage("messageId không hợp lệ"),
  body("content").notEmpty().withMessage("content không được để trống"),
];

const addMembersSchema = [
  param("conversationId")
    .custom(isValidConversationIdentifier)
    .withMessage("conversationId không hợp lệ"),
  body("memberIds")
    .isArray({ min: 1 })
    .withMessage("memberIds phải là mảng không rỗng"),
  body("memberIds.*").isUUID().withMessage("Mỗi memberId phải là UUID hợp lệ"),
];

const syncMembersSchema = [
  param("conversationId")
    .custom(isValidConversationIdentifier)
    .withMessage("conversationId không hợp lệ"),
  body("memberIds").isArray().withMessage("memberIds phải là mảng"),
  body("memberIds.*").isUUID().withMessage("Mỗi memberId phải là UUID hợp lệ"),
  body("mode")
    .optional()
    .isIn(["REPLACE", "ADD_ONLY", "REMOVE_ONLY"])
    .withMessage("mode phải là REPLACE, ADD_ONLY hoặc REMOVE_ONLY"),
];

const updateConversationSchema = [
  param("conversationId")
    .custom(isValidConversationIdentifier)
    .withMessage("conversationId không hợp lệ"),
  body("name")
    .optional()
    .notEmpty()
    .withMessage("Tên nhóm không được để trống"),
  body("description")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 1000 })
    .withMessage("Mô tả nhóm tối đa 1000 ký tự"),
  body("avatarUrl")
    .optional({ nullable: true })
    .isString()
    .withMessage("avatarUrl phải là chuỗi hợp lệ"),
];

const pinMessageSchema = [
  param("conversationId")
    .custom(isValidConversationIdentifier)
    .withMessage("conversationId không hợp lệ"),
  param("messageId").isUUID().withMessage("messageId không hợp lệ"),
  body("note")
    .optional()
    .isString()
    .isLength({ max: 255 })
    .withMessage("Ghi chú ghim tối đa 255 ký tự"),
];

const reactionSchema = [
  param("messageId").isUUID().withMessage("messageId không hợp lệ"),
  body("emoji")
    .notEmpty()
    .isString()
    .isLength({ max: 32 })
    .withMessage("emoji không hợp lệ"),
];

const attachmentUploadTicketSchema = [
  param("conversationId")
    .custom(isValidConversationIdentifier)
    .withMessage("conversationId không hợp lệ"),
  body("fileName").notEmpty().withMessage("fileName là bắt buộc"),
  body("mimeType").optional().isString(),
  body("fileSize").optional().isInt({ min: 1 }),
];

const updateEntityCardSnapshotSchema = [
  body("snapshotPatch")
    .isObject()
    .withMessage("snapshotPatch phải là một object"),
];

module.exports = {
  MessageDTO,
  ConversationDTO,
  createConversationSchema,
  ensureContextConversationSchema,
  getMessagesSchema,
  searchMessagesSchema,
  sendMessageSchema,
  editMessageSchema,
  addMembersSchema,
  syncMembersSchema,
  updateConversationSchema,
  pinMessageSchema,
  reactionSchema,
  attachmentUploadTicketSchema,
  updateEntityCardSnapshotSchema,
};
