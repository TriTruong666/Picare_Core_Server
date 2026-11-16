const grpc = require("@grpc/grpc-js");
const { timingSafeEqual } = require("crypto");
const ChatService = require("./chat.service");
const appConfig = require("../config/app.config");
const { ConversationDTO, MessageDTO } = require("../schemas/chat.schema");

const fail = (callback, code, details) => callback({ code, details });

const isAuthorized = (call) => {
  const expectedToken =
    appConfig.grpc?.chatServiceToken || appConfig.grpc?.storageServiceToken;
  if (!expectedToken) return false;

  const providedToken = String(
    call.metadata?.get("x-service-token")?.[0] || "",
  );
  const expectedBuffer = Buffer.from(expectedToken);
  const providedBuffer = Buffer.from(providedToken);

  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
};

const requireAuthorization = (call, callback) => {
  if (!appConfig.grpc?.chatAuthEnabled) return true;

  const expectedToken =
    appConfig.grpc?.chatServiceToken || appConfig.grpc?.storageServiceToken;
  if (!expectedToken) {
    fail(
      callback,
      grpc.status.FAILED_PRECONDITION,
      "GRPC_CHAT_SERVICE_TOKEN chưa được cấu hình",
    );
    return false;
  }
  if (isAuthorized(call)) return true;
  fail(callback, grpc.status.UNAUTHENTICATED, "Chat service token không hợp lệ");
  return false;
};

const safeParseJson = (jsonStr, fallback = null) => {
  if (!jsonStr || typeof jsonStr !== "string" || !jsonStr.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(jsonStr);
  } catch (_err) {
    return fallback;
  }
};

const mapDomainErrorToGrpc = (error) => {
  const statusCode = error?.statusCode || error?.status || 500;
  if (statusCode === 400) return grpc.status.INVALID_ARGUMENT;
  if (statusCode === 401) return grpc.status.UNAUTHENTICATED;
  if (statusCode === 403) return grpc.status.PERMISSION_DENIED;
  if (statusCode === 404) return grpc.status.NOT_FOUND;
  if (statusCode === 409) return grpc.status.ALREADY_EXISTS;
  return grpc.status.INTERNAL;
};

const grpcChatHandler = {
  /**
   * RPC EnsureConversation
   * Tạo hoặc lấy hội thoại 1-1 / nhóm theo ngữ cảnh nghiệp vụ (Office, SFA, WMS, OMS)
   */
  async ensureConversation(call, callback) {
    try {
      if (!requireAuthorization(call, callback)) return;
      const req = call.request || {};
      const creatorId = String(req.creatorId || "").trim();
      if (!creatorId) {
        return fail(
          callback,
          grpc.status.INVALID_ARGUMENT,
          "creatorId là bắt buộc",
        );
      }

      let conversation;
      if (req.contextType && req.contextId) {
        conversation = await ChatService.ensureContextConversation({
          creatorId,
          type: req.type || "group",
          name: req.name || null,
          avatarUrl: req.avatarUrl || null,
          memberIds: Array.isArray(req.memberIds) ? req.memberIds : [],
          scopeSystem: req.scopeSystem || "OFFICE",
          companyId: req.companyId || null,
          contextType: req.contextType,
          contextId: req.contextId,
        });
      } else {
        conversation = await ChatService.createConversation(creatorId, {
          type: req.type || "private",
          name: req.name || null,
          avatarUrl: req.avatarUrl || null,
          memberIds: Array.isArray(req.memberIds) ? req.memberIds : [],
          scopeSystem: req.scopeSystem || "CORE",
          companyId: req.companyId || null,
        });
      }

      const dto = ConversationDTO.from(conversation);
      callback(null, {
        success: true,
        message: "Khởi tạo/đồng bộ cuộc hội thoại thành công",
        conversationId: dto.id,
        conversationJson: JSON.stringify(dto),
      });
    } catch (error) {
      fail(
        callback,
        mapDomainErrorToGrpc(error),
        error.message || "Lỗi xử lý EnsureConversation",
      );
    }
  },

  /**
   * RPC SendMessage
   * Gửi tin nhắn văn bản, file đính kèm hoặc Entity Card từ các repo sang Core Hub
   */
  async sendMessage(call, callback) {
    try {
      if (!requireAuthorization(call, callback)) return;
      const req = call.request || {};
      const conversationId = String(req.conversationId || "").trim();
      const senderId = String(req.senderId || "").trim();

      if (!conversationId || !senderId) {
        return fail(
          callback,
          grpc.status.INVALID_ARGUMENT,
          "conversationId và senderId là bắt buộc",
        );
      }

      const metadata = safeParseJson(req.metadataJson, null);
      const message = await ChatService.sendMessage(conversationId, senderId, {
        type: req.type || "text",
        content: req.content || null,
        replyToId: req.replyToId || null,
        metadata,
        clientMessageId: req.clientMessageId || null,
        attachments: Array.isArray(req.attachments) ? req.attachments : [],
      });

      const dto = MessageDTO.from(message);
      callback(null, {
        success: true,
        message: "Gửi tin nhắn thành công",
        conversationId: dto.conversationId,
        messageId: dto.id,
        messageJson: JSON.stringify(dto),
      });
    } catch (error) {
      fail(
        callback,
        mapDomainErrorToGrpc(error),
        error.message || "Lỗi xử lý SendMessage",
      );
    }
  },

  /**
   * RPC SendEntityMessage
   * Gửi nhanh thẻ nghiệp vụ (Đơn hàng SFA/OMS, Phiếu kho WMS, Đơn duyệt chi Office)
   * Tự động tạo hội thoại 1-1 / nhóm nếu chưa truyền conversationId.
   */
  async sendEntityMessage(call, callback) {
    try {
      if (!requireAuthorization(call, callback)) return;
      const req = call.request || {};
      const senderId = String(req.senderId || "").trim();
      const entityType = String(req.entityType || "").trim();
      const entityId = String(req.entityId || "").trim();
      const sourceSystem = String(req.sourceSystem || "CORE")
        .trim()
        .toUpperCase();

      if (!senderId || !entityType || !entityId) {
        return fail(
          callback,
          grpc.status.INVALID_ARGUMENT,
          "senderId, entityType và entityId là bắt buộc",
        );
      }

      let targetConversationId = String(req.conversationId || "").trim();
      if (!targetConversationId) {
        const recipientIds = (req.recipientIds || []).filter(
          (id) => id && id !== senderId,
        );
        if (recipientIds.length === 0) {
          return fail(
            callback,
            grpc.status.INVALID_ARGUMENT,
            "Cần truyền conversationId hoặc danh sách recipientIds",
          );
        }

        const conv = await ChatService.createConversation(senderId, {
          type: recipientIds.length === 1 ? "private" : "group",
          name:
            recipientIds.length > 1
              ? `[${sourceSystem}] ${req.entityCode || entityId}`
              : null,
          memberIds: recipientIds,
          scopeSystem: sourceSystem,
          companyId: req.companyId || null,
        });
        targetConversationId = conv.id;
      }

      const snapshot = safeParseJson(req.snapshotJson, {}) || {};
      const fallbackPaths = safeParseJson(req.fallbackPathsJson, {}) || {};

      const metadata = {
        schemaVersion: 1,
        entityType,
        sourceSystem,
        entityId,
        entityCode: req.entityCode || null,
        companyId: req.companyId || null,
        snapshot,
        navigation: {
          primarySystem: req.primarySystem || sourceSystem,
          path: req.navigationPath || null,
          fallbackPaths,
        },
      };

      const message = await ChatService.sendMessage(
        targetConversationId,
        senderId,
        {
          type: "entity_card",
          content: req.content || null,
          metadata,
          clientMessageId: req.clientMessageId || null,
        },
      );

      const dto = MessageDTO.from(message);
      callback(null, {
        success: true,
        message: "Gửi thẻ nghiệp vụ thành công",
        conversationId: dto.conversationId,
        messageId: dto.id,
        messageJson: JSON.stringify(dto),
      });
    } catch (error) {
      fail(
        callback,
        mapDomainErrorToGrpc(error),
        error.message || "Lỗi xử lý SendEntityMessage",
      );
    }
  },

  /**
   * RPC UpdateEntityCardSnapshot
   * Cập nhật trạng thái trực tiếp trên Entity Card khi đơn hàng/chứng từ đổi trạng thái
   */
  async updateEntityCardSnapshot(call, callback) {
    try {
      if (!requireAuthorization(call, callback)) return;
      const req = call.request || {};
      const snapshotPatch = safeParseJson(req.snapshotPatchJson, null);
      const navigationPatch = safeParseJson(req.navigationPatchJson, null);

      if (!snapshotPatch || typeof snapshotPatch !== "object") {
        return fail(
          callback,
          grpc.status.INVALID_ARGUMENT,
          "snapshotPatchJson phải là JSON object hợp lệ",
        );
      }

      const result = await ChatService.updateEntityCardSnapshot({
        conversationId: req.conversationId || null,
        messageId: req.messageId || null,
        entityType: req.entityType || null,
        entityId: req.entityId || null,
        sourceSystem: req.sourceSystem || null,
        snapshotPatch,
        navigationPatch,
      });

      callback(null, {
        success: true,
        message: "Cập nhật trạng thái Entity Card thành công",
        updatedCount: result.updatedCount,
        updatedMessageIds: result.updatedMessageIds,
      });
    } catch (error) {
      fail(
        callback,
        mapDomainErrorToGrpc(error),
        error.message || "Lỗi xử lý UpdateEntityCardSnapshot",
      );
    }
  },

  /**
   * RPC GetUserChatSummary
   * Lấy tổng số tin chưa đọc & danh sách hội thoại rút gọn cho Dropdown UI / Header Badge
   */
  async getUserChatSummary(call, callback) {
    try {
      if (!requireAuthorization(call, callback)) return;
      const req = call.request || {};
      const userId = String(req.userId || "").trim();
      if (!userId) {
        return fail(
          callback,
          grpc.status.INVALID_ARGUMENT,
          "userId là bắt buộc",
        );
      }

      const summary = await ChatService.getUserChatSummary(userId, {
        limit: req.limit || 10,
        scopeSystem: req.scopeSystem || null,
        companyId: req.companyId || null,
      });

      const formatted = {
        ...summary,
        recentConversations: summary.recentConversations.map((c) =>
          ConversationDTO.from(c),
        ),
      };

      callback(null, {
        success: true,
        userId: summary.userId,
        totalUnreadMessages: summary.totalUnreadMessages,
        totalMentionCount: summary.totalMentionCount,
        unreadConversationsCount: summary.unreadConversationsCount,
        totalConversations: summary.totalConversations,
        summaryJson: JSON.stringify(formatted),
      });
    } catch (error) {
      fail(
        callback,
        mapDomainErrorToGrpc(error),
        error.message || "Lỗi xử lý GetUserChatSummary",
      );
    }
  },

  /**
   * RPC SyncConversationMembers
   * Đồng bộ danh sách thành viên vào nhóm chat phòng ban/đội bán hàng
   */
  async syncConversationMembers(call, callback) {
    try {
      if (!requireAuthorization(call, callback)) return;
      const req = call.request || {};
      const conversationId = String(req.conversationId || "").trim();
      if (!conversationId) {
        return fail(
          callback,
          grpc.status.INVALID_ARGUMENT,
          "conversationId là bắt buộc",
        );
      }

      const result = await ChatService.syncConversationMembers(conversationId, {
        memberIds: Array.isArray(req.memberIds) ? req.memberIds : [],
        mode: req.mode || "REPLACE",
      });

      callback(null, {
        success: true,
        conversationId: result.conversationId,
        addedUserIds: result.addedUserIds,
        removedUserIds: result.removedUserIds,
      });
    } catch (error) {
      fail(
        callback,
        mapDomainErrorToGrpc(error),
        error.message || "Lỗi xử lý SyncConversationMembers",
      );
    }
  },

  /**
   * RPC RecallMessage
   */
  async recallMessage(call, callback) {
    try {
      if (!requireAuthorization(call, callback)) return;
      const { messageId, userId } = call.request || {};
      if (!messageId || !userId) {
        return fail(
          callback,
          grpc.status.INVALID_ARGUMENT,
          "messageId và userId là bắt buộc",
        );
      }
      const result = await ChatService.recallMessage(messageId, userId);
      callback(null, {
        success: true,
        message: "Thu hồi tin nhắn thành công",
        messageId: result.messageId || messageId,
      });
    } catch (error) {
      fail(
        callback,
        mapDomainErrorToGrpc(error),
        error.message || "Lỗi xử lý RecallMessage",
      );
    }
  },

  /**
   * RPC DeleteMessageForMe
   */
  async deleteMessageForMe(call, callback) {
    try {
      if (!requireAuthorization(call, callback)) return;
      const { messageId, userId } = call.request || {};
      if (!messageId || !userId) {
        return fail(
          callback,
          grpc.status.INVALID_ARGUMENT,
          "messageId và userId là bắt buộc",
        );
      }
      const result = await ChatService.deleteForMe(messageId, userId);
      callback(null, {
        success: true,
        message: "Đã xoá tin nhắn ở phía bạn",
        messageId: result.messageId || messageId,
      });
    } catch (error) {
      fail(
        callback,
        mapDomainErrorToGrpc(error),
        error.message || "Lỗi xử lý DeleteMessageForMe",
      );
    }
  },
};

module.exports = grpcChatHandler;

