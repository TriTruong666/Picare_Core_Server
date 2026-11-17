const express = require("express");
const multer = require("multer");
const router = express.Router();
const ChatController = require("../controllers/chat.controller");
const { protect } = require("../middlewares/auth.middleware");
const { resolveDbConversationId } = require("../common/chat_constants");
const {
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
} = require("../schemas/chat.schema");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize:
      (parseInt(process.env.CHAT_MAX_UPLOAD_MB, 10) || 50) * 1024 * 1024,
  },
});

// Tất cả chat routes đều yêu cầu đăng nhập
router.use(protect);
const security = require("../services/chat_security.service");
const redis = require("../config/redis.config");
const { Conversation, ConversationMember } = require("../models/chat");
router.use(async (req, res, next) => {
  try {
    const code = req.get("x-chat-security-code");
    const match = req.path.match(/^\/conversations\/([^/]+)/);
    if (code && (typeof code !== "string" || code.length !== 10)) return res.status(403).json({ message: "Mã bảo mật không hợp lệ" });
    if (code) {
      const key = `chat-unlock:${req.user.userId}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 60);
      if (count > 120) return res.status(429).json({ message: "Vui lòng thử lại sau một phút" });
    }
    res.set("Cache-Control", "no-store");
    return security.context.run({ code, conversationId: resolveDbConversationId(match?.[1]), role: req.user.role, secureIds: new Set() }, () => next());
  } catch (error) { next(error); }
});
router.param("conversationId", (req, _res, next, value) => {
  req.params.conversationId = resolveDbConversationId(value);
  next();
});
router.post("/conversations/:conversationId/security/destroy", async (req, res, next) => {
  try {
    const ChatService = require("../services/chat.service");
    const result = await ChatService.destroyRoomSecurity(
      req.params.conversationId,
      req.user.userId,
    );
    return res.json({ success: true, data: result });
  } catch (error) { next(error); }
});
router.post("/conversations/:conversationId/unlock", async (req, res, next) => {
  try {
    const id = req.params.conversationId;
    const member = await ConversationMember.findOne({ where: { conversationId: id, userId: req.user.userId, leftAt: null } });
    if (!member) security.deny();
    const conversation = await Conversation.findByPk(id);
    if (!conversation?.isSecure) security.deny();
    await security.open(conversation);
    return res.json({ success: true, data: { unlocked: true } });
  } catch (error) { next(error); }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY & CONVERSATION ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: Central Chat Hub API - Mã hoá AES-256-GCM, Gửi Ảnh/File S3, Ghim Tin Nhắn & Luân Chuyển Thẻ Nghiệp Vụ Liên Hệ Thống
 */

/**
 * @swagger
 * /api/v1/chat/summary:
 *   get:
 *     summary: Lấy tổng số tin chưa đọc & danh sách hội thoại rút gọn cho Dropdown UI / Header Badge
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: scopeSystem
 *         schema:
 *           type: string
 *           enum: [CORE, OFFICE, OMS, WMS, SFA]
 *       - in: query
 *         name: companyId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tổng hợp trạng thái chat của user
 */
router.get("/summary", ChatController.getUserChatSummary);

/**
 * @swagger
 * /api/v1/chat/conversations:
 *   get:
 *     summary: Lấy danh sách hội thoại của user hiện tại
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Danh sách conversations kèm tin nhắn cuối cùng và unreadCount
 */
router.get("/conversations", ChatController.getMyConversations);

/**
 * @swagger
 * /api/v1/chat/conversations:
 *   post:
 *     summary: Tạo cuộc hội thoại mới (private hoặc group) kèm khoá mã hoá DEK riêng
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.post(
  "/conversations",
  createConversationSchema,
  ChatController.createConversation,
);

/**
 * @swagger
 * /api/v1/chat/conversations/ensure-context:
 *   post:
 *     summary: Đảm bảo cuộc hội thoại ngữ cảnh (Phòng ban Office, Đội bán hàng SFA, Đơn hàng...) tồn tại
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.post(
  "/conversations/ensure-context",
  ensureContextConversationSchema,
  ChatController.ensureContextConversation,
);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}:
 *   get:
 *     summary: Lấy chi tiết một hội thoại (danh sách thành viên, tin nhắn cuối, trạng thái ghim)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.get(
  "/conversations/:conversationId",
  ChatController.getConversationDetail,
);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}:
 *   patch:
 *     summary: Cập nhật thông tin nhóm chat (tên, avatar) - chỉ owner/admin
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.patch(
  "/conversations/:conversationId",
  updateConversationSchema,
  ChatController.updateConversation,
);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/members:
 *   post:
 *     summary: Thêm thành viên vào nhóm - chỉ owner/admin
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.post(
  "/conversations/:conversationId/members",
  addMembersSchema,
  ChatController.addMembers,
);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/members/sync:
 *   post:
 *     summary: Đồng bộ danh sách thành viên cho nhóm chat ngữ cảnh
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.post(
  "/conversations/:conversationId/members/sync",
  syncMembersSchema,
  ChatController.syncMembers,
);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/members/{targetUserId}:
 *   delete:
 *     summary: Xóa thành viên khỏi nhóm hoặc tự rời nhóm
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.delete(
  "/conversations/:conversationId/members/:targetUserId",
  ChatController.removeMember,
);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/pin:
 *   patch:
 *     summary: Ghim / bỏ ghim hội thoại lên đầu danh sách (toggle)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.patch("/conversations/:conversationId/pin", ChatController.togglePin);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/mute:
 *   patch:
 *     summary: Bật / tắt thông báo hội thoại (toggle)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.patch("/conversations/:conversationId/mute", ChatController.toggleMute);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}:
 *   delete:
 *     summary: Giải tán nhóm chat (chỉ role Admin hệ thống, trừ picare_group)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.delete(
  "/conversations/:conversationId",
  ChatController.dissolveGroup,
);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/me:
 *   delete:
 *     summary: Xoá cuộc hội thoại ở phía người dùng hiện tại (ẩn hội thoại & xoá lịch sử cũ đối với user đó)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.delete(
  "/conversations/:conversationId/me",
  ChatController.deleteConversationForMe,
);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/personal-space/data:
 *   delete:
 *     summary: Xoá sạch toàn bộ tin nhắn, tài liệu đính kèm và key trên S3 trong Không gian của bạn
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.delete(
  "/conversations/:conversationId/personal-space/data",
  ChatController.clearPersonalSpaceData,
);

// ─────────────────────────────────────────────────────────────────────────────
// PINNED MESSAGES IN CONVERSATION (C2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/pins:
 *   get:
 *     summary: Lấy danh sách các tin nhắn được ghim trong cuộc hội thoại
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.get(
  "/conversations/:conversationId/pins",
  ChatController.getPinnedMessages,
);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/pins/{messageId}:
 *   post:
 *     summary: Ghim một tin nhắn lên đầu cuộc hội thoại
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.post(
  "/conversations/:conversationId/pins/:messageId",
  pinMessageSchema,
  ChatController.pinMessage,
);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/pins/{messageId}:
 *   delete:
 *     summary: Bỏ ghim một tin nhắn trong cuộc hội thoại
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.delete(
  "/conversations/:conversationId/pins/:messageId",
  ChatController.unpinMessage,
);

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE, SEARCH & REACTION ROUTES (C0, C1, C2, C3, C4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/messages/search:
 *   get:
 *     summary: Tìm kiếm từ khoá trên tin nhắn đã mã hoá (Searchable Encryption qua HMAC Blind Index)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.get(
  "/conversations/:conversationId/messages/search",
  searchMessagesSchema,
  ChatController.searchMessages,
);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/messages:
 *   get:
 *     summary: Lấy danh sách tin nhắn (composite cursor pagination + giải mã AES-256-GCM)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.get(
  "/conversations/:conversationId/messages",
  getMessagesSchema,
  ChatController.getMessages,
);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/messages:
 *   post:
 *     summary: Gửi tin nhắn mới (text, image, file, entity_card, mixed)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.post(
  "/conversations/:conversationId/messages",
  sendMessageSchema,
  ChatController.sendMessage,
);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/read:
 *   post:
 *     summary: Đánh dấu đã đọc tất cả tin nhắn trong hội thoại (reset unreadCount = 0)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.post("/conversations/:conversationId/read", ChatController.markAsRead);

/**
 * @swagger
 * /api/v1/chat/messages/{messageId}:
 *   patch:
 *     summary: Chỉnh sửa nội dung tin nhắn (chỉ người gửi)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.patch(
  "/messages/:messageId",
  editMessageSchema,
  ChatController.editMessage,
);

/**
 * @swagger
 * /api/v1/chat/messages/{messageId}:
 *   delete:
 *     summary: Xóa tin nhắn (soft-delete + xóa bản mã, chỉ người gửi)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.delete("/messages/:messageId", ChatController.deleteMessage);
router.post("/messages/:messageId/recall", ChatController.recallMessage);
router.delete("/messages/:messageId/me", ChatController.deleteForMe);

/**
 * @swagger
 * /api/v1/chat/messages/{messageId}/reactions:
 *   post:
 *     summary: Thả hoặc gỡ biểu cảm (emoji reaction) trên tin nhắn
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.post(
  "/messages/:messageId/reactions",
  reactionSchema,
  ChatController.toggleReaction,
);

// ─────────────────────────────────────────────────────────────────────────────
// ATTACHMENTS & ENTITY CARDS ROUTES (C2, C3, C4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/attachments/upload-ticket:
 *   post:
 *     summary: Cấp Presigned PUT URL để client upload trực tiếp file/ảnh lên S3 private
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.post(
  "/conversations/:conversationId/attachments/upload-ticket",
  attachmentUploadTicketSchema,
  ChatController.createAttachmentUploadTicket,
);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/attachments/upload:
 *   post:
 *     summary: Upload trực tiếp file/ảnh đính kèm lên S3 private và trích xuất kích thước ảnh
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.post(
  "/conversations/:conversationId/attachments/upload",
  upload.single("file"),
  ChatController.uploadChatAttachment,
);

router.get(
  "/conversations/:conversationId/attachments/:attachmentId/content",
  ChatController.getAttachmentContent,
);

/**
 * @swagger
 * /api/v1/chat/attachments/{attachmentId}/signed-url:
 *   get:
 *     summary: Lấy Presigned GET URL có kiểm tra quyền thành viên hội thoại cho file đính kèm
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.get(
  "/attachments/:attachmentId/signed-url",
  ChatController.getAttachmentSignedUrl,
);

/**
 * @swagger
 * /api/v1/chat/entity-cards/snapshot:
 *   patch:
 *     summary: Cập nhật trạng thái trực tiếp trên Entity Card (Đơn hàng, Đơn duyệt chi, Vận đơn)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.patch(
  "/entity-cards/snapshot",
  updateEntityCardSnapshotSchema,
  ChatController.updateEntityCardSnapshot,
);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/rotate-key:
 *   post:
 *     summary: Xoay vòng khoá bọc DEK của cuộc hội thoại (Key Rotation)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.post(
  "/conversations/:conversationId/rotate-key",
  ChatController.rotateConversationKey,
);

/**
 * @swagger
 * /api/v1/chat/deep-link/resolve:
 *   get:
 *     summary: Giải quyết Deep-Link Redirect giữa các hệ thống (OFFICE, OMS, WMS, SFA)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.get("/deep-link/resolve", ChatController.resolveDeepLink);

/**
 * @swagger
 * /api/v1/chat/link-preview:
 *   get:
 *     summary: Trích xuất metadata OpenGraph / YouTube / HTML từ URL gửi trong chat
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 */
router.get("/link-preview", ChatController.getLinkPreview);

module.exports = router;
