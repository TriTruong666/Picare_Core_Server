const jwt = require("jsonwebtoken");
const appConfig = require("../config/app.config");

class JWTService {
  /**
   * Sign a token with custom payload
   * @param {Object} payload
   * @param {Object|string} [options]
   * @returns {string} token
   */
  static signJson(payload, options = {}) {
    const signOptions =
      typeof options === "string" ? { expiresIn: options } : options;
    return jwt.sign(payload, appConfig.jwt.secret, {
      expiresIn: appConfig.jwt.expiresIn,
      ...signOptions,
    });
  }

  /**
   * Sign a token for user with specific payload: name and role
   * @param {string} name
   * @param {string} role
   * @param {string} userId
   * @param {number} [sessionVersion]
   * @param {Object} [options]
   * @returns {string} token
   */
  static signUser(name, role, userId, sessionVersion = 0, options = {}) {
    return this.signJson(
      { name, role, userId, sessionVersion: Number(sessionVersion || 0) },
      options,
    );
  }

  /**
   * Verify a token
   * @param {string} token
   * @returns {Object|null} payload or null if invalid
   */
  static verify(token) {
    try {
      return jwt.verify(token, appConfig.jwt.secret);
    } catch (error) {
      return null;
    }
  }

  /**
   * Verify a user JWT against the current account state.
   * Existing tokens without sessionVersion are treated as version 0.
   */
  static async verifyUserSession(token) {
    const decoded = this.verify(token);
    if (!decoded?.userId) return null;

    // Lazy import avoids a module cycle while AuthService is issuing tokens.
    const User = require("../models/user.model");
    const user = await User.findOne({
      where: { userId: decoded.userId },
      attributes: ["userId", "name", "role", "status", "sessionVersion"],
    });

    if (
      !user ||
      user.status !== "ACTIVE" ||
      Number(decoded.sessionVersion || 0) !== Number(user.sessionVersion || 0)
    ) {
      return null;
    }

    return {
      ...decoded,
      name: user.name,
      role: user.role,
      sessionVersion: Number(user.sessionVersion || 0),
    };
  }
}

module.exports = JWTService;
