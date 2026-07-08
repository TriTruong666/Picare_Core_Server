const express = require("express");
const http = require("http");
const morgan = require("morgan");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const config = require("./src/config/app.config");
const sequelize = require("./src/config/postgres.config");
require("./src/models");
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
const { startJobs, stopJobs } = require("./src/jobs");

const app = express();
const server = http.createServer(app);

socketService.init(server);

function normalizeTableName(table) {
  if (!table) return "";
  if (typeof table === "string") return table;
  if (typeof table === "object") {
    return table.tableName || table.table_name || table.name || "";
  }
  return String(table);
}

function getProtectedTableSet(protectedTables = []) {
  return new Set(protectedTables.map((table) => normalizeTableName(table)));
}

function logSyncSql(sql) {
  console.log(`[DB-SYNC] ${sql}`);
}

async function logDatabaseSchema(queryInterface) {
  const tables = await queryInterface.showAllTables();

  for (const table of tables) {
    const tableName = normalizeTableName(table);
    const columns = await queryInterface.describeTable(table);
    const schema = Object.fromEntries(
      Object.entries(columns).map(([columnName, column]) => [
        columnName,
        {
          type: column.type,
          allowNull: column.allowNull,
          primaryKey: column.primaryKey,
          defaultValue: column.defaultValue,
        },
      ]),
    );

    console.log(`[DB-SCHEMA] ${tableName}: ${JSON.stringify(schema)}`);
  }
}

app.use(morgan("dev"));
app.use(cors({ origin: config.cors, credentials: true }));
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));
app.use(cookieParser());

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

app.use("/api/v1", apiRoutes);

app.use(
  "/api-docs",
  restrictLocalhost,
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec),
);

app.use(globalErrorHandler);

const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log("[DATABASE]: Kết nối Database thành công!");

    const isForceReset = config.db.force_reset;
    const isReset = config.db.reset;
    const protectedTables = config.db.protectedTables || [];
    const protectedTableSet = getProtectedTableSet(protectedTables);
    const queryInterface = sequelize.getQueryInterface();

    if (isForceReset && !isReset) {
      console.log(
        "[WARNING]: Đây là cảnh báo Force Reset DB, vui lòng kiểm tra kỹ Production.",
      );
      console.log("[DATABASE]: Đang khởi tạo lại database...");
      await sequelize.sync({ force: true, logging: logSyncSql });
      console.log("[DATABASE]: Database đã được khởi tạo lại.");

      try {
        await redis.flushall();
        console.log("[REDIS]: Đã dọn dẹp toàn bộ dữ liệu cache.");
      } catch (redisErr) {
        console.error(
          "[REDIS ERROR]: Lỗi khi flushall dữ liệu:",
          redisErr.message,
        );
      }
    } else if (isReset && !isForceReset) {
      console.log(
        "[DATABASE]: Đang khởi tạo lại database (có bảo vệ các bảng quan trọng)...",
      );

      const allTables = await queryInterface.showAllTables();

      for (const table of allTables) {
        const normalizedTableName = normalizeTableName(table);

        if (!protectedTableSet.has(normalizedTableName)) {
          await queryInterface.dropTable(normalizedTableName, {
            cascade: true,
          });
        }
      }

      await sequelize.sync({ alter: true, logging: logSyncSql });

      console.log(
        `[DATABASE]: Database đã được khởi tạo lại (trừ bảng: ${protectedTables.join(
          ", ",
        )}).`,
      );
    } else {
      console.log("[DATABASE]: Đang kiểm tra và đồng bộ cấu trúc database...");
      await sequelize.sync({ logging: logSyncSql });
      console.log("[DATABASE]: Database đã sẵn sàng.");
    }

    // await logDatabaseSchema(queryInterface);

    // await seedingRBAC();
    // await seedingUsers();
    // await seedingHubClients();
    await seedAppConfig();
    await loadDynamicConfig();

    startGrpcServer(config.app.grpc_port);
    startJobs();

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

process.on("SIGINT", async () => {
  await stopJobs();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await stopJobs();
  process.exit(0);
});

startServer();
