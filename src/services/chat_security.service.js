const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { AsyncLocalStorage } = require("node:async_hooks");
const bcrypt = require("bcrypt");
const scrypt = promisify(crypto.scrypt);
const context = new AsyncLocalStorage();
const { ForbiddenException } = require("../common/exceptions/BaseException");
const deny = () => { throw new ForbiddenException("CHAT_SECURITY_CODE_REQUIRED"); };
const security = {
  context,
  deny,
  generateCode() {
    const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*?"];
    const all = groups.join("");
    const chars = groups.map(g => g[crypto.randomInt(g.length)]);
    while (chars.length < 10) chars.push(all[crypto.randomInt(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
  },
  async seal(value, code, id) {
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
    const key = await scrypt(code, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    try {
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(`secure-chat:${id}:v1`));
      const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return ["secure1", salt.toString("base64"), iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
    } finally { key.fill(0); }
  },
  async open(conversation) {
    const store = context.getStore();
    if (!store?.code || store.conversationId !== conversation.id) return deny();
    if (store.keys?.has(conversation.id)) return store.keys.get(conversation.id);
    if (!await bcrypt.compare(store.code, conversation.securityCodeHash || "")) return deny();
    const [version, salt, iv, tag, data] = String(conversation.encryptedDek || "").split(":");
    if (version !== "secure1" || !data) return deny();
    const key = await scrypt(store.code, Buffer.from(salt, "base64"), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
      decipher.setAAD(Buffer.from(`secure-chat:${conversation.id}:v1`));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      const wrapped = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
      store.keys ||= new Map(); store.keys.set(conversation.id, wrapped);
      return wrapped;
    } finally { key.fill(0); }
  },
  // Protected conversations never broadcast plaintext, even to other sessions of the sender.
  event(data) {
    const ids = context.getStore()?.secureIds;
    const id = data?.conversationId || data?.id;
    if (data?.isSecure || ids?.has(id)) return { conversationId: id, id, isSecure: true, requiresUnlock: true };
    return data;
  },
};
module.exports = security;
