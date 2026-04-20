const {
  Conversation,
  ConversationMember,
  Message,
  MessageAttachment,
} = require("../models/chat");
const User = require("../models/user.model");
const socketService = require("./socket.service");
const { Op } = require("sequelize");
const {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} = require("../common/exceptions/BaseException");

class ChatService {
  // =====================================
  // CONVERSATION APIs
  // =====================================

  /**
   * Lấy danh sách tất cả conversations của user hiện tại (bao gồm tin nhắn cuối cùng, unread count)
   * @param {string} userId
   */
  static async getMyConversations(userId) {
    const memberships = await ConversationMember.findAll({
      where: { userId, leftAt: null },
      include: [
        {
          model: Conversation,
          as: "conversation",
          include: [
            {
              model: Message,
              as: "lastMessage",
              include: [{ model: User, as: "sender", attributes: ["userId", "name", "role", "isOnline"] }],
            },
            {
              model: ConversationMember,
              as: "members",
              where: { leftAt: null },
              include: [{ model: User, as: "user", attributes: ["userId", "name", "role", "isOnline"] }],
            },
          ],
        },
      ],
      order: [[{ model: Conversation, as: "conversation" }, "lastMessageAt", "DESC NULLS LAST"]],
    });

    return memberships.map((m) => {
      const conv = m.conversation.toJSON();
      // Tính unread count: tin nhắn sau lastReadAt của chính user
      conv.myMembership = {
        role: m.role,
        nickname: m.nickname,
        isMuted: m.isMuted,
        isPinned: m.isPinned,
        lastReadAt: m.lastReadAt,
      };
      return conv;
    });
  }

  /**
   * Tạo cuộc hội thoại private (1-1) hoặc group
   * @param {string} creatorId
   * @param {Object} dto
   */
  static async createConversation(creatorId, dto) {
    const { type, name, avatarUrl, memberIds } = dto;

    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      throw new BadRequestException("Phải có ít nhất 1 thành viên khác");
    }

    if (type === "private") {
      if (memberIds.length !== 1) {
        throw new BadRequestException("Chat riêng chỉ được có đúng 2 thành viên");
      }
      const targetId = memberIds[0];

      // Kiểm tra xem đã có private conversation giữa 2 người chưa
      const existing = await ConversationMember.findOne({
        where: { userId: creatorId, leftAt: null },
        include: [
          {
            model: Conversation,
            as: "conversation",
            where: { type: "private" },
            include: [
              {
                model: ConversationMember,
                as: "members",
                where: { userId: targetId, leftAt: null },
              },
            ],
          },
        ],
      });

      if (existing) {
        return existing.conversation;
      }
    }

    if (type === "group" && !name) {
      throw new BadRequestException("Nhóm chat phải có tên");
    }

    const allMemberIds = [...new Set([creatorId, ...memberIds])];

    const conversation = await Conversation.create({
      type,
      name: type === "group" ? name : null,
      avatarUrl: avatarUrl || null,
      createdBy: creatorId,
    });

    // Thêm các thành viên
    const memberRecords = allMemberIds.map((uid) => ({
      conversationId: conversation.id,
      userId: uid,
      role: uid === creatorId ? "owner" : "member",
      joinedAt: new Date(),
    }));

    await ConversationMember.bulkCreate(memberRecords);

    // Notify real-time tới tất cả thành viên
    for (const uid of allMemberIds) {
      socketService.emitToUser(uid, "new_conversation", conversation.toJSON());
    }

    return conversation;
  }

  /**
   * Lấy chi tiết một conversation (kiểm tra tư cách thành viên)
   * @param {string} conversationId
   * @param {string} userId
   */
  static async getConversationDetail(conversationId, userId) {
    const membership = await ConversationMember.findOne({
      where: { conversationId, userId, leftAt: null },
    });
    if (!membership) {
      throw new ForbiddenException("Bạn không phải thành viên của cuộc hội thoại này");
    }

    const conversation = await Conversation.findByPk(conversationId, {
      include: [
        {
          model: ConversationMember,
          as: "members",
          where: { leftAt: null },
          include: [{ model: User, as: "user", attributes: ["userId", "name", "role", "isOnline"] }],
        },
        {
          model: Message,
          as: "lastMessage",
          include: [{ model: User, as: "sender", attributes: ["userId", "name", "role", "isOnline"] }],
        },
      ],
    });

    if (!conversation) throw new NotFoundException("Không tìm thấy cuộc hội thoại");

    return conversation;
  }

  /**
   * Cập nhật thông tin nhóm (chỉ owner/admin)
   * @param {string} conversationId
   * @param {string} userId
   * @param {Object} dto
   */
  static async updateConversation(conversationId, userId, dto) {
    const membership = await ConversationMember.findOne({
      where: { conversationId, userId, leftAt: null },
    });
    if (!membership) throw new ForbiddenException("Bạn không phải thành viên");
    if (!["owner", "admin"].includes(membership.role)) {
      throw new ForbiddenException("Chỉ owner hoặc admin mới có thể cập nhật nhóm");
    }

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) throw new NotFoundException("Không tìm thấy cuộc hội thoại");
    if (conversation.type !== "group") {
      throw new BadRequestException("Chỉ có thể cập nhật thông tin nhóm chat");
    }

    const { name, avatarUrl } = dto;
    await conversation.update({
      ...(name !== undefined && { name }),
      ...(avatarUrl !== undefined && { avatarUrl }),
    });

    const allMembers = await ConversationMember.findAll({
      where: { conversationId, leftAt: null },
    });
    for (const m of allMembers) {
      socketService.emitToUser(m.userId, "conversation_updated", conversation.toJSON());
    }

    return conversation;
  }

  /**
   * Thêm thành viên vào nhóm (chỉ owner/admin)
   * @param {string} conversationId
   * @param {string} requesterId
   * @param {string[]} newMemberIds
   */
  static async addMembers(conversationId, requesterId, newMemberIds) {
    const membership = await ConversationMember.findOne({
      where: { conversationId, userId: requesterId, leftAt: null },
    });
    if (!membership) throw new ForbiddenException("Bạn không phải thành viên");
    if (!["owner", "admin"].includes(membership.role)) {
      throw new ForbiddenException("Chỉ owner/admin mới được thêm thành viên");
    }

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation || conversation.type !== "group") {
      throw new BadRequestException("Chỉ có thể thêm thành viên vào nhóm chat");
    }

    const records = newMemberIds.map((uid) => ({
      conversationId,
      userId: uid,
      role: "member",
      joinedAt: new Date(),
    }));

    await ConversationMember.bulkCreate(records, {
      ignoreDuplicates: true,
    });

    // Restore leftAt = null nếu đã rời nhóm trước đó
    await ConversationMember.update(
      { leftAt: null, joinedAt: new Date() },
      {
        where: {
          conversationId,
          userId: { [Op.in]: newMemberIds },
          leftAt: { [Op.ne]: null },
        },
      }
    );

    const allMembers = await ConversationMember.findAll({
      where: { conversationId, leftAt: null },
    });

    // Notify toàn bộ member (kể cả thành viên mới)
    for (const m of allMembers) {
      socketService.emitToUser(m.userId, "members_added", {
        conversationId,
        newMemberIds,
      });
    }

    return { conversationId, newMemberIds };
  }

  /**
   * Xóa thành viên khỏi nhóm / tự rời nhóm
   * @param {string} conversationId
   * @param {string} requesterId
   * @param {string} targetUserId
   */
  static async removeMember(conversationId, requesterId, targetUserId) {
    const requesterMembership = await ConversationMember.findOne({
      where: { conversationId, userId: requesterId, leftAt: null },
    });
    if (!requesterMembership) throw new ForbiddenException("Bạn không phải thành viên");

    const isSelfLeave = requesterId === targetUserId;

    if (!isSelfLeave && !["owner", "admin"].includes(requesterMembership.role)) {
      throw new ForbiddenException("Chỉ owner/admin mới có thể xóa thành viên");
    }

    await ConversationMember.update(
      { leftAt: new Date() },
      { where: { conversationId, userId: targetUserId } }
    );

    const allMembers = await ConversationMember.findAll({
      where: { conversationId, leftAt: null },
    });
    for (const m of allMembers) {
      socketService.emitToUser(m.userId, "member_removed", {
        conversationId,
        removedUserId: targetUserId,
      });
    }
    // Cũng notify người bị xóa
    socketService.emitToUser(targetUserId, "member_removed", {
      conversationId,
      removedUserId: targetUserId,
    });

    return { conversationId, removedUserId: targetUserId };
  }

  // =====================================
  // MESSAGE APIs
  // =====================================

  /**
   * Lấy danh sách tin nhắn của một conversation (phân trang - cursor based)
   * @param {string} conversationId
   * @param {string} userId
   * @param {Object} options - { before, limit }
   */
  static async getMessages(conversationId, userId, options = {}) {
    const membership = await ConversationMember.findOne({
      where: { conversationId, userId, leftAt: null },
    });
    if (!membership) throw new ForbiddenException("Bạn không phải thành viên của cuộc hội thoại này");

    const { before, limit = 30 } = options;
    const parsedLimit = Math.min(parseInt(limit) || 30, 100);

    const where = {
      conversationId,
      deletedAt: null,
      ...(before && { createdAt: { [Op.lt]: new Date(before) } }),
    };

    const messages = await Message.findAll({
      where,
      include: [
        { model: User, as: "sender", attributes: ["userId", "name", "role", "isOnline"] },
        { model: MessageAttachment, as: "attachments" },
        {
          model: Message,
          as: "replyTo",
          include: [{ model: User, as: "sender", attributes: ["userId", "name", "role", "isOnline"] }],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: parsedLimit,
    });

    return messages.reverse();
  }

  /**
   * Gửi tin nhắn mới vào một conversation
   * @param {string} conversationId
   * @param {string} senderId
   * @param {Object} dto
   */
  static async sendMessage(conversationId, senderId, dto) {
    const membership = await ConversationMember.findOne({
      where: { conversationId, userId: senderId, leftAt: null },
    });
    if (!membership) throw new ForbiddenException("Bạn không phải thành viên của cuộc hội thoại này");

    const { content, type = "text", replyToId, attachments } = dto;

    if (type === "text" && !content) {
      throw new BadRequestException("Nội dung tin nhắn không được để trống");
    }

    const message = await Message.create({
      conversationId,
      senderId,
      type,
      content: content || null,
      replyToId: replyToId || null,
    });

    // Lưu attachments nếu có
    if (attachments && attachments.length > 0) {
      const attachmentRecords = attachments.map((att) => ({
        messageId: message.id,
        fileName: att.fileName,
        fileUrl: att.fileUrl,
        fileType: att.fileType || "other",
        mimeType: att.mimeType || null,
        fileSize: att.fileSize || null,
        thumbnailUrl: att.thumbnailUrl || null,
      }));
      await MessageAttachment.bulkCreate(attachmentRecords);
    }

    // Cập nhật lastMessage của conversation
    await Conversation.update(
      { lastMessageId: message.id, lastMessageAt: new Date() },
      { where: { id: conversationId } }
    );

    // Eager load đầy đủ để emit
    const fullMessage = await Message.findByPk(message.id, {
      include: [
        { model: User, as: "sender", attributes: ["userId", "name", "role", "isOnline"] },
        { model: MessageAttachment, as: "attachments" },
        {
          model: Message,
          as: "replyTo",
          include: [{ model: User, as: "sender", attributes: ["userId", "name"] }],
        },
      ],
    });

    // Emit real-time tới conversation room
    socketService.emitToRoom(`conversation:${conversationId}`, "new_message", fullMessage.toJSON());

    return fullMessage;
  }

  /**
   * Chỉnh sửa nội dung tin nhắn (chỉ người gửi mới được sửa)
   * @param {string} messageId
   * @param {string} userId
   * @param {string} newContent
   */
  static async editMessage(messageId, userId, newContent) {
    const message = await Message.findByPk(messageId);
    if (!message || message.deletedAt) {
      throw new NotFoundException("Không tìm thấy tin nhắn");
    }
    if (message.senderId !== userId) {
      throw new ForbiddenException("Bạn chỉ có thể chỉnh sửa tin nhắn của chính mình");
    }
    if (message.type !== "text") {
      throw new BadRequestException("Chỉ có thể chỉnh sửa tin nhắn văn bản");
    }

    await message.update({ content: newContent, isEdited: true });

    socketService.emitToRoom(
      `conversation:${message.conversationId}`,
      "message_edited",
      { messageId, content: newContent, isEdited: true }
    );

    return message;
  }

  /**
   * Xóa tin nhắn (soft-delete, chỉ người gửi)
   * @param {string} messageId
   * @param {string} userId
   */
  static async deleteMessage(messageId, userId) {
    const message = await Message.findByPk(messageId);
    if (!message || message.deletedAt) {
      throw new NotFoundException("Không tìm thấy tin nhắn");
    }
    if (message.senderId !== userId) {
      throw new ForbiddenException("Bạn chỉ có thể xóa tin nhắn của chính mình");
    }

    await message.update({ deletedAt: new Date() });

    socketService.emitToRoom(
      `conversation:${message.conversationId}`,
      "message_deleted",
      { messageId }
    );

    return { messageId };
  }

  /**
   * Đánh dấu đã đọc - cập nhật lastReadAt của member hiện tại
   * @param {string} conversationId
   * @param {string} userId
   */
  static async markAsRead(conversationId, userId) {
    const membership = await ConversationMember.findOne({
      where: { conversationId, userId, leftAt: null },
    });
    if (!membership) throw new ForbiddenException("Bạn không phải thành viên");

    await membership.update({ lastReadAt: new Date() });

    socketService.emitToRoom(`conversation:${conversationId}`, "message_read", {
      conversationId,
      userId,
      readAt: membership.lastReadAt,
    });

    return { conversationId, readAt: membership.lastReadAt };
  }

  /**
   * Ghim / bỏ ghim conversation cho user
   * @param {string} conversationId
   * @param {string} userId
   */
  static async togglePin(conversationId, userId) {
    const membership = await ConversationMember.findOne({
      where: { conversationId, userId, leftAt: null },
    });
    if (!membership) throw new ForbiddenException("Bạn không phải thành viên");

    await membership.update({ isPinned: !membership.isPinned });
    return { conversationId, isPinned: membership.isPinned };
  }

  /**
   * Bật / tắt thông báo (mute) cho conversation
   * @param {string} conversationId
   * @param {string} userId
   */
  static async toggleMute(conversationId, userId) {
    const membership = await ConversationMember.findOne({
      where: { conversationId, userId, leftAt: null },
    });
    if (!membership) throw new ForbiddenException("Bạn không phải thành viên");

    await membership.update({ isMuted: !membership.isMuted });
    return { conversationId, isMuted: membership.isMuted };
  }
}

module.exports = ChatService;
