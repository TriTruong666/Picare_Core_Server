const { createHash } = require("node:crypto");
const redis = require("../config/redis.config");

const WINDOW_SECONDS = 60;
const MAX_PER_USER = 5;
const LEASE_SECONDS = 95;
const REDIS_TIMEOUT_MS = 2000;
const LEASE_KEY = "ocr:inference:lease";
const limits = new Map();
let localActive = false;

const ADMIT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 'BUSY' end
local count = tonumber(redis.call('GET', KEYS[2]) or '0')
if count >= tonumber(ARGV[2]) then return 'LIMITED' end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])
count = redis.call('INCR', KEYS[2])
if count == 1 then redis.call('EXPIRE', KEYS[2], ARGV[3]) end
return 'ADMITTED'
`;
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

function userKey(userId) {
  return `ocr:rate:user:${createHash("sha256").update(userId).digest("hex")}`;
}

function withTimeout(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("OCR Redis timeout"), { code: "OCR_REDIS_TIMEOUT" })),
        REDIS_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

function localAdmit(userId) {
  const now = Date.now();
  for (const [key, value] of limits)
    if (value.until <= now) limits.delete(key);
  const limit = limits.get(userId) || { count: 0, until: now + WINDOW_SECONDS * 1000 };
  if (limit.count >= MAX_PER_USER || limits.size >= 10000) return "LIMITED";
  limit.count++;
  limits.set(userId, limit);
  return "ADMITTED";
}

async function admit(userId, requestId) {
  if (localActive) return { status: "BUSY" };
  localActive = true;
  let redisLease = false;
  try {
    if (redis.status === "ready") {
      try {
        const status = await withTimeout(redis.eval(
          ADMIT, 2, LEASE_KEY, userKey(userId), requestId,
          MAX_PER_USER, WINDOW_SECONDS, LEASE_SECONDS,
        ));
        if (status !== "ADMITTED") {
          localActive = false;
          return { status };
        }
        redisLease = true;
      } catch (error) {
        if (error.code === "OCR_REDIS_TIMEOUT") {
          localActive = false;
          return { status: "BUSY" };
        }
        console.warn("[ocr] admission=redis_unavailable fallback=local");
      }
    }
    if (!redisLease) {
      const status = localAdmit(userId);
      if (status !== "ADMITTED") {
        localActive = false;
        return { status };
      }
    }
    return { status: "ADMITTED", redisLease };
  } catch (error) {
    localActive = false;
    throw error;
  }
}

async function release(requestId, redisLease) {
  try {
    if (redisLease && redis.status === "ready") {
      try {
        await withTimeout(redis.eval(RELEASE, 1, LEASE_KEY, requestId));
      } catch (_error) {
        console.warn("[ocr] admission=release_failed lease_expires_s=95");
      }
    }
  } finally {
    localActive = false;
  }
}

module.exports = { admit, release };
