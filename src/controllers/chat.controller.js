const { validationResult } = require("express-validator");
const ChatService = require("../services/chat.service");
const ResponseHandler = require("../common/response.handler");
const { BadRequestException } = require("../common/exceptions/BaseException");
const { ConversationDTO, MessageDTO } = require("../schemas/chat.schema");

class ChatController {
  // ===========================
  // CONVERSATION
  // ===========================

  /**
   * GET /api/v1/chat/conversations
   * Lấy danh sách conversations của user hiện tại
   */
  static async getMyConversations(req, res, next) {
    try {
      const { userId } = req.user;
      const conversations = await ChatService.getMyConversations(userId);
      const data = conversations.map((c) => ConversationDTO.from(c));
      return ResponseHandler.success(res, data, "Lấy danh sách hội thoại thành công");
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/chat/conversations
   * Tạo mới cuộc hội thoại (private hoặc group)
   */
  static async createConversation(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new BadRequestException("Lỗi validation", errors.array());

      const { userId } = req.user;
      const conversation = await ChatService.createConversation(userId, req.body);
      return ResponseHandler.created(res, ConversationDTO.from(conversation.toJSON ? conversation.toJSON() : conversation), "Tạo hội thoại thành công");
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/chat/conversations/:conversationId
   * Lấy chi tiết một conversation
   */
  static async getConversationDetail(req, res, next) {
    try {
      const { conversationId } = req.params;
      const { userId } = req.user;
      const conversation = await ChatService.getConversationDetail(conversationId, userId);
      return ResponseHandler.success(res, ConversationDTO.from(conversation.toJSON()), "Lấy chi tiết hội thoại thành công");
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/v1/chat/conversations/:conversationId
   * Cập nhật nhóm (tên, avatar) - chỉ owner/admin
   */
  static async updateConversation(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new BadRequestException("Lỗi validation", errors.array());

      const { conversationId } = req.params;
      const { userId } = req.user;
      const conversation = await ChatService.updateConversation(conversationId, userId, req.body);
      return ResponseHandler.success(res, conversation, "Cập nhật hội thoại thành công");
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/chat/conversations/:conversationId/members
   * Thêm thành viên vào nhóm - chỉ owner/admin
   */
  static async addMembers(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new BadRequestException("Lỗi validation", errors.array());

      const { conversationId } = req.params;
      const { userId } = req.user;
      const { memberIds } = req.body;
      const result = await ChatService.addMembers(conversationId, userId, memberIds);
      return ResponseHandler.success(res, result, "Thêm thành viên thành công");
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/chat/conversations/:conversationId/members/:targetUserId
   * Xóa thành viên khỏi nhóm / tự rời nhóm
   */
  static async removeMember(req, res, next) {
    try {
      const { conversationId, targetUserId } = req.params;
      const { userId } = req.user;
      const result = await ChatService.removeMember(conversationId, userId, targetUserId);
      return ResponseHandler.success(res, result, "Rời/xóa thành viên thành công");
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/v1/chat/conversations/:conversationId/pin
   * Ghim / bỏ ghim conversation
   */
  static async togglePin(req, res, next) {
    try {
      const { conversationId } = req.params;
      const { userId } = req.user;
      const result = await ChatService.togglePin(conversationId, userId);
      return ResponseHandler.success(res, result, result.isPinned ? "Đã ghim hội thoại" : "Đã bỏ ghim hội thoại");
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/v1/chat/conversations/:conversationId/mute
   * Tắt / bật thông báo conversation
   */
  static async toggleMute(req, res, next) {
    try {
      const { conversationId } = req.params;
      const { userId } = req.user;
      const result = await ChatService.toggleMute(conversationId, userId);
      return ResponseHandler.success(res, result, result.isMuted ? "Đã tắt thông báo" : "Đã bật thông báo");
    } catch (error) {
      next(error);
    }
  }

  // ===========================
  // MESSAGES
  // ===========================

  /**
   * GET /api/v1/chat/conversations/:conversationId/messages
   * Lấy danh sách tin nhắn (phân trang cursor-based)
   */
  static async getMessages(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new BadRequestException("Lỗi validation", errors.array());

      const { conversationId } = req.params;
      const { userId } = req.user;
      const { before, limit } = req.query;

      const messages = await ChatService.getMessages(conversationId, userId, { before, limit });
      const data = messages.map((m) => MessageDTO.from(m.toJSON ? m.toJSON() : m));
      return ResponseHandler.success(res, data, "Lấy tin nhắn thành công");
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/chat/conversations/:conversationId/messages
   * Gửi tin nhắn vào conversation
   */
  static async sendMessage(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new BadRequestException("Lỗi validation", errors.array());

      const { conversationId } = req.params;
      const { userId } = req.user;
      const message = await ChatService.sendMessage(conversationId, userId, req.body);
      return ResponseHandler.created(res, MessageDTO.from(message.toJSON()), "Gửi tin nhắn thành công");
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/v1/chat/messages/:messageId
   * Chỉnh sửa tin nhắn
   */
  static async editMessage(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new BadRequestException("Lỗi validation", errors.array());

      const { messageId } = req.params;
      const { userId } = req.user;
      const { content } = req.body;
      const message = await ChatService.editMessage(messageId, userId, content);
      return ResponseHandler.success(res, message, "Chỉnh sửa tin nhắn thành công");
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/chat/messages/:messageId
   * Xóa tin nhắn (soft-delete)
   */
  static async deleteMessage(req, res, next) {
    try {
      const { messageId } = req.params;
      const { userId } = req.user;
      const result = await ChatService.deleteMessage(messageId, userId);
      return ResponseHandler.success(res, result, "Xóa tin nhắn thành công");
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/chat/conversations/:conversationId/read
   * Đánh dấu đã đọc conversation
   */
  static async markAsRead(req, res, next) {
    try {
      const { conversationId } = req.params;
      const { userId } = req.user;
      const result = await ChatService.markAsRead(conversationId, userId);
      return ResponseHandler.success(res, result, "Đã đánh dấu đã đọc");
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ChatController;
