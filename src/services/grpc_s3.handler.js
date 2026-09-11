const grpc = require("@grpc/grpc-js");
const { randomUUID, timingSafeEqual } = require("crypto");
const S3Service = require("./s3.service");
const appConfig = require("../config/app.config");
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
const DOWNLOAD_CHUNK_BYTES = 64 * 1024;

const isAuthorized = (call) => {
  const expectedToken = appConfig.grpc.storageServiceToken;
  if (!expectedToken) return false;

  const providedToken = String(
    call.metadata?.get("x-service-token")?.[0] || "",
  );
  const expectedBuffer = Buffer.from(expectedToken);
  const providedBuffer = Buffer.from(providedToken);

  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
};

const requireAuthorization = (call, callback) => {
  if (!appConfig.grpc.storageAuthEnabled) return true;

  if (!appConfig.grpc.storageServiceToken) {
    fail(
      callback,
      grpc.status.FAILED_PRECONDITION,
      "GRPC_STORAGE_SERVICE_TOKEN chưa được cấu hình",
    );
    return false;
  }
  if (isAuthorized(call)) return true;
  fail(callback, grpc.status.UNAUTHENTICATED, "Storage service token không hợp lệ");
  return false;
};

const requireObjectKey = (call, callback) => {
  const key = String(call.request?.key || "").trim();
  if (!key) {
    fail(callback, grpc.status.INVALID_ARGUMENT, "S3 object key là bắt buộc");
    return null;
  }
  if (
    appConfig.grpc.storageAuthEnabled &&
    !appConfig.grpc.storageAllowedPrefixes.some((prefix) =>
      key.startsWith(prefix),
    )
  ) {
    fail(callback, grpc.status.PERMISSION_DENIED, "S3 object key ngoài phạm vi");
    return null;
  }
  return key;
};

const grpcError = (error) => {
  const notFound =
    error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404;
  return {
    code: notFound ? grpc.status.NOT_FOUND : grpc.status.INTERNAL,
    details: error?.message || "S3 operation failed",
  };
};

const grpcS3Handler = {
  async queueUpload(call, callback) {
    try {
      if (!requireAuthorization(call, callback)) return;
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
      if (!requireObjectKey({ request: { key } }, callback)) return;
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
            fileSize: file.length,
            folder,
            clientId: optionalUuid(request.clientId),
            uploadedBy: optionalUuid(request.uploadedBy),
            description: request.description || null,
            visibility: "private",
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
      if (!requireAuthorization(call, callback)) return;
      const job = await s3UploadQueue.getJob(call.request?.jobId);
      if (!job) {
        return fail(
          callback,
          grpc.status.NOT_FOUND,
          "Không tìm thấy job upload",
        );
      }

      const jobKey = job.data?.key || job.returnvalue?.key || "";
      if (!requireObjectKey({ request: { key: jobKey } }, callback)) return;

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

  async downloadObject(call) {
    const callback = (error) => call.destroy(error);
    if (!requireAuthorization(call, callback)) return;
    const key = requireObjectKey(call, callback);
    if (!key) return;

    try {
      const response = await S3Service.getDownloadStream(key);
      const metadata = {
        contentType: response.ContentType || "application/octet-stream",
        contentLength: Number(response.ContentLength) || 0,
        etag: response.ETag || "",
      };
      let wroteChunk = false;

      for await (const sourceChunk of response.Body) {
        if (call.cancelled) return;
        const sourceBuffer = Buffer.from(sourceChunk);
        for (
          let offset = 0;
          offset < sourceBuffer.length;
          offset += DOWNLOAD_CHUNK_BYTES
        ) {
          call.write({
            data: sourceBuffer.subarray(offset, offset + DOWNLOAD_CHUNK_BYTES),
            ...(wroteChunk ? {} : metadata),
          });
          wroteChunk = true;
        }
      }

      if (!wroteChunk) call.write({ data: Buffer.alloc(0), ...metadata });
      call.end();
    } catch (error) {
      call.destroy(grpcError(error));
    }
  },

  async getObjectMetadata(call, callback) {
    if (!requireAuthorization(call, callback)) return;
    const key = requireObjectKey(call, callback);
    if (!key) return;

    try {
      const metadata = await S3Service.getMetadata(key);
      callback(null, {
        key: metadata.key,
        contentType: metadata.contentType || "application/octet-stream",
        contentLength: Number(metadata.contentLength) || 0,
        lastModified: metadata.lastModified?.toISOString?.() || "",
        metadata: metadata.metadata || {},
        etag: metadata.etag || "",
      });
    } catch (error) {
      callback(grpcError(error));
    }
  },

  async deleteObject(call, callback) {
    if (!requireAuthorization(call, callback)) return;
    const key = requireObjectKey(call, callback);
    if (!key) return;

    try {
      const result = await S3Service.deleteAndRecord(key);
      callback(null, {
        success: true,
        deletedRecord: result.deletedRecord,
      });
    } catch (error) {
      callback(grpcError(error));
    }
  },
};

module.exports = grpcS3Handler;
