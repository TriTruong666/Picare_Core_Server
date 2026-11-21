const AuthService = require("../services/auth.service");
const PasswordResetService = require("../services/password_reset.service");
const ResponseHandler = require("../common/response.handler");
const { validationResult } = require("express-validator");
const { BadRequestException } = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");
const { getRequestIp } = require("../utils/ip.util");
const { getRequestDevice } = require("../utils/trusted_ip.util");

class AuthController {
  static isMobileClient(req) {
    const platform = String(req.headers?.["x-client-platform"] || "")
      .trim()
      .toLowerCase();
    return platform === "mobile";
  }

  static setAuthCookie(res, token) {
    const isProduction = process.env.NODE_ENV === "production";
    res.cookie("token", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path: "/",
      ...(isProduction ? { domain: ".picare.vn" } : {}),
      maxAge: 24 * 60 * 60 * 1000,
    });
  }

  static clearAuthCookie(res) {
    const isProduction = process.env.NODE_ENV === "production";
    res.clearCookie("token", {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path: "/",
      ...(isProduction ? { domain: ".picare.vn" } : {}),
    });
  }

  static validateRequest(req) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
    }
  }

  static async login(req, res, next) {
    try {
      AuthController.validateRequest(req);

      const { email, password } = req.body;
      const result = await AuthService.login({
        email,
        password,
        ipAddress: getRequestIp(req),
        device: getRequestDevice(req),
      });

      if (result.token) AuthController.setAuthCookie(res, result.token);

      const { token, message, ...data } = result;
      const payload =
        token && AuthController.isMobileClient(req)
          ? { ...data, accessToken: token }
          : data;
      return ResponseHandler.success(res, payload, message);
    } catch (error) {
      next(error);
    }
  }

  static async verifyLogin(req, res, next) {
    try {
      AuthController.validateRequest(req);

      const result = await AuthService.verifyLogin({
        ...req.body,
        ipAddress: getRequestIp(req),
        device: getRequestDevice(req),
      });
      AuthController.setAuthCookie(res, result.token);

      const payload = AuthController.isMobileClient(req)
        ? { requiresVerification: false, accessToken: result.token }
        : { requiresVerification: false };

      return ResponseHandler.success(res, payload, result.message);
    } catch (error) {
      next(error);
    }
  }

  static async resendLoginCode(req, res, next) {
    try {
      AuthController.validateRequest(req);
      const result = await AuthService.resendLoginCode({
        challengeId: req.body.challengeId,
        ipAddress: getRequestIp(req),
      });
      return ResponseHandler.success(res, result, "Đã gửi lại mã xác thực");
    } catch (error) {
      next(error);
    }
  }

  static async getTrustedIps(req, res, next) {
    try {
      const result = await AuthService.getTrustedIps({
        userId: req.user.userId,
      });
      return ResponseHandler.success(
        res,
        result,
        "Lấy danh sách IP tin cậy thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  static async revokeTrustedIp(req, res, next) {
    try {
      AuthController.validateRequest(req);
      const result = await AuthService.revokeTrustedIp({
        userId: req.user.userId,
        ipAddress: req.body.ipAddress,
      });
      return ResponseHandler.success(res, null, result.message);
    } catch (error) {
      next(error);
    }
  }

  static async revokeAllTrustedIps(req, res, next) {
    try {
      const result = await AuthService.revokeAllTrustedIps({
        userId: req.user.userId,
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

      return ResponseHandler.created(
        res,
        result,
        "Ghi danh tai khoan thanh cong",
      );
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

      AuthController.clearAuthCookie(res);

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

      AuthController.clearAuthCookie(res);

      return ResponseHandler.success(res, null, result.message);
    } catch (error) {
      next(error);
    }
  }

  static async forgotPassword(req, res, next) {
    try {
      AuthController.validateRequest(req);
      const result = await PasswordResetService.requestReset({
        email: req.body.email,
        ipAddress: getRequestIp(req),
      });
      return ResponseHandler.success(
        res,
        result,
        "Mã OTP khôi phục mật khẩu đã được gửi tới email",
      );
    } catch (error) {
      next(error);
    }
  }

  static async verifyForgotPassword(req, res, next) {
    try {
      AuthController.validateRequest(req);
      const result = await PasswordResetService.verifyResetCode({
        challengeId: req.body.challengeId,
        code: req.body.code,
      });
      return ResponseHandler.success(res, result, "Xác thực mã OTP thành công");
    } catch (error) {
      next(error);
    }
  }

  static async resendForgotPasswordCode(req, res, next) {
    try {
      AuthController.validateRequest(req);
      const result = await PasswordResetService.resendResetCode({
        challengeId: req.body.challengeId,
        ipAddress: getRequestIp(req),
      });
      return ResponseHandler.success(res, result, "Đã gửi lại mã OTP");
    } catch (error) {
      next(error);
    }
  }

  static async resetPassword(req, res, next) {
    try {
      AuthController.validateRequest(req);
      const result = await PasswordResetService.resetPassword({
        resetToken: req.body.resetToken,
        newPassword: req.body.newPassword,
      });
      AuthController.clearAuthCookie(res);
      return ResponseHandler.success(res, null, result.message);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AuthController;
