const sequelize = require("./src/config/postgres.config");
require("./src/models");
const { startJobs, stopJobs } = require("./src/jobs");

async function shutdown() {
  await stopJobs();
  await sequelize.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

sequelize.authenticate()
  .then(() => startJobs(process.env.CORE_STORAGE_WORKER_MODE || "small"))
  .catch((error) => {
    console.error("[S3]: Không thể khởi động storage worker:", error);
    process.exit(1);
  });
