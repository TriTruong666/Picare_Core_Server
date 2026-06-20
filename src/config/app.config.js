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

const ALLOWED_CLIENT_URL_3 =
  process.env.ALLOWED_CLIENT_URL_3 || "http://localhost:2345";

const appConfig = {
  app: {
    name: "Picare Core Hub",
    version: "1.0.0",
    env: process.env.NODE_ENV || "development",
    port: parseInt(process.env.SERVER_PORT, 10) || 1905,
    grpc_port: parseInt(process.env.GRPC_PORT, 10) || 50051,
    isProduction: process.env.NODE_ENV === "production",
  },

  client: {
    baseUrl:
      process.env.NODE_ENV === "production"
        ? "https://hub.picare.vn"
        : "http://localhost:5173",
  },

  server: {
    baseUrl:
      process.env.SERVER_BASE_URL ||
      (process.env.NODE_ENV === "production"
        ? "https://core.picare.vn"
        : "http://localhost:1905"),
  },

  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    reset: true,
    force_reset: false,
    protectedTables: [
      "users",
      "roles",
      "permissions",
      "role_permissions",
      "hub_clients",
      "s3_folders",
      "s3_assets",
      "app_configs",
      // "contract",
      // "contract_detail",
      // "contract_document",
      // "contract_signature",
      "product_qr",
    ],
  },

  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || null,
  },

  redis_event_bus: {
    host:
      process.env.REDIS_EVENT_BUS_HOST || process.env.REDIS_HOST || "localhost",
    port:
      parseInt(process.env.REDIS_EVENT_BUS_PORT, 10) ||
      parseInt(process.env.REDIS_PORT, 10) ||
      6379,
    password:
      process.env.REDIS_EVENT_BUS_PASSWORD ||
      process.env.REDIS_PASSWORD ||
      null,
  },

  logging: {
    level: process.env.LOG_LEVEL || "info",
  },

  cors: [ALLOWED_CLIENT_URL_1, ALLOWED_CLIENT_URL_2, ALLOWED_CLIENT_URL_3],

  jwt: {
    secret: process.env.JWT_SECRET || null,
    expiresIn: process.env.JWT_EXPIRES_IN || "1d",
  },

  s3: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    region: process.env.AWS_REGION || "",
    bucketName: process.env.AWS_S3_BUCKET_NAME || "",
  },

  fptAi: {
    apiKey:
      process.env.FPT_AI_API_KEY || process.env.ID_RECOGNITION_API_KEY || "",
    idRecognitionUrl:
      process.env.FPT_AI_ID_RECOGNITION_URL ||
      "https://api.fpt.ai/vision/idr/vnm/",
  },

  mail: {
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.MAIL_FROM || "",
    name: process.env.MAIL_FROM_NAME || "Picare Core Hub",
    rejectUnauthorized:
      String(process.env.SMTP_REJECT_UNAUTHORIZED || "true").toLowerCase() ===
      "true",
  },
};

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
