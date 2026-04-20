const crypto = require("crypto");
const dayjs = require("dayjs");

/**
 * Delay execution for a specified time
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find null or undefined fields in an object
 */
function findNullFields(obj) {
  return Object.entries(obj)
    .filter(([_, v]) => v === null || v === undefined)
    .map(([k]) => k);
}

/**
 * Safely parse JSON strings
 */
function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Create HMAC SHA256 hash
 */
function createHmacSHA256(data, secretKey) {
  return crypto.createHmac("sha256", secretKey).update(data).digest("hex");
}

module.exports = {
  delay,
  findNullFields,
  safeJsonParse,
  createHmacSHA256,
};
