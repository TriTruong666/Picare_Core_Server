const ResponseHandler = require("../common/response.handler");
const UserService = require("../services/user.service");
const { validationResult } = require("express-validator");
const { BadRequestException } = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");

class UserController {
  /**
   * Lấy thông tin người dùng hiện tại (Profile)
   */
  static async getMe(req, res, next) {
    try {
      const token = req.cookies.token;
      const user = await UserService.getMe(token);

      return ResponseHandler.success(
        res,
        user,
        "Xác thực người dùng thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  static async getUserPaginate(req, res, next) {
    try {
      const { page = 1, limit = 20, search = "", role = "" } = req.query;
      const result = await UserService.getUserPaginate({
        page,
        limit,
        search,
        role,
      });

      return ResponseHandler.paginate(
        res,
        result.users,
        result.count,
        result.page,
        result.limit,
        "Lấy danh sách người dùng thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Lấy danh sách tất cả người dùng
   */
  static async getAllUsers(req, res, next) {
    try {
      const users = await UserService.getAllUsers();
      return ResponseHandler.success(
        res,
        users,
        "Lấy danh sách người dùng thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Lấy chi tiết một người dùng theo userId
   */
  static async getUserById(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { userId } = req.params;
      const user = await UserService.getUserByUserId(userId);

      return ResponseHandler.success(
        res,
        user,
        "Lấy thông tin người dùng thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Tạo người dùng mới
   */
  static async createUser(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const user = await UserService.createUser(req.body);

      return ResponseHandler.created(
        res,
        user,
        "Tạo người dùng mới thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cập nhật thông tin người dùng
   */
  static async updateUser(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { userId } = req.params;
      const user = await UserService.updateUser(userId, req.body);

      return ResponseHandler.success(
        res,
        user,
        "Cập nhật người dùng thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Xóa người dùng
   */
  static async deleteUser(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { userId } = req.params;
      const result = await UserService.deleteUser(userId);

      return ResponseHandler.success(res, null, result.message);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = UserController;
