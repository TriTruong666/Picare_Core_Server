const AppConfig = require("../models/app_config.model");
const ErrorCodes = require("../common/exceptions/error_codes");

class AppConfigService {
  constructor() {
    this.cache = null;
  }

  async getConfig() {
    if (this.cache) return this.cache;

    const config = await AppConfig.findOne({ where: { key: "main" } });
    if (!config) {
      throw new Error(ErrorCodes.APP_CONFIG_NOT_FOUND.message);
    }

    this.cache = config;
    return config;
  }

  invalidateCache() {
    this.cache = null;
  }
}

module.exports = new AppConfigService();
