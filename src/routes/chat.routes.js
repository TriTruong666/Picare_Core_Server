const express = require("express");
const router = express.Router();
const ChatController = require("../controllers/chat.controller");
const { protect } = require("../middlewares/auth.middleware");
const {
  createConversationSchema,
  getMessagesSchema,
  sendMessageSchema,
  editMessageSchema,
  addMembersSchema,
  updateConversationSchema,
} = require("../schemas/chat.schema");

// Tất cả chat routes đều yêu cầu đăng nhập
router.use(protect);

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSATION ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: API Chat - Hội thoại và Tin nhắn (Real-time qua Socket.io)
 */

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
 *         description: Danh sách conversations kèm tin nhắn cuối cùng
 */
router.get("/conversations", ChatController.getMyConversations);

/**
 * @swagger
 * /api/v1/chat/conversations:
 *   post:
 *     summary: Tạo cuộc hội thoại mới (private hoặc group)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - memberIds
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [private, group]
 *               memberIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *               name:
 *                 type: string
 *                 description: Bắt buộc nếu type = group
 *               avatarUrl:
 *                 type: string
 *     responses:
 *       201:
 *         description: Tạo hội thoại thành công
 */
router.post("/conversations", createConversationSchema, ChatController.createConversation);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}:
 *   get:
 *     summary: Lấy chi tiết một hội thoại (danh sách thành viên, tin nhắn cuối)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Chi tiết hội thoại
 */
router.get("/conversations/:conversationId", ChatController.getConversationDetail);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}:
 *   patch:
 *     summary: Cập nhật thông tin nhóm chat (tên, avatar) - chỉ owner/admin
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               avatarUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.patch("/conversations/:conversationId", updateConversationSchema, ChatController.updateConversation);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/members:
 *   post:
 *     summary: Thêm thành viên vào nhóm - chỉ owner/admin
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - memberIds
 *             properties:
 *               memberIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Thêm thành viên thành công
 */
router.post("/conversations/:conversationId/members", addMembersSchema, ChatController.addMembers);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/members/{targetUserId}:
 *   delete:
 *     summary: Xóa thành viên khỏi nhóm hoặc tự rời nhóm
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: targetUserId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Thao tác thành công
 */
router.delete("/conversations/:conversationId/members/:targetUserId", ChatController.removeMember);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/pin:
 *   patch:
 *     summary: Ghim / bỏ ghim hội thoại (toggle)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Thao tác thành công
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
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Thao tác thành công
 */
router.patch("/conversations/:conversationId/mute", ChatController.toggleMute);

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/messages:
 *   get:
 *     summary: Lấy danh sách tin nhắn (cursor-based pagination)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: before
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Lấy tin nhắn trước mốc thời gian này (ISO 8601)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Số lượng tin nhắn tối đa (max 100)
 *     responses:
 *       200:
 *         description: Danh sách tin nhắn
 */
router.get("/conversations/:conversationId/messages", getMessagesSchema, ChatController.getMessages);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/messages:
 *   post:
 *     summary: Gửi tin nhắn mới vào hội thoại
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [text, image, file]
 *                 default: text
 *               content:
 *                 type: string
 *               replyToId:
 *                 type: string
 *                 format: uuid
 *               attachments:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     fileName:
 *                       type: string
 *                     fileUrl:
 *                       type: string
 *                     fileType:
 *                       type: string
 *                       enum: [image, video, audio, document, other]
 *                     mimeType:
 *                       type: string
 *                     fileSize:
 *                       type: integer
 *     responses:
 *       201:
 *         description: Gửi tin nhắn thành công
 */
router.post("/conversations/:conversationId/messages", sendMessageSchema, ChatController.sendMessage);

/**
 * @swagger
 * /api/v1/chat/conversations/{conversationId}/read:
 *   post:
 *     summary: Đánh dấu đã đọc tất cả tin nhắn trong hội thoại
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Đã đánh dấu đã đọc
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
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Chỉnh sửa thành công
 */
router.patch("/messages/:messageId", editMessageSchema, ChatController.editMessage);

/**
 * @swagger
 * /api/v1/chat/messages/{messageId}:
 *   delete:
 *     summary: Xóa tin nhắn (soft-delete, chỉ người gửi)
 *     tags: [Chat]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Xóa tin nhắn thành công
 */
router.delete("/messages/:messageId", ChatController.deleteMessage);

module.exports = router;
