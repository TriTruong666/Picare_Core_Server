"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");
const grpc = require("@grpc/grpc-js");
const sharp = require("sharp");

const chatCryptoService = require("../src/services/chat_crypto.service");
const ChatService = require("../src/services/chat.service");
const socketService = require("../src/services/socket.service");
const ssePublisher = require("../src/services/sse_publisher.service");
const s3Service = require("../src/services/s3.service");
const grpcChatHandler = require("../src/services/grpc_chat.handler");
const appConfig = require("../src/config/app.config");
const { runDatabaseMigrations } = require("../src/config/database_migration");
const {
  Conversation,
  ConversationMember,
  Message,
  MessageAttachment,
  PinnedMessage,
  MessageReaction,
} = require("../src/models/chat");

// ─────────────────────────────────────────────────────────────────────────────
// C1: ENVELOPE ENCRYPTION (AES-256-GCM + AAD + BLIND INDEX + KEY ROTATION)
// ─────────────────────────────────────────────────────────────────────────────

test("C1: ChatCryptoService wraps/unwraps per-conversation DEK and rotates KEK version without changing DEK", () => {
  chatCryptoService.clearCache();
  const conversationId = randomUUID();

  const { dek, encryptedDek, dekVersion } =
    chatCryptoService.generateConversationDek(conversationId);

  assert.equal(Buffer.isBuffer(dek), true);
  assert.equal(dek.length, 32);
  assert.match(encryptedDek, /^v\d+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

  chatCryptoService.clearCache();
  const unwrapped = chatCryptoService.unwrapConversationDek(
    conversationId,
    encryptedDek,
    dekVersion,
  );
  assert.deepEqual(unwrapped, dek);

  // Tampering with conversationId in AAD must fail decryption
  chatCryptoService.clearCache();
  assert.throws(() => {
    chatCryptoService.unwrapConversationDek(
      randomUUID(),
      encryptedDek,
      dekVersion,
    );
  });

  // Key rotation to v2 preserves underlying 32-byte DEK
  appConfig.chat.encryption.keyring[2] = "rotated-master-kek-secret-v2";
  const rotated = chatCryptoService.rotateConversationDek(
    conversationId,
    encryptedDek,
    dekVersion,
    2,
  );
  assert.equal(rotated.dekVersion, 2);
  assert.match(rotated.encryptedDek, /^v2:/);

  chatCryptoService.clearCache();
  const unwrappedAfterRotate = chatCryptoService.unwrapConversationDek(
    conversationId,
    rotated.encryptedDek,
    2,
  );
  assert.deepEqual(unwrappedAfterRotate, dek);
});

test("C1: ChatCryptoService encrypts/decrypts message content & metadata with AAD and generates searchable blind indexes", () => {
  const conversationId = randomUUID();
  const senderId = randomUUID();
  const messageId = randomUUID();
  const { dek } = chatCryptoService.generateConversationDek(conversationId);

  const plaintext =
    "Gửi anh B xử lý gấp đơn hàng #SO-202611-0089 của Nhà thuốc Minh Châu";
  const encrypted = chatCryptoService.encryptMessageContent({
    dek,
    conversationId,
    senderId,
    messageId,
    plaintext,
    keyVersion: 1,
  });

  // Content must be null in DB, only ciphertext + iv + authTag stored
  assert.equal(encrypted.content, null);
  assert.ok(encrypted.ciphertext);
  assert.ok(encrypted.iv);
  assert.ok(encrypted.authTag);
  assert.ok(encrypted.searchTokens.length > 0);
  assert.equal(encrypted.ciphertext.includes("Minh Châu"), false);

  const decrypted = chatCryptoService.decryptMessageContent({
    dek,
    conversationId,
    senderId,
    messageId,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
  });
  assert.equal(decrypted, plaintext);

  // Swapping senderId or conversationId or messageId must fail AAD authentication
  assert.throws(() => {
    chatCryptoService.decryptMessageContent({
      dek,
      conversationId,
      senderId: randomUUID(),
      messageId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });
  });

  // Blind index search tokens match both accented Vietnamese, unaccented Vietnamese, and order code
  const qAccented = chatCryptoService.buildQuerySearchTokens(
    dek,
    "Minh Châu",
  );
  const qUnaccented = chatCryptoService.buildQuerySearchTokens(
    dek,
    "minh chau",
  );
  const qOrderCode = chatCryptoService.buildQuerySearchTokens(
    dek,
    "SO-202611-0089",
  );

  for (const token of qAccented) {
    assert.equal(encrypted.searchTokens.includes(token), true);
  }
  for (const token of qUnaccented) {
    assert.equal(encrypted.searchTokens.includes(token), true);
  }
  for (const token of qOrderCode) {
    assert.equal(encrypted.searchTokens.includes(token), true);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// C0: DATABASE MIGRATION, SOCKET SECURITY & REDIS PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

test("C0: runDatabaseMigrations upgrades chat tables and creates pinned_messages & message_reactions idempotently", async () => {
  const executedSql = [];
  const mockSequelize = {
    async query(sql) {
      executedSql.push(sql);
      if (
        sql.includes("to_regclass('public.conversations')") ||
        sql.includes("to_regclass('public.conversation_members')") ||
        sql.includes("to_regclass('public.messages')") ||
        sql.includes("to_regclass('public.message_attachments')")
      ) {
        return [[{ table_exists: "exists" }]];
      }
      return [[{ table_exists: null }]];
    },
  };

  await runDatabaseMigrations(mockSequelize);
  const combined = executedSql.join("\n");

  assert.match(combined, /ADD COLUMN IF NOT EXISTS encrypted_dek TEXT/);
  assert.match(combined, /ADD COLUMN IF NOT EXISTS unread_count INTEGER/);
  assert.match(combined, /ADD COLUMN IF NOT EXISTS ciphertext TEXT/);
  assert.match(combined, /ADD COLUMN IF NOT EXISTS search_tokens TEXT\[\]/);
  assert.match(combined, /CREATE TABLE IF NOT EXISTS pinned_messages/);
  assert.match(combined, /CREATE TABLE IF NOT EXISTS message_reactions/);
});

test("C0: SocketService blocks non-members from joining conversation room", async () => {
  const userId = randomUUID();
  const allowedConvId = randomUUID();
  const forbiddenConvId = randomUUID();

  socketService.setMembershipVerifier(async (cid, uid) => {
    return cid === allowedConvId && uid === userId;
  });

  const joinedRooms = new Set();
  const emittedEvents = [];
  const handlers = {};

  const fakeSocket = {
    id: "sock-1",
    user: { userId, name: "Tester" },
    rooms: joinedRooms,
    join(room) {
      joinedRooms.add(room);
    },
    leave(room) {
      joinedRooms.delete(room);
    },
    emit(event, data) {
      emittedEvents.push({ event, data });
    },
    to() {
      return { emit() {} };
    },
    on(event, fn) {
      handlers[event] = fn;
    },
  };

  socketService._handleConnection(fakeSocket);

  // Non-member attempt must be denied
  let deniedAck = null;
  await handlers.join_conversation(
    { conversationId: forbiddenConvId },
    (res) => {
      deniedAck = res;
    },
  );
  assert.equal(deniedAck.ok, false);
  assert.equal(joinedRooms.has(`conversation:${forbiddenConvId}`), false);

  // Valid member attempt must succeed
  let allowedAck = null;
  await handlers.join_conversation({ conversationId: allowedConvId }, (res) => {
    allowedAck = res;
  });
  assert.equal(allowedAck.ok, true);
  assert.equal(joinedRooms.has(`conversation:${allowedConvId}`), true);

  socketService.setMembershipVerifier(null);
});

test("C0: SSEPublisherService batches multi-user events and sse:chat into a single Redis pipeline", async () => {
  const published = [];
  const originalRedis = ssePublisher.redis;
  ssePublisher.redis = {
    pipeline() {
      return {
        publish(channel, msg) {
          published.push({ channel, msg: JSON.parse(msg) });
          return this;
        },
        async exec() {
          return [];
        },
      };
    },
  };

  try {
    const u1 = randomUUID();
    const u2 = randomUUID();
    await ssePublisher.publishToUsers([u1, u2, u1], "NEW_MESSAGE", {
      id: "m1",
    });

    assert.equal(published.length, 3); // user:u1, user:u2, and sse:chat
    assert.equal(published[0].channel, `user:${u1}`);
    assert.equal(published[1].channel, `user:${u2}`);
    assert.equal(published[2].channel, "sse:chat");
    assert.deepEqual(published[2].msg.targetUserIds, [u1, u2]);
  } finally {
    ssePublisher.redis = originalRedis;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// C2, C3, C4: PIN MESSAGES, S3 ATTACHMENTS, ENTITY CARDS & GRPC HANDLER
// ─────────────────────────────────────────────────────────────────────────────

test("C2, C3, C4: ChatService encrypts entity_card, resolves cross-system deep links, updates live snapshot, and pins/unpins messages", async (t) => {
  const convId = randomUUID();
  const senderId = randomUUID();
  const recipientId = randomUUID();
  const { encryptedDek, dekVersion } =
    chatCryptoService.generateConversationDek(convId);

  const mockConv = {
    id: convId,
    type: "private",
    scopeSystem: "SFA",
    encryptedDek,
    dekVersion,
    pinnedCount: 0,
    async update(patch) {
      Object.assign(this, patch);
      return this;
    },
    toJSON() {
      return { ...this };
    },
  };

  let storedMessage = null;

  t.mock.method(ConversationMember, "findOne", async () => ({
    id: randomUUID(),
    conversationId: convId,
    userId: senderId,
    role: "owner",
    leftAt: null,
  }));
  t.mock.method(ConversationMember, "findAll", async () => [
    { userId: senderId },
    { userId: recipientId },
  ]);
  t.mock.method(ConversationMember, "increment", async () => {});
  t.mock.method(ConversationMember, "update", async () => {});
  t.mock.method(Conversation, "findByPk", async () => mockConv);
  t.mock.method(Conversation, "update", async () => {});
  t.mock.method(ssePublisher, "publishToUsers", async () => {});
  t.mock.method(socketService, "emitToRoom", () => {});

  t.mock.method(Message, "findOne", async ({ where }) => {
    if (where.clientMessageId && storedMessage?.clientMessageId === where.clientMessageId) {
      return storedMessage;
    }
    if (where.id && storedMessage?.id === where.id) {
      return storedMessage;
    }
    return null;
  });

  t.mock.method(Message, "create", async (data) => {
    storedMessage = {
      ...data,
      sender: {
        userId: senderId,
        name: "Sale Nguyễn Văn A",
        role: "sale",
        isOnline: true,
      },
      attachments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      async update(patch) {
        Object.assign(this, patch);
        return this;
      },
      toJSON() {
        return { ...this };
      },
    };
    return storedMessage;
  });

  t.mock.method(Message, "findByPk", async () => storedMessage);
  t.mock.method(Message, "findAll", async () =>
    storedMessage ? [storedMessage] : [],
  );
  t.mock.method(Message, "update", async (patch) => {
    if (storedMessage) Object.assign(storedMessage, patch);
  });

  // 1. Send an SFA Order Entity Card (A -> B)
  const sentMsg = await ChatService.sendMessage(convId, senderId, {
    type: "entity_card",
    content: "Nhờ B duyệt gấp đơn hàng này trên SFA nhé!",
    clientMessageId: "client-idemp-001",
    metadata: {
      entityType: "SFA_ORDER",
      sourceSystem: "SFA",
      entityId: "ord_982341",
      entityCode: "SO-202611-0089",
      companyId: "PIC",
      snapshot: {
        title: "Đơn hàng Nhà thuốc Minh Châu",
        status: "PENDING",
        totalAmount: 15400000,
      },
      navigation: {
        primarySystem: "SFA",
        path: "/orders/ord_982341",
        fallbackPaths: {
          OFFICE: "/approvals/orders/ord_982341",
          WMS: "/shipping/orders?sourceOrderId=ord_982341",
        },
      },
    },
  });

  // Verify DB stored encrypted ciphertext & encryptedMetadata, not plain text or sensitive snapshot
  assert.equal(storedMessage.content, null);
  assert.ok(storedMessage.ciphertext);
  assert.ok(storedMessage.encryptedMetadata);
  assert.equal(storedMessage.metadata.snapshot, undefined);
  assert.equal(storedMessage.metadata.entityId, "ord_982341");

  // Verify hydrated response has decrypted content, snapshot, and resolved cross-repo Deep-Link URLs
  assert.equal(
    sentMsg.content,
    "Nhờ B duyệt gấp đơn hàng này trên SFA nhé!",
  );
  assert.equal(sentMsg.metadata.snapshot.status, "PENDING");
  assert.equal(sentMsg.metadata.snapshot.totalAmount, 15400000);
  assert.match(
    sentMsg.metadata.navigation.redirectUrl,
    /\/orders\/ord_982341\?fromChat=/,
  );
  assert.ok(sentMsg.metadata.navigation.resolvedUrls.OFFICE);
  assert.ok(sentMsg.metadata.navigation.resolvedUrls.WMS);

  // 2. Live Status Update (Order status changes PENDING -> APPROVED)
  const updateResult = await ChatService.updateEntityCardSnapshot({
    conversationId: convId,
    messageId: sentMsg.id,
    snapshotPatch: {
      status: "APPROVED",
      statusLabel: "Đã duyệt xuất kho",
    },
  });
  assert.equal(updateResult.updatedCount, 1);

  const { dek } = await ChatService._getOrEnsureConversationDek(mockConv);
  const rehydrated = ChatService.hydrateMessage(storedMessage, dek);
  assert.equal(rehydrated.metadata.snapshot.status, "APPROVED");
  assert.equal(rehydrated.metadata.snapshot.statusLabel, "Đã duyệt xuất kho");
  assert.equal(rehydrated.metadata.snapshot.totalAmount, 15400000);

  // 3. Pin & Unpin the message inside the conversation (C2)
  let pinStore = null;
  t.mock.method(PinnedMessage, "findOne", async () => pinStore);
  t.mock.method(PinnedMessage, "count", async () => (pinStore ? 1 : 0));
  t.mock.method(PinnedMessage, "create", async (data) => {
    pinStore = {
      id: randomUUID(),
      ...data,
      createdAt: new Date(),
      async destroy() {
        pinStore = null;
      },
      toJSON() {
        return { ...this };
      },
    };
    return pinStore;
  });

  const pinned = await ChatService.pinMessage(convId, sentMsg.id, senderId, {
    note: "Đơn ưu tiên giao sáng mai",
  });
  assert.equal(pinned.messageId, sentMsg.id);
  assert.equal(pinned.note, "Đơn ưu tiên giao sáng mai");
  assert.equal(storedMessage.isPinned, true);
  assert.equal(mockConv.pinnedCount, 1);

  const unpinned = await ChatService.unpinMessage(
    convId,
    sentMsg.id,
    senderId,
  );
  assert.equal(unpinned.pinnedCount, 0);
  assert.equal(storedMessage.isPinned, false);
});

test("C2: ChatService uploads private image attachment via S3Service and extracts dimensions with sharp", async (t) => {
  const convId = randomUUID();
  const userId = randomUUID();

  t.mock.method(ConversationMember, "findOne", async () => ({
    id: randomUUID(),
    conversationId: convId,
    userId,
    leftAt: null,
  }));

  t.mock.method(s3Service, "upload", async (params) => ({
    key: params.key,
    url: `https://bucket.s3.amazonaws.com/${params.key}`,
    etag: '"etag-1"',
    record: { assetId: randomUUID() },
  }));

  t.mock.method(
    s3Service,
    "getPresignedUrl",
    async (key) => `https://signed.picare.vn/${key}?sig=abc`,
  );

  const imageBuffer = await sharp({
    create: {
      width: 320,
      height: 240,
      channels: 3,
      background: { r: 20, g: 120, b: 220 },
    },
  })
    .png()
    .toBuffer();

  const attachment = await ChatService.uploadChatAttachment(convId, userId, {
    buffer: imageBuffer,
    originalName: "phieugiaonhan.png",
    mimeType: "image/png",
    fileSize: imageBuffer.length,
    blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
  });

  assert.equal(attachment.fileType, "image");
  assert.equal(attachment.width, 320);
  assert.equal(attachment.height, 240);
  assert.match(attachment.s3Key, new RegExp(`^chat-attachments/${convId}/`));
  assert.match(attachment.fileUrl, /^https:\/\/signed\.picare\.vn\//);
});

test("C3 & C4: grpcChatHandler handles SendEntityMessage and GetUserChatSummary for cross-repo callers", async (t) => {
  const senderId = randomUUID();
  const recipientId = randomUUID();
  const convId = randomUUID();
  const msgId = randomUUID();

  t.mock.method(ChatService, "createConversation", async () => ({
    id: convId,
    type: "private",
    scopeSystem: "SFA",
    members: [],
  }));

  t.mock.method(ChatService, "sendMessage", async (cid, sid, dto) => ({
    id: msgId,
    conversationId: cid,
    senderId: sid,
    type: dto.type,
    content: dto.content,
    metadata: dto.metadata,
    attachments: [],
    createdAt: new Date().toISOString(),
  }));

  t.mock.method(ChatService, "getUserChatSummary", async (uid) => ({
    userId: uid,
    totalUnreadMessages: 5,
    totalMentionCount: 2,
    unreadConversationsCount: 2,
    totalConversations: 4,
    recentConversations: [],
  }));

  const entityRes = await new Promise((resolve, reject) => {
    grpcChatHandler.sendEntityMessage(
      {
        request: {
          senderId,
          recipientIds: [recipientId],
          content: "Đơn hàng đại lý cần xử lý",
          entityType: "SFA_ORDER",
          sourceSystem: "SFA",
          entityId: "ord_100",
          entityCode: "SO-100",
          companyId: "PIC",
          snapshotJson: JSON.stringify({
            title: "Đơn hàng SO-100",
            status: "PENDING",
          }),
          navigationPath: "/orders/ord_100",
          primarySystem: "SFA",
        },
      },
      (err, res) => (err ? reject(err) : resolve(res)),
    );
  });

  assert.equal(entityRes.success, true);
  assert.equal(entityRes.conversationId, convId);
  assert.equal(entityRes.messageId, msgId);
  const parsedMsg = JSON.parse(entityRes.messageJson);
  assert.equal(parsedMsg.metadata.entityCode, "SO-100");

  const summaryRes = await new Promise((resolve, reject) => {
    grpcChatHandler.getUserChatSummary(
      {
        request: {
          userId: recipientId,
          limit: 5,
          scopeSystem: "OFFICE",
        },
      },
      (err, res) => (err ? reject(err) : resolve(res)),
    );
  });

  assert.equal(summaryRes.success, true);
  assert.equal(summaryRes.totalUnreadMessages, 5);
  assert.equal(summaryRes.totalMentionCount, 2);

  // Verify invalid payload returns INVALID_ARGUMENT
  const invalidErr = await new Promise((resolve) => {
    grpcChatHandler.sendEntityMessage({ request: {} }, (err) => resolve(err));
  });
  assert.equal(invalidErr.code, grpc.status.INVALID_ARGUMENT);
});

test("C1 & C4: ChatService resolves cross-repo deep links and rotates conversation DEK key version", async (t) => {
  const convId = randomUUID();
  const ownerId = randomUUID();
  const msgId = randomUUID();

  const nav = ChatService.resolveDeepLink({
    entityType: "SFA_ORDER",
    sourceSystem: "SFA",
    entityId: "ord_777",
    entityCode: "SO-777",
    path: "/orders/ord_777",
    primarySystem: "SFA",
    fallbackPaths: {
      OFFICE: "/approvals/orders/ord_777",
      OMS: "/sales-orders/SO-777",
    },
    conversationId: convId,
    messageId: msgId,
  });

  assert.equal(nav.primarySystem, "SFA");
  assert.match(nav.redirectUrl, /\/orders\/ord_777\?fromChat=/);
  assert.match(nav.resolvedUrls.OFFICE, /\/approvals\/orders\/ord_777\?fromChat=/);
  assert.match(nav.resolvedUrls.OMS, /\/sales-orders\/SO-777\?fromChat=/);

  const initialKey = chatCryptoService.generateConversationDek(convId);
  appConfig.chat.encryption.keyring[2] = "enterprise-master-kek-v2";

  const mockConv = {
    id: convId,
    type: "group",
    encryptedDek: initialKey.encryptedDek,
    dekVersion: 1,
    async update(patch) {
      Object.assign(this, patch);
      return this;
    },
  };

  t.mock.method(ConversationMember, "findOne", async () => ({
    id: randomUUID(),
    conversationId: convId,
    userId: ownerId,
    role: "owner",
    leftAt: null,
  }));
  t.mock.method(Conversation, "findByPk", async () => mockConv);

  const rotated = await ChatService.rotateConversationKey(convId, ownerId, 2);
  assert.equal(rotated.previousVersion, 1);
  assert.equal(rotated.dekVersion, 2);
  assert.match(mockConv.encryptedDek, /^v2:/);
});

test("C0 & C2: ChatService handles Recall Message (Thu hồi) and Delete For Me (Xoá ở phía tôi)", async (t) => {
  const convId = randomUUID();
  const senderId = randomUUID();
  const receiverId = randomUUID();
  const msgId = randomUUID();

  const mockMessageData = {
    id: msgId,
    conversationId: convId,
    senderId,
    content: "Tin nhắn bí mật",
    ciphertext: "encrypted-payload",
    isRecalled: false,
    recalledAt: null,
    recalledBy: null,
    deletedForUserIds: [],
    deletedAt: null,
    isPinned: false,
    async update(patch) {
      Object.assign(this, patch);
      return this;
    },
    toJSON() {
      return { ...this };
    },
  };

  t.mock.method(Message, "findByPk", async (id) => (id === msgId ? mockMessageData : null));
  t.mock.method(ConversationMember, "findAll", async () => [
    { userId: senderId },
    { userId: receiverId },
  ]);
  t.mock.method(ConversationMember, "findOne", async ({ where }) => {
    if (where.conversationId === convId && (where.userId === senderId || where.userId === receiverId)) {
      return { id: randomUUID(), conversationId: convId, userId: where.userId, leftAt: null };
    }
    return null;
  });

  // 1. Non-sender cannot recall message
  await assert.rejects(
    async () => ChatService.recallMessage(msgId, receiverId),
    (err) => err.statusCode === 403
  );

  // 2. Sender recalls message
  const recallRes = await ChatService.recallMessage(msgId, senderId);
  assert.equal(recallRes.isRecalled, true);
  assert.equal(mockMessageData.isRecalled, true);
  assert.equal(mockMessageData.content, null);
  assert.equal(mockMessageData.ciphertext, null);
  assert.equal(mockMessageData.recalledBy, senderId);
  assert.ok(mockMessageData.recalledAt);

  // 3. Hydrate recalled message returns sanitized object
  const hydrated = ChatService.hydrateMessage(mockMessageData, Buffer.alloc(32));
  assert.equal(hydrated.isRecalled, true);
  assert.equal(hydrated.content, null);
  assert.deepEqual(hydrated.attachments, []);
  assert.deepEqual(hydrated.reactions, []);
  assert.equal(hydrated.ciphertext, undefined);

  // 4. Delete for me (Receiver deletes on their side)
  const delForMeRes = await ChatService.deleteForMe(msgId, receiverId);
  assert.equal(delForMeRes.success, true);
  assert.ok(mockMessageData.deletedForUserIds.includes(receiverId));
  assert.equal(mockMessageData.deletedForUserIds.includes(senderId), false);
});



