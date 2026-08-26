const assert = require("node:assert/strict");
const grpc = require("@grpc/grpc-js");

process.env.GRPC_STORAGE_SERVICE_TOKEN = "test-storage-token";
process.env.GRPC_STORAGE_ALLOWED_PREFIXES = "picare-intelligent/";

const mockModule = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { filename, id: filename, loaded: true, exports };
};

mockModule("../src/services/s3.service", {
  buildKey(folder, filename) {
    return `${folder}/generated-${filename}`;
  },
  async getMetadata(key) {
    return {
      key,
      contentType: "text/plain",
      contentLength: 9,
      lastModified: new Date("2026-08-26T00:00:00.000Z"),
      metadata: { source: "picare-intelligent" },
      etag: "etag-1",
    };
  },
  async getDownloadStream() {
    return {
      ContentType: "text/plain",
      ContentLength: 9,
      ETag: "etag-1",
      Body: (async function* streamBody() {
        yield Buffer.from("know");
        yield Buffer.from("ledge");
      })(),
    };
  },
  async deleteAndRecord() {
    return { deletedRecord: true };
  },
});
mockModule("../src/services/upload_staging.service", {
  async stageBuffer(buffer) {
    assert.equal(buffer.toString(), "knowledge");
    return "/tmp/staged-upload";
  },
  async remove() {},
});
mockModule("../src/jobs/queues", {
  s3UploadQueue: {
    async add(name, data) {
      assert.equal(name, "upload-file");
      assert.equal(data.folder, "picare-intelligent/knowledge");
      assert.equal(data.fileSize, 9);
      assert.equal(data.visibility, "private");
      return { id: "job-1" };
    },
    async getJob(jobId) {
      assert.equal(jobId, "job-1");
      return {
        id: jobId,
        data: {
          key: "picare-intelligent/knowledge/generated-document.txt",
        },
        progress: 100,
        failedReason: null,
        returnvalue: {
          key: "picare-intelligent/knowledge/generated-document.txt",
          url: "https://storage.example/document.txt",
          etag: "etag-1",
          recordId: "asset-1",
          reused: false,
        },
        async getState() {
          return "completed";
        },
      };
    },
  },
});

const grpcS3Handler = require("../src/services/grpc_s3.handler");

const metadata = (token) => ({
  get(name) {
    return name === "x-service-token" && token ? [token] : [];
  },
});

const unary = (method, request, token) =>
  new Promise((resolve, reject) => {
    method(
      { request, metadata: metadata(token) },
      (error, response) => (error ? reject(error) : resolve(response)),
    );
  });

async function run() {
  await assert.rejects(
    unary(
      grpcS3Handler.getObjectMetadata,
      { key: "picare-intelligent/knowledge/document.txt" },
      "wrong-token",
    ),
    (error) => error.code === grpc.status.UNAUTHENTICATED,
  );

  await assert.rejects(
    unary(
      grpcS3Handler.getObjectMetadata,
      { key: "contracts/private.pdf" },
      "test-storage-token",
    ),
    (error) => error.code === grpc.status.PERMISSION_DENIED,
  );

  await assert.rejects(
    unary(
      grpcS3Handler.queueUpload,
      {
        file: Buffer.from("knowledge"),
        originalName: "document.txt",
        folder: "contracts",
      },
      "test-storage-token",
    ),
    (error) => error.code === grpc.status.PERMISSION_DENIED,
  );

  const queued = await unary(
    grpcS3Handler.queueUpload,
    {
      file: Buffer.from("knowledge"),
      originalName: "document.txt",
      fileSize: 9,
      mimeType: "text/plain",
      folder: "picare-intelligent/knowledge",
    },
    "test-storage-token",
  );
  assert.equal(queued.success, true);
  assert.equal(queued.jobId, "job-1");

  const uploadJob = await unary(
    grpcS3Handler.getUploadJob,
    { jobId: queued.jobId },
    "test-storage-token",
  );
  assert.equal(uploadJob.status, "completed");
  assert.equal(uploadJob.result.recordId, "asset-1");

  const objectMetadata = await unary(
    grpcS3Handler.getObjectMetadata,
    { key: "picare-intelligent/knowledge/document.txt" },
    "test-storage-token",
  );
  assert.equal(objectMetadata.contentLength, 9);
  assert.equal(objectMetadata.metadata.source, "picare-intelligent");

  const writes = [];
  const streamCall = {
    request: { key: "picare-intelligent/knowledge/document.txt" },
    metadata: metadata("test-storage-token"),
    cancelled: false,
    write(chunk) {
      writes.push(chunk);
    },
    end() {
      this.ended = true;
    },
    destroy(error) {
      this.error = error;
    },
  };
  await grpcS3Handler.downloadObject(streamCall);
  assert.equal(streamCall.error, undefined);
  assert.equal(streamCall.ended, true);
  assert.equal(Buffer.concat(writes.map((chunk) => chunk.data)).toString(), "knowledge");
  assert.equal(writes[0].contentType, "text/plain");
  assert.equal(writes[0].contentLength, 9);

  const deleted = await unary(
    grpcS3Handler.deleteObject,
    { key: "picare-intelligent/knowledge/document.txt" },
    "test-storage-token",
  );
  assert.deepEqual(deleted, { success: true, deletedRecord: true });
}

run()
  .then(() => console.log("gRPC storage handler contract tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
