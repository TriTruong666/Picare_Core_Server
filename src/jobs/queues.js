const { Queue } = require("bullmq");
const bullMQConfig = require("../config/bullmq.config");

const packageVideoQueue = new Queue("package-video-queue", {
  connection: bullMQConfig.connection,
  defaultJobOptions: bullMQConfig.defaultJobOptions,
});

const s3UploadQueue = new Queue("s3-upload-queue", {
  connection: bullMQConfig.connection,
  defaultJobOptions: bullMQConfig.defaultJobOptions,
});

const s3VideoUploadQueue = new Queue("s3-video-upload-queue", {
  connection: bullMQConfig.connection,
  defaultJobOptions: bullMQConfig.defaultJobOptions,
});

const getUploadQueue = (mimeType = "", originalName = "") =>
  (String(mimeType).toLowerCase().startsWith("video/") ||
    /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(String(originalName)))
    ? s3VideoUploadQueue
    : s3UploadQueue;

const getUploadJob = async (jobId) =>
  (await s3UploadQueue.getJob(jobId)) ||
  (await s3VideoUploadQueue.getJob(jobId));

module.exports = {
  packageVideoQueue,
  s3UploadQueue,
  s3VideoUploadQueue,
  getUploadQueue,
  getUploadJob,
};
