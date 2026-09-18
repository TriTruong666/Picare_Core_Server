"use strict";

const crypto = require("crypto");
const redis = require("../config/redis.config");
const appConfig = require("../config/app.config");
const ErrorCodes = require("../common/exceptions/error_codes");
const {
  BaseException,
  BadRequestException,
  UnauthorizedException,
} = require("../common/exceptions/BaseException");
const MailService = require("./mail.service");

const VERIFY_SCRIPT = `
local challengeKey = KEYS[1]
local pointerKey = KEYS[2]
local expectedIp = ARGV[1]
local submittedHash = ARGV[2]
local maxAttempts = tonumber(ARGV[3])
local challengeId = ARGV[4]

if redis.call('EXISTS', challengeKey) == 0 then
  return {'EXPIRED'}
end

if redis.call('HGET', challengeKey, 'ipAddress') ~= expectedIp then
  return {'IP_MISMATCH'}
end

if redis.call('HGET', challengeKey, 'codeHash') ~= submittedHash then
  local attempts = redis.call('HINCRBY', challengeKey, 'attempts', 1)
  if attempts >= maxAttempts then
    redis.call('DEL', challengeKey)
    if redis.call('GET', pointerKey) == challengeId then
      redis.call('DEL', pointerKey)
    end
    return {'ATTEMPTS_EXCEEDED'}
  end
  return {'INVALID', tostring(maxAttempts - attempts)}
end

local userId = redis.call('HGET', challengeKey, 'userId')
redis.call('DEL', challengeKey)
if redis.call('GET', pointerKey) == challengeId then
  redis.call('DEL', pointerKey)
end
return {'VERIFIED', userId}
`;

const RESEND_SCRIPT = `
local challengeKey = KEYS[1]
local pointerKey = KEYS[2]
local cooldownKey = KEYS[3]
local expectedIp = ARGV[1]
local codeHash = ARGV[2]
local now = tonumber(ARGV[3])
local cooldownMs = tonumber(ARGV[4])
local maxResends = tonumber(ARGV[5])
local ttlSeconds = tonumber(ARGV[6])
local challengeId = ARGV[7]

if redis.call('EXISTS', challengeKey) == 0 then
  return {'EXPIRED'}
end

if redis.call('HGET', challengeKey, 'ipAddress') ~= expectedIp then
  return {'IP_MISMATCH'}
end

local resendCount = tonumber(redis.call('HGET', challengeKey, 'resendCount') or '0')
if resendCount >= maxResends then
  return {'RESEND_LIMIT'}
end

local lastSentAt = tonumber(redis.call('HGET', challengeKey, 'lastSentAt') or '0')
if now - lastSentAt < cooldownMs then
  return {'TOO_SOON', tostring(math.ceil((cooldownMs - (now - lastSentAt)) / 1000))}
end

redis.call('HSET', challengeKey,
  'codeHash', codeHash,
  'attempts', '0',
  'resendCount', tostring(resendCount + 1),
  'lastSentAt', tostring(now)
)
redis.call('EXPIRE', challengeKey, ttlSeconds)
if redis.call('GET', pointerKey) == challengeId then
  redis.call('EXPIRE', pointerKey, ttlSeconds)
end
redis.call('SET', cooldownKey, '1', 'EX', math.ceil(cooldownMs / 1000))
return {'RESENT', redis.call('HGET', challengeKey, 'userId')}
`;

class LoginVerificationService {
  static get config() {
    return appConfig.auth.loginVerification;
  }

  static challengeKey(challengeId) {
    return `auth:login-verification:challenge:${challengeId}`;
  }

  static pointerKey(userId) {
    const identityHash = crypto
      .createHash("sha256")
      .update(String(userId))
      .digest("hex");
    return `auth:login-verification:active:${identityHash}`;
  }

  static cooldownKey(userId) {
    const identityHash = crypto
      .createHash("sha256")
      .update(String(userId))
      .digest("hex");
    return `auth:login-verification:cooldown:${identityHash}`;
  }

  static assertConfigured() {
    if (!this.config.otpSecret) {
      throw new BaseException(ErrorCodes.AUTH_OTP_CONFIG_MISSING);
    }
  }

  static generateCode() {
    return String(crypto.randomInt(100000, 1000000));
  }

  static hashCode(challengeId, code) {
    this.assertConfigured();
    return crypto
      .createHmac("sha256", this.config.otpSecret)
      .update(`${challengeId}:${code}`)
      .digest("hex");
  }

  static maskEmail(email) {
    const [localPart, domain] = String(email).split("@");
    if (!localPart || !domain) return "***";
    return `${localPart.slice(0, 1)}***@${domain}`;
  }

  static async createChallenge({ user, ipAddress }) {
    this.assertConfigured();

    const cooldownKey = this.cooldownKey(user.userId);
    const acquired = await redis.set(
      cooldownKey,
      "1",
      "EX",
      this.config.resendCooldownSeconds,
      "NX",
    );

    if (!acquired) {
      throw new BaseException(ErrorCodes.AUTH_VERIFICATION_RESEND_TOO_SOON);
    }

    const challengeId = crypto.randomUUID();
    const code = this.generateCode();
    const challengeKey = this.challengeKey(challengeId);
    const pointerKey = this.pointerKey(user.userId);
    const previousChallengeId = await redis.get(pointerKey);

    if (previousChallengeId) {
      await redis.del(this.challengeKey(previousChallengeId));
    }

    const now = Date.now();
    await redis
      .multi()
      .hset(challengeKey, {
        userId: user.userId,
        codeHash: this.hashCode(challengeId, code),
        ipAddress,
        attempts: "0",
        resendCount: "0",
        lastSentAt: String(now),
      })
      .expire(challengeKey, this.config.ttlSeconds)
      .set(pointerKey, challengeId, "EX", this.config.ttlSeconds)
      .exec();

    try {
      await MailService.sendLoginVerificationMail({
        to: user.email,
        code,
        expiresInMinutes: Math.ceil(this.config.ttlSeconds / 60),
        ipAddress,
      });
    } catch (error) {
      await redis.del(challengeKey, pointerKey, cooldownKey);
      throw error;
    }

    return {
      challengeId,
      expiresIn: this.config.ttlSeconds,
      resendAfter: this.config.resendCooldownSeconds,
      maskedEmail: this.maskEmail(user.email),
    };
  }

  static async verifyChallenge({ challengeId, code, ipAddress }) {
    const challengeKey = this.challengeKey(challengeId);
    const userId = await redis.hget(challengeKey, "userId");
    const pointerKey = userId
      ? this.pointerKey(userId)
      : "auth:login-verification:active:missing";
    const result = await redis.eval(
      VERIFY_SCRIPT,
      2,
      challengeKey,
      pointerKey,
      ipAddress,
      this.hashCode(challengeId, code),
      this.config.maxAttempts,
      challengeId,
    );

    const [status, value] = result;
    if (status === "VERIFIED") return { userId: value };
    if (status === "IP_MISMATCH") {
      throw new UnauthorizedException(ErrorCodes.AUTH_VERIFICATION_IP_MISMATCH);
    }
    if (status === "ATTEMPTS_EXCEEDED") {
      throw new BaseException(ErrorCodes.AUTH_VERIFICATION_ATTEMPTS_EXCEEDED);
    }
    if (status === "INVALID") {
      throw new BadRequestException(ErrorCodes.AUTH_VERIFICATION_INVALID, {
        attemptsRemaining: Number(value),
      });
    }

    throw new BadRequestException(ErrorCodes.AUTH_VERIFICATION_EXPIRED);
  }

  static async resendChallenge({ challengeId, ipAddress, findUserById }) {
    const challengeKey = this.challengeKey(challengeId);
    const challengeUserId = await redis.hget(challengeKey, "userId");
    if (!challengeUserId) {
      throw new BadRequestException(ErrorCodes.AUTH_VERIFICATION_EXPIRED);
    }

    const pointerKey = this.pointerKey(challengeUserId);
    const cooldownKey = this.cooldownKey(challengeUserId);
    const code = this.generateCode();
    const result = await redis.eval(
      RESEND_SCRIPT,
      3,
      challengeKey,
      pointerKey,
      cooldownKey,
      ipAddress,
      this.hashCode(challengeId, code),
      Date.now(),
      this.config.resendCooldownSeconds * 1000,
      this.config.maxResends,
      this.config.ttlSeconds,
      challengeId,
    );

    const [status, value] = result;
    if (status === "IP_MISMATCH") {
      throw new UnauthorizedException(ErrorCodes.AUTH_VERIFICATION_IP_MISMATCH);
    }
    if (status === "TOO_SOON") {
      throw new BaseException(ErrorCodes.AUTH_VERIFICATION_RESEND_TOO_SOON, {
        retryAfter: Number(value),
      });
    }
    if (status === "RESEND_LIMIT") {
      throw new BaseException(ErrorCodes.AUTH_VERIFICATION_RESEND_LIMIT);
    }
    if (status !== "RESENT") {
      throw new BadRequestException(ErrorCodes.AUTH_VERIFICATION_EXPIRED);
    }

    const user = await findUserById(value);
    if (!user) {
      await redis.del(challengeKey, pointerKey, cooldownKey);
      throw new BadRequestException(ErrorCodes.AUTH_VERIFICATION_EXPIRED);
    }

    try {
      await MailService.sendLoginVerificationMail({
        to: user.email,
        code,
        expiresInMinutes: Math.ceil(this.config.ttlSeconds / 60),
        ipAddress,
      });
    } catch (error) {
      await redis.del(challengeKey, pointerKey, cooldownKey);
      throw error;
    }

    return {
      challengeId,
      expiresIn: await redis.ttl(challengeKey),
      resendAfter: this.config.resendCooldownSeconds,
      maskedEmail: this.maskEmail(user.email),
    };
  }
}

module.exports = LoginVerificationService;
