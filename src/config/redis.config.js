const Redis = require("ioredis");
const config = require("./app.config");


/**
 * Cấu hình Redis Client sử dụng ioredis.
 * Tự động kết nối và xử lý các sự kiện mất kết nối.
 */
const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  // Tùy chọn Retry chuyên nghiệp cho Production
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  // Giới hạn thời gian kết nối
  connectTimeout: 10000,
});

// Lắng nghe các sự kiện
redis.on("connect", () => {
  console.log("------------------------------------------");
  console.log("Kết nối Redis thành công!");
});

redis.on("error", (err) => {
  console.error("Lỗi kết nối Redis:", err.message);
});

module.exports = redis;
