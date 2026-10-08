const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const schema = require("../src/schemas/ocr.schema");
const service = require("../src/services/ocr.service");
const controller = require("../src/controllers/ocr.controller");
const originalFetch = global.fetch;
const originalToken = process.env.CORE_OCR_SERVICE_TOKEN;
const originalGrpcToken = process.env.GRPC_OCR_SERVICE_TOKEN;
afterEach(() => {
  global.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.CORE_OCR_SERVICE_TOKEN;
  else process.env.CORE_OCR_SERVICE_TOKEN = originalToken;
  if (originalGrpcToken === undefined)
    delete process.env.GRPC_OCR_SERVICE_TOKEN;
  else process.env.GRPC_OCR_SERVICE_TOKEN = originalGrpcToken;
});
const image = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.alloc(10),
]);
const input = (userId = "test") => ({
  documentType: "vn_identity_card",
  userId,
  front: image,
  back: image,
});
test("schema bounds images and allows only registered document types", () => {
  assert.equal(schema.validate(input()).documentType, "vn_identity_card");
  for (const invalid of [
    { ...input(), documentType: "../../unsafe" },
    { ...input(), back: Buffer.alloc(0) },
    { ...input(), front: Buffer.alloc(11 * 1024 * 1024) },
  ])
    assert.throws(() => schema.validate(invalid), { statusCode: 400 });
});
test("gRPC rejects unauthenticated calls before OCR", async () => {
  process.env.GRPC_OCR_SERVICE_TOKEN = "test-secret";
  const error = await new Promise((resolve) =>
    controller.recognize(
      { metadata: { get: () => [] }, request: input() },
      resolve,
    ),
  );
  assert.equal(error.code, 16);
});
test("internal HTTP uses standard result and private service authentication", async () => {
  process.env.CORE_OCR_SERVICE_TOKEN = "test-secret";
  global.fetch = async (url, options) => {
    assert.equal(options.headers["x-service-token"], "test-secret");
    assert.match(options.headers["x-request-id"], /^[0-9a-f]{32}$/);
    assert.equal(options.body.get("document_type"), "vn_identity_card");
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          documentType: "vn_identity_card",
          fields: { number: "012345678901" },
        },
      }),
    };
  };
  assert.equal(
    (await service.recognize(input("success"))).fields.number,
    "012345678901",
  );
});
test("busy, invalid image and network failures are sanitized", async () => {
  process.env.CORE_OCR_SERVICE_TOKEN = "test-secret";
  for (const [status, expected] of [
    [429, 429],
    [400, 400],
    [504, 504],
    [503, 503],
  ]) {
    global.fetch = async () => ({ status, ok: false });
    await assert.rejects(service.recognize(input(`status-${status}`)), {
      statusCode: expected,
    });
  }
  global.fetch = async () => {
    throw new Error("private URL or secret");
  };
  await assert.rejects(
    service.recognize(input("network")),
    (error) => error.statusCode === 503 && !error.message.includes("secret"),
  );
});

test("OCR timeout propagates as gRPC deadline exceeded", async () => {
  process.env.CORE_OCR_SERVICE_TOKEN = "test-secret";
  process.env.GRPC_OCR_SERVICE_TOKEN = "test-secret";
  global.fetch = async () => ({ status: 504, ok: false });
  const error = await new Promise((resolve) =>
    controller.recognize(
      {
        metadata: { get: () => ["test-secret"] },
        request: input("timeout-grpc"),
      },
      resolve,
    ),
  );
  assert.equal(error.code, 4);
  assert.match(error.details, /quá thời gian/);
});
