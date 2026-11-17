const { validationResult } = require("express-validator");
const ChatService = require("../services/chat.service");
const ResponseHandler = require("../common/response.handler");
const { BadRequestException } = require("../common/exceptions/BaseException");
const { ConversationDTO, MessageDTO } = require("../schemas/chat.schema");

class ChatController {
  // ===========================
  // CONVERSATION & SUMMARY
  // ===========================

  /**
   * GET /api/v1/chat/conversations
   * Lấy danh sách conversations của user hiện tại
   */
  static async getMyConversations(req, res, next) {
    try {
      const { userId, role } = req.user;
      const { scopeSystem, companyId } = req.query;
      const conversations = await ChatService.getMyConversations(userId, {
        scopeSystem,
        companyId,
        userRole: role,
      });
      const data = conversations.map((c) => ConversationDTO.from(c));
      return ResponseHandler.success(
        res,
        data,
        "Lấy danh sách hội thoại thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/chat/summary
   * Lấy tổng số tin chưa đọc & danh sách rút gọn cho Dropdown UI / Header Badge (C0 & C4)
   */
  static async getUserChatSummary(req, res, next) {
    try {
      const { userId, role } = req.user;
      const { limit, scopeSystem, companyId } = req.query;
      const summary = await ChatService.getUserChatSummary(userId, {
        limit,
        scopeSystem,
        companyId,
        userRole: role,
      });
      return ResponseHandler.success(
        res,
        {
          ...summary,
          recentConversations: summary.recentConversations.map((c) =>
            ConversationDTO.from(c),
          ),
        },
        "Lấy tổng hợp trạng thái chat thành công",
      );
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
      if (!errors.isEmpty()) {
        throw new BadRequestException("Lỗi validation", errors.array());
      }

      const { userId } = req.user;
      const conversation = await ChatService.createConversation(
        userId,
        req.body,
      );
      return ResponseHandler.created(
        res,
        { ...ConversationDTO.from(conversation.toJSON ? conversation.toJSON() : conversation), ...(conversation.securityCode ? { securityCode: conversation.securityCode, securityCodeExpiresAt: conversation.securityCodeExpiresAt } : {}) },
        "Tạo hội thoại thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/chat/conversations/ensure-context
   * Đảm bảo cuộc hội thoại ngữ cảnh (Phòng ban Office, Đội bán hàng SFA, Đơn hàng...) tồn tại
   */
  static async ensureContextConversation(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Lỗi validation", errors.array());
      }

      const { userId } = req.user;
      const conversation = await ChatService.ensureContextConversation({
        creatorId: userId,
        ...req.body,
      });
      return ResponseHandler.success(
        res,
        ConversationDTO.from(conversation),
        "Đồng bộ hội thoại ngữ cảnh thành công",
      );
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
      const { userId, role } = req.user;
      const conversation = await ChatService.getConversationDetail(
        conversationId,
        userId,
        role,
      );
      return ResponseHandler.success(
        res,
        ConversationDTO.from(
          conversation.toJSON ? conversation.toJSON() : conversation,
        ),
        "Lấy chi tiết hội thoại thành công",
      );
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
      if (!errors.isEmpty()) {
        throw new BadRequestException("Lỗi validation", errors.array());
      }

      const { conversationId } = req.params;
      const { userId, role } = req.user;
      const conversation = await ChatService.updateConversation(
        conversationId,
        userId,
        req.body,
        role,
      );
      return ResponseHandler.success(
        res,
        conversation,
        "Cập nhật hội thoại thành công",
      );
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
      if (!errors.isEmpty()) {
        throw new BadRequestException("Lỗi validation", errors.array());
      }

      const { conversationId } = req.params;
      const { userId, role } = req.user;
      const { memberIds } = req.body;
      const result = await ChatService.addMembers(
        conversationId,
        userId,
        memberIds,
        role,
      );
      return ResponseHandler.success(res, result, "Thêm thành viên thành công");
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/chat/conversations/:conversationId/members/sync
   * Đồng bộ danh sách thành viên cho nhóm ngữ cảnh
   */
  static async syncMembers(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Lỗi validation", errors.array());
      }

      const { conversationId } = req.params;
      const { memberIds, mode } = req.body;
      const result = await ChatService.syncConversationMembers(conversationId, {
        memberIds,
        mode,
      });
      return ResponseHandler.success(
        res,
        result,
        "Đồng bộ thành viên thành công",
      );
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
      const { userId, role } = req.user;
      const result = await ChatService.removeMember(
        conversationId,
        userId,
        targetUserId,
        role,
      );
      return ResponseHandler.success(
        res,
        result,
        "Rời/xóa thành viên thành công",
      );
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
      return ResponseHandler.success(
        res,
        result,
        result.isPinned ? "Đã ghim hội thoại" : "Đã bỏ ghim hội thoại",
      );
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
      return ResponseHandler.success(
        res,
        result,
        result.isMuted ? "Đã tắt thông báo" : "Đã bật thông báo",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/chat/conversations/:conversationId
   * Giải tán nhóm chat (chỉ owner/admin nhóm, xoá cuộc trò chuyện với toàn bộ thành viên)
   */
  static async dissolveGroup(req, res, next) {
    try {
      const { conversationId } = req.params;
      const { userId, role } = req.user;
      const result = await ChatService.dissolveGroup(
        conversationId,
        userId,
        role,
      );
      return ResponseHandler.success(res, result, "Đã giải tán nhóm trò chuyện");
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/chat/conversations/:conversationId/me
   * Xoá cuộc trò chuyện ở phía người dùng hiện tại (ẩn hội thoại & xoá vĩnh viễn lịch sử cũ với user đó)
   */
  static async deleteConversationForMe(req, res, next) {
    try {
      const { conversationId } = req.params;
      const { userId } = req.user;
      const result = await ChatService.deleteConversationForMe(
        conversationId,
        userId,
      );
      return ResponseHandler.success(
        res,
        result,
        "Đã xoá cuộc trò chuyện ở phía bạn",
      );
    } catch (error) {
      next(error);
    }
  }

  // ===========================
  // MESSAGES & SEARCH
  // ===========================

  /**
   * GET /api/v1/chat/conversations/:conversationId/messages
   * Lấy danh sách tin nhắn (phân trang cursor-based)
   */
  static async getMessages(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Lỗi validation", errors.array());
      }

      const { conversationId } = req.params;
      const { userId, role } = req.user;
      const { before, beforeId, limit } = req.query;

      const messages = await ChatService.getMessages(conversationId, userId, {
        before,
        beforeId,
        limit,
        userRole: role,
      });
      const data = messages.map((m) =>
        MessageDTO.from(m.toJSON ? m.toJSON() : m),
      );
      return ResponseHandler.success(res, data, "Lấy tin nhắn thành công");
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/chat/conversations/:conversationId/messages/search
   * Tìm kiếm tin nhắn trên dữ liệu đã mã hoá (Searchable Encryption - C1)
   */
  static async searchMessages(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Lỗi validation", errors.array());
      }

      const { conversationId } = req.params;
      const { userId, role } = req.user;
      const { q, limit } = req.query;

      const messages = await ChatService.searchMessages(
        conversationId,
        userId,
        q,
        { limit, userRole: role },
      );
      const data = messages.map((m) => MessageDTO.from(m));
      return ResponseHandler.success(res, data, "Tìm kiếm tin nhắn thành công");
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
      if (!errors.isEmpty()) {
        throw new BadRequestException("Lỗi validation", errors.array());
      }

      const { conversationId } = req.params;
      const { userId } = req.user;
      const message = await ChatService.sendMessage(
        conversationId,
        userId,
        req.body,
      );
      return ResponseHandler.created(
        res,
        MessageDTO.from(message.toJSON ? message.toJSON() : message),
        "Gửi tin nhắn thành công",
      );
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
      if (!errors.isEmpty()) {
        throw new BadRequestException("Lỗi validation", errors.array());
      }

      const { messageId } = req.params;
      const { userId } = req.user;
      const { content } = req.body;
      const message = await ChatService.editMessage(messageId, userId, content);
      return ResponseHandler.success(
        res,
        MessageDTO.from(message),
        "Chỉnh sửa tin nhắn thành công",
      );
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
   * POST /api/v1/chat/messages/:messageId/recall
   * Thu hồi tin nhắn
   */
  static async recallMessage(req, res, next) {
    try {
      const { messageId } = req.params;
      const { userId } = req.user;
      const result = await ChatService.recallMessage(messageId, userId);
      return ResponseHandler.success(res, result, "Thu hồi tin nhắn thành công");
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/chat/messages/:messageId/me
   * Xoá tin nhắn ở phía tôi
   */
  static async deleteForMe(req, res, next) {
    try {
      const { messageId } = req.params;
      const { userId } = req.user;
      const result = await ChatService.deleteForMe(messageId, userId);
      return ResponseHandler.success(res, result, "Đã xoá tin nhắn ở phía bạn");
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
      const { userId, role } = req.user;
      const { lastReadMessageId } = req.body || {};
      const result = await ChatService.markAsRead(
        conversationId,
        userId,
        lastReadMessageId,
        role,
      );
      return ResponseHandler.success(res, result, "Đã đánh dấu đã đọc");
    } catch (error) {
      next(error);
    }
  }

  // ===========================
  // PINNED MESSAGES & REACTIONS (C2)
  // ===========================

  /**
   * GET /api/v1/chat/conversations/:conversationId/pins
   */
  static async getPinnedMessages(req, res, next) {
    try {
      const { conversationId } = req.params;
      const { userId, role } = req.user;
      const pins = await ChatService.getPinnedMessages(
        conversationId,
        userId,
        role,
      );
      return ResponseHandler.success(
        res,
        pins.map((p) => ({
          ...p,
          message: MessageDTO.from(p.message),
        })),
        "Lấy danh sách tin nhắn ghim thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/chat/conversations/:conversationId/pins/:messageId
   */
  static async pinMessage(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Lỗi validation", errors.array());
      }

      const { conversationId, messageId } = req.params;
      const { userId } = req.user;
      const { note } = req.body || {};
      const result = await ChatService.pinMessage(
        conversationId,
        messageId,
        userId,
        { note },
      );
      return ResponseHandler.created(
        res,
        {
          ...result,
          message: MessageDTO.from(result.message),
        },
        "Đã ghim tin nhắn vào cuộc hội thoại",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/chat/conversations/:conversationId/pins/:messageId
   */
  static async unpinMessage(req, res, next) {
    try {
      const { conversationId, messageId } = req.params;
      const { userId } = req.user;
      const result = await ChatService.unpinMessage(
        conversationId,
        messageId,
        userId,
      );
      return ResponseHandler.success(
        res,
        result,
        "Đã bỏ ghim tin nhắn khỏi cuộc hội thoại",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/chat/messages/:messageId/reactions
   */
  static async toggleReaction(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Lỗi validation", errors.array());
      }

      const { messageId } = req.params;
      const { userId } = req.user;
      const { emoji } = req.body;
      const result = await ChatService.toggleReaction(messageId, userId, emoji);
      return ResponseHandler.success(
        res,
        result,
        "Cập nhật biểu cảm thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  // ===========================
  // ATTACHMENTS & ENTITY CARDS (C2, C3, C4)
  // ===========================

  /**
   * POST /api/v1/chat/conversations/:conversationId/attachments/upload-ticket
   */
  static async createAttachmentUploadTicket(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Lỗi validation", errors.array());
      }

      const { conversationId } = req.params;
      const { userId } = req.user;
      const ticket = await ChatService.createAttachmentUploadTicket(
        conversationId,
        userId,
        req.body,
      );
      return ResponseHandler.success(
        res,
        ticket,
        "Tạo Presigned Upload URL thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/chat/conversations/:conversationId/attachments/upload
   */
  static async uploadChatAttachment(req, res, next) {
    try {
      const { conversationId } = req.params;
      const { userId } = req.user;
      if (!req.file || !req.file.buffer) {
        throw new BadRequestException("Vui lòng chọn file hoặc ảnh để tải lên");
      }

      const attachment = await ChatService.uploadChatAttachment(
        conversationId,
        userId,
        {
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          fileSize: req.file.size,
          blurhash: req.body?.blurhash || null,
          durationMs: req.body?.durationMs || null,
        },
      );

      return ResponseHandler.created(
        res,
        attachment,
        "Tải lên tệp đính kèm thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/chat/conversations/:conversationId/attachments/:attachmentId/content
   */
  static async getAttachmentContent(req, res, next) {
    try {
      const { conversationId, attachmentId } = req.params;
      const { userId } = req.user;
      const isDownload = String(req.query?.download || "") === "1";

      const result = await ChatService.getSecureAttachmentContent(
        conversationId,
        attachmentId,
        userId,
      );

      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", result.mimeType || "application/octet-stream");
      res.setHeader("Content-Length", String(result.buffer.length));
      const encodedName = encodeURIComponent(result.fileName || "attachment");
      res.setHeader(
        "Content-Disposition",
        `${isDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodedName}`,
      );
      return res.send(result.buffer);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/chat/attachments/:attachmentId/signed-url
   */
  static async getAttachmentSignedUrl(req, res, next) {
    try {
      const { attachmentId } = req.params;
      const { userId } = req.user;
      const result = await ChatService.getAttachmentSignedUrl(
        attachmentId,
        userId,
      );
      return ResponseHandler.success(
        res,
        result,
        "Lấy liên kết tải tệp đính kèm thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/v1/chat/entity-cards/snapshot
   */
  static async updateEntityCardSnapshot(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Lỗi validation", errors.array());
      }

      const result = await ChatService.updateEntityCardSnapshot(req.body);
      return ResponseHandler.success(
        res,
        result,
        "Cập nhật trạng thái thẻ nghiệp vụ thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/chat/conversations/:conversationId/rotate-key
   * Xoay vòng khoá bọc DEK của cuộc hội thoại (Key Rotation - C1)
   */
  static async rotateConversationKey(req, res, next) {
    try {
      const { conversationId } = req.params;
      const { userId } = req.user;
      const { targetVersion } = req.body || {};
      const result = await ChatService.rotateConversationKey(
        conversationId,
        userId,
        targetVersion ? Number(targetVersion) : null,
      );
      return ResponseHandler.success(
        res,
        result,
        "Xoay vòng khoá bảo mật cuộc hội thoại thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/chat/deep-link/resolve
   * Giải quyết Deep-Link Redirect giữa các hệ thống (OFFICE, OMS, WMS, SFA) (C4)
   */
  static async resolveDeepLink(req, res, next) {
    try {
      const {
        entityType,
        sourceSystem,
        entityId,
        entityCode,
        path,
        primarySystem,
        conversationId,
        messageId,
      } = req.query;

      const navigation = ChatService.resolveDeepLink({
        entityType,
        sourceSystem,
        entityId,
        entityCode,
        path,
        primarySystem,
        conversationId,
        messageId,
      });

      return ResponseHandler.success(
        res,
        navigation,
        "Giải quyết Deep-Link liên hệ thống thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/chat/link-preview?url=...
   * Lấy OpenGraph / HTML metadata (title, description, image) cho đường dẫn
   */
  static async getLinkPreview(req, res, next) {
    try {
      const { url } = req.query;
      if (!url || typeof url !== "string") {
        throw new BadRequestException("Thiếu tham số url");
      }

      const preview = await ChatService.getLinkPreview(url);
      return ResponseHandler.success(
        res,
        preview,
        "Lấy thông tin liên kết thành công",
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ChatController;
