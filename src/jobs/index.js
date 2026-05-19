const { Worker } = require("bullmq");
const bullMQConfig = require("../config/bullmq.config");
const S3Service = require("../services/s3.service");
const socketService = require("../services/socket.service");

let packageVideoWorker;

function startJobs() {
  if (packageVideoWorker) {
    return { packageVideoWorker };
  }

  packageVideoWorker = new Worker(
    "package-video-queue",
    async (job) => {
      if (job.name !== "merge-videos") {
        throw new Error(`Unsupported package video job: ${job.name}`);
      }

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
      concurrency: 1,
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

  console.log("[JOBS]: package-video worker started");
  return { packageVideoWorker };
}

async function stopJobs() {
  if (packageVideoWorker) {
    await packageVideoWorker.close();
    packageVideoWorker = null;
  }
}

module.exports = {
  startJobs,
  stopJobs,
};
