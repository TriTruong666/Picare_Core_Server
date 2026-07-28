const grpc = require("@grpc/grpc-js");
const { randomUUID } = require("crypto");
const S3Service = require("./s3.service");
const UploadStagingService = require("./upload_staging.service");
const { s3UploadQueue } = require("../jobs/queues");
const {
  maxFileUploadMb,
  maxFileUploadBytes,
} = require("../config/upload.config");

const fail = (callback, code, details) => callback({ code, details });
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const optionalUuid = (value) =>
  value && UUID_PATTERN.test(String(value)) ? String(value) : null;

const grpcS3Handler = {
  async queueUpload(call, callback) {
    try {
      const request = call.request || {};
      const file = Buffer.isBuffer(request.file)
        ? request.file
        : Buffer.from(request.file || []);

      if (!file.length) {
        return fail(
          callback,
          grpc.status.INVALID_ARGUMENT,
          "Không tìm thấy nội dung file",
        );
      }
      if (file.length > maxFileUploadBytes) {
        return fail(
          callback,
          grpc.status.RESOURCE_EXHAUSTED,
          `File vượt quá giới hạn ${maxFileUploadMb} MB`,
        );
      }

      const originalName = (request.originalName || "upload.bin").slice(0, 512);
      const folder = request.folder || "uploads";
      const key = S3Service.buildKey(folder, originalName);
      const jobId = `s3-upload-${Date.now()}-${randomUUID()}`;
      const tempFilePath = await UploadStagingService.stageBuffer(file);

      let job;
      try {
        job = await s3UploadQueue.add(
          "upload-file",
          {
            key,
            tempFilePath,
            mimeType: (
              request.mimeType || "application/octet-stream"
            ).slice(0, 128),
            originalName,
            fileSize: Number(request.fileSize) || file.length,
            folder,
            clientId: optionalUuid(request.clientId),
            uploadedBy: optionalUuid(request.uploadedBy),
            description: request.description || null,
            visibility: request.visibility === "public" ? "public" : "private",
            allowExisting: true,
            requestedAt: new Date().toISOString(),
          },
          { jobId },
        );
      } catch (error) {
        await UploadStagingService.remove(tempFilePath).catch(() => {});
        throw error;
      }

      callback(null, {
        success: true,
        message: "Yêu cầu upload đã được tiếp nhận",
        jobId: job.id,
        key,
        status: "queued",
      });
    } catch (error) {
      fail(callback, grpc.status.INTERNAL, error.message);
    }
  },

  async getUploadJob(call, callback) {
    try {
      const job = await s3UploadQueue.getJob(call.request?.jobId);
      if (!job) {
        return fail(
          callback,
          grpc.status.NOT_FOUND,
          "Không tìm thấy job upload",
        );
      }

      const status = await job.getState();
      const isTerminal = status === "completed" || status === "failed";
      const result = job.returnvalue
        ? {
            key: job.returnvalue.key || "",
            url: job.returnvalue.url || "",
            etag: job.returnvalue.etag || "",
            recordId: job.returnvalue.recordId || "",
            reused: Boolean(job.returnvalue.reused),
          }
        : null;

      callback(null, {
        success: true,
        message: "Lấy trạng thái upload thành công",
        jobId: job.id,
        status,
        progress: Number(job.progress) || 0,
        shouldPoll: !isTerminal,
        result,
        failedReason: job.failedReason || "",
      });
    } catch (error) {
      fail(callback, grpc.status.INTERNAL, error.message);
    }
  },
};

module.exports = grpcS3Handler;
