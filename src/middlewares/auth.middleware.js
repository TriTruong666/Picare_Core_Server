const JWTService = require("../services/jwt.service");
const {
  UnauthorizedException,
  ForbiddenException,
} = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");

const getHeaderValue = (req, headerName) => {
  const value = req.headers?.[headerName.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

const getBearerToken = (req) => {
  const authorization = getHeaderValue(req, "authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
};

const getPartnerContractToken = (req) => {
  const queryToken = Array.isArray(req.query?.token)
    ? req.query.token[0]
    : req.query?.token;

  return (
    queryToken ||
    getHeaderValue(req, "x-partner-token") ||
    getHeaderValue(req, "x-contract-token") ||
    getBearerToken(req)
  );
};

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
 * Middleware bảo mật kết hợp (Hybrid Auth Middleware)
 * Cho phép truy cập bằng Cookie của User đã đăng nhập HOẶC bằng Token bảo mật của Đối tác ký đính kèm trong request
 */
const protectContractAccess = async (req, res, next) => {
  try {
    const { contractId } = req.params;

    // 1. Kiểm tra session đăng nhập thông thường (Cookie)
    const cookieToken = req.cookies?.token;
    if (cookieToken) {
      const decoded = JWTService.verify(cookieToken);
      if (decoded) {
        req.user = decoded;
        return next();
      }
    }

    // 2. Kiểm tra token ký của đối tác (Query param hoặc Bearer token)
    const partnerToken = getPartnerContractToken(req);

    if (!partnerToken) {
      throw new UnauthorizedException(ErrorCodes.UNAUTHORIZED);
    }

    const decodedPartner = JWTService.verify(partnerToken);
    if (
      !decodedPartner ||
      decodedPartner.role !== "partner" ||
      decodedPartner.contractId !== contractId
    ) {
      throw new ForbiddenException(ErrorCodes.FORBIDDEN);
    }

    // Gán payload ảo cho đối tác
    req.user = {
      userId: null,
      role: "partner",
      email: decodedPartner.email,
      contractId: decodedPartner.contractId,
    };

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
  protectContractAccess,
  restrictTo,
};

