const { Worker, UnrecoverableError } = require("bullmq");
const bullMQConfig = require("../config/bullmq.config");
const S3Service = require("../services/s3.service");
const UploadStagingService = require("../services/upload_staging.service");
const { publishToUser } = require("../services/storage_worker_events.service");

const workers = [];
const uploadLockDurationMs =
  Number.parseInt(process.env.S3_UPLOAD_LOCK_DURATION_MS || "120000", 10) || 120000;

const getLegacyJobBuffer = (body) => {
  if (Buffer.isBuffer(body)) return body;
  if (Array.isArray(body?.data)) return Buffer.from(body.data);
  throw new UnrecoverableError("S3 upload job is missing staged file data");
};

const formatJobError = (error) => ({
  name: error?.name || "Error",
  message: error?.message || String(error),
  validationErrors: Array.isArray(error?.errors)
    ? error.errors.map((item) => ({ path: item.path, message: item.message, value: item.value }))
    : undefined,
});

function startMergeWorker() {
  const worker = new Worker(
    "package-video-queue",
    async (job) => {
      if (job.name !== "merge-videos") {
        throw new Error(`Unsupported package video job: ${job.name}`);
      }
      await job.updateProgress(10);
      const result = await S3Service.mergeVideos(job.data);
      await job.updateProgress(100);
      return {
        key: result.key,
        url: result.url,
        presignedUrl: job.data.visibility === "private"
          ? await S3Service.getPresignedUrl(result.key, 86400)
          : result.url,
        etag: result.etag,
        recordId: result.record?.assetId || result.record?.id || null,
      };
    },
    {
      connection: bullMQConfig.connection,
      concurrency: Number.parseInt(process.env.S3_MERGE_CONCURRENCY || "1", 10) || 1,
    },
  );
  worker.on("completed", (job, result) => {
    console.log("[S3]: merge completed", { jobId: job.id, key: result?.key });
    if (job.data.uploadedBy) {
      publishToUser(job.data.uploadedBy, "s3_merge_video_completed", {
        jobId: job.id, status: "completed", result,
      }).catch((error) => console.error("[S3]: completion event failed:", error));
    }
  });
  worker.on("failed", (job, error) => {
    console.error("[S3]: merge failed", { jobId: job?.id, error: formatJobError(error) });
    if (job?.data?.uploadedBy) {
      publishToUser(job.data.uploadedBy, "s3_merge_video_failed", {
        jobId: job.id, status: "failed", message: error.message,
      }).catch((publishError) => console.error("[S3]: failure event failed:", publishError));
    }
  });
  worker.on("error", (error) => console.error("[S3]: merge worker error", error));
  workers.push(worker);
}

async function processUpload(job) {
  if (job.name !== "upload-file") {
    throw new Error(`Unsupported S3 upload job: ${job.name}`);
  }
  const { stagingKey, tempFilePath } = job.data;
  try {
    await job.updateProgress(10);
    const result = await S3Service.upload({
      ...job.data,
      body: stagingKey
        ? null
        : tempFilePath
          ? UploadStagingService.createReadStream(tempFilePath)
          : getLegacyJobBuffer(job.data.body),
      allowExisting: true,
    });
    await job.updateProgress(100);
    // Cleanup failure must not turn a committed asset into a failed retry.
    if (stagingKey) {
      await UploadStagingService.removeStagedS3Object(stagingKey).catch((error) => {
        console.error("[S3]: staging cleanup failed", { jobId: job.id, message: error.message });
      });
    }
    if (tempFilePath) {
      await UploadStagingService.remove(tempFilePath).catch((error) => {
        console.error("[S3]: legacy staging cleanup failed", { jobId: job.id, message: error.message });
      });
    }
    return {
      key: result.key,
      url: result.url,
      etag: result.etag,
      recordId: result.record?.assetId || result.record?.id || null,
      reused: Boolean(result.reused),
    };
  } catch (error) {
    if (error?.name === "SequelizeValidationError") {
      const details = formatJobError(error);
      throw new UnrecoverableError(
        `${details.message}: ${JSON.stringify(details.validationErrors || [])}`,
      );
    }
    throw error;
  }
}

function startUploadWorker(queueName, concurrency) {
  const worker = new Worker(queueName, processUpload, {
    connection: bullMQConfig.connection,
    concurrency,
    lockDuration: uploadLockDurationMs,
  });
  worker.on("completed", (job, result) => {
    console.log("[S3]: upload completed", { queueName, jobId: job.id, key: result?.key });
  });
  worker.on("failed", (job, error) => {
    console.error("[S3]: upload failed", {
      queueName,
      jobId: job?.id,
      key: job?.data?.key,
      attempt: job?.attemptsMade,
      maxAttempts: job?.opts?.attempts || 1,
      error: formatJobError(error),
    });
    const isFinalAttempt = error?.name === "UnrecoverableError" ||
      (job?.attemptsMade || 0) >= (job?.opts?.attempts || 1);
    if (isFinalAttempt && job?.data?.tempFilePath) {
      UploadStagingService.remove(job.data.tempFilePath).catch(() => {});
    }
    // Preserve failed S3 staging objects for investigation or manual retry.
  });
  worker.on("stalled", (jobId) => {
    console.error("[S3]: upload stalled", { queueName, jobId });
  });
  worker.on("error", (error) => {
    console.error("[S3]: upload worker error", { queueName, message: error.message });
  });
  workers.push(worker);
}

function startJobs(mode = "all") {
  if (workers.length) return workers;
  if (mode === "all" || mode === "small") {
    // Existing upload jobs remain in this queue during rollout.
    startUploadWorker(
      "s3-upload-queue",
      Number.parseInt(process.env.S3_UPLOAD_CONCURRENCY || "4", 10) || 4,
    );
  }
  if (mode === "all" || mode === "video") {
    startUploadWorker(
      "s3-video-upload-queue",
      Number.parseInt(process.env.S3_VIDEO_UPLOAD_CONCURRENCY || "2", 10) || 2,
    );
  }
  if (mode === "all" || mode === "merge") startMergeWorker();
  if (!workers.length) throw new Error(`Unknown storage worker mode: ${mode}`);
  console.log("[S3]: storage workers started", { mode });
  return workers;
}

async function stopJobs() {
  await Promise.all(workers.splice(0).map((worker) => worker.close()));
}

module.exports = { startJobs, stopJobs };
