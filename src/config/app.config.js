const path = require("path");
require("dotenv").config({
  path: path.join(
    __dirname,
    "../../",
    process.env.NODE_ENV === "production" ? ".env" : ".env.development",
  ),
});

const ALLOWED_CLIENT_URL_1 =
  process.env.ALLOWED_CLIENT_URL_1 || "http://localhost:1234";

const ALLOWED_CLIENT_URL_2 =
  process.env.ALLOWED_CLIENT_URL_2 || "http://localhost:2345";

/**
 * Centralized Application Configuration
 */
const appConfig = {
  app: {
    name: "Picare Core Hub",
    version: "1.0.0",
    env: process.env.NODE_ENV || "development",
    port: parseInt(process.env.SERVER_PORT, 10) || 1905,
    grpc_port: parseInt(process.env.GRPC_PORT, 10) || 50051,
    isProduction: process.env.NODE_ENV === "production",
  },

  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    reset: false,
    force_reset: false,
    protectedTables: ["users"],
  },

  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || null,
  },

  logging: {
    level: process.env.LOG_LEVEL || "info",
  },

  cors: [ALLOWED_CLIENT_URL_1, ALLOWED_CLIENT_URL_2],

  jwt: {
    secret: process.env.JWT_SECRET || null,
    expiresIn: process.env.JWT_EXPIRES_IN || "1d",
  },
};

/**
 * Load dynamic config from DB (Simplified)
 */
async function loadDynamicConfig() {
  const AppConfigService = require("../services/app_config.service");
  try {
    const record = await AppConfigService.getConfig();
    const cfg = record.appConfig || {};

    if (record.appName) appConfig.app.name = record.appName;
    if (record.appVersion) appConfig.app.version = record.appVersion;

    if (cfg.jwt) {
      appConfig.jwt.secret = cfg.jwt.secret || appConfig.jwt.secret;
      appConfig.jwt.expiresIn = cfg.jwt.expiresIn || appConfig.jwt.expiresIn;
    }

    console.log("[CONFIG]: Đã load cấu hình động từ DB thành công.");
  } catch (err) {
    console.warn("[CONFIG]: Sử dụng cấu hình từ .env (Fallback).");
  }
}

module.exports = appConfig;
module.exports.loadDynamicConfig = loadDynamicConfig;
