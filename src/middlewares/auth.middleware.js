const JWTService = require("../services/jwt.service");
const {
  UnauthorizedException,
  ForbiddenException,
} = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");

/**
 * Authentication Middleware
 * Bảo vệ các route yêu cầu đăng nhập bằng cách kiểm tra JWT trong cookie.
 */
const protect = async (req, res, next) => {
  try {
    const token = req.cookies?.token;

    if (!token) {
      throw new UnauthorizedException(ErrorCodes.UNAUTHORIZED);
    }

    const decoded = JWTService.verify(token);
    if (!decoded) {
      throw new UnauthorizedException(ErrorCodes.UNAUTHORIZED);
    }
    req.user = decoded;

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Authorization Middleware (RBAC)
 * Giới hạn quyền truy cập dựa trên Role của người dùng.
 * @param {...string} allowedRoles - Danh sách các role được phép truy cập
 */
const restrictTo = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user || !allowedRoles.includes(req.user.role)) {
        throw new ForbiddenException(ErrorCodes.FORBIDDEN);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = {
  protect,
  restrictTo,
};
