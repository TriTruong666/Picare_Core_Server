const LicenseService = require("./license.service");
const ErrorCodes = require("../common/exceptions/error_codes");

function toTicketMessage(ticket) {
  if (!ticket) return {};
  return {
    id: ticket.id || "",
    licenseId: ticket.licenseId || "",
    title: ticket.title || "",
    message: ticket.message || "",
    attachments: ticket.attachments || [],
    status: ticket.status || "",
    cancelReason: ticket.cancelReason || "",
    note: ticket.note || "",
    createdAt: ticket.createdAt ? new Date(ticket.createdAt).toISOString() : "",
    updatedAt: ticket.updatedAt ? new Date(ticket.updatedAt).toISOString() : "",
  };
}

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

  createTicket: async (call, callback) => {
    try {
      const { licenseId, licenseKey, title, message } = call.request;
      if (!licenseId || !licenseKey || !title || !message) {
        return callback(null, {
          success: false,
          message: "Thieu licenseId, licenseKey, title hoac message.",
        });
      }

      const ticket = await LicenseService.createTicketByLicenseCredentials({
        licenseId,
        licenseKey,
        payload: {
          title,
          message,
          attachments: call.request.attachments || [],
          status: call.request.status || undefined,
          cancelReason: call.request.cancelReason || null,
          note: call.request.note || null,
        },
      });

      return callback(null, {
        success: true,
        message: "Tao ticket thanh cong",
        ticket: toTicketMessage(ticket),
      });
    } catch (error) {
      return callback(null, {
        success: false,
        message: error.message,
      });
    }
  },

  listTickets: async (call, callback) => {
    try {
      const { licenseId, licenseKey } = call.request;
      if (!licenseId || !licenseKey) {
        return callback(null, {
          success: false,
          message: "Thieu licenseId hoac licenseKey.",
          tickets: [],
        });
      }

      const result = await LicenseService.getTicketsByLicenseCredentials({
        licenseId,
        licenseKey,
        page: call.request.page || 1,
        limit: call.request.limit || 20,
        search: call.request.search || "",
        status: call.request.status || undefined,
      });

      return callback(null, {
        success: true,
        message: "Lay danh sach ticket thanh cong",
        tickets: result.rows.map(toTicketMessage),
        totalRecords: result.count,
        totalPages: Math.ceil(result.count / result.limit),
        currentPage: result.page,
        pageSize: result.limit,
      });
    } catch (error) {
      return callback(null, {
        success: false,
        message: error.message,
        tickets: [],
      });
    }
  },

  getTicket: async (call, callback) => {
    try {
      const { licenseId, licenseKey, ticketId } = call.request;
      if (!licenseId || !licenseKey || !ticketId) {
        return callback(null, {
          success: false,
          message: "Thieu licenseId, licenseKey hoac ticketId.",
        });
      }

      const ticket = await LicenseService.getTicketByLicenseCredentials({
        licenseId,
        licenseKey,
        ticketId,
      });

      return callback(null, {
        success: true,
        message: "Lay chi tiet ticket thanh cong",
        ticket: toTicketMessage(ticket),
      });
    } catch (error) {
      return callback(null, {
        success: false,
        message: error.message,
      });
    }
  },
};

module.exports = grpcLicenseHandler;
