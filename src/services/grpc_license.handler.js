const { LicenseSoftware } = require("../models");

/**
 * Handler cho các RPC của LicenseService
 */
const grpcLicenseHandler = {
  /**
   * RPC: GetLicenseConfig
   */
  getLicenseConfig: async (call, callback) => {
    try {
      const { clientId } = call.request;

      if (!clientId) {
        return callback(null, {
          active: false,
          status: "inactive",
          enabledFeatures: [],
          message: "Thiếu Client ID.",
        });
      }

      // Tìm LicenseSoftware theo ID (chính là CLIENT_ID cấu hình bên Client)
      const software = await LicenseSoftware.findByPk(clientId);

      if (!software) {
        return callback(null, {
          active: false,
          status: "not_found",
          enabledFeatures: [],
          message: "Không tìm thấy bản quyền phần mềm này trên Hub.",
        });
      }

      const isActive = software.status === "active";
      
      // Lấy danh sách tính năng được bật/tắt từ cột serverConfig (JSONB)
      let enabledFeatures = [];
      if (isActive && software.serverConfig) {
        // Lọc các key có giá trị là true trong serverConfig (ví dụ: { "s3": true, "mail": false })
        enabledFeatures = Object.keys(software.serverConfig).filter(
          (key) => software.serverConfig[key] === true
        );
      }

      return callback(null, {
        active: isActive,
        status: software.status,
        enabledFeatures: enabledFeatures,
        message: isActive ? "Bản quyền phần mềm hợp lệ." : "Bản quyền phần mềm đã bị khóa.",
      });
    } catch (error) {
      console.error("[gRPC License]: Lỗi khi kiểm tra bản quyền:", error.message);
      return callback(error);
    }
  },
};

module.exports = grpcLicenseHandler;
