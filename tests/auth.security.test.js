"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const mockModule = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { filename, id: filename, loaded: true, exports };
};

let currentUser = null;
let createdUserPayload = null;
let createdChallengePayload = null;
let rateLimitFailures = [];

const User = {
  async findOne() {
    return currentUser;
  },
  async create(payload) {
    createdUserPayload = payload;
    return {
      userId: "5e104bc8-a5cf-470b-a700-6af22ae7da0c",
      ...payload,
    };
  },
};

mockModule("../src/models/user.model", User);
mockModule("../src/models/role.model", {
  async findOrCreate({ where }) {
    return [{ id: 1, name: where.name }];
  },
});
mockModule("../src/services/jwt.service", {
  signUser() {
    return "signed-token";
  },
});
mockModule("../src/services/login_verification.service", {
  async createChallenge(payload) {
    createdChallengePayload = payload;
    return {
      challengeId: "216145ee-d534-4cc4-958b-a758720c4326",
      expiresIn: 300,
      resendAfter: 60,
      maskedEmail: "u***@picare.vn",
    };
  },
  async verifyChallenge() {
    return { userId: "5e104bc8-a5cf-470b-a700-6af22ae7da0c" };
  },
});
mockModule("../src/services/login_rate_limit.service", {
  async assertAllowed() {},
  async recordFailure(context) {
    rateLimitFailures.push(context);
  },
  async clearAccountFailures() {},
});

const AuthService = require("../src/services/auth.service");
const appConfig = require("../src/config/app.config");
const { normalizeIpAddress } = require("../src/utils/ip.util");

const buildUser = (overrides = {}) => ({
  userId: "5e104bc8-a5cf-470b-a700-6af22ae7da0c",
  name: "Test User",
  email: "user@picare.vn",
  role: "default",
  status: "ACTIVE",
  trustedIps: [],
  trustedIpRecords: [],
  bypassIpVerification: false,
  sessionVersion: 0,
  async comparePassword() {
    return true;
  },
  ...overrides,
});

test("login verification is enabled in the active environment", () => {
  assert.equal(appConfig.auth.loginVerification.enabled, true);
});

test("normalizes IPv4-mapped and loopback IPv6 addresses", () => {
  assert.equal(normalizeIpAddress("::ffff:203.0.113.10"), "203.0.113.10");
  assert.equal(normalizeIpAddress("::1"), "127.0.0.1");
});

test("login from an unknown IP creates a verification challenge without a token", async () => {
  appConfig.auth.loginVerification.enabled = true;
  currentUser = buildUser();
  createdChallengePayload = null;

  const result = await AuthService.login({
    email: currentUser.email,
    password: "secret123",
    ipAddress: "::ffff:203.0.113.10",
  });

  assert.equal(result.requiresVerification, true);
  assert.equal(result.token, undefined);
  assert.equal(createdChallengePayload.ipAddress, "203.0.113.10");
  assert.equal(createdChallengePayload.user.userId, currentUser.userId);
});

test("invalid credentials are recorded against account and IP", async () => {
  currentUser = null;
  rateLimitFailures = [];

  await assert.rejects(
    AuthService.login({
      email: "Missing.User@Picare.vn",
      password: "secret123",
      ipAddress: "::ffff:198.51.100.30",
    }),
    (error) => error.errorCode === "ERR_AUTH_001",
  );

  assert.deepEqual(rateLimitFailures, [
    {
      email: "missing.user@picare.vn",
      ipAddress: "198.51.100.30",
    },
  ]);
});

test("trusted IP and admin bypass complete login without creating a challenge", async () => {
  appConfig.auth.loginVerification.enabled = true;
  const originalCompleteLogin = AuthService.completeLogin;
  const completions = [];
  AuthService.completeLogin = async (payload) => {
    completions.push(payload);
    return { requiresVerification: false, token: "signed-token" };
  };

  try {
    currentUser = buildUser({ trustedIps: ["203.0.113.10"] });
    await AuthService.login({
      email: currentUser.email,
      password: "secret123",
      ipAddress: "203.0.113.10",
    });

    currentUser = buildUser({ bypassIpVerification: true });
    await AuthService.login({
      email: currentUser.email,
      password: "secret123",
      ipAddress: "198.51.100.20",
    });

    assert.equal(completions.length, 2);
    assert.equal(completions[0].ipAddress, "203.0.113.10");
    assert.equal(completions[1].ipAddress, "198.51.100.20");
  } finally {
    AuthService.completeLogin = originalCompleteLogin;
  }
});

test("disabled login verification uses the legacy login flow", async () => {
  const originalCompleteLogin = AuthService.completeLogin;
  const originalEnabled = appConfig.auth.loginVerification.enabled;
  let completionPayload = null;

  AuthService.completeLogin = async (payload) => {
    completionPayload = payload;
    return { requiresVerification: false, token: "signed-token" };
  };

  try {
    appConfig.auth.loginVerification.enabled = false;
    currentUser = buildUser();
    createdChallengePayload = null;

    const result = await AuthService.login({
      email: currentUser.email,
      password: "secret123",
      ipAddress: "::ffff:198.51.100.20",
    });

    assert.equal(result.requiresVerification, false);
    assert.equal(result.token, "signed-token");
    assert.equal(completionPayload.ipAddress, "198.51.100.20");
    assert.equal(createdChallengePayload, null);
  } finally {
    appConfig.auth.loginVerification.enabled = originalEnabled;
    AuthService.completeLogin = originalCompleteLogin;
  }
});

test("public registration forces default role and ignores security fields", async () => {
  currentUser = null;
  createdUserPayload = null;

  await AuthService.register({
    name: "New User",
    email: "new-user@picare.vn",
    password: "secret123",
    role: "admin",
    bypassIpVerification: true,
    trustedIps: ["203.0.113.10"],
  });

  assert.equal(createdUserPayload.role, "default");
  assert.equal(createdUserPayload.bypassIpVerification, undefined);
  assert.equal(createdUserPayload.trustedIps, undefined);
});
