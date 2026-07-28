const { Worker, UnrecoverableError } = require("bullmq");
const bullMQConfig = require("../config/bullmq.config");
const S3Service = require("../services/s3.service");
const UploadStagingService = require("../services/upload_staging.service");
const socketService = require("../services/socket.service");

let packageVideoWorker;
let s3UploadWorker;

const s3UploadConcurrency =
  Number.parseInt(process.env.S3_UPLOAD_CONCURRENCY || "1", 10) || 1;
const s3UploadLockDurationMs =
  Number.parseInt(process.env.S3_UPLOAD_LOCK_DURATION_MS || "900000", 10) ||
  900000;

const getLegacyJobBuffer = (body) => {
  if (Buffer.isBuffer(body)) return body;
  if (Array.isArray(body?.data)) return Buffer.from(body.data);
  throw new UnrecoverableError("S3 upload job is missing staged file data");
};

const formatJobError = (error) => ({
  name: error?.name || "Error",
  message: error?.message || String(error),
  validationErrors: Array.isArray(error?.errors)
    ? error.errors.map((item) => ({
        path: item.path,
        message: item.message,
        value: item.value,
      }))
    : undefined,
});

function startJobs() {
  if (packageVideoWorker) {
    return { packageVideoWorker, s3UploadWorker };
  }

  packageVideoWorker = new Worker(
    "package-video-queue",
    async (job) => {
      if (job.name !== "merge-videos") {
        throw new Error(`Unsupported package video job: ${job.name}`);
      }

      console.log("[JOBS]: merge-videos started", {
        jobId: job.id,
        mainVideoKey: job.data.mainVideoKey,
        secondVideoKey: job.data.secondVideoKey,
        hasOverlayText: Boolean(job.data.overlayText),
        overlayText: job.data.overlayText || null,
      });

      await job.updateProgress(10);
      const result = await S3Service.mergeVideos(job.data);
      await job.updateProgress(100);

      let presignedUrl = result.url;
      if (job.data.visibility === "private") {
        presignedUrl = await S3Service.getPresignedUrl(result.key, 86400);
      }

      return {
        key: result.key,
        url: result.url,
        presignedUrl,
        etag: result.etag,
        recordId: result.record?.assetId || result.record?.id || null,
      };
    },
    {
      connection: bullMQConfig.connection,
      concurrency: 2,
    },
  );

  packageVideoWorker.on("completed", (job, result) => {
    console.log("[JOBS]: merge-videos completed", {
      jobId: job.id,
      key: result?.key,
    });

    if (job.data.uploadedBy) {
      socketService.emitToUser(job.data.uploadedBy, "s3_merge_video_completed", {
        jobId: job.id,
        status: "completed",
        result,
      });
    }
  });

  packageVideoWorker.on("failed", (job, error) => {
    console.error("[JOBS]: merge-videos failed", {
      jobId: job?.id,
      message: error.message,
    });

    if (job?.data?.uploadedBy) {
      socketService.emitToUser(job.data.uploadedBy, "s3_merge_video_failed", {
        jobId: job.id,
        status: "failed",
        message: error.message,
      });
    }
  });

  packageVideoWorker.on("error", (error) => {
    console.error("[JOBS]: package-video worker error", error.message);
  });

  UploadStagingService.cleanupStaleFiles()
    .then((removedCount) => {
      if (removedCount > 0) {
        console.log("[S3]: removed stale staging files", { removedCount });
      }
    })
    .catch((error) => {
      console.error("[S3]: staging cleanup failed", error.message);
    });

  s3UploadWorker = new Worker(
    "s3-upload-queue",
    async (job) => {
      if (job.name !== "upload-file") {
        throw new Error(`Unsupported S3 upload job: ${job.name}`);
      }

      const tempFilePath = job.data.tempFilePath || null;

      try {
        await job.updateProgress(10);
        const result = await S3Service.upload({
          ...job.data,
          body: tempFilePath
            ? UploadStagingService.createReadStream(tempFilePath)
            : getLegacyJobBuffer(job.data.body),
          allowExisting: true,
        });
        await job.updateProgress(100);

        if (tempFilePath) {
          await UploadStagingService.remove(tempFilePath).catch((error) => {
            console.error("[S3]: staging file cleanup failed", {
              jobId: job.id,
              message: error.message,
            });
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
          if (tempFilePath) {
            await UploadStagingService.remove(tempFilePath).catch(() => {});
          }
          const validationDetails = formatJobError(error);
          throw new UnrecoverableError(
            `${validationDetails.message}: ${JSON.stringify(
              validationDetails.validationErrors || [],
            )}`,
          );
        }
        throw error;
      }
    },
    {
      connection: bullMQConfig.connection,
      concurrency: s3UploadConcurrency,
      lockDuration: s3UploadLockDurationMs,
    },
  );

  s3UploadWorker.on("completed", (job, result) => {
    console.log("[S3]: upload completed", { jobId: job.id, key: result?.key });
  });

  s3UploadWorker.on("failed", (job, error) => {
    console.error("[S3]: upload failed", {
      jobId: job?.id,
      key: job?.data?.key,
      attempt: job?.attemptsMade,
      maxAttempts: job?.opts?.attempts || 1,
      error: formatJobError(error),
    });

    const isFinalAttempt =
      error?.name === "UnrecoverableError" ||
      (job?.attemptsMade || 0) >= (job?.opts?.attempts || 1);
    if (isFinalAttempt && job?.data?.tempFilePath) {
      UploadStagingService.remove(job.data.tempFilePath).catch((cleanupError) => {
        console.error("[S3]: final staging cleanup failed", {
          jobId: job.id,
          message: cleanupError.message,
        });
      });
    }
  });

  s3UploadWorker.on("error", (error) => {
    console.error("[JOBS]: s3-upload worker error", error.message);
  });

  console.log("[JOBS]: package-video and s3-upload workers started");
  return { packageVideoWorker, s3UploadWorker };
}

async function stopJobs() {
  if (packageVideoWorker) {
    await packageVideoWorker.close();
    packageVideoWorker = null;
  }
  if (s3UploadWorker) {
    await s3UploadWorker.close();
    s3UploadWorker = null;
  }
}

module.exports = {
  startJobs,
  stopJobs,
};
