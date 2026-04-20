const redis = require("../config/redis.config");

/**
 * Key convention: picare:<module>:<resource>:<identifier>:<params>
 * Ví dụ: picare:haravan:orders:abc123:page=1&limit=20
 */

const DEFAULT_TTL = 1800; // 30 phút (khớp với cron sync interval)
const KEY_PREFIX = "picare";

class CacheService {
  /**
   * Tạo key chuẩn từ các phần tử
   * @param  {...string} parts - Các phần tử của key
   * @returns {string} Key hoàn chỉnh
   *
   * Ví dụ: buildKey("haravan", "orders", companyId, `page=${page}&limit=${limit}`)
   *       → "picare:haravan:orders:abc123:page=1&limit=20"
   */
  static buildKey(...parts) {
    return [KEY_PREFIX, ...parts].join(":");
  }

  /**
   * Lấy dữ liệu từ cache
   * @param {string} key
   * @returns {object|null} - Dữ liệu đã parse hoặc null nếu không tìm thấy
   */
  static async get(key) {
    try {
      const data = await redis.get(key);
      if (!data) return null;
      return JSON.parse(data);
    } catch (error) {
      console.error(`[CACHE]: Lỗi khi đọc key "${key}":`, error.message);
      return null;
    }
  }

  /**
   * Lưu dữ liệu vào cache
   * @param {string} key
   * @param {any} data - Dữ liệu cần cache (sẽ được JSON.stringify)
   * @param {number} ttl - Thời gian sống (giây), mặc định 30 phút
   */
  static async set(key, data, ttl = DEFAULT_TTL) {
    try {
      await redis.set(key, JSON.stringify(data), "EX", ttl);
    } catch (error) {
      console.error(`[CACHE]: Lỗi khi ghi key "${key}":`, error.message);
    }
  }

  /**
   * Xóa một key cụ thể
   * @param {string} key
   */
  static async del(key) {
    try {
      await redis.del(key);
    } catch (error) {
      console.error(`[CACHE]: Lỗi khi xóa key "${key}":`, error.message);
    }
  }

  /**
   * Xóa batch theo pattern sử dụng SCAN (an toàn cho production, không block Redis)
   * @param {string} pattern - Glob pattern, ví dụ: "picare:haravan:orders:abc123:*"
   */
  static async delByPattern(pattern) {
    try {
      let cursor = "0";
      let deletedCount = 0;

      do {
        const [newCursor, keys] = await redis.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100
        );
        cursor = newCursor;

        if (keys.length > 0) {
          await redis.del(...keys);
          deletedCount += keys.length;
        }
      } while (cursor !== "0");

      if (deletedCount > 0) {
        console.log(
          `[CACHE]: Đã xóa ${deletedCount} keys theo pattern "${pattern}"`
        );
      }
    } catch (error) {
      console.error(
        `[CACHE]: Lỗi khi xóa pattern "${pattern}":`,
        error.message
      );
    }
  }
}

module.exports = CacheService;
