"use strict";

const { Op } = require("sequelize");
const UserPushToken = require("../models/user_push_token.model");
const { toPublicConversationId } = require("../common/chat_constants");

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_BATCH_SIZE = 100;
const SINGLE_LINE_MAX_CHARS = 30;
const TWO_LINE_TOTAL_MAX_CHARS = 62;

function truncateCleanly(text, limit, forceEllipsis = false) {
  const chars = Array.from(String(text || "").trim());
  if (chars.length <= limit && !forceEllipsis) {
    return chars.join("");
  }

  const maxBody = Math.max(1, limit - 1);
  if (chars.length <= maxBody) {
    return `${chars.join("").replace(/…+$/, "").trimEnd()}…`;
  }

  const slice = chars.slice(0, maxBody).join("");
  const lastSpace = slice.lastIndexOf(" ");
  const clean =
    lastSpace >= Math.floor(maxBody * 0.55) ? slice.slice(0, lastSpace) : slice;
  return `${clean.replace(/…+$/, "").trimEnd()}…`;
}

/**
 * Universal 2-line clamp rule shared between Mobile & Server so remote push
 * notifications NEVER overflow past 2 visual lines on iPhone / Android banners.
 */
function formatNotificationBody(rawBody) {
  const paragraphs = String(rawBody || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((segment) => segment.replace(/[ \t]+/g, " ").trim())
    .filter((segment) => segment.length > 0);

  if (paragraphs.length === 0) {
    return "Tin nhắn mới";
  }

  if (paragraphs.length === 1) {
    return truncateCleanly(paragraphs[0], TWO_LINE_TOTAL_MAX_CHARS, false);
  }

  const line1 = truncateCleanly(paragraphs[0], SINGLE_LINE_MAX_CHARS, false);
  const line2 = truncateCleanly(
    paragraphs[1],
    SINGLE_LINE_MAX_CHARS,
    paragraphs.length > 2,
  );
  return `${line1}\n${line2}`;
}

function buildChatPushPreview(message, conversation) {
  if (conversation?.isSecure) {
    return "Bạn có tin nhắn bảo mật mới";
  }
  if (!message) {
    return "Tin nhắn mới";
  }

  const text = typeof message.content === "string" ? message.content.trim() : "";
  if (text) {
    return formatNotificationBody(text);
  }

  if (message.type === "sticker" || message.metadata?.sticker) {
    return "Đã gửi một nhãn dán";
  }
  if (message.type === "voice" || message.metadata?.voice) {
    return "Đã gửi tin nhắn thoại";
  }
  if (message.type === "entity_card" || message.metadata?.entityCard) {
    const title = message.metadata?.entityCard?.title;
    return formatNotificationBody(title ? `Đã chia sẻ: ${title}` : "Đã gửi một thẻ nghiệp vụ");
  }
  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    const hasVideo = message.attachments.some(
      (att) =>
        String(att.fileType || "").toLowerCase() === "video" ||
        String(att.mimeType || "").toLowerCase().startsWith("video/"),
    );
    const hasImage = message.attachments.some(
      (att) =>
        String(att.fileType || "").toLowerCase() === "image" ||
        String(att.mimeType || "").toLowerCase().startsWith("image/"),
    );
    if (hasVideo) return "Đã gửi một video";
    if (hasImage) {
      return message.attachments.length > 1
        ? `Đã gửi ${message.attachments.length} hình ảnh`
        : "Đã gửi một hình ảnh";
    }
    return "Đã gửi tệp đính kèm";
  }

  return "Tin nhắn mới";
}

function detectTokenType(token, providedType) {
  if (providedType && ["expo", "apns", "fcm"].includes(providedType)) {
    return providedType;
  }
  if (
    typeof token === "string" &&
    (token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken["))
  ) {
    return "expo";
  }
  return "apns";
}

class PushNotificationService {
  /**
   * Đăng ký / làm mới Push Token cho thiết bị của user.
   */
  static async registerToken(
    userId,
    { token, deviceId, platform, tokenType, appBundleId } = {},
  ) {
    const cleanToken = String(token || "").trim();
    const cleanDeviceId = String(deviceId || "").trim();
    const cleanPlatform = String(platform || "").toLowerCase().trim();
    const resolvedType = detectTokenType(cleanToken, tokenType);
    const resolvedBundle = String(appBundleId || "vn.picare.office").trim();

    if (!cleanToken || !cleanDeviceId || !["ios", "android"].includes(cleanPlatform)) {
      throw new Error("Thông tin push token không hợp lệ");
    }

    // Nếu token đã tồn tại (kể cả vừa đổi tài khoản trên cùng 1 máy) -> cập nhật chủ sở hữu mới
    const existingByToken = await UserPushToken.findOne({
      where: { token: cleanToken },
    });

    if (existingByToken) {
      await existingByToken.update({
        userId,
        deviceId: cleanDeviceId,
        platform: cleanPlatform,
        tokenType: resolvedType,
        appBundleId: resolvedBundle,
        isActive: true,
        lastSeenAt: new Date(),
      });
      return existingByToken;
    }

    // Vô hiệu hóa token cũ cùng (userId, deviceId, platform, tokenType) để tránh gửi trùng 2 lần tới cùng 1 máy
    await UserPushToken.update(
      { isActive: false },
      {
        where: {
          userId,
          deviceId: cleanDeviceId,
          platform: cleanPlatform,
          tokenType: resolvedType,
          isActive: true,
        },
      },
    );

    return UserPushToken.create({
      userId,
      deviceId: cleanDeviceId,
      platform: cleanPlatform,
      tokenType: resolvedType,
      token: cleanToken,
      appBundleId: resolvedBundle,
      isActive: true,
      lastSeenAt: new Date(),
    });
  }

  /**
   * Hủy đăng ký Push Token khi user đăng xuất khỏi thiết bị.
   */
  static async unregisterToken(userId, { token, deviceId } = {}) {
    const cleanToken = String(token || "").trim();
    const cleanDeviceId = String(deviceId || "").trim();

    if (!cleanToken && !cleanDeviceId) {
      return { removedCount: 0 };
    }

    const where = { userId };
    if (cleanToken) {
      where.token = cleanToken;
    } else if (cleanDeviceId) {
      where.deviceId = cleanDeviceId;
    }

    const [affected] = await UserPushToken.update(
      { isActive: false },
      { where },
    );

    return { removedCount: affected };
  }

  /**
   * Liệt kê các thiết bị đang hoạt động của user (phục vụ kiểm tra / debug).
   */
  static async listUserTokens(userId) {
    return UserPushToken.findAll({
      where: { userId, isActive: true },
      order: [["lastSeenAt", "DESC"]],
    });
  }

  /**
   * Bắn Remote Push Notification khi có tin nhắn chat mới.
   * - Tự loại trừ người gửi (`senderId`) và các thành viên đã tắt thông báo (`isMuted`).
   * - Giữ đúng chuẩn UI: Title = Tên thành viên, Subtitle = Tên nhóm (nếu là nhóm),
   *   Body cắt tối đa 2 dòng, `threadId` gom stack theo từng phòng.
   */
  static async dispatchChatMessagePush({
    conversation,
    message,
    members = [],
    senderId,
  }) {
    try {
      if (!conversation || !message) return;

      const recipientUserIds = members
        .filter((m) => m && m.userId && m.userId !== senderId && !m.isMuted)
        .map((m) => m.userId);

      if (recipientUserIds.length === 0) return;

      const tokens = await UserPushToken.findAll({
        where: {
          userId: { [Op.in]: recipientUserIds },
          isActive: true,
        },
        attributes: ["id", "userId", "platform", "tokenType", "token"],
      });

      if (tokens.length === 0) return;

      const publicConvId = toPublicConversationId(conversation.id);
      const threadId = `picare:chat:${publicConvId}`;
      const isGroup = conversation.type === "group";
      const senderName =
        String(message.sender?.name || "").trim() || "Đồng nghiệp Picare";
      const groupName = isGroup
        ? String(conversation.name || "").trim() || "Nhóm trò chuyện"
        : null;
      const body = buildChatPushPreview(message, conversation);

      const expoMessages = [];
      const directApnsTokens = [];
      const directFcmTokens = [];

      for (const row of tokens) {
        if (row.tokenType === "expo") {
          expoMessages.push({
            tokenId: row.id,
            payload: {
              to: row.token,
              title: senderName,
              ...(groupName ? { subtitle: groupName } : {}),
              body,
              sound:
                row.platform === "ios"
                  ? "chat_notification_sound_mobile.wav"
                  : "default",
              channelId: "picare_chat_messages_v2",
              categoryId: "PICARE_CHAT_MESSAGE",
              priority: "high",
              mutableContent: true,
              data: {
                domain: "chat",
                conversationId: publicConvId,
                threadId,
                senderId: String(senderId || ""),
                senderName,
                isGroup: isGroup ? "1" : "0",
                groupName: groupName || "",
                messageId: String(message.id || ""),
              },
            },
          });
        } else if (row.tokenType === "apns") {
          directApnsTokens.push(row);
        } else if (row.tokenType === "fcm") {
          directFcmTokens.push(row);
        }
      }

      if (expoMessages.length > 0) {
        await this.sendExpoPushBatch(expoMessages);
      }

      // Direct APNs (.p8) / FCM v1 transport hooks (completed in Phase 2 once Apple/Firebase credentials are installed)
      if (directApnsTokens.length > 0 && !process.env.APNS_KEY_P8) {
        console.log(
          `[PUSH]: Skipping ${directApnsTokens.length} direct APNs token(s) — Phase 2 APNS_KEY_P8 not configured yet.`,
        );
      }
      if (directFcmTokens.length > 0 && !process.env.FCM_SERVICE_ACCOUNT_JSON) {
        console.log(
          `[PUSH]: Skipping ${directFcmTokens.length} direct FCM token(s) — Phase 2 FCM_SERVICE_ACCOUNT_JSON not configured yet.`,
        );
      }
    } catch (error) {
      console.error("[PUSH_DISPATCH_ERROR]:", error?.message || error);
    }
  }

  static async sendExpoPushBatch(entries) {
    if (typeof fetch !== "function") {
      console.warn("[PUSH]: Global fetch unavailable in current Node runtime.");
      return;
    }

    for (let i = 0; i < entries.length; i += EXPO_PUSH_BATCH_SIZE) {
      const chunk = entries.slice(i, i + EXPO_PUSH_BATCH_SIZE);
      const headers = {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      };
      if (process.env.EXPO_ACCESS_TOKEN) {
        headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
      }

      try {
        const response = await fetch(EXPO_PUSH_ENDPOINT, {
          method: "POST",
          headers,
          body: JSON.stringify(chunk.map((item) => item.payload)),
        });

        if (!response.ok) {
          console.warn(
            `[PUSH]: Expo Push HTTP ${response.status} (${response.statusText})`,
          );
          continue;
        }

        const json = await response.json().catch(() => null);
        const tickets = Array.isArray(json?.data) ? json.data : [];
        const invalidTokenIds = [];

        tickets.forEach((ticket, idx) => {
          if (
            ticket?.status === "error" &&
            ticket?.details?.error === "DeviceNotRegistered"
          ) {
            const target = chunk[idx];
            if (target?.tokenId) {
              invalidTokenIds.push(target.tokenId);
            }
          }
        });

        if (invalidTokenIds.length > 0) {
          await UserPushToken.update(
            { isActive: false },
            { where: { id: { [Op.in]: invalidTokenIds } } },
          );
        }
      } catch (err) {
        console.warn("[PUSH]: Expo Push request failed:", err?.message || err);
      }
    }
  }
}

module.exports = PushNotificationService;
module.exports.formatNotificationBody = formatNotificationBody;
