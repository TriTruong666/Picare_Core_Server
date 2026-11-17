const { randomUUID } = require("crypto");
const { Op, Sequelize } = require("sequelize");
const sharp = require("sharp");
const {
  Conversation,
  ConversationMember,
  Message,
  MessageAttachment,
  PinnedMessage,
  MessageReaction,
} = require("../models/chat");
const User = require("../models/user.model");
const S3Asset = require("../models/s3_asset.model");
const socketService = require("./socket.service");
const chatSecurity = require("./chat_security.service");
const bcrypt = require("bcrypt");
const ssePublisher = require("./sse_publisher.service");
const chatCryptoService = require("./chat_crypto.service");
const linkPreviewService = require("./link_preview.service");
const s3Service = require("./s3.service");
const appConfig = require("../config/app.config");
const { AssetVisibility } = require("../common/enum/s3_asset.enum");
const {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");
const {
  PICARE_GROUP_PUBLIC_ID,
  PICARE_GROUP_DB_ID,
  PICARE_GROUP_NAME,
  PICARE_GROUP_DESCRIPTION,
  SYSTEM_ADMIN_USER_ID,
  resolveDbConversationId,
  toPublicConversationId,
} = require("../common/chat_constants");

const SENDER_ATTRIBUTES = ["userId", "name", "role", "isOnline"];
const VALID_SYSTEMS = ["CORE", "OFFICE", "OMS", "WMS", "SFA"];
const messageRateWindowMap = new Map(); // userId -> { count, resetAt }

class ChatService {
  static resolveDbConversationId(id) {
    return resolveDbConversationId(id);
  }

  static toPublicConversationId(id) {
    return toPublicConversationId(id);
  }

  /**
   * Đảm bảo nhóm chat chính thức toàn hệ thống "Đại gia đình - Picare Group" (id công khai: picare_group)
   * tồn tại trong DB và toàn bộ thành viên hệ thống đều được thêm vào.
   */
  static async ensurePicareGroup({ force = false } = {}) {
    if (this._picareGroupBootstrapped && !force) {
      return this._picareGroupConv || null;
    }
    if (this._ensurePicareGroupPromise && !force) {
      return this._ensurePicareGroupPromise;
    }

    const runEnsure = async () => {
      let conv = await Conversation.findByPk(PICARE_GROUP_DB_ID);
      if (!conv) {
        const systemAdmin = await User.findOne({
          where: { userId: SYSTEM_ADMIN_USER_ID },
          attributes: ["userId"],
        });
        const firstAdmin =
          systemAdmin ||
          (await User.findOne({
            where: { role: "admin" },
            order: [["id", "ASC"]],
            attributes: ["userId"],
          })) ||
          (await User.findOne({
            order: [["id", "ASC"]],
            attributes: ["userId"],
          }));

        if (!firstAdmin?.userId) {
          return null;
        }

        [conv] = await Conversation.findOrCreate({
          where: { id: PICARE_GROUP_DB_ID },
          defaults: {
            id: PICARE_GROUP_DB_ID,
            type: "group",
            name: PICARE_GROUP_NAME,
            description: PICARE_GROUP_DESCRIPTION,
            createdBy: firstAdmin.userId,
            scopeSystem: "CORE",
            companyId: null,
            contextType: "PICARE_GROUP",
            contextId: PICARE_GROUP_PUBLIC_ID,
          },
        });
      } else if (
        conv.contextType !== "PICARE_GROUP" ||
        conv.contextId !== PICARE_GROUP_PUBLIC_ID
      ) {
        await conv.update({
          name: PICARE_GROUP_NAME,
          description: PICARE_GROUP_DESCRIPTION,
          contextType: "PICARE_GROUP",
          contextId: PICARE_GROUP_PUBLIC_ID,
        });
      }

      await this._getOrEnsureConversationDek(conv);

      const activeUsers = await User.findAll({
        where: {
          [Op.or]: [{ status: "ACTIVE" }, { status: null }],
        },
        attributes: ["userId"],
      });

      const existingMembers = await ConversationMember.findAll({
        where: { conversationId: PICARE_GROUP_DB_ID },
        attributes: ["userId"],
      });
      const existingUserSet = new Set(existingMembers.map((m) => m.userId));
      const now = new Date();
      const missingMembers = activeUsers
        .map((u) => u.userId)
        .filter((uid) => uid && !existingUserSet.has(uid));

      if (missingMembers.length > 0) {
        await ConversationMember.bulkCreate(
          missingMembers.map((uid) => ({
            conversationId: PICARE_GROUP_DB_ID,
            userId: uid,
            role: uid === conv.createdBy ? "owner" : "member",
            unreadCount: 0,
            mentionCount: 0,
            joinedAt: now,
          })),
          { ignoreDuplicates: true },
        );
        socketService.addUsersToConversationRoom(
          missingMembers,
          PICARE_GROUP_PUBLIC_ID,
        );
      }

      if (!this._picareGroupUserSet) {
        this._picareGroupUserSet = new Set();
      }
      for (const m of existingMembers) {
        if (m.userId) this._picareGroupUserSet.add(m.userId);
      }
      for (const uid of missingMembers) {
        this._picareGroupUserSet.add(uid);
      }

      this._picareGroupConv = conv;
      this._picareGroupBootstrapped = true;
      return conv;
    };

    const promise = runEnsure().finally(() => {
      if (this._ensurePicareGroupPromise === promise) {
        this._ensurePicareGroupPromise = null;
      }
    });
    this._ensurePicareGroupPromise = promise;
    return promise;
  }

  /**
   * Tự động thêm một thành viên vừa được tạo trong hệ thống vào "Đại gia đình - Picare Group"
   */
  static async addUserToPicareGroup(userId) {
    if (!userId) return null;
    const conv = await this.ensurePicareGroup();
    if (!conv) return null;

    const existing = await ConversationMember.findOne({
      where: { conversationId: PICARE_GROUP_DB_ID, userId },
    });

    if (!this._picareGroupUserSet) {
      this._picareGroupUserSet = new Set();
    }
    this._picareGroupUserSet.add(userId);

    if (existing) {
      return existing;
    }

    const member = await ConversationMember.create({
      conversationId: PICARE_GROUP_DB_ID,
      userId,
      role: userId === conv.createdBy ? "owner" : "member",
      unreadCount: 0,
      mentionCount: 0,
      joinedAt: new Date(),
    });

    socketService.addUsersToConversationRoom([userId], PICARE_GROUP_PUBLIC_ID);
    try {
      const detail = await this.getConversationDetail(PICARE_GROUP_DB_ID, userId);
      socketService.emitToUsers([userId], "new_conversation", detail);
    } catch (_err) {
      // Ignore secondary notification errors
    }
    return member;
  }
  // =====================================
  // INTERNAL HELPERS (CRYPTO, HYDRATION & DEEP-LINK)
  // =====================================

  /**
   * Kiểm tra giới hạn tần suất gửi tin nhắn (Rate Limiting - C4)
   * @param {string} userId
   */
  static checkSendRateLimit(userId) {
    if (!userId) return;
    const maxPerMinute =
      Number(process.env.CHAT_RATE_LIMIT_PER_MINUTE) || 120;
    const windowMs = 60 * 1000;
    const now = Date.now();

    const current = messageRateWindowMap.get(userId);
    if (!current || now > current.resetAt) {
      messageRateWindowMap.set(userId, {
        count: 1,
        resetAt: now + windowMs,
      });
      return;
    }

    if (current.count >= maxPerMinute) {
      throw new BadRequestException({
        code: "ERR_CHAT_RATE_LIMIT",
        message: "Bạn gửi tin nhắn quá nhanh, vui lòng thử lại sau giây lát",
        statusCode: 429,
      });
    }

    current.count += 1;
  }

  /**
   * Giải quyết Deep-Link trực tiếp cho Dropdown Widget (OMS, WMS, SFA, Office) (C4)
   * @param {Object} params
   */
  static resolveDeepLink({
    entityType,
    sourceSystem = "OFFICE",
    entityId,
    entityCode = null,
    path = null,
    primarySystem = null,
    fallbackPaths = {},
    conversationId = null,
    messageId = null,
  }) {
    const normalized = this.normalizeEntityCardMetadata(
      {
        entityType,
        sourceSystem,
        entityId,
        entityCode,
        navigation: {
          primarySystem: primarySystem || sourceSystem,
          path,
          fallbackPaths,
        },
      },
      { defaultSystem: sourceSystem },
    );

    const resolved = this.resolveEntityNavigation(
      normalized,
      conversationId,
      messageId,
    );
    return resolved.navigation;
  }

  /**
   * Xoay vòng khoá bọc DEK của một cuộc hội thoại sang phiên bản Master KEK mới (Key Rotation - C1)
   * @param {string} conversationId
   * @param {string} requesterId
   * @param {number} [targetVersion]
   */
  static async rotateConversationKey(
    conversationId,
    requesterId,
    targetVersion = null,
  ) {
    const [membership, conversation] = await Promise.all([
      ConversationMember.findOne({
        where: { conversationId, userId: requesterId, leftAt: null },
      }),
      Conversation.findByPk(conversationId),
    ]);

    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_CONVERSATION_MEMBER);
    }
    if (
      conversation?.type === "group" &&
      !["owner", "admin"].includes(membership.role)
    ) {
      throw new ForbiddenException(ErrorCodes.CHAT_GROUP_UPDATE_FORBIDDEN);
    }
    if (!conversation) {
      throw new NotFoundException(ErrorCodes.CHAT_CONVERSATION_NOT_FOUND);
    }

    const previousVersion = conversation.dekVersion || 1;
    const rotated = chatCryptoService.rotateConversationDek(
      conversation.id,
      conversation.encryptedDek,
      previousVersion,
      targetVersion,
    );

    await conversation.update({
      encryptedDek: rotated.encryptedDek,
      dekVersion: rotated.dekVersion,
    });

    return {
      conversationId: conversation.id,
      previousVersion,
      dekVersion: rotated.dekVersion,
      rotatedAt: new Date().toISOString(),
    };
  }

  /**
   * Đảm bảo cuộc hội thoại luôn có DEK hợp lệ và trả về Buffer DEK
   * @param {Conversation|Object} conversation
   * @returns {Promise<{dek: Buffer, dekVersion: number}>}
   */
  static async _getOrEnsureConversationDek(conversation) {
    if (!conversation) {
      throw new NotFoundException(ErrorCodes.CHAT_CONVERSATION_NOT_FOUND);
    }

    const convId = conversation.id;
    if (conversation.isSecure) {
      const store = chatSecurity.context.getStore();
      store?.secureIds.add(convId);
      if (!store?.code || store.conversationId !== convId) return { dek: null, dekVersion: conversation.dekVersion };
      const wrapped = await chatSecurity.open(conversation);
      // Never retain protected DEKs in the process-wide cache.
      chatCryptoService.dekCache.delete(convId);
      try {
        return { dek: chatCryptoService.unwrapConversationDek(convId, wrapped, conversation.dekVersion), dekVersion: conversation.dekVersion };
      } finally { chatCryptoService.dekCache.delete(convId); }
    }
    let encryptedDek = conversation.encryptedDek;
    let dekVersion = conversation.dekVersion || 1;

    if (!encryptedDek && typeof conversation.update === "function") {
      const generated = chatCryptoService.generateConversationDek(convId);
      encryptedDek = generated.encryptedDek;
      dekVersion = generated.dekVersion;
      await conversation.update({
        encryptedDek,
        dekVersion,
      });
      return { dek: generated.dek, dekVersion };
    }

    const dek = chatCryptoService.unwrapConversationDek(
      convId,
      encryptedDek,
      dekVersion,
    );
    return { dek, dekVersion };
  }

  /**
   * Chuẩn hoá và kiểm tra hợp lệ dữ liệu Sticker gửi trong chat
   * @param {Object} metadata
   */
  static normalizeStickerMetadata(metadata = {}) {
    const rawSticker =
      metadata?.sticker && typeof metadata.sticker === "object"
        ? metadata.sticker
        : metadata;

    const stickerId = String(rawSticker?.id || rawSticker?.stickerId || "").trim();
    if (!stickerId || !/^[a-zA-Z0-9_-]{1,80}$/.test(stickerId)) {
      throw new BadRequestException("Thông tin stickerId không hợp lệ");
    }

    const isSafeStickerUrl = (val) => {
      if (!val || typeof val !== "string") return false;
      const trimmed = val.trim();
      return (
        trimmed.startsWith("/stickers/") ||
        trimmed.startsWith("https://fonts.gstatic.com/s/e/notoemoji/")
      );
    };

    const url = isSafeStickerUrl(rawSticker?.url) ? rawSticker.url.trim() : null;
    const lottieUrl = isSafeStickerUrl(rawSticker?.lottieUrl)
      ? rawSticker.lottieUrl.trim()
      : null;
    const fallbackWebpUrl = isSafeStickerUrl(rawSticker?.fallbackWebpUrl)
      ? rawSticker.fallbackWebpUrl.trim()
      : null;

    if (!url && !lottieUrl && !fallbackWebpUrl) {
      throw new BadRequestException("Đường dẫn sticker không hợp lệ");
    }

    const format = rawSticker?.format === "lottie" ? "lottie" : "webp";
    const pack = String(rawSticker?.pack || "picare_pibot")
      .trim()
      .slice(0, 40);
    const label = String(rawSticker?.label || "Nhãn dán")
      .trim()
      .slice(0, 80);
    const codepoint = rawSticker?.codepoint
      ? String(rawSticker.codepoint).trim().slice(0, 40)
      : null;

    return {
      schemaVersion: 1,
      sticker: {
        id: stickerId,
        pack,
        label,
        format,
        url: url || fallbackWebpUrl || lottieUrl,
        ...(lottieUrl ? { lottieUrl } : {}),
        ...(fallbackWebpUrl ? { fallbackWebpUrl } : {}),
        ...(codepoint ? { codepoint } : {}),
      },
    };
  }

  /**
   * Chuẩn hoá và kiểm tra hợp lệ dữ liệu Entity Card (C3 & C4)
   * @param {Object} metadata
   * @param {Object} [options]
   */
  static normalizeEntityCardMetadata(metadata, options = {}) {
    if (!metadata || typeof metadata !== "object") {
      throw new BadRequestException(ErrorCodes.CHAT_ENTITY_CARD_INVALID);
    }

    const entityType = String(metadata.entityType || "")
      .trim()
      .toUpperCase();
    const sourceSystem = String(
      metadata.sourceSystem || options.defaultSystem || "CORE",
    )
      .trim()
      .toUpperCase();
    const entityId = String(metadata.entityId || "").trim();

    if (!entityType || !entityId || !VALID_SYSTEMS.includes(sourceSystem)) {
      throw new BadRequestException(ErrorCodes.CHAT_ENTITY_CARD_INVALID);
    }

    const snapshot =
      metadata.snapshot && typeof metadata.snapshot === "object"
        ? { ...metadata.snapshot }
        : {};
    if (!snapshot.title) {
      snapshot.title = metadata.entityCode
        ? `${entityType} #${metadata.entityCode}`
        : `${entityType} #${entityId}`;
    }

    const navigation =
      metadata.navigation && typeof metadata.navigation === "object"
        ? { ...metadata.navigation }
        : {};
    const primarySystem = String(
      navigation.primarySystem || sourceSystem,
    ).toUpperCase();
    const defaultPath =
      navigation.path ||
      metadata.deepLink ||
      `/${entityType.toLowerCase().replace(/_/g, "-")}s/${encodeURIComponent(entityId)}`;

    return {
      schemaVersion: Number(metadata.schemaVersion) || 1,
      entityType,
      sourceSystem,
      entityId,
      entityCode: metadata.entityCode ? String(metadata.entityCode).trim() : null,
      companyId: metadata.companyId ? String(metadata.companyId).trim() : null,
      snapshot,
      navigation: {
        primarySystem: VALID_SYSTEMS.includes(primarySystem)
          ? primarySystem
          : sourceSystem,
        path: defaultPath.startsWith("/") ? defaultPath : `/${defaultPath}`,
        fallbackPaths:
          navigation.fallbackPaths &&
          typeof navigation.fallbackPaths === "object"
            ? navigation.fallbackPaths
            : {},
      },
      actions: Array.isArray(metadata.actions) ? metadata.actions : [],
      ...(Array.isArray(metadata.mentions)
        ? { mentions: metadata.mentions }
        : {}),
      updatedAt: metadata.updatedAt || new Date().toISOString(),
    };
  }

  /**
   * Giải quyết Deep-Link Redirect cho Entity Card giữa các hệ thống (CORE, OFFICE, OMS, WMS, SFA)
   * @param {Object} metadata
   * @param {string} [conversationId]
   * @param {string} [messageId]
   */
  static resolveEntityNavigation(metadata, conversationId, messageId) {
    if (!metadata || typeof metadata !== "object" || !metadata.entityType) {
      return metadata;
    }

    const systemUrls = appConfig.chat?.systemUrls || {};
    const nav = metadata.navigation || {};
    const primarySystem = String(
      nav.primarySystem || metadata.sourceSystem || "OFFICE",
    ).toUpperCase();
    const rawPath = nav.path || "/";
    const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    const baseUrl = String(
      systemUrls[primarySystem] || systemUrls.OFFICE || "",
    ).replace(/\/+$/, "");

    const querySuffix =
      conversationId && messageId
        ? `${normalizedPath.includes("?") ? "&" : "?"}fromChat=${encodeURIComponent(conversationId)}&msgId=${encodeURIComponent(messageId)}`
        : "";

    const resolvedUrls = {};
    if (baseUrl) {
      resolvedUrls[primarySystem] = `${baseUrl}${normalizedPath}${querySuffix}`;
    }

    const fallbackPaths = nav.fallbackPaths || {};
    for (const [sysKey, sysPath] of Object.entries(fallbackPaths)) {
      const upperSys = String(sysKey).toUpperCase();
      const sysBase = String(systemUrls[upperSys] || "").replace(/\/+$/, "");
      if (sysBase && typeof sysPath === "string" && sysPath.trim()) {
        const cleanSysPath = sysPath.startsWith("/") ? sysPath : `/${sysPath}`;
        resolvedUrls[upperSys] = `${sysBase}${cleanSysPath}${querySuffix}`;
      }
    }

    return {
      ...metadata,
      navigation: {
        ...nav,
        primarySystem,
        path: normalizedPath,
        redirectUrl: resolvedUrls[primarySystem] || normalizedPath,
        resolvedUrls,
      },
    };
  }

  /**
   * Giải mã một Message (kể cả replyTo và metadata) và làm sạch các trường mật mã nội bộ
   * @param {Message|Object} messageInstanceOrPlain
   * @param {Buffer} dek
   */
  static hydrateMessage(messageInstanceOrPlain, dek) {
    if (!messageInstanceOrPlain) return null;
    const raw =
      typeof messageInstanceOrPlain.toJSON === "function"
        ? messageInstanceOrPlain.toJSON()
        : { ...messageInstanceOrPlain };

    if (!dek) return { id: raw.id, conversationId: this.toPublicConversationId(raw.conversationId), content: null, metadata: null, attachments: [], replyTo: null, isSecure: true };

    if (raw.isRecalled) {
      let hydratedReplyTo = null;
      if (raw.replyTo) {
        hydratedReplyTo = this.hydrateMessage(raw.replyTo, dek);
      }
      const cleanRecalled = {
        ...raw,
        conversationId: this.toPublicConversationId(raw.conversationId),
        content: null,
        metadata: null,
        attachments: [],
        reactions: [],
        replyTo: hydratedReplyTo,
        isRecalled: true,
      };
      delete cleanRecalled.ciphertext;
      delete cleanRecalled.iv;
      delete cleanRecalled.authTag;
      delete cleanRecalled.searchTokens;
      delete cleanRecalled.encryptedMetadata;
      delete cleanRecalled.metadataIv;
      delete cleanRecalled.metadataAuthTag;
      return cleanRecalled;
    }

    const decryptedContent = chatCryptoService.decryptMessageContent({
      dek,
      conversationId: raw.conversationId,
      senderId: raw.senderId,
      messageId: raw.id,
      ciphertext: raw.ciphertext,
      iv: raw.iv,
      authTag: raw.authTag,
      fallbackPlaintext: raw.content,
    });

    let decryptedMetadata = chatCryptoService.decryptMetadata({
      dek,
      conversationId: raw.conversationId,
      senderId: raw.senderId,
      messageId: raw.id,
      encryptedMetadata: raw.encryptedMetadata,
      metadataIv: raw.metadataIv,
      metadataAuthTag: raw.metadataAuthTag,
      fallbackMetadata: raw.metadata,
    });

    const publicConvId = this.toPublicConversationId(raw.conversationId);

    if (decryptedMetadata && decryptedMetadata.entityType) {
      decryptedMetadata = this.resolveEntityNavigation(
        decryptedMetadata,
        publicConvId,
        raw.id,
      );
    }

    let hydratedReplyTo = null;
    if (raw.replyTo) {
      hydratedReplyTo = this.hydrateMessage(raw.replyTo, dek);
    }

    const hydratedAttachments = Array.isArray(raw.attachments)
      ? raw.attachments.map((att) => {
          const item =
            typeof att?.toJSON === "function" ? att.toJSON() : { ...att };
          if (item.isEncrypted && item.id && publicConvId) {
            item.fileUrl = `/api/v1/chat/conversations/${publicConvId}/attachments/${item.id}/content`;
          }
          return item;
        })
      : raw.attachments;

    const clean = {
      ...raw,
      conversationId: publicConvId,
      content: decryptedContent,
      metadata: decryptedMetadata,
      attachments: hydratedAttachments,
      replyTo: hydratedReplyTo,
    };

    delete clean.ciphertext;
    delete clean.iv;
    delete clean.authTag;
    delete clean.searchTokens;
    delete clean.encryptedMetadata;
    delete clean.metadataIv;
    delete clean.metadataAuthTag;

    if (
      clean.sender &&
      (clean.sender.role === "admin" ||
        clean.sender.email === "admin@picare.vn")
    ) {
      clean.sender.name = "Hệ thống";
    }

    return clean;
  }

  /**
   * Làm sạch đối tượng Conversation trước khi trả về client (ẩn encryptedDek)
   */
  static sanitizeConversation(convInstanceOrPlain, dek = null) {
    if (!convInstanceOrPlain) return null;
    const raw =
      typeof convInstanceOrPlain.toJSON === "function"
        ? convInstanceOrPlain.toJSON()
        : { ...convInstanceOrPlain };

    if (raw.isSecure) { raw.lastMessage = null; raw.requiresUnlock = true; }
    delete raw.securityCodeHash;
    if (raw.lastMessage && dek) {
      raw.lastMessage = this.hydrateMessage(raw.lastMessage, dek);
    } else if (raw.lastMessage && !dek) {
      raw.lastMessage = null;
    }

    if (Array.isArray(raw.members)) {
      raw.members.forEach((m) => {
        if (
          m.user &&
          (m.user.role === "admin" || m.user.email === "admin@picare.vn")
        ) {
          m.user.name = "Hệ thống";
        }
      });
    }

    delete raw.encryptedDek;
    raw.id = this.toPublicConversationId(raw.id);
    return raw;
  }

  /**
   * Xác định loại file tổng quát từ mimeType
   */
  static resolveAttachmentFileType(mimeType, explicitType) {
    if (
      explicitType &&
      ["image", "video", "audio", "document", "other"].includes(explicitType)
    ) {
      return explicitType;
    }
    const mime = String(mimeType || "").toLowerCase();
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    if (
      mime.includes("pdf") ||
      mime.includes("word") ||
      mime.includes("excel") ||
      mime.includes("spreadsheet") ||
      mime.includes("presentation") ||
      mime.startsWith("text/")
    ) {
      return "document";
    }
    return "other";
  }

  // =====================================
  // CONVERSATION APIs (C0, C1, C3)
  // =====================================

  static _isSystemAdmin(userRole) {
    return String(userRole || "").toLowerCase() === "admin";
  }

  /**
   * Lấy danh sách tất cả conversations của user hiện tại (bao gồm tin nhắn cuối đã giải mã, unreadCount)
   * @param {string} userId
   * @param {Object} [options] - { scopeSystem, companyId, userRole }
   */
  static async getMyConversations(userId, options = {}) {
    try {
      await this.ensurePicareGroup();
      if (userId && !this._picareGroupUserSet?.has(userId)) {
        await this.addUserToPicareGroup(userId);
      }
    } catch (err) {
      console.warn(
        "[ChatService.getMyConversations] ensurePicareGroup warning:",
        err?.message || err,
      );
    }

    const convWhere = {
      ...(options.scopeSystem && {
        scopeSystem: String(options.scopeSystem).toUpperCase(),
      }),
      ...(options.companyId && { companyId: String(options.companyId) }),
    };

    const memberships = await ConversationMember.findAll({
      where: { userId, hiddenAt: null },
      include: [
        {
          model: Conversation,
          as: "conversation",
          required: true,
          where: Object.keys(convWhere).length > 0 ? convWhere : undefined,
          include: [
            {
              model: Message,
              as: "lastMessage",
              include: [
                { model: User, as: "sender", attributes: SENDER_ATTRIBUTES },
              ],
            },
            {
              model: ConversationMember,
              as: "members",
              where: { leftAt: null },
              required: false,
              include: [
                { model: User, as: "user", attributes: SENDER_ATTRIBUTES },
              ],
            },
          ],
        },
      ],
      order: [
        ["isPinned", "DESC"],
        [
          { model: Conversation, as: "conversation" },
          "lastMessageAt",
          "DESC NULLS LAST",
        ],
      ],
    });

    const results = [];
    const pendingLeftLastMessages = [];
    for (const m of memberships) {
      if (!m.conversation) continue;
      let dek = null;
      try {
        const dekInfo = await this._getOrEnsureConversationDek(m.conversation);
        dek = dekInfo.dek;
      } catch (err) {
        console.warn(
          `[ChatService] Không thể mở khoá DEK cho hội thoại ${m.conversation.id}:`,
          err.message,
        );
      }
      const conv = this.sanitizeConversation(m.conversation, dek);
      const leftAtDate = m.leftAt ? new Date(m.leftAt) : null;
      const clearedAtDate = m.clearedAt ? new Date(m.clearedAt) : null;
      if (leftAtDate && conv.lastMessage?.createdAt && new Date(conv.lastMessage.createdAt) > leftAtDate) {
        pendingLeftLastMessages.push(
          Message.findOne({
            where: {
              conversationId: m.conversation.id,
              deletedAt: null,
              createdAt: {
                [Op.lte]: leftAtDate,
                ...(clearedAtDate ? { [Op.gt]: clearedAtDate } : {}),
              },
            },
            include: [{ model: User, as: "sender", attributes: SENDER_ATTRIBUTES }],
            order: [
              ["createdAt", "DESC"],
              ["id", "DESC"],
            ],
          }).then((lastAllowedMsg) => {
            conv.lastMessage = lastAllowedMsg
              ? this.hydrateMessage(lastAllowedMsg, dek)
              : null;
            conv.lastMessageAt = conv.lastMessage?.createdAt || m.leftAt;
          }),
        );
      } else if (
        clearedAtDate &&
        conv.lastMessage?.createdAt &&
        new Date(conv.lastMessage.createdAt) <= clearedAtDate
      ) {
        conv.lastMessage = null;
      }
      conv.myMembership = {
        role: m.role,
        nickname: m.nickname,
        isMuted: Boolean(m.isMuted),
        isPinned: Boolean(m.isPinned),
        lastReadAt: m.lastReadAt,
        lastReadMessageId: m.lastReadMessageId || null,
        clearedAt: m.clearedAt || null,
        leftAt: m.leftAt || null,
        unreadCount: m.leftAt ? 0 : Number(m.unreadCount || 0),
        mentionCount: m.leftAt ? 0 : Number(m.mentionCount || 0),
      };
      results.push(conv);
    }

    if (pendingLeftLastMessages.length > 0) {
      await Promise.all(pendingLeftLastMessages);
    }

    return results;
  }

  /**
   * Lấy tổng hợp số tin chưa đọc & danh sách rút gọn cho Dropdown UI / Header Badge (C0 & C4)
   * @param {string} userId
   * @param {Object} [options] - { limit, scopeSystem, companyId }
   */
  static async getUserChatSummary(userId, options = {}) {
    const conversations = await this.getMyConversations(userId, options);
    let totalUnreadMessages = 0;
    let totalMentionCount = 0;
    let unreadConversationsCount = 0;

    for (const conv of conversations) {
      const unread = Number(conv.myMembership?.unreadCount || 0);
      const mentions = Number(conv.myMembership?.mentionCount || 0);
      totalUnreadMessages += unread;
      totalMentionCount += mentions;
      if (unread > 0) unreadConversationsCount += 1;
    }

    const limit = Math.min(parseInt(options.limit, 10) || 10, 50);
    return {
      userId,
      totalUnreadMessages,
      totalMentionCount,
      unreadConversationsCount,
      totalConversations: conversations.length,
      recentConversations: conversations.slice(0, limit),
    };
  }

  static async _validateExistingUserIds(userIds = []) {
    const uniqueIds = [...new Set((userIds || []).filter(Boolean))];
    if (uniqueIds.length === 0) return [];
    const existingUsers = await User.findAll({
      where: { userId: { [Op.in]: uniqueIds } },
      attributes: ["userId"],
    });
    const validSet = new Set(existingUsers.map((u) => u.userId));
    const invalidIds = uniqueIds.filter((uid) => !validSet.has(uid));
    if (invalidIds.length > 0) {
      throw new BadRequestException(
        `Tài khoản thành viên không tồn tại trên hệ thống (${invalidIds[0]})`,
      );
    }
    return uniqueIds;
  }

  /**
   * Tạo cuộc hội thoại private (1-1) hoặc group kèm khởi tạo khoá DEK riêng (C1)
   * @param {string} creatorId
   * @param {Object} dto
   */
  static async createConversation(creatorId, dto) {
    if (dto.isSecure && (dto.type !== "private" || chatSecurity.context.getStore()?.role !== "ceo")) chatSecurity.deny();
    const {
      type,
      name,
      description,
      avatarUrl,
      memberIds,
      scopeSystem = "CORE",
      companyId = null,
      contextType = null,
      contextId = null,
    } = dto;

    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      throw new BadRequestException(ErrorCodes.CHAT_MEMBER_REQUIRED);
    }

    if (type === "private") {
      const otherIds = memberIds.filter((id) => id !== creatorId);
      if (otherIds.length !== 1) {
        throw new BadRequestException(
          ErrorCodes.CHAT_PRIVATE_MEMBER_COUNT_INVALID,
        );
      }
      const targetId = otherIds[0];

      // Kiểm tra xem đã có private conversation giữa 2 người chưa
      const existing = await ConversationMember.findOne({
        where: { userId: creatorId, leftAt: null },
        include: [
          {
            model: Conversation,
            as: "conversation",
            where: { type: "private", isSecure: Boolean(dto.isSecure) },
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

      if (existing && existing.conversation) {
        if (existing.hiddenAt) {
          await existing.update({ hiddenAt: null });
        }
        const { dek } = await this._getOrEnsureConversationDek(
          existing.conversation,
        );
        return this.sanitizeConversation(existing.conversation, dek);
      }
    }

    if (type === "group" && !name) {
      throw new BadRequestException(ErrorCodes.CHAT_GROUP_NAME_REQUIRED);
    }

    const allMemberIds = await this._validateExistingUserIds([
      creatorId,
      ...memberIds,
    ]);
    const conversationId = randomUUID();
    const { encryptedDek, dekVersion, dek } =
      chatCryptoService.generateConversationDek(conversationId);

    const normalizedScope = VALID_SYSTEMS.includes(
      String(scopeSystem || "CORE").toUpperCase(),
    )
      ? String(scopeSystem).toUpperCase()
      : "CORE";

    const securityCode = dto.isSecure ? chatSecurity.generateCode() : null;
    const protectedDek = securityCode ? await chatSecurity.seal(encryptedDek, securityCode, conversationId) : encryptedDek;
    const securityCodeHash = securityCode ? await bcrypt.hash(securityCode, 12) : null;
    if (securityCode) {
      chatCryptoService.dekCache.delete(conversationId);
      chatSecurity.context.getStore()?.secureIds.add(conversationId);
    }
    const conversation = await Conversation.create({
      isSecure: Boolean(dto.isSecure), securityCodeHash,
      id: conversationId,
      type,
      name: type === "group" ? name : null,
      description:
        type === "group" && description !== undefined && description !== null
          ? String(description).trim() || null
          : null,
      avatarUrl: avatarUrl || null,
      createdBy: creatorId,
      scopeSystem: normalizedScope,
      companyId: companyId || null,
      contextType: contextType || null,
      contextId: contextId || null,
      encryptedDek: protectedDek,
      dekVersion,
      pinnedCount: 0,
    });

    const now = new Date();
    const memberRecords = allMemberIds.map((uid) => ({
      conversationId: conversation.id,
      userId: uid,
      role: uid === creatorId ? "owner" : "member",
      unreadCount: 0,
      mentionCount: 0,
      joinedAt: now,
    }));

    await ConversationMember.bulkCreate(memberRecords);

    const sanitized = this.sanitizeConversation(conversation, dek);

    // Cho các socket đang kết nối join room hội thoại mới & notify real-time tới tất cả thành viên
    socketService.addUsersToConversationRoom(allMemberIds, conversation.id);
    socketService.emitToUsers(allMemberIds, "new_conversation", sanitized);
    await ssePublisher.publishToUsers(
      allMemberIds,
      "NEW_CONVERSATION",
      sanitized,
    );

    return securityCode ? { ...sanitized, securityCode, securityCodeExpiresAt: new Date(Date.now() + 300000).toISOString() } : sanitized;
  }

  /**
   * Đảm bảo cuộc hội thoại ngữ cảnh (Phòng ban Office, Đội bán hàng SFA, Đơn hàng...) tồn tại (C3)
   * @param {Object} params
   */
  static async ensureContextConversation({
    creatorId,
    type = "group",
    name,
    avatarUrl = null,
    memberIds = [],
    scopeSystem = "OFFICE",
    companyId = null,
    contextType,
    contextId,
  }) {
    const normalizedScope = String(scopeSystem || "OFFICE").toUpperCase();
    const isCompanyGeneral = String(contextType || "").toUpperCase() === "COMPANY_GENERAL";

    if (contextType && contextId) {
      let existing = await Conversation.findOne({
        where: {
          scopeSystem: normalizedScope,
          ...(companyId ? { companyId: String(companyId) } : {}),
          contextType: String(contextType),
          contextId: String(contextId),
        },
        include: [
          {
            model: ConversationMember,
            as: "members",
            where: { leftAt: null },
            required: false,
          },
        ],
      });

      // Fallback: nếu phòng chat tổng (VD: "Picare Office — Kênh Nội Bộ") đã tồn tại từ trước khi gắn contextType/contextId
      if (!existing && isCompanyGeneral && name) {
        existing = await Conversation.findOne({
          where: {
            type: "group",
            name: String(name),
          },
          include: [
            {
              model: ConversationMember,
              as: "members",
              where: { leftAt: null },
              required: false,
            },
          ],
        });
        if (existing) {
          await existing.update({
            scopeSystem: normalizedScope,
            companyId: companyId ? String(companyId) : existing.companyId,
            contextType: String(contextType),
            contextId: String(contextId),
          });
        }
      }

      if (existing) {
        const allUserIds = [
          ...new Set([creatorId, ...(memberIds || [])].filter(Boolean)),
        ];
        if (allUserIds.length > 0) {
          await this.syncConversationMembers(existing.id, {
            memberIds: allUserIds,
            mode: isCompanyGeneral ? "REPLACE" : "ADD_ONLY",
          });
        }
        const { dek } = await this._getOrEnsureConversationDek(existing);
        return this.sanitizeConversation(existing, dek);
      }
    }

    return this.createConversation(creatorId, {
      type,
      name: name || `${contextType || "Group"} #${contextId || ""}`.trim(),
      avatarUrl,
      memberIds: memberIds.length > 0 ? memberIds : [creatorId],
      scopeSystem,
      companyId,
      contextType,
      contextId,
    });
  }

  /**
   * Đồng bộ danh sách thành viên cho nhóm chat ngữ cảnh (Phòng ban Office / Đội Sale SFA) (C3)
   * @param {string} conversationId
   * @param {Object} options - { memberIds, mode: 'REPLACE' | 'ADD_ONLY' | 'REMOVE_ONLY' }
   */
  static async syncConversationMembers(
    conversationId,
    { memberIds = [], mode = "REPLACE" } = {},
  ) {
    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) {
      throw new NotFoundException(ErrorCodes.CHAT_CONVERSATION_NOT_FOUND);
    }

    const rawTargetIds = [...new Set((memberIds || []).filter(Boolean))];
    const existingUsers =
      rawTargetIds.length > 0
        ? await User.findAll({
            where: { userId: { [Op.in]: rawTargetIds } },
            attributes: ["userId"],
          })
        : [];
    const validUserSet = new Set(existingUsers.map((u) => u.userId));
    const targetIds = rawTargetIds.filter((uid) => validUserSet.has(uid));
    const existingMembers = await ConversationMember.findAll({
      where: { conversationId },
    });

    const activeSet = new Set(
      existingMembers.filter((m) => !m.leftAt).map((m) => m.userId),
    );
    const allRecordMap = new Map(existingMembers.map((m) => [m.userId, m]));

    const addedUserIds = [];
    const removedUserIds = [];
    const now = new Date();

    if (mode === "REPLACE" || mode === "ADD_ONLY") {
      const toCreate = [];
      const toRejoinIds = [];

      for (const uid of targetIds) {
        if (activeSet.has(uid)) continue;
        if (allRecordMap.has(uid)) {
          toRejoinIds.push(uid);
        } else {
          toCreate.push({
            conversationId,
            userId: uid,
            role: "member",
            unreadCount: 0,
            mentionCount: 0,
            joinedAt: now,
          });
        }
        addedUserIds.push(uid);
      }

      if (toCreate.length > 0) {
        await ConversationMember.bulkCreate(toCreate, {
          ignoreDuplicates: true,
        });
      }
      if (toRejoinIds.length > 0) {
        await ConversationMember.update(
          { leftAt: null, joinedAt: now, unreadCount: 0, mentionCount: 0 },
          {
            where: {
              conversationId,
              userId: { [Op.in]: toRejoinIds },
            },
          },
        );
      }
    }

    if (mode === "REPLACE" || mode === "REMOVE_ONLY") {
      const isCompanyGeneral =
        String(conversation.contextType || "").toUpperCase() ===
        "COMPANY_GENERAL";
      const toRemove =
        mode === "REMOVE_ONLY"
          ? targetIds.filter((uid) => activeSet.has(uid))
          : [...activeSet].filter(
              (uid) =>
                !targetIds.includes(uid) &&
                (isCompanyGeneral
                  ? uid !== "25d3eb75-03fe-4208-a685-845ec606e2d8"
                  : allRecordMap.get(uid)?.role !== "owner"),
            );

      if (toRemove.length > 0) {
        await ConversationMember.update(
          { leftAt: now },
          {
            where: {
              conversationId,
              userId: { [Op.in]: toRemove },
              leftAt: null,
            },
          },
        );
        removedUserIds.push(...toRemove);
      }
    }

    if (addedUserIds.length > 0) {
      socketService.addUsersToConversationRoom(addedUserIds, conversationId);
    }

    const notifyTargets = [
      ...new Set([...activeSet, ...addedUserIds, ...removedUserIds]),
    ];
    if (
      notifyTargets.length > 0 &&
      (addedUserIds.length > 0 || removedUserIds.length > 0)
    ) {
      const eventPayload = {
        conversationId,
        addedUserIds,
        removedUserIds,
        mode,
      };
      socketService.emitToUsers(
        notifyTargets,
        "conversation_members_synced",
        eventPayload,
      );
      await ssePublisher.publishToUsers(
        notifyTargets,
        "CONVERSATION_MEMBERS_SYNCED",
        eventPayload,
      );
    }

    return {
      conversationId,
      addedUserIds,
      removedUserIds,
    };
  }

  /**
   * Lấy chi tiết một conversation (kiểm tra tư cách thành viên & giải mã lastMessage)
   * @param {string} conversationId
   * @param {string} userId
   */
  static async getConversationDetail(conversationId, userId) {
    conversationId = this.resolveDbConversationId(conversationId);
    if (conversationId === PICARE_GROUP_DB_ID) {
      await this.addUserToPicareGroup(userId).catch(() => null);
    }
    const [membership, conversation] = await Promise.all([
      ConversationMember.findOne({
        where: { conversationId, userId },
      }),
      Conversation.findByPk(conversationId, {
        include: [
          {
            model: ConversationMember,
            as: "members",
            where: { leftAt: null },
            required: false,
            include: [
              { model: User, as: "user", attributes: SENDER_ATTRIBUTES },
            ],
          },
          {
            model: Message,
            as: "lastMessage",
            include: [
              { model: User, as: "sender", attributes: SENDER_ATTRIBUTES },
            ],
          },
        ],
      }),
    ]);

    if (!conversation) {
      throw new NotFoundException(ErrorCodes.CHAT_CONVERSATION_NOT_FOUND);
    }
    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_CONVERSATION_MEMBER);
    }

    const { dek } = await this._getOrEnsureConversationDek(conversation);
    const sanitized = this.sanitizeConversation(conversation, dek);
    const leftAtDate = membership?.leftAt ? new Date(membership.leftAt) : null;
    const clearedAtDate = membership?.clearedAt ? new Date(membership.clearedAt) : null;
    if (leftAtDate && sanitized.lastMessage?.createdAt && new Date(sanitized.lastMessage.createdAt) > leftAtDate) {
      const lastAllowedMsg = await Message.findOne({
        where: {
          conversationId,
          deletedAt: null,
          createdAt: {
            [Op.lte]: leftAtDate,
            ...(clearedAtDate ? { [Op.gt]: clearedAtDate } : {}),
          },
        },
        include: [{ model: User, as: "sender", attributes: SENDER_ATTRIBUTES }],
        order: [
          ["createdAt", "DESC"],
          ["id", "DESC"],
        ],
      });
      sanitized.lastMessage = lastAllowedMsg
        ? this.hydrateMessage(lastAllowedMsg, dek)
        : null;
      sanitized.lastMessageAt = sanitized.lastMessage?.createdAt || membership.leftAt;
    }
    if (
      clearedAtDate &&
      sanitized.lastMessage?.createdAt &&
      new Date(sanitized.lastMessage.createdAt) <= clearedAtDate
    ) {
      sanitized.lastMessage = null;
    }
    sanitized.myMembership = membership
      ? {
          role: membership.role,
          nickname: membership.nickname,
          isMuted: Boolean(membership.isMuted),
          isPinned: Boolean(membership.isPinned),
          lastReadAt: membership.lastReadAt,
          lastReadMessageId: membership.lastReadMessageId || null,
          clearedAt: membership.clearedAt || null,
          leftAt: membership.leftAt || null,
          unreadCount: membership.leftAt ? 0 : Number(membership.unreadCount || 0),
          mentionCount: membership.leftAt ? 0 : Number(membership.mentionCount || 0),
        }
      : {
          role: "admin",
          nickname: null,
          isMuted: false,
          isPinned: false,
          lastReadAt: null,
          lastReadMessageId: null,
          clearedAt: null,
          leftAt: null,
          unreadCount: 0,
          mentionCount: 0,
        };
    return sanitized;
  }

  /**
   * Cập nhật thông tin nhóm (chỉ owner/admin)
   */
  static async updateConversation(conversationId, userId, dto, userRole = null) {
    if (conversationId === PICARE_GROUP_DB_ID) {
      throw new ForbiddenException(
        "Không thể chỉnh sửa thông tin nhóm chính thức Đại gia đình - Picare Group",
      );
    }
    const isSysAdmin = String(userRole || "").toLowerCase() === "admin";
    const membership = await ConversationMember.findOne({
      where: { conversationId, userId, leftAt: null },
    });
    if (!isSysAdmin) {
      if (!membership) throw new ForbiddenException(ErrorCodes.CHAT_NOT_MEMBER);
      if (!["owner", "admin"].includes(membership.role)) {
        throw new ForbiddenException(ErrorCodes.CHAT_GROUP_UPDATE_FORBIDDEN);
      }
    }

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) {
      throw new NotFoundException(ErrorCodes.CHAT_CONVERSATION_NOT_FOUND);
    }
    if (conversation.type !== "group") {
      throw new BadRequestException(ErrorCodes.CHAT_ONLY_GROUP_UPDATE);
    }

    const { name, description, avatarUrl } = dto;
    await conversation.update({
      ...(name !== undefined && { name }),
      ...(description !== undefined && {
        description:
          description === null ? null : String(description).trim() || null,
      }),
      ...(avatarUrl !== undefined && { avatarUrl }),
    });

    const { dek } = await this._getOrEnsureConversationDek(conversation);
    const sanitized = this.sanitizeConversation(conversation, dek);

    const allMembers = await ConversationMember.findAll({
      where: { conversationId, leftAt: null },
      attributes: ["userId"],
    });
    const memberIds = allMembers.map((m) => m.userId);

    socketService.emitToUsers(memberIds, "conversation_updated", sanitized);
    await ssePublisher.publishToUsers(
      memberIds,
      "CONVERSATION_UPDATED",
      sanitized,
    );

    return sanitized;
  }

  /**
   * Tạo & phát tin nhắn hệ thống nội bộ trong cuộc hội thoại (với mã hoá DEK chuẩn)
   */
  static async _createSystemMessage(
    conversation,
    actorId,
    content,
    metadata = {},
    notifyUserIds = null,
  ) {
    const { dek, version: dekVersion } =
      await this._getOrEnsureConversationDek(conversation);
    const messageId = randomUUID();
    const normalizedMetadata = { isSystem: true, ...metadata };
    const encryptedMetaResult = chatCryptoService.encryptMetadata({
      dek,
      conversationId: conversation.id,
      senderId: actorId,
      messageId,
      metadata: normalizedMetadata,
    });
    const encryptedContentResult = chatCryptoService.encryptMessageContent({
      dek,
      conversationId: conversation.id,
      senderId: actorId,
      messageId,
      plaintext: content,
      extraSearchTerms: encryptedMetaResult.extraSearchTerms || [],
      keyVersion: dekVersion,
    });

    const now = new Date();
    const message = await Message.create({
      id: messageId,
      conversationId: conversation.id,
      senderId: actorId,
      type: "system",
      content: encryptedContentResult.content,
      ciphertext: encryptedContentResult.ciphertext,
      iv: encryptedContentResult.iv,
      authTag: encryptedContentResult.authTag,
      keyVersion: encryptedContentResult.keyVersion,
      searchTokens: encryptedContentResult.searchTokens,
      metadata: encryptedMetaResult.publicMetadata,
      encryptedMetadata: encryptedMetaResult.encryptedMetadata,
      metadataIv: encryptedMetaResult.metadataIv,
      metadataAuthTag: encryptedMetaResult.metadataAuthTag,
      createdAt: now,
    });

    await Promise.all([
      Conversation.update(
        { lastMessageId: message.id, lastMessageAt: now },
        { where: { id: conversation.id } },
      ),
      ConversationMember.update(
        { hiddenAt: null },
        {
          where: {
            conversationId: conversation.id,
            leftAt: null,
            hiddenAt: { [Op.ne]: null },
          },
        },
      ),
    ]);

    const fullMessage = await Message.findByPk(message.id, {
      include: [
        { model: User, as: "sender", attributes: SENDER_ATTRIBUTES },
        { model: MessageAttachment, as: "attachments" },
      ],
    });
    const hydrated = this.hydrateMessage(fullMessage || message, dek);

    let recipients = notifyUserIds;
    if (!Array.isArray(recipients)) {
      const members = await ConversationMember.findAll({
        where: { conversationId: conversation.id, leftAt: null },
        attributes: ["userId"],
      });
      recipients = members.map((m) => m.userId);
    }

    if (recipients.length > 0) {
      socketService.emitToConversationAndUsers(
        conversation.id,
        recipients,
        "new_message",
        hydrated,
      );
      await ssePublisher.publishToUsers(recipients, "NEW_MESSAGE", hydrated);
    }

    return { hydrated, createdAt: now };
  }

  /**
   * Thêm thành viên vào nhóm (chỉ Quản trị viên - người tạo phòng)
   */
  static async addMembers(conversationId, requesterId, newMemberIds, userRole = null) {
    if (conversationId === PICARE_GROUP_DB_ID) {
      throw new ForbiddenException(
        "Thành viên được tự động đồng bộ vào nhóm chính thức Đại gia đình - Picare Group",
      );
    }
    const isSysAdmin = String(userRole || "").toLowerCase() === "admin";
    const [membership, conversation] = await Promise.all([
      ConversationMember.findOne({
        where: { conversationId, userId: requesterId, leftAt: null },
      }),
      Conversation.findByPk(conversationId),
    ]);
    if (!isSysAdmin && !membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_MEMBER);
    }
    if (!conversation || conversation.type !== "group") {
      throw new BadRequestException(ErrorCodes.CHAT_ONLY_GROUP_ADD_MEMBER);
    }
    const isGroupOwner =
      isSysAdmin ||
      conversation.createdBy === requesterId ||
      membership?.role === "owner";
    if (!isGroupOwner) {
      throw new ForbiddenException(ErrorCodes.CHAT_ADD_MEMBER_FORBIDDEN);
    }

    const validNewMemberIds = await this._validateExistingUserIds(newMemberIds);
    if (validNewMemberIds.length === 0) {
      throw new BadRequestException("Danh sách thành viên thêm mới không hợp lệ");
    }

    const now = new Date();
    const records = validNewMemberIds.map((uid) => ({
      conversationId,
      userId: uid,
      role: "member",
      unreadCount: 0,
      mentionCount: 0,
      joinedAt: now,
    }));

    await ConversationMember.bulkCreate(records, {
      ignoreDuplicates: true,
    });

    await ConversationMember.update(
      {
        leftAt: null,
        hiddenAt: null,
        joinedAt: now,
        unreadCount: 0,
        mentionCount: 0,
      },
      {
        where: {
          conversationId,
          userId: { [Op.in]: validNewMemberIds },
          leftAt: { [Op.ne]: null },
        },
      },
    );

    const allMembers = await ConversationMember.findAll({
      where: { conversationId, leftAt: null },
      attributes: ["userId"],
    });
    const memberIds = allMembers.map((m) => m.userId);
    const payload = {
      conversationId: this.toPublicConversationId(conversationId),
      newMemberIds,
    };

    socketService.addUsersToConversationRoom(newMemberIds, conversationId);
    socketService.emitToUsers(memberIds, "members_added", payload);
    await ssePublisher.publishToUsers(memberIds, "MEMBERS_ADDED", payload);

    return payload;
  }

  /**
   * Xóa thành viên khỏi nhóm (chỉ Quản trị viên) / tự rời nhóm (giữ nguyên lịch sử tới thời điểm rời)
   */
  static async removeMember(conversationId, requesterId, targetUserId, userRole = null) {
    if (conversationId === PICARE_GROUP_DB_ID) {
      throw new ForbiddenException(
        "Không thể rời khỏi hoặc xoá thành viên khỏi nhóm chính thức Đại gia đình - Picare Group",
      );
    }
    const isSysAdmin = String(userRole || "").toLowerCase() === "admin";
    const [requesterMembership, targetMembership, conversation] =
      await Promise.all([
        ConversationMember.findOne({
          where: { conversationId, userId: requesterId, leftAt: null },
        }),
        ConversationMember.findOne({
          where: { conversationId, userId: targetUserId, leftAt: null },
        }),
        Conversation.findByPk(conversationId),
      ]);
    if (!isSysAdmin && !requesterMembership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_MEMBER);
    }
    if (!conversation) {
      throw new NotFoundException(ErrorCodes.CHAT_CONVERSATION_NOT_FOUND);
    }

    const isSelfLeave = requesterId === targetUserId;
    const isRequesterOwner =
      isSysAdmin ||
      conversation.createdBy === requesterId ||
      requesterMembership?.role === "owner";

    if (!isSelfLeave && !isRequesterOwner) {
      throw new ForbiddenException(ErrorCodes.CHAT_REMOVE_MEMBER_FORBIDDEN);
    }
    if (
      !isSysAdmin &&
      !isSelfLeave &&
      (targetUserId === conversation.createdBy ||
        targetMembership?.role === "owner")
    ) {
      throw new ForbiddenException(ErrorCodes.CHAT_REMOVE_MEMBER_FORBIDDEN);
    }

    const activeMembersBefore = await ConversationMember.findAll({
      where: { conversationId, leftAt: null },
      attributes: ["userId", "role", "joinedAt"],
      order: [["joinedAt", "ASC"]],
    });
    const notifyIdsBefore = [
      ...new Set([
        ...activeMembersBefore.map((m) => m.userId),
        targetUserId,
      ]),
    ];

    const targetUser = await User.findOne({
      where: { userId: targetUserId },
      attributes: SENDER_ATTRIBUTES,
    });
    const targetName =
      targetUser?.name ||
      targetUser?.displayName ||
      targetUser?.fullName ||
      targetUser?.email ||
      "Thành viên";

    const systemContent = isSelfLeave
      ? `${targetName} đã rời khỏi nhóm`
      : `Quản trị viên đã xoá thành viên ${targetName} ra khỏi nhóm`;

    const { createdAt: sysCreatedAt } = await this._createSystemMessage(
      conversation,
      requesterId,
      systemContent,
      {
        systemAction: isSelfLeave ? "member_left" : "member_kicked",
        actorId: requesterId,
        targetUserId,
        targetName,
      },
      notifyIdsBefore,
    );

    const leftAtTimestamp = new Date(sysCreatedAt.getTime() + 50);
    await ConversationMember.update(
      {
        leftAt: leftAtTimestamp,
        unreadCount: 0,
        mentionCount: 0,
        isPinned: false,
      },
      { where: { conversationId, userId: targetUserId } },
    );

    const remainingMembers = await ConversationMember.findAll({
      where: { conversationId, leftAt: null },
      attributes: ["userId", "role", "joinedAt"],
      order: [["joinedAt", "ASC"]],
    });
    const remainingIds = remainingMembers.map((m) => m.userId);

    // Nếu quản trị viên rời nhóm và vẫn còn thành viên active khác -> chuyển quyền Quản trị viên cho người vào sớm nhất
    if (
      isSelfLeave &&
      (targetMembership?.role === "owner" ||
        conversation.createdBy === targetUserId) &&
      remainingMembers.length > 0
    ) {
      const nextOwner = remainingMembers[0];
      await Promise.all([
        ConversationMember.update(
          { role: "owner" },
          { where: { conversationId, userId: nextOwner.userId } },
        ),
        conversation.update({ createdBy: nextOwner.userId }),
      ]);
      try {
        const { dek } = await this._getOrEnsureConversationDek(conversation);
        const updatedConv = await Conversation.findByPk(conversationId, {
          include: [
            {
              model: ConversationMember,
              as: "members",
              where: { leftAt: null },
              required: false,
              include: [
                { model: User, as: "user", attributes: SENDER_ATTRIBUTES },
              ],
            },
          ],
        });
        if (updatedConv) {
          const sanitized = this.sanitizeConversation(updatedConv, dek);
          socketService.emitToUsers(
            remainingIds,
            "conversation_updated",
            sanitized,
          );
          await ssePublisher.publishToUsers(
            remainingIds,
            "CONVERSATION_UPDATED",
            sanitized,
          );
        }
      } catch (_err) {
        // Bỏ qua lỗi phụ nếu emit update thất bại
      }
    }

    const notifyIds = [...new Set([...remainingIds, targetUserId])];
    const payload = {
      conversationId: this.toPublicConversationId(conversationId),
      removedUserId: targetUserId,
      leftAt: leftAtTimestamp.toISOString(),
      kicked: !isSelfLeave,
    };

    socketService.removeUsersFromConversationRoom(
      [targetUserId],
      conversationId,
    );
    socketService.emitToUsers(notifyIds, "member_removed", payload);
    await ssePublisher.publishToUsers(notifyIds, "MEMBER_REMOVED", payload);

    return payload;
  }

  // =====================================
  // MESSAGE APIs (C0, C1, C2, C3, C4)
  // =====================================

  /**
   * Lấy danh sách tin nhắn của một conversation (phân trang composite cursor + giải mã AES-256-GCM)
   * @param {string} conversationId
   * @param {string} userId
   * @param {Object} options - { before, beforeId, limit }
   */
  static async getMessages(conversationId, userId, options = {}) {
    const [membership, conversation] = await Promise.all([
      ConversationMember.findOne({
        where: { conversationId, userId },
      }),
      Conversation.findByPk(conversationId),
    ]);

    if (!conversation) {
      throw new NotFoundException(ErrorCodes.CHAT_CONVERSATION_NOT_FOUND);
    }
    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_CONVERSATION_MEMBER);
    }

    const { before, beforeId, limit = 30 } = options;
    const parsedLimit = Math.min(parseInt(limit, 10) || 30, 100);

    let cursorFilter = {};
    if (before) {
      const beforeDate = new Date(before);
      if (beforeId) {
        cursorFilter = {
          [Op.or]: [
            { createdAt: { [Op.lt]: beforeDate } },
            {
              createdAt: beforeDate,
              id: { [Op.lt]: beforeId },
            },
          ],
        };
      } else {
        cursorFilter = { createdAt: { [Op.lt]: beforeDate } };
      }
    }

    const where = {
      conversationId,
      deletedAt: null,
      ...cursorFilter,
    };
    where[Op.and] = where[Op.and] || [];
    if (membership?.clearedAt) {
      where[Op.and].push({
        createdAt: { [Op.gt]: new Date(membership.clearedAt) },
      });
    }
    if (membership?.leftAt) {
      where[Op.and].push({
        createdAt: { [Op.lte]: new Date(membership.leftAt) },
      });
    }
    if (userId) {
      where[Op.and].push(
        Sequelize.literal(`NOT ("Message"."deleted_for_user_ids" @> ARRAY['${String(userId).replace(/'/g, "")}']::uuid[])`)
      );
    }

    const messages = await Message.findAll({
      where,
      include: [
        { model: User, as: "sender", attributes: SENDER_ATTRIBUTES },
        { model: MessageAttachment, as: "attachments" },
        { model: MessageReaction, as: "reactions" },
        {
          model: Message,
          as: "replyTo",
          include: [
            { model: User, as: "sender", attributes: SENDER_ATTRIBUTES },
            { model: MessageAttachment, as: "attachments" },
          ],
        },
      ],
      order: [
        ["createdAt", "DESC"],
        ["id", "DESC"],
      ],
      limit: parsedLimit,
    });

    const { dek } = await this._getOrEnsureConversationDek(conversation);
    const clearedCutoff = membership?.clearedAt
      ? new Date(membership.clearedAt)
      : null;
    return messages.reverse().map((msg) => {
      const hydrated = this.hydrateMessage(msg, dek);
      if (
        clearedCutoff &&
        hydrated.replyTo?.createdAt &&
        new Date(hydrated.replyTo.createdAt) <= clearedCutoff
      ) {
        hydrated.replyTo = null;
      }
      return hydrated;
    });
  }

  /**
   * Tìm kiếm tin nhắn trong cuộc hội thoại trên dữ liệu đã mã hoá (Searchable Encryption qua Blind Index) (C1)
   * @param {string} conversationId
   * @param {string} userId
   * @param {string} queryText
   * @param {Object} [options] - { limit }
   */
  static async searchMessages(conversationId, userId, queryText, options = {}) {
    const [membership, conversation] = await Promise.all([
      ConversationMember.findOne({
        where: { conversationId, userId },
      }),
      Conversation.findByPk(conversationId),
    ]);

    if (!conversation) {
      throw new NotFoundException(ErrorCodes.CHAT_CONVERSATION_NOT_FOUND);
    }
    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_CONVERSATION_MEMBER);
    }

    const cleanQuery = String(queryText || "").trim();
    if (!cleanQuery) return [];

    const { dek } = await this._getOrEnsureConversationDek(conversation);
    const queryTokens = chatCryptoService.buildQuerySearchTokens(
      dek,
      cleanQuery,
    );
    const parsedLimit = Math.min(parseInt(options.limit, 10) || 20, 50);

    const where = {
      conversationId,
      deletedAt: null,
      ...(queryTokens.length > 0
        ? {
            [Op.or]: [
              { searchTokens: { [Op.contains]: queryTokens } },
              { content: { [Op.iLike]: `%${cleanQuery}%` } },
            ],
          }
        : {
            content: { [Op.iLike]: `%${cleanQuery}%` },
          }),
    };
    where[Op.and] = where[Op.and] || [];
    if (membership?.clearedAt) {
      where[Op.and].push({
        createdAt: { [Op.gt]: new Date(membership.clearedAt) },
      });
    }
    if (membership?.leftAt) {
      where[Op.and].push({
        createdAt: { [Op.lte]: new Date(membership.leftAt) },
      });
    }
    if (userId) {
      where[Op.and].push(
        Sequelize.literal(`NOT ("Message"."deleted_for_user_ids" @> ARRAY['${String(userId).replace(/'/g, "")}']::uuid[])`)
      );
    }

    const messages = await Message.findAll({
      where,
      include: [
        { model: User, as: "sender", attributes: SENDER_ATTRIBUTES },
        { model: MessageAttachment, as: "attachments" },
        {
          model: Message,
          as: "replyTo",
          include: [
            { model: User, as: "sender", attributes: SENDER_ATTRIBUTES },
            { model: MessageAttachment, as: "attachments" },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: parsedLimit,
    });

    const clearedCutoff = membership.clearedAt
      ? new Date(membership.clearedAt)
      : null;
    return messages.map((m) => {
      const hydrated = this.hydrateMessage(m, dek);
      if (
        clearedCutoff &&
        hydrated.replyTo?.createdAt &&
        new Date(hydrated.replyTo.createdAt) <= clearedCutoff
      ) {
        hydrated.replyTo = null;
      }
      return hydrated;
    });
  }

  /**
   * Gửi tin nhắn mới vào một conversation (Mã hoá AES-256-GCM + Entity Card + Unread Counter + Redis Pipeline)
   * @param {string} conversationId
   * @param {string} senderId
   * @param {Object} dto
   */
  static async sendMessage(conversationId, senderId, dto = {}) {
    this.checkSendRateLimit(senderId);

    const [membership, conversation] = await Promise.all([
      ConversationMember.findOne({
        where: { conversationId, userId: senderId, leftAt: null },
      }),
      Conversation.findByPk(conversationId),
    ]);

    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_CONVERSATION_MEMBER);
    }
    if (!conversation) {
      throw new NotFoundException(ErrorCodes.CHAT_CONVERSATION_NOT_FOUND);
    }

    const {
      content,
      type: rawType = "text",
      replyToId,
      replyToMessageId,
      attachments,
      metadata,
      clientMessageId,
    } = dto;
    const effectiveReplyToId = replyToId || replyToMessageId || null;

    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    let type = rawType;
    if (hasAttachments && rawType === "text") {
      if (content && String(content).trim()) {
        type = "mixed";
      } else {
        const allImages = attachments.every(
          (att) =>
            this.resolveAttachmentFileType(att?.mimeType, att?.fileType) ===
            "image",
        );
        type = allImages ? "image" : "file";
      }
    }

    if (
      type === "text" &&
      !hasAttachments &&
      (!content || !String(content).trim())
    ) {
      throw new BadRequestException(ErrorCodes.CHAT_MESSAGE_EMPTY);
    }

    // Kiểm tra chống gửi trùng (Idempotency) theo clientMessageId
    if (clientMessageId) {
      const existingMsg = await Message.findOne({
        where: {
          conversationId,
          senderId,
          clientMessageId: String(clientMessageId),
        },
        include: [
          { model: User, as: "sender", attributes: SENDER_ATTRIBUTES },
          { model: MessageAttachment, as: "attachments" },
          {
            model: Message,
            as: "replyTo",
            include: [
              { model: User, as: "sender", attributes: SENDER_ATTRIBUTES },
              { model: MessageAttachment, as: "attachments" },
            ],
          },
        ],
      });
      if (existingMsg) {
        const { dek } = await this._getOrEnsureConversationDek(conversation);
        return this.hydrateMessage(existingMsg, dek);
      }
    }

    let normalizedMetadata = metadata || null;
    if (type === "sticker") {
      normalizedMetadata = this.normalizeStickerMetadata(metadata);
    } else if (type === "entity_card" || metadata?.entityType) {
      normalizedMetadata = this.normalizeEntityCardMetadata(metadata, {
        defaultSystem: conversation.scopeSystem,
      });
    } else if (
      (!attachments || attachments.length === 0) &&
      !normalizedMetadata?.linkPreview
    ) {
      const pureUrl = linkPreviewService.extractPureUrl(content);
      if (pureUrl) {
        const fetchedPreview = await linkPreviewService
          .fetchMetadata(pureUrl, { timeoutMs: 2800 })
          .catch(() => null);
        if (fetchedPreview) {
          normalizedMetadata = {
            ...(normalizedMetadata || {}),
            linkPreview: fetchedPreview,
          };
        }
      }
    }

    const { dek, dekVersion } =
      await this._getOrEnsureConversationDek(conversation);
    const messageId = randomUUID();

    const encryptedMetaResult = normalizedMetadata
      ? chatCryptoService.encryptMetadata({
          dek,
          conversationId,
          senderId,
          messageId,
          metadata: normalizedMetadata,
        })
      : {
          publicMetadata: null,
          encryptedMetadata: null,
          metadataIv: null,
          metadataAuthTag: null,
          extraSearchTerms: [],
        };

    const attachmentFileNames = Array.isArray(attachments)
      ? attachments.map((a) => a?.fileName).filter(Boolean)
      : [];

    const effectivePlaintext =
      content ||
      (type === "entity_card" && normalizedMetadata?.snapshot?.title
        ? `[${normalizedMetadata.sourceSystem}] ${normalizedMetadata.snapshot.title}`
        : null);

    const encryptedContentResult = chatCryptoService.encryptMessageContent({
      dek,
      conversationId,
      senderId,
      messageId,
      plaintext: effectivePlaintext,
      extraSearchTerms: [
        ...encryptedMetaResult.extraSearchTerms,
        ...attachmentFileNames,
      ],
      keyVersion: dekVersion,
    });

    const message = await Message.create({
      id: messageId,
      conversationId,
      senderId,
      type,
      content: encryptedContentResult.content,
      ciphertext: encryptedContentResult.ciphertext,
      iv: encryptedContentResult.iv,
      authTag: encryptedContentResult.authTag,
      keyVersion: encryptedContentResult.keyVersion,
      searchTokens: encryptedContentResult.searchTokens,
      metadata: encryptedMetaResult.publicMetadata,
      encryptedMetadata: encryptedMetaResult.encryptedMetadata,
      metadataIv: encryptedMetaResult.metadataIv,
      metadataAuthTag: encryptedMetaResult.metadataAuthTag,
      clientMessageId: clientMessageId ? String(clientMessageId) : null,
      replyToId: effectiveReplyToId,
    });

    if (Array.isArray(attachments) && attachments.length > 0) {
      const attachmentRecords = attachments.map((att) => ({
        messageId: message.id,
        fileName: att.fileName,
        fileUrl: att.fileUrl || att.url || "",
        s3AssetId: att.s3AssetId || null,
        s3Key: att.s3Key || att.key || null,
        fileType: this.resolveAttachmentFileType(att.mimeType, att.fileType),
        mimeType: att.mimeType || null,
        fileSize: att.fileSize || null,
        thumbnailUrl: att.thumbnailUrl || null,
        width: att.width || null,
        height: att.height || null,
        blurhash: att.blurhash || null,
        durationMs: att.durationMs || null,
        isEncrypted: Boolean(att.isEncrypted),
      }));
      await MessageAttachment.bulkCreate(attachmentRecords);
    }

    const now = new Date();
    const mentionedUserIds = Array.isArray(normalizedMetadata?.mentions)
      ? normalizedMetadata.mentions.filter((uid) => uid && uid !== senderId)
      : [];

    // Cập nhật song song: Conversation.lastMessage, bỏ ẩn (nếu thành viên từng xoá hội thoại ở phía họ), tăng unread_count của các thành viên khác, và reset unread của sender
    await Promise.all([
      Conversation.update(
        { lastMessageId: message.id, lastMessageAt: now },
        { where: { id: conversationId } },
      ),
      ConversationMember.update(
        { hiddenAt: null },
        {
          where: {
            conversationId,
            leftAt: null,
            hiddenAt: { [Op.ne]: null },
          },
        },
      ),
      ConversationMember.increment("unreadCount", {
        by: 1,
        where: {
          conversationId,
          userId: { [Op.ne]: senderId },
          leftAt: null,
        },
      }),
      ConversationMember.update(
        {
          lastReadAt: now,
          lastReadMessageId: message.id,
          unreadCount: 0,
          mentionCount: 0,
        },
        {
          where: { conversationId, userId: senderId, leftAt: null },
        },
      ),
      ...(mentionedUserIds.length > 0
        ? [
            ConversationMember.increment("mentionCount", {
              by: 1,
              where: {
                conversationId,
                userId: { [Op.in]: mentionedUserIds },
                leftAt: null,
              },
            }),
          ]
        : []),
    ]);

    const [fullMessage, members] = await Promise.all([
      Message.findByPk(message.id, {
        include: [
          { model: User, as: "sender", attributes: SENDER_ATTRIBUTES },
          { model: MessageAttachment, as: "attachments" },
          {
            model: Message,
            as: "replyTo",
            include: [
              { model: User, as: "sender", attributes: SENDER_ATTRIBUTES },
              { model: MessageAttachment, as: "attachments" },
            ],
          },
        ],
      }),
      ConversationMember.findAll({
        where: { conversationId, leftAt: null },
        attributes: ["userId"],
      }),
    ]);

    const hydrated = this.hydrateMessage(fullMessage || message, dek);
    const memberIds = members.map((m) => m.userId);

    socketService.emitToConversationAndUsers(
      conversationId,
      memberIds,
      "new_message",
      hydrated,
    );
    await ssePublisher.publishToUsers(memberIds, "NEW_MESSAGE", hydrated);

    return hydrated;
  }

  /**
   * Cập nhật trạng thái của Entity Card trên khung chat khi đơn hàng / đơn duyệt chi thay đổi trạng thái (C3)
   * @param {Object} params
   */
  static async updateEntityCardSnapshot({
    conversationId = null,
    messageId = null,
    entityType = null,
    entityId = null,
    sourceSystem = null,
    snapshotPatch = {},
    navigationPatch = null,
  }) {
    if (!snapshotPatch || typeof snapshotPatch !== "object") {
      throw new BadRequestException(ErrorCodes.CHAT_ENTITY_CARD_INVALID);
    }

    const where = {
      deletedAt: null,
      ...(conversationId ? { conversationId } : {}),
      ...(messageId ? { id: messageId } : {}),
    };

    if (!messageId) {
      if (!entityId) {
        throw new BadRequestException(ErrorCodes.CHAT_ENTITY_CARD_INVALID);
      }
      where.metadata = {
        [Op.contains]: {
          entityId: String(entityId),
          ...(entityType ? { entityType: String(entityType).toUpperCase() } : {}),
          ...(sourceSystem
            ? { sourceSystem: String(sourceSystem).toUpperCase() }
            : {}),
        },
      };
    }

    const messages = await Message.findAll({ where });
    if (messages.length === 0) {
      return { updatedCount: 0, updatedMessageIds: [] };
    }

    const updatedMessageIds = [];

    for (const msg of messages) {
      const conversation = await Conversation.findByPk(msg.conversationId);
      if (!conversation || conversation.isSecure) continue;

      const { dek } = await this._getOrEnsureConversationDek(conversation);
      const currentMeta =
        chatCryptoService.decryptMetadata({
          dek,
          conversationId: msg.conversationId,
          senderId: msg.senderId,
          messageId: msg.id,
          encryptedMetadata: msg.encryptedMetadata,
          metadataIv: msg.metadataIv,
          metadataAuthTag: msg.metadataAuthTag,
          fallbackMetadata: msg.metadata,
        }) || {};

      const mergedMeta = {
        ...currentMeta,
        snapshot: {
          ...(currentMeta.snapshot || {}),
          ...snapshotPatch,
        },
        ...(navigationPatch
          ? {
              navigation: {
                ...(currentMeta.navigation || {}),
                ...navigationPatch,
              },
            }
          : {}),
        updatedAt: new Date().toISOString(),
      };

      const reEncryptedMeta = chatCryptoService.encryptMetadata({
        dek,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        messageId: msg.id,
        metadata: mergedMeta,
      });

      await msg.update({
        metadata: reEncryptedMeta.publicMetadata,
        encryptedMetadata: reEncryptedMeta.encryptedMetadata,
        metadataIv: reEncryptedMeta.metadataIv,
        metadataAuthTag: reEncryptedMeta.metadataAuthTag,
      });

      const resolvedMetadata = this.resolveEntityNavigation(
        mergedMeta,
        msg.conversationId,
        msg.id,
      );

      const eventPayload = {
        conversationId: msg.conversationId,
        messageId: msg.id,
        entityType: mergedMeta.entityType,
        entityId: mergedMeta.entityId,
        metadata: resolvedMetadata,
      };

      const members = await ConversationMember.findAll({
        where: { conversationId: msg.conversationId, leftAt: null },
        attributes: ["userId"],
      });
      const memberIds = members.map((m) => m.userId);
      socketService.emitToConversationAndUsers(
        msg.conversationId,
        memberIds,
        "entity_card_updated",
        eventPayload,
      );
      await ssePublisher.publishToUsers(
        memberIds,
        "ENTITY_CARD_UPDATED",
        eventPayload,
      );

      updatedMessageIds.push(msg.id);
    }

    return {
      updatedCount: updatedMessageIds.length,
      updatedMessageIds,
    };
  }

  /**
   * Chỉnh sửa nội dung tin nhắn (chỉ người gửi mới được sửa, tự động mã hoá lại với IV mới)
   * @param {string} messageId
   * @param {string} userId
   * @param {string} newContent
   */
  static async editMessage(messageId, userId, newContent) {
    const message = await Message.findByPk(messageId);
    if (!message || message.deletedAt) {
      throw new NotFoundException(ErrorCodes.CHAT_MESSAGE_NOT_FOUND);
    }
    if (message.senderId !== userId) {
      throw new ForbiddenException(ErrorCodes.CHAT_EDIT_OWN_MESSAGE_ONLY);
    }
    if (!["text", "mixed"].includes(message.type)) {
      throw new BadRequestException(ErrorCodes.CHAT_TEXT_MESSAGE_EDIT_ONLY);
    }

    const conversation = await Conversation.findByPk(message.conversationId);
    const { dek, dekVersion } =
      await this._getOrEnsureConversationDek(conversation);

    const encrypted = chatCryptoService.encryptMessageContent({
      dek,
      conversationId: message.conversationId,
      senderId: message.senderId,
      messageId: message.id,
      plaintext: newContent,
      keyVersion: dekVersion,
    });

    await message.update({
      content: encrypted.content,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
      searchTokens: encrypted.searchTokens,
      isEdited: true,
    });

    const hydrated = this.hydrateMessage(message, dek);

    const eventPayload = {
      conversationId: this.toPublicConversationId(message.conversationId),
      messageId,
      content: newContent,
      isEdited: true,
    };
    const members = await ConversationMember.findAll({
      where: { conversationId: message.conversationId, leftAt: null },
      attributes: ["userId"],
    });
    const memberIds = members.map((m) => m.userId);
    socketService.emitToConversationAndUsers(
      message.conversationId,
      memberIds,
      "message_edited",
      eventPayload,
    );
    await ssePublisher.publishToUsers(
      memberIds,
      "MESSAGE_EDITED",
      eventPayload,
    );

    return hydrated;
  }

  /**
   * Xóa tin nhắn (soft-delete, chỉ người gửi, đồng thời xoá bản mã nhạy cảm)
   * @param {string} messageId
   * @param {string} userId
   */
  static async deleteMessage(messageId, userId) {
    const message = await Message.findByPk(messageId);
    if (!message || message.deletedAt) {
      throw new NotFoundException(ErrorCodes.CHAT_MESSAGE_NOT_FOUND);
    }
    if (message.senderId !== userId) {
      throw new ForbiddenException(ErrorCodes.CHAT_DELETE_OWN_MESSAGE_ONLY);
    }

    await message.update({
      deletedAt: new Date(),
      content: null,
      ciphertext: null,
      iv: null,
      authTag: null,
      searchTokens: [],
      encryptedMetadata: null,
      metadataIv: null,
      metadataAuthTag: null,
    });

    if (message.isPinned) {
      await PinnedMessage.destroy({
        where: { conversationId: message.conversationId, messageId },
      });
    }

    const eventPayload = {
      conversationId: this.toPublicConversationId(message.conversationId),
      messageId,
    };
    const members = await ConversationMember.findAll({
      where: { conversationId: message.conversationId, leftAt: null },
      attributes: ["userId"],
    });
    const memberIds = members.map((m) => m.userId);
    socketService.emitToConversationAndUsers(
      message.conversationId,
      memberIds,
      "message_deleted",
      eventPayload,
    );
    await ssePublisher.publishToUsers(
      memberIds,
      "MESSAGE_DELETED",
      eventPayload,
    );

    return { messageId };
  }

  /**
   * Thu hồi tin nhắn cho tất cả thành viên trong hội thoại
   * @param {string} messageId
   * @param {string} userId
   */
  static async recallMessage(messageId, userId) {
    const message = await Message.findByPk(messageId);
    if (!message || message.deletedAt) {
      throw new NotFoundException(ErrorCodes.CHAT_MESSAGE_NOT_FOUND);
    }
    if (message.senderId !== userId) {
      throw new ForbiddenException(ErrorCodes.CHAT_RECALL_OWN_MESSAGE_ONLY);
    }
    if (message.isRecalled) {
      return { messageId, isRecalled: true };
    }

    const recalledAt = new Date();
    await message.update({
      isRecalled: true,
      recalledAt,
      recalledBy: userId,
      content: null,
      ciphertext: null,
      iv: null,
      authTag: null,
      searchTokens: [],
      encryptedMetadata: null,
      metadataIv: null,
      metadataAuthTag: null,
    });

    if (message.isPinned) {
      await PinnedMessage.destroy({
        where: { conversationId: message.conversationId, messageId },
      });
    }

    const eventPayload = {
      conversationId: this.toPublicConversationId(message.conversationId),
      messageId,
      senderId: message.senderId,
      isRecalled: true,
      recalledAt,
      recalledBy: userId,
    };

    const members = await ConversationMember.findAll({
      where: { conversationId: message.conversationId, leftAt: null },
      attributes: ["userId"],
    });
    const memberIds = members.map((m) => m.userId);
    socketService.emitToConversationAndUsers(
      message.conversationId,
      memberIds,
      "message_recalled",
      eventPayload,
    );
    await ssePublisher.publishToUsers(
      memberIds,
      "MESSAGE_RECALLED",
      eventPayload,
    );

    return {
      messageId,
      conversationId: this.toPublicConversationId(message.conversationId),
      isRecalled: true,
      recalledAt,
      recalledBy: userId,
    };
  }

  /**
   * Xoá tin nhắn ở phía tôi (ẩn tin nhắn chỉ đối với người dùng hiện tại)
   * @param {string} messageId
   * @param {string} userId
   */
  static async deleteForMe(messageId, userId) {
    const message = await Message.findByPk(messageId);
    if (!message || message.deletedAt) {
      throw new NotFoundException(ErrorCodes.CHAT_MESSAGE_NOT_FOUND);
    }

    const membership = await ConversationMember.findOne({
      where: { conversationId: message.conversationId, userId, leftAt: null },
    });
    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_CONVERSATION_MEMBER);
    }

    const currentDeleted = Array.isArray(message.deletedForUserIds)
      ? [...message.deletedForUserIds]
      : [];
    if (!currentDeleted.includes(userId)) {
      currentDeleted.push(userId);
      await message.update({
        deletedForUserIds: currentDeleted,
      });
    }

    const eventPayload = {
      conversationId: this.toPublicConversationId(message.conversationId),
      messageId,
    };

    socketService.emitToUser(
      userId,
      "message_deleted_for_me",
      eventPayload,
    );

    await ssePublisher.publishToUsers(
      [userId],
      "MESSAGE_DELETED_FOR_ME",
      eventPayload,
    );

    return {
      success: true,
      conversationId: this.toPublicConversationId(message.conversationId),
      messageId,
    };
  }

  /**
   * Đánh dấu đã đọc - cập nhật lastReadAt và reset unreadCount = 0, mentionCount = 0
   * @param {string} conversationId
   * @param {string} userId
   * @param {string} [lastReadMessageId]
   */
  static async markAsRead(
    conversationId,
    userId,
    lastReadMessageId = null,
  ) {
    const membership = await ConversationMember.findOne({
      where: { conversationId, userId },
    });
    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_MEMBER);
    }

    if (membership.leftAt) {
      if (membership.unreadCount || membership.mentionCount) {
        await membership.update({ unreadCount: 0, mentionCount: 0 });
      }
      return {
        conversationId,
        userId,
        readAt: membership.lastReadAt,
        lastReadMessageId: membership.lastReadMessageId || null,
        unreadCount: 0,
      };
    }

    const readAt = new Date();
    await membership.update({
      lastReadAt: readAt,
      ...(lastReadMessageId ? { lastReadMessageId } : {}),
      unreadCount: 0,
      mentionCount: 0,
    });

    const payload = {
      conversationId: this.toPublicConversationId(conversationId),
      userId,
      readAt,
      lastReadMessageId: membership.lastReadMessageId || null,
      unreadCount: 0,
    };

    const members = await ConversationMember.findAll({
      where: { conversationId, leftAt: null },
      attributes: ["userId"],
    });
    socketService.emitToConversationAndUsers(
      conversationId,
      members.map((m) => m.userId),
      "message_read",
      payload,
    );

    return payload;
  }

  /**
   * Ghim / bỏ ghim conversation cho user
   */
  static async togglePin(conversationId, userId) {
    const membership = await ConversationMember.findOne({
      where: { conversationId, userId, leftAt: null },
    });
    if (!membership) throw new ForbiddenException(ErrorCodes.CHAT_NOT_MEMBER);

    await membership.update({ isPinned: !membership.isPinned });
    return {
      conversationId: this.toPublicConversationId(conversationId),
      isPinned: membership.isPinned,
    };
  }

  /**
   * Bật / tắt thông báo (mute) cho conversation
   */
  static async toggleMute(conversationId, userId) {
    const membership = await ConversationMember.findOne({
      where: { conversationId, userId, leftAt: null },
    });
    if (!membership) throw new ForbiddenException(ErrorCodes.CHAT_NOT_MEMBER);

    await membership.update({ isMuted: !membership.isMuted });
    return {
      conversationId: this.toPublicConversationId(conversationId),
      isMuted: membership.isMuted,
    };
  }

  /**
   * Xoá cuộc hội thoại ở phía người dùng hiện tại:
   * - Đặt clearedAt & hiddenAt = now chỉ trên bản ghi ConversationMember của userId
   * - Reset unreadCount / mentionCount / isPinned của userId
   * - Không ảnh hưởng tới cuộc hội thoại hoặc lịch sử tin nhắn của thành viên khác
   * - Nếu có tin nhắn mới gửi vào sau mốc clearedAt, hội thoại tự hiện lại (hiddenAt = null) nhưng chỉ xem được tin mới
   */
  static async deleteConversationForMe(conversationId, userId) {
    if (conversationId === PICARE_GROUP_DB_ID) {
      throw new ForbiddenException(
        "Không thể xoá cuộc trò chuyện chính thức Đại gia đình - Picare Group",
      );
    }
    const membership = await ConversationMember.findOne({
      where: { conversationId, userId },
    });
    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_CONVERSATION_MEMBER);
    }

    const now = new Date();
    await membership.update({
      clearedAt: now,
      hiddenAt: now,
      unreadCount: 0,
      mentionCount: 0,
      lastReadAt: now,
      isPinned: false,
    });

    const eventPayload = {
      conversationId: this.toPublicConversationId(conversationId),
      clearedAt: now.toISOString(),
    };

    socketService.emitToUser(
      userId,
      "conversation_deleted_for_me",
      eventPayload,
    );

    await ssePublisher.publishToUsers(
      [userId],
      "CONVERSATION_DELETED_FOR_ME",
      eventPayload,
    );

    return {
      success: true,
      conversationId: this.toPublicConversationId(conversationId),
      clearedAt: eventPayload.clearedAt,
    };
  }

  // =====================================
  // PINNED MESSAGES IN CONVERSATION (C2)
  // =====================================

  /**
   * Ghim một tin nhắn quan trọng lên đầu cuộc hội thoại
   * @param {string} conversationId
   * @param {string} messageId
   * @param {string} userId
   * @param {Object} [options] - { note }
   */
  static async pinMessage(conversationId, messageId, userId, options = {}) {
    const [membership, conversation, message] = await Promise.all([
      ConversationMember.findOne({
        where: { conversationId, userId, leftAt: null },
      }),
      Conversation.findByPk(conversationId),
      Message.findOne({
        where: { id: messageId, conversationId, deletedAt: null },
        include: [
          { model: User, as: "sender", attributes: SENDER_ATTRIBUTES },
          { model: MessageAttachment, as: "attachments" },
        ],
      }),
    ]);

    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_CONVERSATION_MEMBER);
    }
    if (!conversation) {
      throw new NotFoundException(ErrorCodes.CHAT_CONVERSATION_NOT_FOUND);
    }
    if (!message) {
      throw new NotFoundException(ErrorCodes.CHAT_MESSAGE_NOT_FOUND);
    }

    const existingPin = await PinnedMessage.findOne({
      where: { conversationId, messageId },
    });
    if (existingPin) {
      throw new ConflictException(ErrorCodes.CHAT_MESSAGE_ALREADY_PINNED);
    }

    const maxPins = appConfig.chat?.maxPinsPerConversation || 20;
    const currentPinsCount = await PinnedMessage.count({
      where: { conversationId },
    });
    if (currentPinsCount >= maxPins) {
      throw new BadRequestException(
        ErrorCodes.CHAT_PIN_LIMIT_REACHED(maxPins),
      );
    }

    const pinRecord = await PinnedMessage.create({
      conversationId,
      messageId,
      pinnedBy: userId,
      note: options.note ? String(options.note).slice(0, 255) : null,
      pinOrder: currentPinsCount + 1,
    });

    await Promise.all([
      message.update({ isPinned: true }),
      conversation.update({ pinnedCount: currentPinsCount + 1 }),
    ]);

    const { dek } = await this._getOrEnsureConversationDek(conversation);
    const hydratedMessage = this.hydrateMessage(message, dek);

    const payload = {
      id: pinRecord.id,
      conversationId: this.toPublicConversationId(conversationId),
      messageId,
      pinnedBy: userId,
      note: pinRecord.note,
      pinOrder: pinRecord.pinOrder,
      createdAt: pinRecord.createdAt,
      message: hydratedMessage,
    };

    const members = await ConversationMember.findAll({
      where: { conversationId, leftAt: null },
      attributes: ["userId"],
    });
    const memberIds = members.map((m) => m.userId);
    socketService.emitToConversationAndUsers(
      conversationId,
      memberIds,
      "message_pinned",
      payload,
    );
    await ssePublisher.publishToUsers(
      memberIds,
      "MESSAGE_PINNED",
      payload,
    );

    return payload;
  }

  /**
   * Bỏ ghim một tin nhắn trong cuộc hội thoại
   * @param {string} conversationId
   * @param {string} messageId
   * @param {string} userId
   */
  static async unpinMessage(conversationId, messageId, userId) {
    const [membership, conversation, existingPin] = await Promise.all([
      ConversationMember.findOne({
        where: { conversationId, userId, leftAt: null },
      }),
      Conversation.findByPk(conversationId),
      PinnedMessage.findOne({
        where: { conversationId, messageId },
      }),
    ]);

    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_CONVERSATION_MEMBER);
    }
    if (!conversation) {
      throw new NotFoundException(ErrorCodes.CHAT_CONVERSATION_NOT_FOUND);
    }
    if (!existingPin) {
      throw new NotFoundException(ErrorCodes.CHAT_MESSAGE_NOT_PINNED);
    }

    await existingPin.destroy();
    const remainingCount = await PinnedMessage.count({
      where: { conversationId },
    });

    await Promise.all([
      Message.update(
        { isPinned: false },
        { where: { id: messageId, conversationId } },
      ),
      conversation.update({ pinnedCount: Math.max(remainingCount, 0) }),
    ]);

    const payload = {
      conversationId: this.toPublicConversationId(conversationId),
      messageId,
      unpinnedBy: userId,
      pinnedCount: remainingCount,
    };

    const members = await ConversationMember.findAll({
      where: { conversationId, leftAt: null },
      attributes: ["userId"],
    });
    const memberIds = members.map((m) => m.userId);
    socketService.emitToConversationAndUsers(
      conversationId,
      memberIds,
      "message_unpinned",
      payload,
    );
    await ssePublisher.publishToUsers(
      memberIds,
      "MESSAGE_UNPINNED",
      payload,
    );

    return payload;
  }

  /**
   * Lấy danh sách tất cả tin nhắn đang được ghim trong cuộc hội thoại
   * @param {string} conversationId
   * @param {string} userId
   */
  static async getPinnedMessages(conversationId, userId) {
    const [membership, conversation] = await Promise.all([
      ConversationMember.findOne({
        where: { conversationId, userId },
      }),
      Conversation.findByPk(conversationId),
    ]);

    if (!conversation) {
      throw new NotFoundException(ErrorCodes.CHAT_CONVERSATION_NOT_FOUND);
    }
    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_CONVERSATION_MEMBER);
    }

    const messageFilter = {
      deletedAt: null,
      [Op.and]: [
        ...(membership?.clearedAt
          ? [{ createdAt: { [Op.gt]: new Date(membership.clearedAt) } }]
          : []),
        ...(membership?.leftAt
          ? [{ createdAt: { [Op.lte]: new Date(membership.leftAt) } }]
          : []),
      ],
    };

    const pins = await PinnedMessage.findAll({
      where: { conversationId },
      include: [
        {
          model: Message,
          as: "message",
          where: messageFilter,
          required: true,
          include: [
            { model: User, as: "sender", attributes: SENDER_ATTRIBUTES },
            { model: MessageAttachment, as: "attachments" },
          ],
        },
        {
          model: User,
          as: "pinner",
          attributes: SENDER_ATTRIBUTES,
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const { dek } = await this._getOrEnsureConversationDek(conversation);
    return pins.map((pin) => {
      const rawPin = typeof pin.toJSON === "function" ? pin.toJSON() : pin;
      return {
        id: rawPin.id,
        conversationId: this.toPublicConversationId(rawPin.conversationId),
        messageId: rawPin.messageId,
        pinnedBy: rawPin.pinnedBy,
        pinner: rawPin.pinner || null,
        note: rawPin.note,
        pinOrder: rawPin.pinOrder,
        createdAt: rawPin.createdAt,
        message: this.hydrateMessage(rawPin.message, dek),
      };
    });
  }

  // =====================================
  // REACTIONS (C2)
  // =====================================

  /**
   * Thả hoặc gỡ biểu cảm (Emoji Reaction) trên một tin nhắn
   * @param {string} messageId
   * @param {string} userId
   * @param {string} emoji
   */
  static async toggleReaction(messageId, userId, emoji) {
    const message = await Message.findByPk(messageId);
    if (!message || message.deletedAt) {
      throw new NotFoundException(ErrorCodes.CHAT_MESSAGE_NOT_FOUND);
    }

    const membership = await ConversationMember.findOne({
      where: {
        conversationId: message.conversationId,
        userId,
        leftAt: null,
      },
    });
    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_CONVERSATION_MEMBER);
    }

    const cleanEmoji = String(emoji || "").trim().slice(0, 32);
    if (!cleanEmoji) {
      throw new BadRequestException(ErrorCodes.BAD_REQUEST);
    }

    const existing = await MessageReaction.findOne({
      where: { messageId, userId, emoji: cleanEmoji },
    });

    let action = "added";
    if (existing) {
      await existing.destroy();
      action = "removed";
    } else {
      await MessageReaction.create({
        messageId,
        conversationId: message.conversationId,
        userId,
        emoji: cleanEmoji,
      });
    }

    const allReactions = await MessageReaction.findAll({
      where: { messageId },
      attributes: ["id", "userId", "emoji", "createdAt"],
    });

    const payload = {
      conversationId: this.toPublicConversationId(message.conversationId),
      messageId,
      userId,
      emoji: cleanEmoji,
      action,
      reactions: allReactions.map((r) =>
        typeof r.toJSON === "function" ? r.toJSON() : r,
      ),
    };

    const members = await ConversationMember.findAll({
      where: { conversationId: message.conversationId, leftAt: null },
      attributes: ["userId"],
    });
    socketService.emitToConversationAndUsers(
      message.conversationId,
      members.map((m) => m.userId),
      "message_reaction_updated",
      payload,
    );

    return payload;
  }

  // =====================================
  // S3 ATTACHMENTS (IMAGES & FILES) (C2)
  // =====================================

  /**
   * Cấp Presigned PUT URL để client upload trực tiếp file/ảnh lên S3 trong thư mục private của hội thoại
   * @param {string} conversationId
   * @param {string} userId
   * @param {Object} dto - { fileName, mimeType, fileSize }
   */
  static async createAttachmentUploadTicket(conversationId, userId, dto = {}) {
    const membership = await ConversationMember.findOne({
      where: { conversationId, userId, leftAt: null },
    });
    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_CONVERSATION_MEMBER);
    }

    const fileName = String(dto.fileName || "attachment.bin").trim();
    const mimeType = String(
      dto.mimeType || "application/octet-stream",
    ).trim();
    const basePrefix =
      appConfig.chat?.attachmentFolderPrefix || "chat-attachments";
    const folder = `${basePrefix}/${conversationId}`;
    const s3Key = s3Service.buildKey(folder, fileName);
    const expiresIn = 300;
    const uploadUrl = await s3Service.getPresignedUploadUrl(
      s3Key,
      mimeType,
      expiresIn,
    );

    return {
      conversationId,
      s3Key,
      uploadUrl,
      expiresIn,
      fileName,
      mimeType,
      fileSize: Number(dto.fileSize) || null,
      fileType: this.resolveAttachmentFileType(mimeType, dto.fileType),
    };
  }

  /**
   * Upload trực tiếp file/ảnh đính kèm từ Buffer lên S3 (chế độ PRIVATE) và tự động trích xuất kích thước ảnh
   * @param {string} conversationId
   * @param {string} userId
   * @param {Object} fileData - { buffer, originalName, mimeType, fileSize, blurhash, durationMs }
   */
  static async uploadChatAttachment(conversationId, userId, fileData = {}) {
    const [membership, conversation] = await Promise.all([
      ConversationMember.findOne({
        where: { conversationId, userId, leftAt: null },
      }),
      Conversation.findByPk(conversationId),
    ]);
    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_CONVERSATION_MEMBER);
    }

    const { buffer, originalName, mimeType, fileSize, blurhash, durationMs } =
      fileData;
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new BadRequestException("Không tìm thấy dữ liệu tệp đính kèm");
    }

    const fileType = this.resolveAttachmentFileType(mimeType);
    let width = fileData.width ? Number(fileData.width) : null;
    let height = fileData.height ? Number(fileData.height) : null;

    if (fileType === "image" && (!width || !height)) {
      try {
        const meta = await sharp(buffer).metadata();
        width = meta.width || null;
        height = meta.height || null;
      } catch (_err) {
        // Bỏ qua nếu định dạng ảnh không hỗ trợ đọc metadata bằng sharp
      }
    }

    const isSecure = Boolean(conversation?.isSecure);
    const basePrefix =
      appConfig.chat?.attachmentFolderPrefix || "chat-attachments";
    const folder = isSecure
      ? `${basePrefix}/secure/${conversationId}`
      : `${basePrefix}/${conversationId}`;
    const s3Key = s3Service.buildKey(
      folder,
      isSecure ? `${randomUUID()}.enc` : originalName || "attachment.bin",
    );

    let uploadBody = buffer;
    if (isSecure) {
      const { dek } = await this._getOrEnsureConversationDek(conversation);
      if (!dek) {
        chatSecurity.deny();
      }
      uploadBody = chatCryptoService.encryptAttachmentBuffer({
        dek,
        conversationId,
        s3Key,
        buffer,
      });
    }

    const uploadResult = await s3Service.upload({
      key: s3Key,
      body: uploadBody,
      mimeType: isSecure
        ? "application/octet-stream"
        : mimeType || "application/octet-stream",
      originalName: isSecure
        ? `encrypted_${randomUUID()}.bin`
        : originalName || "attachment.bin",
      fileSize: uploadBody.length,
      folder,
      userId,
      uploadedBy: userId,
      description: isSecure
        ? `Encrypted chat attachment in conversation ${conversationId}`
        : `Chat attachment in conversation ${conversationId}`,
      visibility: AssetVisibility.PRIVATE,
    });

    const expiresIn = appConfig.chat?.presignedUrlExpiresIn || 3600;
    const fileUrl = isSecure
      ? `s3://${s3Key}`
      : await s3Service.getPresignedUrl(s3Key, expiresIn);

    return {
      fileName: originalName || "attachment.bin",
      fileUrl,
      s3AssetId: uploadResult.record?.assetId || null,
      s3Key,
      fileType,
      mimeType: mimeType || "application/octet-stream",
      fileSize: fileSize || buffer.length,
      width,
      height,
      blurhash: blurhash || null,
      durationMs: durationMs ? Number(durationMs) : null,
      isEncrypted: isSecure,
      expiresIn,
    };
  }

  /**
   * Giải mã và tải nội dung tệp đính kèm trong phòng chat bảo mật (chỉ khi mở khoá đúng mã)
   */
  static async getSecureAttachmentContent(conversationId, attachmentId, userId) {
    const [membership, conversation, attachment] = await Promise.all([
      ConversationMember.findOne({
        where: { conversationId, userId, leftAt: null },
      }),
      Conversation.findByPk(conversationId),
      MessageAttachment.findByPk(attachmentId, {
        include: [
          {
            model: Message,
            as: "message",
            attributes: ["id", "conversationId", "deletedAt", "isRecalled"],
          },
        ],
      }),
    ]);

    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_CONVERSATION_MEMBER);
    }
    if (!conversation) {
      throw new NotFoundException(ErrorCodes.CHAT_CONVERSATION_NOT_FOUND);
    }
    if (
      !attachment ||
      !attachment.message ||
      attachment.message.conversationId !== conversationId ||
      attachment.message.deletedAt ||
      attachment.message.isRecalled ||
      !attachment.s3Key
    ) {
      throw new NotFoundException(ErrorCodes.CHAT_ATTACHMENT_NOT_FOUND);
    }

    if (conversation.isSecure) {
      await chatSecurity.open(conversation);
    }

    const streamData = await s3Service.getDownloadStream(attachment.s3Key);
    const chunks = [];
    for await (const chunk of streamData.Body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    let buffer = Buffer.concat(chunks);

    if (attachment.isEncrypted) {
      const { dek } = await this._getOrEnsureConversationDek(conversation);
      if (!dek) {
        chatSecurity.deny();
      }
      buffer = chatCryptoService.decryptAttachmentBuffer({
        dek,
        conversationId,
        s3Key: attachment.s3Key,
        encryptedBuffer: buffer,
      });
    }

    return {
      buffer,
      fileName: attachment.fileName || "attachment",
      mimeType: attachment.mimeType || "application/octet-stream",
      fileSize: attachment.fileSize || buffer.length,
    };
  }

  /**
   * Huỷ khoá phòng bảo mật & xoá toàn bộ dữ liệu cuộc hội thoại (S3 object, s3_assets, attachments, reactions, pins, messages, members, conversation) khỏi server
   */
  static async _purgeConversation(conversationId, { deleteS3Assets = false } = {}) {
    const [members, convMessages, attachments] = await Promise.all([
      ConversationMember.findAll({
        where: { conversationId },
        attributes: ["userId"],
      }),
      Message.findAll({
        where: { conversationId },
        attributes: ["id"],
        paranoid: false,
      }),
      MessageAttachment.findAll({
        include: [
          {
            model: Message,
            as: "message",
            attributes: [],
            where: { conversationId },
            paranoid: false,
          },
        ],
      }),
    ]);

    const memberIds = [...new Set(members.map((m) => m.userId).filter(Boolean))];
    const messageIds = convMessages.map((m) => m.id).filter(Boolean);
    const attachmentIds = attachments.map((att) => att.id).filter(Boolean);

    if (deleteS3Assets) {
      const s3Keys = [
        ...new Set(attachments.map((att) => att.s3Key).filter(Boolean)),
      ];
      const s3AssetIds = [
        ...new Set(attachments.map((att) => att.s3AssetId).filter(Boolean)),
      ];

      await Promise.allSettled(
        s3Keys.map(async (s3Key) => {
          try {
            await s3Service.deleteAndRecord(s3Key);
          } catch (err) {
            console.warn(
              `[ChatService._purgeConversation] Failed deleting S3 key ${s3Key}:`,
              err?.message || err,
            );
          }
        }),
      );

      if (s3AssetIds.length > 0 || s3Keys.length > 0) {
        const assetFilters = [];
        if (s3AssetIds.length > 0) {
          assetFilters.push({ assetId: { [Op.in]: s3AssetIds } });
        }
        if (s3Keys.length > 0) {
          assetFilters.push({ s3Key: { [Op.in]: s3Keys } });
        }
        await S3Asset.destroy({
          where: { [Op.or]: assetFilters },
        });
      }
    }

    await Conversation.update(
      { lastMessageId: null, encryptedDek: null, securityCodeHash: null },
      { where: { id: conversationId } },
    );

    if (messageIds.length > 0) {
      await Message.update(
        { replyToId: null },
        { where: { conversationId }, paranoid: false },
      );
    }

    if (attachmentIds.length > 0) {
      await MessageAttachment.destroy({
        where: { id: { [Op.in]: attachmentIds } },
      });
    }

    if (messageIds.length > 0) {
      await MessageReaction.destroy({
        where: { messageId: { [Op.in]: messageIds } },
      });
    }

    await PinnedMessage.destroy({ where: { conversationId } });
    await Message.destroy({ where: { conversationId }, force: true });
    await ConversationMember.destroy({ where: { conversationId } });
    await Conversation.destroy({ where: { id: conversationId } });

    chatCryptoService.dekCache.delete(conversationId);

    return { memberIds, messageIds, attachmentIds };
  }

  static async dissolveGroup(conversationId, userId, userRole = null) {
    if (
      conversationId === PICARE_GROUP_DB_ID ||
      this.toPublicConversationId(conversationId) === PICARE_GROUP_PUBLIC_ID
    ) {
      throw new ForbiddenException(
        "Không thể giải tán nhóm chính thức Đại gia đình - Picare Group",
      );
    }

    const isSysAdmin = this._isSystemAdmin(userRole);
    if (!isSysAdmin) {
      throw new ForbiddenException(
        "Chỉ tài khoản có vai trò Admin mới có quyền giải tán nhóm",
      );
    }

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) {
      throw new NotFoundException(ErrorCodes.CHAT_CONVERSATION_NOT_FOUND);
    }
    if (conversation.type !== "group") {
      throw new BadRequestException("Chỉ có thể giải tán cuộc trò chuyện nhóm");
    }

    const groupName = conversation.name;
    const { memberIds } = await this._purgeConversation(conversationId, {
      deleteS3Assets: true,
    });

    const publicId = this.toPublicConversationId(conversationId);
    const payload = {
      conversationId: publicId,
      dissolved: true,
      groupName,
    };

    const notifyUserIds = [...new Set([...memberIds, userId].filter(Boolean))];
    if (notifyUserIds.length > 0) {
      socketService.removeUsersFromConversationRoom(notifyUserIds, publicId);
      socketService.emitToUsers(
        notifyUserIds,
        "conversation_deleted_for_me",
        payload,
      );
      await ssePublisher.publishToUsers(
        notifyUserIds,
        "CONVERSATION_DISSOLVED",
        payload,
      );
    }

    return {
      dissolved: true,
      conversationId: publicId,
      groupName,
    };
  }

  static async destroyRoomSecurity(conversationId, userId) {
    const [conversation, member] = await Promise.all([
      Conversation.findByPk(conversationId),
      ConversationMember.findOne({
        where: { conversationId, userId, leftAt: null },
      }),
    ]);

    if (!member || !conversation?.isSecure || conversation.createdBy !== userId) {
      chatSecurity.deny();
    }
    await chatSecurity.open(conversation);

    const { memberIds, messageIds, attachmentIds } =
      await this._purgeConversation(conversationId, { deleteS3Assets: true });

    const payload = {
      conversationId,
      destroyed: true,
    };

    if (memberIds.length > 0) {
      socketService.removeUsersFromConversationRoom(memberIds, conversationId);
      socketService.emitToUsers(memberIds, "conversation_deleted_for_me", payload);
      await ssePublisher.publishToUsers(
        memberIds,
        "CONVERSATION_DELETED_FOR_ME",
        payload,
      );
    }

    return {
      destroyed: true,
      deletedConversationId: conversationId,
      deletedMessageCount: messageIds.length,
      deletedAttachmentCount: attachmentIds.length,
    };
  }

  /**
   * Cấp Presigned GET URL có kiểm tra quyền thành viên cuộc hội thoại cho file đính kèm (C2)
   * @param {string} attachmentId
   * @param {string} userId
   */
  static async getAttachmentSignedUrl(attachmentId, userId) {
    const attachment = await MessageAttachment.findByPk(attachmentId, {
      include: [
        {
          model: Message,
          as: "message",
          attributes: ["id", "conversationId", "deletedAt"],
        },
      ],
    });

    if (!attachment || !attachment.message || attachment.message.deletedAt) {
      throw new NotFoundException(ErrorCodes.CHAT_ATTACHMENT_NOT_FOUND);
    }

    if (attachment.isEncrypted) {
      chatSecurity.deny();
    }

    const membership = await ConversationMember.findOne({
      where: {
        conversationId: attachment.message.conversationId,
        userId,
        leftAt: null,
      },
    });
    if (!membership) {
      throw new ForbiddenException(ErrorCodes.CHAT_NOT_CONVERSATION_MEMBER);
    }

    const expiresIn = appConfig.chat?.presignedUrlExpiresIn || 3600;
    if (attachment.s3Key) {
      const downloadUrl = await s3Service.getPresignedUrl(
        attachment.s3Key,
        expiresIn,
      );
      return {
        attachmentId: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        downloadUrl,
        expiresIn,
      };
    }

    return {
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
      downloadUrl: attachment.fileUrl,
      expiresIn,
    };
  }

  /**
   * Trích xuất OpenGraph / HTML metadata từ đường link gửi trong chat
   * @param {string} rawUrl
   */
  static async getLinkPreview(rawUrl) {
    try {
      return await linkPreviewService.fetchMetadata(rawUrl);
    } catch (_error) {
      throw new BadRequestException("Đường dẫn không hợp lệ hoặc không thể truy cập");
    }
  }
}

// Enforce at the service boundary so alternate transports cannot bypass room locks.
for (const method of ["getMessages", "searchMessages", "sendMessage", "getPinnedMessages", "pinMessage", "unpinMessage", "createAttachmentUploadTicket", "uploadChatAttachment", "getSecureAttachmentContent", "rotateConversationKey", "addMembers", "syncConversationMembers", "updateConversation", "markAsRead"]) {
  const original = ChatService[method];
  if (!original) continue;
  ChatService[method] = async function(id, ...args) {
    const conversation = await Conversation.findByPk(id);
    if (conversation?.isSecure) {
      const store = chatSecurity.context.getStore();
      store?.secureIds.add(id);
      await chatSecurity.open(conversation);
      if (["createAttachmentUploadTicket", "rotateConversationKey"].includes(method)) chatSecurity.deny();
    }
    return original.call(this, id, ...args);
  };
}
for (const method of ["editMessage", "deleteMessage", "recallMessage", "deleteForMe", "toggleReaction", "getAttachmentSignedUrl"]) {
  const original = ChatService[method];
  if (!original) continue;
  ChatService[method] = async function(id, ...args) {
    const resource = method === "getAttachmentSignedUrl" ? await MessageAttachment.findByPk(id) : await Message.findByPk(id);
    const message = method === "getAttachmentSignedUrl" && resource ? await Message.findByPk(resource.messageId) : resource;
    const conversation = message && await Conversation.findByPk(message.conversationId);
    if (conversation?.isSecure) {
      const store = chatSecurity.context.getStore();
      if (store && !store.conversationId) store.conversationId = conversation.id;
      store?.secureIds.add(conversation.id);
      await chatSecurity.open(conversation);
    }
    return original.call(this, id, ...args);
  };
}
module.exports = ChatService;
