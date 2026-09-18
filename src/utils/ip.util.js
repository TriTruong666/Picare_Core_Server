"use strict";

const normalizeIpAddress = (value) => {
  const ipAddress = String(value || "").trim();

  if (!ipAddress) return "unknown";
  if (ipAddress.startsWith("::ffff:")) return ipAddress.slice(7);
  if (ipAddress === "::1") return "127.0.0.1";

  return ipAddress.toLowerCase();
};

const getRequestIp = (req) =>
  normalizeIpAddress(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress);

module.exports = {
  getRequestIp,
  normalizeIpAddress,
};
