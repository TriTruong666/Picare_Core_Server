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
   * @param {Object} [options]
   * @returns {string} token
   */
  static signUser(name, role, userId, options = {}) {
    return this.signJson({ name, role, userId }, options);
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
}

module.exports = JWTService;
