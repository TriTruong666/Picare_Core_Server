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

      return ResponseHandler.success(res, user, "Xac thuc nguoi dung thanh cong");
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
        "Lay danh sach nguoi dung thanh cong"
      );
    } catch (error) {
      next(error);
    }
  }

  static async getAllUsers(req, res, next) {
    try {
      const users = await UserService.getAllUsers();
      return ResponseHandler.success(res, users, "Lay danh sach nguoi dung thanh cong");
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

      return ResponseHandler.success(res, user, "Lay thong tin nguoi dung thanh cong");
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

      return ResponseHandler.created(res, user, "Tao nguoi dung moi thanh cong");
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

      return ResponseHandler.success(res, user, "Cap nhat nguoi dung thanh cong");
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
