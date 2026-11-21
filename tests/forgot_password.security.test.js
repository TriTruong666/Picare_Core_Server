"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const mockModule = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { filename, id: filename, loaded: true, exports };
};

const kv = new Map();
const hashes = new Map();
const sentMails = [];
const disconnected = [];
let currentUser = null;

const redisMock = {
  async set(key, value, ...args) {
    const hasNx = args.includes("NX");
    if (hasNx && kv.has(key)) return null;
    kv.set(key, String(value));
    return "OK";
  },
  async get(key) {
    return kv.has(key) ? kv.get(key) : null;
  },
  async ttl() {
    return 60;
  },
  async hget(key, field) {
    return hashes.get(key)?.get(field) ?? null;
  },
  async del(...keys) {
    for (const k of keys) {
      kv.delete(k);
      hashes.delete(k);
    }
    return 1;
  },
  multi() {
    const ops = [];
    const chain = {
      hset(key, obj) {
        ops.push(() => {
          const map = new Map();
          for (const [k, v] of Object.entries(obj)) map.set(k, String(v));
          hashes.set(key, map);
        });
        return chain;
      },
      expire() {
        return chain;
      },
      set(key, val) {
        ops.push(() => kv.set(key, String(val)));
        return chain;
      },
      async exec() {
        for (const op of ops) op();
        return [];
      },
    };
    return chain;
  },
  async eval(script, _numKeys, ...args) {
    if (script.includes("submittedHash")) {
      const [challengeKey, pointerKey, submittedHash, maxAttemptsStr, challengeId] = args;
      const challenge = hashes.get(challengeKey);
      if (!challenge) return ["EXPIRED"];
      if (challenge.get("codeHash") !== submittedHash) {
        const attempts = Number(challenge.get("attempts") || 0) + 1;
        challenge.set("attempts", String(attempts));
        const maxAttempts = Number(maxAttemptsStr);
        if (attempts >= maxAttempts) {
          hashes.delete(challengeKey);
          if (kv.get(pointerKey) === challengeId) kv.delete(pointerKey);
          return ["ATTEMPTS_EXCEEDED"];
        }
        return ["INVALID", String(maxAttempts - attempts)];
      }
      const userId = challenge.get("userId");
      hashes.delete(challengeKey);
      if (kv.get(pointerKey) === challengeId) kv.delete(pointerKey);
      return ["VERIFIED", userId];
    }

    if (script.includes("resendCount")) {
      const [challengeKey, _pointerKey, cooldownKey, codeHash, nowStr, cooldownMsStr, maxResendsStr] = args;
      const challenge = hashes.get(challengeKey);
      if (!challenge) return ["EXPIRED"];
      const resendCount = Number(challenge.get("resendCount") || 0);
      if (resendCount >= Number(maxResendsStr)) return ["RESEND_LIMIT"];
      const now = Number(nowStr);
      const lastSentAt = Number(challenge.get("lastSentAt") || 0);
      const cooldownMs = Number(cooldownMsStr);
      if (now - lastSentAt < cooldownMs) {
        return ["TOO_SOON", String(Math.ceil((cooldownMs - (now - lastSentAt)) / 1000))];
      }
      challenge.set("codeHash", codeHash);
      challenge.set("attempts", "0");
      challenge.set("resendCount", String(resendCount + 1));
      challenge.set("lastSentAt", String(now));
      kv.set(cooldownKey, "1");
      return ["RESENT", challenge.get("userId")];
    }

    // Consume resetToken
    const [tokenKey] = args;
    const userId = kv.get(tokenKey) ?? null;
    if (!userId) return null;
    kv.delete(tokenKey);
    return userId;
  },
};

mockModule("../src/config/redis.config", redisMock);
mockModule("../src/models/user.model", {
  async findOne() {
    return currentUser;
  },
});
mockModule("../src/services/mail.service", {
  async sendPasswordResetMail(payload) {
    sentMails.push(payload);
  },
});
mockModule("../src/services/socket.service", {
  disconnectUser(userId, reason) {
    disconnected.push({ userId, reason });
    return 1;
  },
});

const appConfig = require("../src/config/app.config");
appConfig.auth.loginVerification.otpSecret = "test-otp-secret";
const PasswordResetService = require("../src/services/password_reset.service");

test("forgot-password sends 6-digit OTP, verifies once, and issues single-use resetToken", async () => {
  kv.clear();
  hashes.clear();
  sentMails.length = 0;
  disconnected.length = 0;

  let updatedPassword = null;
  currentUser = {
    userId: "user-reset-1",
    email: "member@picare.vn",
    status: "ACTIVE",
    async comparePassword(candidate) {
      return candidate === "oldpass123";
    },
    async update(patch) {
      updatedPassword = patch.password;
    },
  };

  const challenge = await PasswordResetService.requestReset({
    email: "Member@Picare.vn ",
    ipAddress: "::ffff:127.0.0.1",
  });

  assert.ok(challenge.challengeId);
  assert.equal(challenge.maskedEmail, "m***@picare.vn");
  assert.equal(sentMails.length, 1);
  assert.match(sentMails[0].code, /^\d{6}$/);

  // Wrong code decrements attempts
  await assert.rejects(
    PasswordResetService.verifyResetCode({
      challengeId: challenge.challengeId,
      code: "000000",
    }),
    (err) => err.errorCode === "ERR_AUTH_017",
  );

  // Valid code returns resetToken
  const verified = await PasswordResetService.verifyResetCode({
    challengeId: challenge.challengeId,
    code: sentMails[0].code,
  });
  assert.ok(verified.resetToken);

  // Reusing OTP fails
  await assert.rejects(
    PasswordResetService.verifyResetCode({
      challengeId: challenge.challengeId,
      code: sentMails[0].code,
    }),
    (err) => err.errorCode === "ERR_AUTH_018",
  );

  // Resetting to same password is rejected (after token consumed)
  const freshTokenKey = PasswordResetService.resetTokenKey(crypto.randomUUID());
  await redisMock.set(freshTokenKey, currentUser.userId);
  await assert.rejects(
    PasswordResetService.resetPassword({
      resetToken: freshTokenKey.split(":").pop(),
      newPassword: "oldpass123",
    }),
    (err) => err.errorCode === "ERR_AUTH_005",
  );

  // Resetting with verified resetToken updates password and disconnects sockets
  const done = await PasswordResetService.resetPassword({
    resetToken: verified.resetToken,
    newPassword: "newSecret999",
  });
  assert.equal(updatedPassword, "newSecret999");
  assert.deepEqual(disconnected, [
    { userId: "user-reset-1", reason: "password_reset" },
  ]);
  assert.ok(done.message);

  // ResetToken is single-use
  await assert.rejects(
    PasswordResetService.resetPassword({
      resetToken: verified.resetToken,
      newPassword: "anotherSecret",
    }),
    (err) => err.errorCode === "ERR_AUTH_018",
  );
});
