const express = require("express");
const http = require("http");
const morgan = require("morgan");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const config = require("./src/config/app.config");
const sequelize = require("./src/config/postgres.config");
const db = require("./src/models");
const redis = require("./src/config/redis.config");
const apiRoutes = require("./src/routes");
const globalErrorHandler = require("./src/middlewares/error.handler");
const seedingUsers = require("./src/seeds/user_seed");
const { seedAppConfig } = require("./src/seeds/app_config_seed");
const { loadDynamicConfig } = require("./src/config/app.config");
const socketService = require("./src/services/socket.service");
const { startGrpcServer } = require("./src/services/grpc_server");
const seedingRBAC = require("./src/seeds/rbac_seed");
const seedingHubClients = require("./src/seeds/hub_client_seed");

// Khởi tạo ứng dụng express
const app = express();
const server = http.createServer(app);

// Khởi tạo Socket.io
socketService.init(server);

/**
 * Middlewares cơ bản
 */
app.use(morgan("dev"));
app.use(cors({ origin: config.cors, credentials: true }));
app.use(express.json()); // Parse JSON body
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // Parse Cookies

/**
 * Định tuyến (Routes)
 */
app.get("/health", async (req, res) => {
  const redisStatus = redis.status === "ready" ? "Connected" : "Disconnected";

  res.status(200).json({
    status: "Running",
    app: config.app.name,
    version: config.app.version,
    env: config.app.env,
    database: "Connected",
    redis: redisStatus,
    uptime: process.uptime(),
  });
});

const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./src/config/swagger.config");
const restrictLocalhost = require("./src/middlewares/localhostOnly.middleware");

// Sử dụng tập hợp các API routes
app.use("/api/v1", apiRoutes);

// Cấu hình Swagger UI (Chỉ Localhost)
app.use(
  "/api-docs",
  restrictLocalhost,
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec),
);

/**
 * Global Error Handler (Phải đặt ở sau cùng các route)
 */
app.use(globalErrorHandler);

/**
 * Khởi động Server
 */
const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log("[DATABASE]: Kết nối Database thành công!");

    // Đồng bộ Database
    const isForceReset = config.db.force_reset;
    await sequelize.sync({ force: isForceReset });
    console.log(`[DATABASE]: Database đã được đồng bộ (force: ${isForceReset}).`);

    // Hạt giống dữ liệu
    await seedingUsers();
    await seedingRBAC();
    await seedingHubClients();
    await seedAppConfig();
    await loadDynamicConfig();

    // Khởi tạo gRPC Server (Hub for other backend services)
    startGrpcServer(config.app.grpc_port);

    const { port, name, version, env } = config.app;

    server.listen(port, () => {
      console.log(`
  _____  _____   _____            _____  ______ __      __ _   _ 
 |  __ \\|_   _| / ____|    /\\    |  __ \\|  ____|\\ \\    / /| \\ | |
 | |__) | | |  | |        /  \\   | |__) | |__    \\ \\  / / |  \\| |
 |  ___/  | |  | |       / /\\ \\  |  _  /|  __|    \\ \\/ /  | . \` |
 | |     _| |_ | |____  / ____ \\ | | \\ \\| |____    \\  /   | |\\  |
 |_|    |_____| \\_____|/_/    \\_\\|_|  \\_\\______|    \\/    |_| \\_|
      `);
      console.log(`${name} - (${version}) đang chạy...`);
      console.log(`Môi trường: ${env.toUpperCase()}`);
      console.log(`URL: http://localhost:${port}`);
      console.log("------------------------------------------");
    });
  } catch (error) {
    console.error("Không thể khởi động Server:", error);
    process.exit(1);
  }
};

startServer();
