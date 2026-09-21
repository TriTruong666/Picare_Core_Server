const ResponseHandler = require("../common/response.handler");
const UserService = require("../services/user.service");
const { validationResult } = require("express-validator");
const { BadRequestException } = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");

class UserController {
  static async getMe(req, res, next) {
    try {
      const token = req.cookies.token;
      const user = await UserService.getMe(token);

      return ResponseHandler.success(
        res,
        user,
        "Xác thực người dùng thành công",
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
        "Lấy danh sách người dùng thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  static async getAllUsers(req, res, next) {
    try {
      const users = await UserService.getAllUsers();
      return ResponseHandler.success(
        res,
        users,
        "Lấy danh sách người dùng thành công",
      );
    } catch (error) {
      next(error);
    }
  }

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
        "Lấy thông tin người dùng thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  static async createUser(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const user = await UserService.createUser(req.body, req.user);

      return ResponseHandler.created(
        res,
        user,
        "Tạo người dùng mới thành công",
      );
    } catch (error) {
      next(error);
    }
  }

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
        "Cập nhật người dùng thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  static async updateAuthPolicy(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const result = await UserService.updateAuthPolicy(
        req.params.userId,
        req.body,
      );
      return ResponseHandler.success(
        res,
        result,
        "Cập nhật chính sách xác thực thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  static async revokeAllTrustedIps(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const result = await UserService.revokeAllTrustedIps(req.params.userId);
      return ResponseHandler.success(res, null, result.message);
    } catch (error) {
      next(error);
    }
  }

  static async getTrustedIps(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const result = await UserService.getTrustedIps(req.params.userId);
      return ResponseHandler.success(
        res,
        result,
        "Lấy danh sách IP tin cậy thành công",
      );
    } catch (error) {
      next(error);
    }
  }

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
