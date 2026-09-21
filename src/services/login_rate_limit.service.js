"use strict";

const crypto = require("crypto");
const redis = require("../config/redis.config");
const appConfig = require("../config/app.config");
const ErrorCodes = require("../common/exceptions/error_codes");
const { BaseException } = require("../common/exceptions/BaseException");

const RECORD_FAILURE_SCRIPT = `
local ipCount = redis.call('INCR', KEYS[1])
if ipCount == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local accountCount = redis.call('INCR', KEYS[2])
if accountCount == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end

local ipTtl = redis.call('TTL', KEYS[1])
local accountTtl = redis.call('TTL', KEYS[2])
local limited = ipCount >= tonumber(ARGV[2]) or accountCount >= tonumber(ARGV[3])

return {
  limited and 'LIMITED' or 'RECORDED',
  tostring(math.max(ipTtl, accountTtl)),
  tostring(ipCount),
  tostring(accountCount)
}
`;

class LoginRateLimitService {
  static get config() {
    return appConfig.auth.loginRateLimit;
  }

  static hash(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
  }

  static keys({ email, ipAddress }) {
    return {
      ipKey: `auth:login-rate:ip:${this.hash(ipAddress)}`,
      accountKey: `auth:login-rate:account:${this.hash(String(email).toLowerCase())}`,
    };
  }

  static rateLimitError(retryAfter) {
    return new BaseException(ErrorCodes.AUTH_LOGIN_RATE_LIMITED, {
      retryAfter: Math.max(1, Number(retryAfter) || this.config.windowSeconds),
    });
  }

  static async assertAllowed(context) {
    if (!this.config.enabled) return;

    try {
      const { ipKey, accountKey } = this.keys(context);
      const pipeline = redis.pipeline();
      pipeline.get(ipKey).ttl(ipKey).get(accountKey).ttl(accountKey);
      const results = await pipeline.exec();
      const ipCount = Number(results?.[0]?.[1] || 0);
      const ipTtl = Number(results?.[1]?.[1] || 0);
      const accountCount = Number(results?.[2]?.[1] || 0);
      const accountTtl = Number(results?.[3]?.[1] || 0);

      if (
        ipCount >= this.config.maxAttemptsPerIp ||
        accountCount >= this.config.maxAttemptsPerAccount
      ) {
        throw this.rateLimitError(Math.max(ipTtl, accountTtl));
      }
    } catch (error) {
      if (error instanceof BaseException) throw error;
      console.warn(
        "[AUTH RATE LIMIT]: Redis unavailable, allowing login attempt.",
      );
    }
  }

  static async recordFailure(context) {
    if (!this.config.enabled) return;

    try {
      const { ipKey, accountKey } = this.keys(context);
      const [status, retryAfter] = await redis.eval(
        RECORD_FAILURE_SCRIPT,
        2,
        ipKey,
        accountKey,
        this.config.windowSeconds,
        this.config.maxAttemptsPerIp,
        this.config.maxAttemptsPerAccount,
      );
      if (status === "LIMITED") throw this.rateLimitError(retryAfter);
    } catch (error) {
      if (error instanceof BaseException) throw error;
      console.warn("[AUTH RATE LIMIT]: Could not record failed login attempt.");
    }
  }

  static async clearAccountFailures(context) {
    if (!this.config.enabled) return;

    try {
      const { accountKey } = this.keys(context);
      await redis.del(accountKey);
    } catch (_error) {
      console.warn("[AUTH RATE LIMIT]: Could not clear account failures.");
    }
  }
}

module.exports = LoginRateLimitService;
