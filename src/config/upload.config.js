const DEFAULT_MAX_FILE_UPLOAD_MB = 2048;
const GRPC_MESSAGE_OVERHEAD_MB = 8;

const parsedMaxFileUploadMb = Number.parseInt(
  process.env.MAX_FILE_UPLOAD_MB || `${DEFAULT_MAX_FILE_UPLOAD_MB}`,
  10,
);

const maxFileUploadMb =
  Number.isFinite(parsedMaxFileUploadMb) && parsedMaxFileUploadMb > 0
    ? parsedMaxFileUploadMb
    : DEFAULT_MAX_FILE_UPLOAD_MB;

const maxFileUploadBytes = maxFileUploadMb * 1024 * 1024;
const maxGrpcMessageBytes =
  (maxFileUploadMb + GRPC_MESSAGE_OVERHEAD_MB) * 1024 * 1024;

module.exports = {
  maxFileUploadMb,
  maxFileUploadBytes,
  maxGrpcMessageBytes,
};
