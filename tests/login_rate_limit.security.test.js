"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const mockModule = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { filename, id: filename, loaded: true, exports };
};

let pipelineResults = [
  [null, null],
  [null, -2],
  [null, null],
  [null, -2],
];
let evalResult = ["RECORDED", "900", "1", "1"];
let deletedKey = null;

mockModule("../src/config/redis.config", {
  pipeline() {
    return {
      get() {
        return this;
      },
      ttl() {
        return this;
      },
      async exec() {
        return pipelineResults;
      },
    };
  },
  async eval() {
    return evalResult;
  },
  async del(key) {
    deletedKey = key;
  },
});

const appConfig = require("../src/config/app.config");
const LoginRateLimitService = require("../src/services/login_rate_limit.service");

test("blocks a login when the account failure limit is already reached", async () => {
  const originalConfig = { ...appConfig.auth.loginRateLimit };
  appConfig.auth.loginRateLimit.enabled = true;
  appConfig.auth.loginRateLimit.maxAttemptsPerIp = 50;
  appConfig.auth.loginRateLimit.maxAttemptsPerAccount = 10;
  pipelineResults = [
    [null, "2"],
    [null, 500],
    [null, "10"],
    [null, 600],
  ];

  try {
    await assert.rejects(
      LoginRateLimitService.assertAllowed({
        email: "user@picare.vn",
        ipAddress: "203.0.113.10",
      }),
      (error) =>
        error.errorCode === "ERR_AUTH_016" && error.details.retryAfter === 600,
    );
  } finally {
    Object.assign(appConfig.auth.loginRateLimit, originalConfig);
  }
});

test("returns rate limit immediately when a failed attempt reaches the threshold", async () => {
  const originalConfig = { ...appConfig.auth.loginRateLimit };
  appConfig.auth.loginRateLimit.enabled = true;
  evalResult = ["LIMITED", "720", "5", "10"];

  try {
    await assert.rejects(
      LoginRateLimitService.recordFailure({
        email: "user@picare.vn",
        ipAddress: "203.0.113.10",
      }),
      (error) =>
        error.errorCode === "ERR_AUTH_016" && error.details.retryAfter === 720,
    );
  } finally {
    Object.assign(appConfig.auth.loginRateLimit, originalConfig);
  }
});

test("clears only the account failure bucket after successful credentials", async () => {
  deletedKey = null;
  await LoginRateLimitService.clearAccountFailures({
    email: "user@picare.vn",
    ipAddress: "203.0.113.10",
  });

  assert.match(deletedKey, /^auth:login-rate:account:/);
});
