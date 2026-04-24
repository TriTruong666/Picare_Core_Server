const ResponseHandler = require("../common/response.handler");
const HubClientService = require("../services/hub_client.service");
const { validationResult } = require("express-validator");
const { BadRequestException } = require("../common/exceptions/BaseException");

class HubClientController {
  /**
   * Get hub clients with pagination
   */
  static async getClientsPaginate(req, res, next) {
    try {
      const { page = 1, limit = 20, search = "", status = "" } = req.query;
      const result = await HubClientService.getClientsPaginate({
        page,
        limit,
        search,
        status,
      });

      return ResponseHandler.paginate(
        res,
        result.clients,
        result.count,
        result.page,
        result.limit,
        "Lấy danh sách Hub Clients thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get detail of a hub client by clientId
   */
  static async getClientById(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
      }

      const { clientId } = req.params;
      const client = await HubClientService.getClientByClientId(clientId);

      return ResponseHandler.success(
        res,
        client,
        "Lấy thông tin Hub Client thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new hub client
   */
  static async createClient(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
      }

      const client = await HubClientService.createClient(req.body);

      return ResponseHandler.created(
        res,
        client,
        "Tạo Hub Client mới thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update hub client information
   */
  static async updateClient(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
      }

      const { clientId } = req.params;
      const client = await HubClientService.updateClient(clientId, req.body);

      return ResponseHandler.success(
        res,
        client,
        "Cập nhật Hub Client thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a hub client
   */
  static async deleteClient(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
      }

      const { clientId } = req.params;
      const result = await HubClientService.deleteClient(clientId);

      return ResponseHandler.success(res, null, result.message);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check if the current user (via cookie token) has access to a specific client.
   * Used when user already has a session and navigates to a client.
   */
  static async checkClientAccess(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
      }

      const token = req.cookies?.token;
      const { clientId } = req.params;
      const result = await HubClientService.checkClientAccess(token, clientId);

      return ResponseHandler.success(
        res,
        result,
        "Tài khoản có quyền truy cập vào client này"
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = HubClientController;
