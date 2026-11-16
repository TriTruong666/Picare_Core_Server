const crypto = require("crypto");
const appConfig = require("../config/app.config");
const { InternalServerException } = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");

const ALGORITHM = "aes-256-gcm";
const IV_BYTE_LENGTH = 12;
const DEK_BYTE_LENGTH = 32;
const BLIND_INDEX_HEX_LENGTH = 16;

/**
 * ChatCryptoService
 * Thực thi kiến trúc Defense-in-Depth Envelope Encryption cho Central Chat Hub:
 * 1. Mỗi Conversation có một Data Encryption Key (DEK - 32 bytes) riêng biệt.
 * 2. DEK được bọc (wrap) bằng Master KEK theo phiên bản (hỗ trợ Key Rotation không cần mã hoá lại tin nhắn).
 * 3. Mỗi Message được mã hoá bằng AES-256-GCM với IV 12-byte ngẫu nhiên + AAD gắn chặt
 *    (conversationId : senderId : messageId), chống tráo đổi hoặc chỉnh sửa bản mã trong DB.
 * 4. Hỗ trợ tìm kiếm từ khoá trên dữ liệu mã hoá (Searchable Encryption) bằng HMAC-SHA256 Blind Index
 *    hỗ trợ cả tiếng Việt có dấu, không dấu và mã chứng từ (SO-..., EXP-...).
 */
class ChatCryptoService {
  constructor() {
    this.dekCache = new Map();
  }

  /**
   * Lấy Master Key Encryption Key (32 bytes) theo version
   * @param {number} [version]
   * @returns {Buffer}
   */
  getKek(version) {
    const encCfg = appConfig.chat?.encryption || {};
    const targetVersion = version || encCfg.currentKeyVersion || 1;
    const rawSecret =
      encCfg.keyring?.[targetVersion] ||
      encCfg.masterKek ||
      appConfig.jwt?.secret ||
      "picare-core-default-chat-master-kek-dev";

    return crypto
      .createHash("sha256")
      .update(`picare-chat-kek-v${targetVersion}:${rawSecret}`, "utf8")
      .digest();
  }

  /**
   * Xây dựng Additional Authenticated Data (AAD) cho Conversation DEK
   */
  _buildConversationAad(conversationId, version) {
    return Buffer.from(`conv-dek:${conversationId}:v${version}`, "utf8");
  }

  /**
   * Xây dựng Additional Authenticated Data (AAD) cho Message
   */
  buildMessageAad(conversationId, senderId, messageId, scope = "content") {
    return Buffer.from(
      `${scope}:${conversationId}:${senderId}:${messageId}`,
      "utf8",
    );
  }

  /**
   * Bọc (Wrap) DEK bằng Master KEK
   * @param {string} conversationId
   * @param {Buffer} dekBuffer
   * @param {number} [version]
   */
  wrapDek(conversationId, dekBuffer, version) {
    const dekVersion =
      version || appConfig.chat?.encryption?.currentKeyVersion || 1;
    const kek = this.getKek(dekVersion);
    const iv = crypto.randomBytes(IV_BYTE_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, kek, iv);
    cipher.setAAD(this._buildConversationAad(conversationId, dekVersion));

    const encrypted = Buffer.concat([
      cipher.update(dekBuffer),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    const encryptedDek = [
      `v${dekVersion}`,
      iv.toString("base64"),
      authTag.toString("base64"),
      encrypted.toString("base64"),
    ].join(":");

    this._setCachedDek(conversationId, dekBuffer);

    return {
      encryptedDek,
      dekVersion,
    };
  }

  /**
   * Sinh mới DEK cho một cuộc hội thoại
   * @param {string} conversationId
   */
  generateConversationDek(conversationId) {
    const dek = crypto.randomBytes(DEK_BYTE_LENGTH);
    const { encryptedDek, dekVersion } = this.wrapDek(conversationId, dek);
    return {
      dek,
      encryptedDek,
      dekVersion,
    };
  }

  /**
   * Mở bọc (Unwrap) DEK của cuộc hội thoại
   * @param {string} conversationId
   * @param {string|null} encryptedDek
   * @param {number} [dekVersion=1]
   * @returns {Buffer}
   */
  unwrapConversationDek(conversationId, encryptedDek, dekVersion = 1) {
    if (!conversationId) {
      throw new InternalServerException(
        ErrorCodes.CHAT_ENCRYPTION_INTEGRITY_FAILED,
      );
    }

    const cached = this._getCachedDek(conversationId);
    if (cached) return cached;

    if (!encryptedDek) {
      // Fallback tất định cho hội thoại cũ tạo trước khi có cột encrypted_dek
      const kek = this.getKek(dekVersion || 1);
      const derivedDek = crypto
        .createHmac("sha256", kek)
        .update(`legacy-conv-dek:${conversationId}`, "utf8")
        .digest();
      this._setCachedDek(conversationId, derivedDek);
      return derivedDek;
    }

    try {
      const parts = String(encryptedDek).split(":");
      if (parts.length !== 4) {
        throw new Error("Invalid wrapped DEK format");
      }

      const [versionTag, ivB64, authTagB64, cipherB64] = parts;
      const parsedVersion =
        Number.parseInt(versionTag.replace(/^v/i, ""), 10) || dekVersion || 1;
      const aad = this._buildConversationAad(conversationId, parsedVersion);
      const iv = Buffer.from(ivB64, "base64");
      const authTag = Buffer.from(authTagB64, "base64");
      const encrypted = Buffer.from(cipherB64, "base64");

      const tryUnwrapWithKek = (kek) => {
        const decipher = crypto.createDecipheriv(ALGORITHM, kek, iv);
        decipher.setAAD(aad);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]);
      };

      const candidateKeks = [this.getKek(parsedVersion)];
      // Fallback an toàn cho các hội thoại v1 cũ được bọc trước khi đặt CHAT_MASTER_KEK
      if (parsedVersion === 1) {
        const legacySecrets = [
          appConfig.jwt?.secret,
          "picare-core-default-chat-master-kek-dev",
        ].filter(Boolean);
        for (const secret of legacySecrets) {
          candidateKeks.push(
            crypto
              .createHash("sha256")
              .update(`picare-chat-kek-v1:${secret}`, "utf8")
              .digest(),
          );
        }
      }

      let dek = null;
      let lastError = null;
      for (const kek of candidateKeks) {
        try {
          dek = tryUnwrapWithKek(kek);
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (!dek) {
        throw lastError || new Error("Unable to unwrap conversation DEK");
      }

      this._setCachedDek(conversationId, dek);
      return dek;
    } catch (_error) {
      throw new InternalServerException(
        ErrorCodes.CHAT_ENCRYPTION_INTEGRITY_FAILED,
      );
    }
  }

  /**
   * Xoay vòng khoá bọc DEK (Key Rotation) từ version cũ sang version mới
   * mà không làm thay đổi DEK gốc hay phải mã hoá lại bảng messages.
   */
  rotateConversationDek(
    conversationId,
    encryptedDek,
    currentVersion = 1,
    targetVersion = null,
  ) {
    const newVersion =
      targetVersion || appConfig.chat?.encryption?.currentKeyVersion || 1;
    const dek = this.unwrapConversationDek(
      conversationId,
      encryptedDek,
      currentVersion,
    );
    return this.wrapDek(conversationId, dek, newVersion);
  }

  /**
   * Dẫn xuất khoá tìm kiếm mù (Blind Index Key) từ DEK của cuộc hội thoại
   * @param {Buffer} dek
   * @returns {Buffer}
   */
  deriveSearchKey(dek) {
    return crypto
      .createHmac("sha256", dek)
      .update("picare-chat-blind-index-v1", "utf8")
      .digest();
  }

  /**
   * Bỏ dấu tiếng Việt để hỗ trợ tìm kiếm cả có dấu lẫn không dấu
   * @param {string} str
   */
  stripVietnameseAccents(str) {
    return String(str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");
  }

  /**
   * Tách từ khoá chuẩn hoá phục vụ tạo Blind Index
   * @param {string} text
   * @returns {string[]}
   */
  tokenizeForSearch(text) {
    if (!text || typeof text !== "string") return [];
    const lowered = text.toLowerCase().trim();
    if (!lowered) return [];

    // Giữ lại cả mã chứng từ có dấu gạch ngang (vd: so-202611-0089) và từng thành phần con
    const rawMatches =
      lowered.match(/[\p{L}\p{N}]+(?:[-_./][\p{L}\p{N}]+)*/gu) || [];
    const tokenSet = new Set();

    for (const token of rawMatches) {
      if (token.length >= 2) {
        tokenSet.add(token);
        const unaccented = this.stripVietnameseAccents(token);
        if (unaccented.length >= 2) {
          tokenSet.add(unaccented);
        }
      }
      if (/[-_./]/.test(token)) {
        const subParts = token.split(/[-_./]+/).filter((p) => p.length >= 2);
        for (const sub of subParts) {
          tokenSet.add(sub);
          const unaccentedSub = this.stripVietnameseAccents(sub);
          if (unaccentedSub.length >= 2) {
            tokenSet.add(unaccentedSub);
          }
        }
      }
    }

    return [...tokenSet].slice(0, 128);
  }

  /**
   * Sinh mảng Blind Index tokens (HMAC-SHA256 rút gọn) để lưu vào messages.search_tokens
   * @param {Buffer} dek
   * @param {string} text
   * @param {string[]} [extraTerms=[]]
   * @returns {string[]}
   */
  generateSearchTokens(dek, text, extraTerms = []) {
    const combinedText = [text || "", ...(extraTerms || [])]
      .filter(Boolean)
      .join(" ");
    const words = this.tokenizeForSearch(combinedText);
    if (words.length === 0) return [];

    const searchKey = this.deriveSearchKey(dek);
    const hashes = new Set();

    for (const word of words) {
      const digest = crypto
        .createHmac("sha256", searchKey)
        .update(word, "utf8")
        .digest("hex")
        .slice(0, BLIND_INDEX_HEX_LENGTH);
      hashes.add(digest);
    }

    return [...hashes];
  }

  /**
   * Băm câu truy vấn tìm kiếm của người dùng thành mảng Blind Index tokens
   * (Chỉ băm các từ nguyên bản người dùng nhập để dùng toán tử @> chính xác)
   * @param {Buffer} dek
   * @param {string} queryText
   * @returns {string[]}
   */
  buildQuerySearchTokens(dek, queryText) {
    if (!queryText || typeof queryText !== "string") return [];
    const normalized = queryText.toLowerCase().trim();
    const rawWords =
      normalized.match(/[\p{L}\p{N}]+(?:[-_./][\p{L}\p{N}]+)*/gu) || [];
    const validWords = rawWords.filter((w) => w.length >= 2);
    if (validWords.length === 0) return [];

    const searchKey = this.deriveSearchKey(dek);
    return [
      ...new Set(
        validWords.map((word) =>
          crypto
            .createHmac("sha256", searchKey)
            .update(word, "utf8")
            .digest("hex")
            .slice(0, BLIND_INDEX_HEX_LENGTH),
        ),
      ),
    ];
  }

  /**
   * Mã hoá nội dung tin nhắn bằng AES-256-GCM + AAD
   */
  encryptMessageContent({
    dek,
    conversationId,
    senderId,
    messageId,
    plaintext,
    extraSearchTerms = [],
    keyVersion = 1,
  }) {
    if (plaintext === null || plaintext === undefined || plaintext === "") {
      return {
        content: null,
        ciphertext: null,
        iv: null,
        authTag: null,
        keyVersion,
        searchTokens:
          extraSearchTerms.length > 0
            ? this.generateSearchTokens(dek, "", extraSearchTerms)
            : [],
      };
    }

    const textStr = String(plaintext);
    const iv = crypto.randomBytes(IV_BYTE_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
    cipher.setAAD(
      this.buildMessageAad(conversationId, senderId, messageId, "content"),
    );

    const encrypted = Buffer.concat([
      cipher.update(textStr, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      content: null, // Không lưu bản rõ xuống DB
      ciphertext: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      keyVersion,
      searchTokens: this.generateSearchTokens(dek, textStr, extraSearchTerms),
    };
  }

  /**
   * Giải mã nội dung tin nhắn và kiểm tra tính toàn vẹn AAD + AuthTag
   */
  decryptMessageContent({
    dek,
    conversationId,
    senderId,
    messageId,
    ciphertext,
    iv,
    authTag,
    fallbackPlaintext = null,
  }) {
    if (!ciphertext) {
      return fallbackPlaintext;
    }

    if (!iv || !authTag) {
      throw new InternalServerException(
        ErrorCodes.CHAT_ENCRYPTION_INTEGRITY_FAILED,
      );
    }

    try {
      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        dek,
        Buffer.from(iv, "base64"),
      );
      decipher.setAAD(
        this.buildMessageAad(conversationId, senderId, messageId, "content"),
      );
      decipher.setAuthTag(Buffer.from(authTag, "base64"));

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64")),
        decipher.final(),
      ]);

      return decrypted.toString("utf8");
    } catch (_error) {
      throw new InternalServerException(
        ErrorCodes.CHAT_ENCRYPTION_INTEGRITY_FAILED,
      );
    }
  }

  /**
   * Mã hoá payload Metadata (VD: Entity Card) thành encrypted_metadata + chỉ giữ lại phần header định danh ở cột metadata JSONB
   */
  encryptMetadata({ dek, conversationId, senderId, messageId, metadata }) {
    if (!metadata || typeof metadata !== "object") {
      return {
        publicMetadata: null,
        encryptedMetadata: null,
        metadataIv: null,
        metadataAuthTag: null,
        extraSearchTerms: [],
      };
    }

    const jsonStr = JSON.stringify(metadata);
    const iv = crypto.randomBytes(IV_BYTE_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
    cipher.setAAD(
      this.buildMessageAad(conversationId, senderId, messageId, "metadata"),
    );

    const encrypted = Buffer.concat([
      cipher.update(jsonStr, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Chỉ giữ các khoá định danh không nhạy cảm ở cột JSONB để phục vụ truy vấn/cập nhật trạng thái thẻ
    const publicMetadata = {
      schemaVersion: metadata.schemaVersion || 1,
      ...(metadata.entityType ? { entityType: metadata.entityType } : {}),
      ...(metadata.sourceSystem ? { sourceSystem: metadata.sourceSystem } : {}),
      ...(metadata.entityId ? { entityId: String(metadata.entityId) } : {}),
      ...(metadata.entityCode
        ? { entityCode: String(metadata.entityCode) }
        : {}),
      ...(metadata.companyId ? { companyId: String(metadata.companyId) } : {}),
      ...(Array.isArray(metadata.mentions)
        ? { mentions: metadata.mentions }
        : {}),
    };

    const extraSearchTerms = [
      metadata.entityCode,
      metadata.entityId,
      metadata.entityType,
      metadata.sourceSystem,
      metadata.snapshot?.title,
      metadata.snapshot?.subtitle,
      metadata.snapshot?.customerName,
      metadata.linkPreview?.title,
      metadata.linkPreview?.description,
      metadata.linkPreview?.domain,
      metadata.linkPreview?.url,
    ].filter(Boolean);

    return {
      publicMetadata,
      encryptedMetadata: encrypted.toString("base64"),
      metadataIv: iv.toString("base64"),
      metadataAuthTag: authTag.toString("base64"),
      extraSearchTerms,
    };
  }

  /**
   * Giải mã Metadata của tin nhắn
   */
  decryptMetadata({
    dek,
    conversationId,
    senderId,
    messageId,
    encryptedMetadata,
    metadataIv,
    metadataAuthTag,
    fallbackMetadata = null,
  }) {
    if (!encryptedMetadata) {
      return fallbackMetadata || null;
    }

    if (!metadataIv || !metadataAuthTag) {
      throw new InternalServerException(
        ErrorCodes.CHAT_ENCRYPTION_INTEGRITY_FAILED,
      );
    }

    try {
      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        dek,
        Buffer.from(metadataIv, "base64"),
      );
      decipher.setAAD(
        this.buildMessageAad(conversationId, senderId, messageId, "metadata"),
      );
      decipher.setAuthTag(Buffer.from(metadataAuthTag, "base64"));

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedMetadata, "base64")),
        decipher.final(),
      ]);

      return JSON.parse(decrypted.toString("utf8"));
    } catch (_error) {
      throw new InternalServerException(
        ErrorCodes.CHAT_ENCRYPTION_INTEGRITY_FAILED,
      );
    }
  }

  /**
   * Mã hoá Buffer tệp đính kèm bằng AES-256-GCM với DEK của hội thoại.
   * Format binary: [5B magic "PSEC1"][12B IV][16B AuthTag][ciphertext...]
   */
  encryptAttachmentBuffer({ dek, conversationId, s3Key, buffer }) {
    if (!dek || !Buffer.isBuffer(buffer)) {
      throw new InternalServerException(
        ErrorCodes.CHAT_ENCRYPTION_INTEGRITY_FAILED,
      );
    }
    const magic = Buffer.from("PSEC1", "ascii");
    const iv = crypto.randomBytes(IV_BYTE_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
    cipher.setAAD(
      Buffer.from(`att:${conversationId}:${s3Key}`, "utf8"),
    );

    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([magic, iv, authTag, encrypted]);
  }

  /**
   * Giải mã Buffer tệp đính kèm đã mã hoá theo chuẩn PSEC1.
   */
  decryptAttachmentBuffer({ dek, conversationId, s3Key, encryptedBuffer }) {
    const authTagByteLength = 16;
    const headerLen = 5 + IV_BYTE_LENGTH + authTagByteLength;
    if (
      !dek ||
      !Buffer.isBuffer(encryptedBuffer) ||
      encryptedBuffer.length < headerLen ||
      encryptedBuffer.subarray(0, 5).toString("ascii") !== "PSEC1"
    ) {
      throw new InternalServerException(
        ErrorCodes.CHAT_ENCRYPTION_INTEGRITY_FAILED,
      );
    }

    try {
      const iv = encryptedBuffer.subarray(5, 5 + IV_BYTE_LENGTH);
      const authTag = encryptedBuffer.subarray(
        5 + IV_BYTE_LENGTH,
        5 + IV_BYTE_LENGTH + authTagByteLength,
      );
      const ciphertext = encryptedBuffer.subarray(headerLen);

      const decipher = crypto.createDecipheriv(ALGORITHM, dek, iv);
      decipher.setAAD(
        Buffer.from(`att:${conversationId}:${s3Key}`, "utf8"),
      );
      decipher.setAuthTag(authTag);

      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (_error) {
      throw new InternalServerException(
        ErrorCodes.CHAT_ENCRYPTION_INTEGRITY_FAILED,
      );
    }
  }

  _getCachedDek(conversationId) {
    const entry = this.dekCache.get(conversationId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.dekCache.delete(conversationId);
      return null;
    }
    return entry.dek;
  }

  _setCachedDek(conversationId, dek) {
    const maxSize = appConfig.chat?.encryption?.dekCacheMaxSize || 2000;
    const ttlMs = appConfig.chat?.encryption?.dekCacheTtlMs || 10 * 60 * 1000;

    if (this.dekCache.size >= maxSize) {
      const firstKey = this.dekCache.keys().next().value;
      if (firstKey) this.dekCache.delete(firstKey);
    }

    this.dekCache.set(conversationId, {
      dek,
      expiresAt: Date.now() + ttlMs,
    });
  }

  clearCache() {
    this.dekCache.clear();
  }
}

module.exports = new ChatCryptoService();
module.exports.ChatCryptoService = ChatCryptoService;

