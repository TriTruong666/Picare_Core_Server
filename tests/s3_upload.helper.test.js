const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseBase64DataUri,
  resolveMimeType,
} = require("../src/common/s3_upload.helper");

test("parses an MP4 Data URL and preserves its bytes", () => {
  const source = Buffer.from("mock mp4 bytes");
  const parsed = parseBase64DataUri(
    `data:video/mp4;base64,${source.toString("base64")}`,
  );

  assert.equal(parsed.mimeType, "video/mp4");
  assert.deepEqual(parsed.buffer, source);
});

test("parses a Data URL that contains media type parameters", () => {
  const parsed = parseBase64DataUri(
    "data:text/plain;charset=utf-8;base64,aGVsbG8=",
  );

  assert.equal(parsed.mimeType, "text/plain");
  assert.equal(parsed.buffer.toString(), "hello");
});

test("infers MP4 MIME type when the uploader sends octet-stream", () => {
  assert.equal(
    resolveMimeType("application/octet-stream", "example.mp4"),
    "video/mp4",
  );
});

test("keeps a specific MIME type supplied by the uploader", () => {
  assert.equal(resolveMimeType("video/webm", "example.bin"), "video/webm");
});
