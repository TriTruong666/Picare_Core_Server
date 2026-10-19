const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const redisPath = require.resolve("../src/config/redis.config");
const redis = { status: "connecting", eval: async () => { throw new Error("unexpected Redis call"); } };
require.cache[redisPath] = { id: redisPath, filename: redisPath, loaded: true, exports: redis };
const schema = require("../src/schemas/ocr.schema");
const service = require("../src/services/ocr.service");
const controller = require("../src/controllers/ocr.controller");
const originalFetch = global.fetch;
const originalDateNow = Date.now;
const originalToken = process.env.CORE_OCR_SERVICE_TOKEN;
const originalGrpcToken = process.env.GRPC_OCR_SERVICE_TOKEN;
afterEach(() => {
  global.fetch = originalFetch;
  Date.now = originalDateNow;
  redis.status = "connecting";
  redis.eval = async () => { throw new Error("unexpected Redis call"); };
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

test("network disconnect after the Python watchdog is reported as a timeout", async () => {
  process.env.CORE_OCR_SERVICE_TOKEN = "test-secret";
  const started = originalDateNow();
  Date.now = () => started;
  global.fetch = async () => {
    Date.now = () => started + 80_100;
    throw new TypeError("fetch failed");
  };
  await assert.rejects(service.recognize(input("watchdog-disconnect")), {
    statusCode: 504,
    errorCode: "ERR_OCR_TIMEOUT",
  });
});

test("OCR admits one request at a time and busy requests do not consume quota", async () => {
  process.env.CORE_OCR_SERVICE_TOKEN = "test-secret";
  let finish;
  let calls = 0;
  global.fetch = async () => {
    calls++;
    if (calls === 1) await new Promise((resolve) => { finish = resolve; });
    return {
      ok: true,
      json: async () => ({ success: true, data: {
        documentType: "vn_identity_card", fields: {},
      } }),
    };
  };
  const user = `admission-${Date.now()}`;
  const first = service.recognize(input(user));
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(service.recognize(input(user)), { statusCode: 429 });
  finish();
  await first;
  for (let i = 0; i < 4; i++) await service.recognize(input(user));
  await assert.rejects(service.recognize(input(user)), { statusCode: 429 });
  assert.equal(calls, 5);
});

test("OCR uses an atomic Redis admission and releases its own lease", async () => {
  process.env.CORE_OCR_SERVICE_TOKEN = "test-secret";
  redis.status = "ready";
  const calls = [];
  redis.eval = async (...args) => {
    calls.push(args);
    return calls.length === 1 ? "ADMITTED" : 1;
  };
  global.fetch = async () => ({ ok: true, json: async () => ({
    success: true, data: { documentType: "vn_identity_card", fields: {} },
  }) });
  await service.recognize(input("redis-admission"));
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1], 2);
  assert.equal(calls[0][2], "ocr:inference:lease");
  assert.match(calls[0][3], /^ocr:rate:user:[0-9a-f]{64}$/);
  assert.equal(calls[1][1], 1);
  assert.equal(calls[1][2], "ocr:inference:lease");
  assert.equal(calls[1][3], calls[0][4]);
});

test("OCR rate limit reaches gRPC as RESOURCE_EXHAUSTED with its error code", async () => {
  process.env.CORE_OCR_SERVICE_TOKEN = "test-secret";
  process.env.GRPC_OCR_SERVICE_TOKEN = "test-secret";
  const userId = `grpc-rate-${Date.now()}`;
  global.fetch = async () => ({ ok: true, json: async () => ({
    success: true, data: { documentType: "vn_identity_card", fields: {} },
  }) });
  for (let i = 0; i < 5; i++) await service.recognize(input(userId));
  const error = await new Promise((resolve) => controller.recognize({
    metadata: { get: () => ["test-secret"] },
    request: input(userId),
  }, resolve));
  assert.equal(error.code, 8);
  assert.equal(error.metadata.get("x-ocr-error-code")[0], "ERR_OCR_RATE_LIMITED");
});
