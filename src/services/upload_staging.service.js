const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const stagingDirectory = path.resolve(
  process.env.S3_UPLOAD_STAGING_DIR ||
    path.join(process.cwd(), "tmp", "s3-uploads"),
);

const resolveStagedPath = (filePath) => {
  const resolvedPath = path.resolve(filePath);
  const stagingPrefix = `${stagingDirectory}${path.sep}`;

  if (!resolvedPath.startsWith(stagingPrefix)) {
    throw new Error("Invalid S3 staging file path");
  }

  return resolvedPath;
};

const UploadStagingService = {
  async stageBuffer(buffer) {
    await fsPromises.mkdir(stagingDirectory, { recursive: true });

    const filePath = path.join(
      stagingDirectory,
      `${Date.now()}-${randomUUID()}.upload`,
    );
    const fileHandle = await fsPromises.open(filePath, "wx");

    try {
      await fileHandle.writeFile(buffer);
    } catch (error) {
      await fileHandle.close();
      await fsPromises.unlink(filePath).catch(() => {});
      throw error;
    }

    await fileHandle.close();
    return filePath;
  },

  createReadStream(filePath) {
    return fs.createReadStream(resolveStagedPath(filePath));
  },

  async remove(filePath) {
    if (!filePath) return;

    try {
      await fsPromises.unlink(resolveStagedPath(filePath));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  },

  async cleanupStaleFiles(maxAgeMs = 24 * 60 * 60 * 1000) {
    await fsPromises.mkdir(stagingDirectory, { recursive: true });
    const entries = await fsPromises.readdir(stagingDirectory, {
      withFileTypes: true,
    });
    const oldestAllowedTime = Date.now() - maxAgeMs;
    let removedCount = 0;

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const filePath = path.join(stagingDirectory, entry.name);
      const stat = await fsPromises.stat(filePath);
      if (stat.mtimeMs >= oldestAllowedTime) continue;

      await fsPromises.unlink(filePath);
      removedCount += 1;
    }

    return removedCount;
  },
};

module.exports = UploadStagingService;
