const AuthService = require("../services/auth.service");
const ResponseHandler = require("../common/response.handler");
const { validationResult } = require("express-validator");
const { BadRequestException } = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");

class AuthController {
  static async login(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { email, password } = req.body;
      const result = await AuthService.login({ email, password });

      res.cookie("token", result.token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        domain: process.env.NODE_ENV === "production" ? ".picare.vn" : "localhost",
        maxAge: 24 * 60 * 60 * 1000,
      });

      return ResponseHandler.success(res, null, result.message);
    } catch (error) {
      next(error);
    }
  }

  static async register(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const result = await AuthService.register(req.body);

      return ResponseHandler.created(res, result, "Ghi danh tai khoan thanh cong");
    } catch (error) {
      next(error);
    }
  }

  static async logout(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { email } = req.body || {};

      res.clearCookie("token", {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        domain: process.env.NODE_ENV === "production" ? ".picare.vn" : "localhost",
      });

      const result = await AuthService.logout({ email });

      return ResponseHandler.success(res, null, result.message);
    } catch (error) {
      next(error);
    }
  }

  static async changePassword(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { oldPassword, newPassword } = req.body;
      const result = await AuthService.changePassword({
        userId: req.user.userId,
        oldPassword,
        newPassword,
      });

      return ResponseHandler.success(res, null, result.message);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AuthController;
