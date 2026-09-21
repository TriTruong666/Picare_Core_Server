"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createTrustedIpRecord,
  normalizeTrustedIpRecords,
  sanitizeDevice,
} = require("../src/utils/trusted_ip.util");

test("creates a trusted IP record with metadata and expiry", () => {
  const record = createTrustedIpRecord({
    ipAddress: "::ffff:203.0.113.10",
    device: "Test Browser\nInjected",
    now: new Date("2026-09-21T00:00:00.000Z"),
    ttlDays: 30,
  });

  assert.deepEqual(record, {
    ipAddress: "203.0.113.10",
    trustedAt: "2026-09-21T00:00:00.000Z",
    lastUsedAt: "2026-09-21T00:00:00.000Z",
    expiresAt: "2026-10-21T00:00:00.000Z",
    device: "Test Browser Injected",
  });
});

test("drops expired records instead of reviving them from legacy IPs", () => {
  const records = normalizeTrustedIpRecords({
    records: [
      {
        ipAddress: "203.0.113.10",
        trustedAt: "2026-08-01T00:00:00.000Z",
        lastUsedAt: "2026-08-15T00:00:00.000Z",
        expiresAt: "2026-09-01T00:00:00.000Z",
        device: "Old browser",
      },
    ],
    legacyIps: ["203.0.113.10"],
    now: new Date("2026-09-21T00:00:00.000Z"),
  });

  assert.deepEqual(records, []);
});

test("backfills legacy IPs only when metadata does not exist", () => {
  const records = normalizeTrustedIpRecords({
    records: [],
    legacyIps: ["::ffff:198.51.100.20"],
    now: new Date("2026-09-21T00:00:00.000Z"),
    ttlDays: 7,
  });

  assert.equal(records[0].ipAddress, "198.51.100.20");
  assert.equal(records[0].expiresAt, "2026-09-28T00:00:00.000Z");
  assert.equal(sanitizeDevice("\tBrowser\nName"), "Browser Name");
});
