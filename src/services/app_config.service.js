const AppConfig = require("../models/app_config.model");

class AppConfigService {
  constructor() {
    this.cache = null;
  }

  async getConfig() {
    if (this.cache) return this.cache;

    const config = await AppConfig.findOne({ where: { key: "main" } });
    if (!config) {
      throw new Error("Main configuration not found in database");
    }

    this.cache = config;
    return config;
  }

  invalidateCache() {
    this.cache = null;
  }
}

module.exports = new AppConfigService();
