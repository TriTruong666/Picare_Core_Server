"use strict";

const crypto = require("crypto");
const redis = require("../config/redis.config");
const appConfig = require("../config/app.config");
const User = require("../models/user.model");
const MailService = require("./mail.service");
const SocketService = require("./socket.service");
const ErrorCodes = require("../common/exceptions/error_codes");
const { USER_STATUS } = require("../common/enum/user.enum");
const { normalizeIpAddress } = require("../utils/ip.util");
const {
  BaseException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} = require("../common/exceptions/BaseException");

const VERIFY_RESET_SCRIPT = `
local challengeKey = KEYS[1]
local pointerKey = KEYS[2]
local submittedHash = ARGV[1]
local maxAttempts = tonumber(ARGV[2])
local challengeId = ARGV[3]

if redis.call('EXISTS', challengeKey) == 0 then
  return {'EXPIRED'}
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

const RESEND_RESET_SCRIPT = `
local challengeKey = KEYS[1]
local pointerKey = KEYS[2]
local cooldownKey = KEYS[3]
local codeHash = ARGV[1]
local now = tonumber(ARGV[2])
local cooldownMs = tonumber(ARGV[3])
local maxResends = tonumber(ARGV[4])
local ttlSeconds = tonumber(ARGV[5])
local challengeId = ARGV[6]

if redis.call('EXISTS', challengeKey) == 0 then
  return {'EXPIRED'}
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

const CONSUME_RESET_TOKEN_SCRIPT = `
local tokenKey = KEYS[1]
local userId = redis.call('GET', tokenKey)
if not userId then
  return nil
end
redis.call('DEL', tokenKey)
return userId
`;

const RESET_TOKEN_TTL_SECONDS = 10 * 60;

class PasswordResetService {
  static get config() {
    return appConfig.auth.loginVerification;
  }

  static identityHash(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
  }

  static challengeKey(challengeId) {
    return `auth:password-reset:challenge:${challengeId}`;
  }

  static pointerKey(userId) {
    return `auth:password-reset:active:${this.identityHash(userId)}`;
  }

  static cooldownKey(userId) {
    return `auth:password-reset:cooldown:${this.identityHash(userId)}`;
  }

  static resetTokenKey(resetToken) {
    return `auth:password-reset:token:${resetToken}`;
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
      .update(`pwd-reset:${challengeId}:${code}`)
      .digest("hex");
  }

  static maskEmail(email) {
    const [localPart, domain] = String(email).split("@");
    if (!localPart || !domain) return "***";
    return `${localPart.slice(0, 1)}***@${domain}`;
  }

  /**
   * Step 1: Request a 6-digit OTP to reset password for a registered email.
   */
  static async requestReset({ email, ipAddress }) {
    this.assertConfigured();

    const normalizedEmail = String(email || "")
      .trim()
      .toLowerCase();
    const normalizedIpAddress = normalizeIpAddress(ipAddress);

    const user = await User.findOne({ where: { email: normalizedEmail } });
    if (!user) {
      throw new NotFoundException(
        ErrorCodes.USER_NOT_FOUND,
        "Email chưa được đăng ký trong hệ thống",
      );
    }

    if (user.status !== USER_STATUS.ACTIVE) {
      throw new ForbiddenException(ErrorCodes.AUTH_ACCOUNT_INACTIVE);
    }

    const cooldownKey = this.cooldownKey(user.userId);
    const acquired = await redis.set(
      cooldownKey,
      "1",
      "EX",
      this.config.resendCooldownSeconds,
      "NX",
    );

    if (!acquired) {
      const retryAfter = await redis.ttl(cooldownKey);
      throw new BaseException(ErrorCodes.AUTH_PASSWORD_RESET_RESEND_TOO_SOON, {
        retryAfter: Math.max(1, Number(retryAfter) || this.config.resendCooldownSeconds),
      });
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
        attempts: "0",
        resendCount: "0",
        lastSentAt: String(now),
      })
      .expire(challengeKey, this.config.ttlSeconds)
      .set(pointerKey, challengeId, "EX", this.config.ttlSeconds)
      .exec();

    try {
      await MailService.sendPasswordResetMail({
        to: user.email,
        code,
        expiresInMinutes: Math.ceil(this.config.ttlSeconds / 60),
        ipAddress: normalizedIpAddress,
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

  /**
   * Step 2: Verify the 6-digit OTP and issue a short-lived single-use resetToken.
   */
  static async verifyResetCode({ challengeId, code }) {
    this.assertConfigured();

    const challengeKey = this.challengeKey(challengeId);
    const userId = await redis.hget(challengeKey, "userId");
    const pointerKey = userId
      ? this.pointerKey(userId)
      : "auth:password-reset:active:missing";

    const result = await redis.eval(
      VERIFY_RESET_SCRIPT,
      2,
      challengeKey,
      pointerKey,
      this.hashCode(challengeId, code),
      this.config.maxAttempts,
      challengeId,
    );

    const [status, value] = result;
    if (status === "ATTEMPTS_EXCEEDED") {
      throw new BaseException(ErrorCodes.AUTH_PASSWORD_RESET_ATTEMPTS_EXCEEDED);
    }
    if (status === "INVALID") {
      throw new BadRequestException(ErrorCodes.AUTH_PASSWORD_RESET_INVALID, {
        attemptsRemaining: Number(value),
      });
    }
    if (status !== "VERIFIED" || !value) {
      throw new BadRequestException(ErrorCodes.AUTH_PASSWORD_RESET_EXPIRED);
    }

    const resetToken = crypto.randomUUID();
    await redis.set(
      this.resetTokenKey(resetToken),
      value,
      "EX",
      RESET_TOKEN_TTL_SECONDS,
    );

    return {
      resetToken,
      expiresIn: RESET_TOKEN_TTL_SECONDS,
    };
  }

  /**
   * Optional resend of the 6-digit password reset OTP.
   */
  static async resendResetCode({ challengeId, ipAddress }) {
    this.assertConfigured();

    const challengeKey = this.challengeKey(challengeId);
    const challengeUserId = await redis.hget(challengeKey, "userId");
    if (!challengeUserId) {
      throw new BadRequestException(ErrorCodes.AUTH_PASSWORD_RESET_EXPIRED);
    }

    const pointerKey = this.pointerKey(challengeUserId);
    const cooldownKey = this.cooldownKey(challengeUserId);
    const code = this.generateCode();

    const result = await redis.eval(
      RESEND_RESET_SCRIPT,
      3,
      challengeKey,
      pointerKey,
      cooldownKey,
      this.hashCode(challengeId, code),
      Date.now(),
      this.config.resendCooldownSeconds * 1000,
      this.config.maxResends,
      this.config.ttlSeconds,
      challengeId,
    );

    const [status, value] = result;
    if (status === "TOO_SOON") {
      throw new BaseException(ErrorCodes.AUTH_PASSWORD_RESET_RESEND_TOO_SOON, {
        retryAfter: Number(value),
      });
    }
    if (status === "RESEND_LIMIT") {
      throw new BaseException(ErrorCodes.AUTH_PASSWORD_RESET_RESEND_LIMIT);
    }
    if (status !== "RESENT") {
      throw new BadRequestException(ErrorCodes.AUTH_PASSWORD_RESET_EXPIRED);
    }

    const user = await User.findOne({ where: { userId: value } });
    if (!user) {
      await redis.del(challengeKey, pointerKey, cooldownKey);
      throw new BadRequestException(ErrorCodes.AUTH_PASSWORD_RESET_EXPIRED);
    }

    try {
      await MailService.sendPasswordResetMail({
        to: user.email,
        code,
        expiresInMinutes: Math.ceil(this.config.ttlSeconds / 60),
        ipAddress: normalizeIpAddress(ipAddress),
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

  /**
   * Step 3: Consume resetToken atomically and set the new password.
   */
  static async resetPassword({ resetToken, newPassword }) {
    const tokenKey = this.resetTokenKey(resetToken);
    const userId = await redis.eval(CONSUME_RESET_TOKEN_SCRIPT, 1, tokenKey);
    if (!userId) {
      throw new BadRequestException(ErrorCodes.AUTH_PASSWORD_RESET_EXPIRED);
    }

    const user = await User.findOne({ where: { userId } });
    if (!user) {
      throw new NotFoundException(ErrorCodes.USER_NOT_FOUND);
    }
    if (user.status !== USER_STATUS.ACTIVE) {
      throw new ForbiddenException(ErrorCodes.AUTH_ACCOUNT_INACTIVE);
    }

    const isSameAsCurrent = await user.comparePassword(newPassword);
    if (isSameAsCurrent) {
      throw new BadRequestException(
        ErrorCodes.AUTH_NEW_PASSWORD_MUST_DIFFERENT,
      );
    }

    await user.update({ password: newPassword });
    SocketService.disconnectUser(user.userId, "password_reset");

    return {
      message: "Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.",
    };
  }
}

module.exports = PasswordResetService;
