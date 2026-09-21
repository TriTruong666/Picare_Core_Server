"use strict";

const { normalizeIpAddress } = require("./ip.util");

const toIsoString = (value, fallback) => {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime())
    ? new Date(fallback).toISOString()
    : date.toISOString();
};

const sanitizeDevice = (value) =>
  String(value || "Unknown device")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 512) || "Unknown device";

const getRequestDevice = (req) =>
  sanitizeDevice(req.get?.("x-device-name") || req.get?.("user-agent"));

const createTrustedIpRecord = ({
  ipAddress,
  device,
  now = new Date(),
  ttlDays = 30,
}) => {
  const trustedAt = new Date(now);
  const expiresAt = new Date(trustedAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + ttlDays);

  return {
    ipAddress: normalizeIpAddress(ipAddress),
    trustedAt: trustedAt.toISOString(),
    lastUsedAt: trustedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    device: sanitizeDevice(device),
  };
};

const normalizeTrustedIpRecords = ({
  records,
  legacyIps = [],
  now = new Date(),
  ttlDays = 30,
  maxRecords = 10,
}) => {
  const nowDate = new Date(now);
  const fallbackExpiresAt = new Date(nowDate);
  fallbackExpiresAt.setUTCDate(fallbackExpiresAt.getUTCDate() + ttlDays);
  const byIp = new Map();

  for (const record of Array.isArray(records) ? records : []) {
    const ipAddress = normalizeIpAddress(record?.ipAddress);
    const expiresAt = new Date(record?.expiresAt);
    if (
      !ipAddress ||
      ipAddress === "unknown" ||
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt <= nowDate
    ) {
      continue;
    }

    const normalized = {
      ipAddress,
      trustedAt: toIsoString(record.trustedAt, nowDate),
      lastUsedAt: toIsoString(record.lastUsedAt, record.trustedAt || nowDate),
      expiresAt: expiresAt.toISOString(),
      device: sanitizeDevice(record.device),
    };
    const current = byIp.get(ipAddress);
    if (!current || normalized.lastUsedAt > current.lastUsedAt) {
      byIp.set(ipAddress, normalized);
    }
  }

  const hasMetadataRecords = Array.isArray(records) && records.length > 0;
  if (!hasMetadataRecords) {
    for (const legacyIp of Array.isArray(legacyIps) ? legacyIps : []) {
      const ipAddress = normalizeIpAddress(legacyIp);
      if (!ipAddress || ipAddress === "unknown" || byIp.has(ipAddress))
        continue;
      byIp.set(ipAddress, {
        ipAddress,
        trustedAt: nowDate.toISOString(),
        lastUsedAt: nowDate.toISOString(),
        expiresAt: fallbackExpiresAt.toISOString(),
        device: "Migrated trusted IP",
      });
    }
  }

  return [...byIp.values()]
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
    .slice(0, Math.max(1, maxRecords));
};

module.exports = {
  createTrustedIpRecord,
  getRequestDevice,
  normalizeTrustedIpRecords,
  sanitizeDevice,
};
