const AppConfig = require("../models/app_config.model");

const DEFAULT_APP_NAME = "Picare Core Hub";

/**
 * Seed dữ liệu AppConfig từ .env (chỉ chạy lần đầu, không ghi đè)
 */
async function seedAppConfig() {
  console.log("[SEEDING]: Kiểm tra AppConfig...");

  const existing = await AppConfig.findOne({ where: { key: "main" } });
  if (existing) {
    console.log("[SEEDING]: AppConfig đã tồn tại.");
    return existing;
  }

  const config = await AppConfig.create({
    key: "main",
    appVersion: process.env.APP_VERSION || "1.0.0",
    appName: DEFAULT_APP_NAME,
    appConfig: {
      jwt: {
        secret: process.env.JWT_SECRET || "",
        expiresIn: process.env.JWT_EXPIRES_IN || "1d",
      },
    },
  });

  console.log("[SEEDING]: Đã tạo AppConfig mới từ .env thành công.");
  return config;
}

module.exports = { seedAppConfig };
