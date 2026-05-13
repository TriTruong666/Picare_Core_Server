const { S3Client } = require("@aws-sdk/client-s3");
const appConfig = require("./app.config");

const { accessKeyId, secretAccessKey, region } = appConfig.s3;

if (!accessKeyId || !secretAccessKey || !region) {
  console.warn(
    "[S3]: Thiếu thông tin cấu hình AWS S3. Kiểm tra lại biến môi trường.",
  );
}

/**
 * AWS S3 Client (SDK v3)
 */
const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

module.exports = s3Client;
