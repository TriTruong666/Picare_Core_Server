const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const security = require('../src/services/chat_security.service');
const cryptoService = require('../src/services/chat_crypto.service');
const ChatService = require('../src/services/chat.service');
const { Conversation } = require('../src/models/chat');
const store = (id, code) => ({ conversationId: id, code, secureIds: new Set() });

test('generated codes have ten characters and all required character classes', () => {
  const generated = new Set();
  for (let i = 0; i < 500; i++) {
    const code = security.generateCode();
    assert.match(code, /^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[!@#$%&*?]).{10}$/);
    generated.add(code);
  }
  assert.equal(generated.size, 500);
});

test('password wrapping requires both the code and correct conversation; no protected DEK stays cached', async () => {
  const id = 'secure-room', code = security.generateCode();
  const generated = cryptoService.generateConversationDek(id);
  const conversation = { id, isSecure: true, dekVersion: generated.dekVersion,
    encryptedDek: await security.seal(generated.encryptedDek, code, id),
    securityCodeHash: await bcrypt.hash(code, 4) };
  cryptoService.dekCache.delete(id);
  assert.throws(() => cryptoService.unwrapConversationDek(id, conversation.encryptedDek, generated.dekVersion));
  await assert.rejects(security.context.run(store(id, 'BadCode12!'), () => security.open(conversation)));
  await assert.rejects(security.context.run(store('different-room', code), () => security.open(conversation)));
  const opened = await security.context.run(store(id, code), () => ChatService._getOrEnsureConversationDek(conversation));
  assert.deepEqual(opened.dek, generated.dek);
  assert.equal(cryptoService.dekCache.has(id), false);
  const locked = await ChatService._getOrEnsureConversationDek(conversation);
  assert.equal(locked.dek, null);
  const swapped = { ...conversation, id: 'swapped' };
  await assert.rejects(security.context.run(store('swapped', code), () => security.open(swapped)));
  const destroyed = { ...conversation, encryptedDek: null, securityCodeHash: null };
  await assert.rejects(security.context.run(store(id, code), () => security.open(destroyed)));
});

test('serialization and realtime remove all protected content and internal key material', () => {
  const raw = { id: 'room', isSecure: true, securityCodeHash: 'hash', encryptedDek: 'wrapped', lastMessage: { content: 'secret', attachments: [{ fileUrl: 'secret' }] } };
  const clean = ChatService.sanitizeConversation(raw);
  assert.equal(clean.lastMessage, null);
  assert.equal(clean.securityCodeHash, undefined);
  assert.equal(clean.encryptedDek, undefined);
  security.context.run({ secureIds: new Set(['room']) }, () => {
    const event = security.event({ id: 'message', conversationId: 'room', content: 'secret', metadata: { secret: true }, replyTo: { content: 'secret' } });
    assert.deepEqual(Object.keys(event).sort(), ['conversationId', 'id', 'isSecure', 'requiresUnlock'].sort());
  });
});

test('service boundaries deny alternate transports without a room code', async () => {
  const original = Conversation.findByPk;
  Conversation.findByPk = async () => ({ id: 'room', isSecure: true });
  try {
    for (const method of ['getMessages', 'searchMessages', 'sendMessage', 'getPinnedMessages', 'rotateConversationKey', 'uploadChatAttachment']) {
      await assert.rejects(ChatService[method]('room', 'user', {}));
    }
    await assert.rejects(ChatService.createConversation('user', { type: 'private', isSecure: true, memberIds: ['other'] }));
  } finally { Conversation.findByPk = original; }
});

test('HTTP flow: CEO creates once, member unlocks, owner destroys; role and membership enforced', async () => {
  const express = require('express');
  const { randomUUID } = require('node:crypto');
  const jwtService = require('../src/services/jwt.service');
  const redis = require('../src/config/redis.config');
  const socket = require('../src/services/socket.service');
  const publisher = require('../src/services/sse_publisher.service');
  const { ConversationMember, MessageAttachment } = require('../src/models/chat');
  const owner = randomUUID(), partner = randomUUID(), outsider = randomUUID();
  const originals = [];
  const stub = (object, key, value) => { originals.push(() => { object[key] = value; }); object[key] = value; };
  let room;
  const events = [];
  stub(jwtService, 'verifyUserSession', async token => token === 'owner' ? { userId: owner, role: 'ceo' } : token === 'partner' ? { userId: partner, role: 'default' } : { userId: outsider, role: 'default' });
  stub(redis, 'incr', async () => 1); stub(redis, 'expire', async () => 1);
  stub(Conversation, 'findByPk', async id => room?.id === id ? room : null);
  stub(Conversation, 'create', async attrs => {
    room = { ...attrs, toJSON() { const { toJSON, update, ...data } = this; return data; }, async update(patch) { Object.assign(this, patch); } };
    return room;
  });
  stub(ConversationMember, 'findOne', async query => query.include ? (room ? { conversation: room } : null) : ([owner, partner].includes(query.where.userId) ? { role: query.where.userId === owner ? 'owner' : 'member' } : null));
  stub(ConversationMember, 'bulkCreate', async () => []);
  stub(ConversationMember, 'findAll', async () => [{ userId: owner }, { userId: partner }]);
  stub(MessageAttachment, 'findAll', async () => []);
  stub(socket, 'addUsersToConversationRoom', () => {});
  stub(socket, 'emitToUsers', (...args) => events.push(args[2]));
  stub(socket, 'emitToConversationAndUsers', (...args) => events.push(args[3]));
  stub(publisher, 'publishToUsers', async (...args) => events.push(args[2]));
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.cookies = { token: req.get('x-test-user') || 'owner' }; next(); });
  app.use('/api/v1/chat', require('../src/routes/chat.routes'));
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/chat`;
  const request = (path, actor, body, code) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': actor, ...(code ? { 'X-Chat-Security-Code': code } : {}) }, body: JSON.stringify(body || {}) });
  try {
    const denied = await request('/conversations', 'partner', { type: 'private', memberIds: [owner], isSecure: true });
    assert.equal(denied.status, 403);
    const created = await request('/conversations', 'owner', { type: 'private', memberIds: [partner], isSecure: true });
    const payload = await created.json();
    assert.equal(created.status, 201, JSON.stringify(payload));
    const code = payload.data.securityCode;
    assert.equal(code.length, 10);
    assert.equal(payload.data.securityCodeHash, undefined);
    assert.equal(payload.data.encryptedDek, undefined);
    assert.equal(events.some(event => JSON.stringify(event).includes(code)), false);
    const repeated = await request('/conversations', 'owner', { type: 'private', memberIds: [partner], isSecure: true });
    const repeatedPayload = await repeated.json();
    assert.equal(repeatedPayload.data.id, room.id);
    assert.equal(repeatedPayload.data.securityCode, undefined);
    const id = room.id;
    const missing = await request(`/conversations/${id}/unlock`, 'partner');
    assert.equal(missing.status, 403);
    const wrong = await request(`/conversations/${id}/unlock`, 'partner', {}, 'BadCode12!');
    assert.equal(wrong.status, 403);
    const notMember = await request(`/conversations/${id}/unlock`, 'outsider', {}, code);
    assert.equal(notMember.status, 403);
    const unlocked = await request(`/conversations/${id}/unlock`, 'partner', {}, code);
    assert.equal(unlocked.status, 200);
    const deniedDestroy = await request(`/conversations/${id}/security/destroy`, 'partner', {}, code);
    assert.equal(deniedDestroy.status, 403);
    const destroyed = await request(`/conversations/${id}/security/destroy`, 'owner', {}, code);
    assert.equal(destroyed.status, 200);
    assert.equal(room.encryptedDek, null);
    assert.equal(room.isSecure, true);
    const cannotReopen = await request(`/conversations/${id}/unlock`, 'partner', {}, code);
    assert.equal(cannotReopen.status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    originals.reverse().forEach(restore => restore());
  }
});

test('secure attachments: binary PSEC1 encrypt/decrypt, S3 encrypted upload, and crypto-erasure deletes S3 & DB records', async () => {
  const { Readable } = require('node:stream');
  const { randomUUID } = require('node:crypto');
  const s3Service = require('../src/services/s3.service');
  const socket = require('../src/services/socket.service');
  const publisher = require('../src/services/sse_publisher.service');
  const S3Asset = require('../src/models/s3_asset.model');
  const { ConversationMember, MessageAttachment } = require('../src/models/chat');

  const conversationId = randomUUID();
  const ownerId = randomUUID();
  const attachmentId = randomUUID();
  const code = security.generateCode();
  const generated = cryptoService.generateConversationDek(conversationId);
  const sealedDek = await security.seal(generated.encryptedDek, code, conversationId);
  const codeHash = await bcrypt.hash(code, 4);

  const plainAudio = Buffer.from('REAL-WEBM-AUDIO-BYTES-1234567890');
  const directEnc = cryptoService.encryptAttachmentBuffer({
    dek: generated.dek,
    conversationId,
    s3Key: 'chat-attachments/secure/test.enc',
    buffer: plainAudio,
  });
  assert.equal(directEnc.subarray(0, 5).toString('ascii'), 'PSEC1');
  assert.equal(directEnc.includes(plainAudio), false);
  assert.deepEqual(
    cryptoService.decryptAttachmentBuffer({
      dek: generated.dek,
      conversationId,
      s3Key: 'chat-attachments/secure/test.enc',
      encryptedBuffer: directEnc,
    }),
    plainAudio,
  );
  assert.throws(() =>
    cryptoService.decryptAttachmentBuffer({
      dek: generated.dek,
      conversationId: 'wrong-room',
      s3Key: 'chat-attachments/secure/test.enc',
      encryptedBuffer: directEnc,
    }),
  );

  const s3Objects = new Map();
  const deletedKeys = [];
  let s3AssetDestroyCount = 0;
  let attachmentDestroyCount = 0;
  const originals = [];
  const stub = (object, key, value) => {
    originals.push(() => { object[key] = value; });
    object[key] = value;
  };

  const room = {
    id: conversationId,
    isSecure: true,
    createdBy: ownerId,
    dekVersion: generated.dekVersion,
    encryptedDek: sealedDek,
    securityCodeHash: codeHash,
    async update(patch) { Object.assign(this, patch); },
  };

  let uploadedMeta = null;
  stub(Conversation, 'findByPk', async (id) => (id === conversationId ? room : null));
  stub(ConversationMember, 'findOne', async (q) =>
    q.where.userId === ownerId ? { userId: ownerId, role: 'owner' } : null,
  );
  stub(ConversationMember, 'findAll', async () => [{ userId: ownerId }]);
  stub(s3Service, 'upload', async ({ key, body, mimeType, originalName }) => {
    uploadedMeta = { key, mimeType, originalName };
    s3Objects.set(key, Buffer.from(body));
    return { key, url: `https://s3.test/${key}`, record: { assetId: 'asset-uuid-1' } };
  });
  stub(s3Service, 'getDownloadStream', async (key) => ({
    Body: Readable.from([s3Objects.get(key)]),
  }));
  stub(s3Service, 'deleteAndRecord', async (key) => {
    deletedKeys.push(key);
    s3Objects.delete(key);
    return { deletedRecord: true };
  });
  stub(S3Asset, 'destroy', async () => { s3AssetDestroyCount += 1; return 1; });
  stub(socket, 'emitToConversationAndUsers', () => {});
  stub(publisher, 'publishToUsers', async () => {});

  try {
    const uploaded = await security.context.run(store(conversationId, code), () =>
      ChatService.uploadChatAttachment(conversationId, ownerId, {
        buffer: plainAudio,
        originalName: 'secret-voice.webm',
        mimeType: 'audio/webm',
        fileSize: plainAudio.length,
        durationMs: 4200,
      }),
    );

    assert.equal(uploaded.isEncrypted, true);
    assert.equal(uploaded.fileName, 'secret-voice.webm');
    assert.equal(uploaded.fileType, 'audio');
    assert.equal(uploaded.mimeType, 'audio/webm');
    assert.equal(uploaded.durationMs, 4200);
    assert.equal(uploadedMeta.mimeType, 'application/octet-stream');
    assert.equal(uploadedMeta.originalName.includes('secret-voice'), false);
    assert.equal(s3Objects.get(uploaded.s3Key).subarray(0, 5).toString('ascii'), 'PSEC1');

    const attRow = {
      id: attachmentId,
      messageId: randomUUID(),
      fileName: uploaded.fileName,
      fileUrl: uploaded.fileUrl,
      s3AssetId: uploaded.s3AssetId,
      s3Key: uploaded.s3Key,
      fileType: uploaded.fileType,
      mimeType: uploaded.mimeType,
      fileSize: uploaded.fileSize,
      isEncrypted: true,
      message: { id: randomUUID(), conversationId, deletedAt: null, isRecalled: false },
    };

    const hydrated = ChatService.hydrateMessage(
      {
        id: randomUUID(),
        conversationId,
        senderId: ownerId,
        content: null,
        attachments: [attRow],
      },
      generated.dek,
    );
    assert.equal(
      hydrated.attachments[0].fileUrl,
      `/api/v1/chat/conversations/${conversationId}/attachments/${attachmentId}/content`,
    );

    stub(MessageAttachment, 'findByPk', async (id) => (id === attachmentId ? attRow : null));
    stub(MessageAttachment, 'findAll', async () => [attRow]);
    stub(MessageAttachment, 'destroy', async () => { attachmentDestroyCount += 1; return 1; });

    await assert.rejects(
      ChatService.getSecureAttachmentContent(conversationId, attachmentId, ownerId),
    );
    const decrypted = await security.context.run(store(conversationId, code), () =>
      ChatService.getSecureAttachmentContent(conversationId, attachmentId, ownerId),
    );
    assert.deepEqual(decrypted.buffer, plainAudio);
    assert.equal(decrypted.fileName, 'secret-voice.webm');
    assert.equal(decrypted.mimeType, 'audio/webm');

    const destroyRes = await security.context.run(store(conversationId, code), () =>
      ChatService.destroyRoomSecurity(conversationId, ownerId),
    );
    assert.equal(destroyRes.destroyed, true);
    assert.equal(destroyRes.deletedAttachmentCount, 1);
    assert.deepEqual(deletedKeys, [uploaded.s3Key]);
    assert.equal(s3Objects.size, 0);
    assert.equal(s3AssetDestroyCount, 1);
    assert.equal(attachmentDestroyCount, 1);
    assert.equal(room.encryptedDek, null);
    assert.equal(room.securityCodeHash, null);
  } finally {
    originals.reverse().forEach(restore => restore());
  }
});
