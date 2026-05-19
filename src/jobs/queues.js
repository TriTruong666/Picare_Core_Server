const { Queue } = require("bullmq");
const bullMQConfig = require("../config/bullmq.config");

const packageVideoQueue = new Queue("package-video-queue", {
  connection: bullMQConfig.connection,
  defaultJobOptions: bullMQConfig.defaultJobOptions,
});

module.exports = { packageVideoQueue };
