const LicenseService = require("./license.service");
const ErrorCodes = require("../common/exceptions/error_codes");

/**
 * Handler cho các RPC của LicenseService
 */
const grpcLicenseHandler = {
  checkLicense: async (call, callback) => {
    try {
      const { licenseKey, softwareId } = call.request;
      if (!licenseKey || !softwareId) {
        return callback(null, {
          active: false,
          status: "inactive",
          enabledFeatures: [],
          message: ErrorCodes.GRPC_LICENSE_INPUT_MISSING.message,
        });
      }

      const result = await LicenseService.checkSoftwareAccess({ licenseKey, softwareId });
      return callback(null, {
        active: true,
        status: result.status,
        enabledFeatures: result.software.enabledFeatures,
        message: "License hợp lệ.",
        licenseId: result.customer.id,
        customerName: result.customer.name,
        softwareName: result.software.name,
      });
    } catch (error) {
      return callback(null, {
        active: false,
        status: "invalid",
        enabledFeatures: [],
        message: error.message,
      });
    }
  },
  /**
   * RPC: GetLicenseConfig
   */
  getLicenseConfig: async (call, callback) => {
    try {
      const { licenseKey, softwareId } = call.request;

      if (!licenseKey || !softwareId) {
        return callback(null, {
          active: false,
          status: "inactive",
          enabledFeatures: [],
          message: ErrorCodes.GRPC_LICENSE_INPUT_MISSING.message,
        });
      }

      const result = await LicenseService.checkServerAccess({ licenseKey, softwareId });

      return callback(null, {
        active: result.active,
        status: result.status,
        enabledFeatures: result.software.enabledFeatures,
        message: "Bản quyền server hợp lệ.",
        licenseId: result.customer.id,
        customerName: result.customer.name,
        softwareName: result.software.name,
      });
    } catch (error) {
      console.warn("[gRPC License]: Từ chối bản quyền:", error.message);
      return callback(null, {
        active: false,
        status: error.statusCode === 403 ? "error" : "not_found",
        enabledFeatures: [],
        message: error.message,
      });
    }
  },
};

module.exports = grpcLicenseHandler;
