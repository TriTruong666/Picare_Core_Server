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

    const decoded = await JWTService.verifyUserSession(token);
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
      const decoded = await JWTService.verifyUserSession(cookieToken);
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

/**
 * Middleware xác thực API upload cho thực tập sinh.
 * Header bắt buộc: x-picare-s3-upload-key
 */
const protectInternUpload = (req, res, next) => {
  try {
    const configuredKey = process.env.INTERN_UPLOAD_API_KEY;
    if (!configuredKey) {
      throw new ForbiddenException(
        ErrorCodes.FORBIDDEN,
        "Chưa cấu hình INTERN_UPLOAD_API_KEY trên hệ thống",
      );
    }

    const apiKey =
      req.headers["x-picare-s3-upload-key"] ||
      req.headers["x-api-key"] ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7).trim()
        : null);

    if (!apiKey || apiKey !== configuredKey) {
      throw new UnauthorizedException(
        ErrorCodes.UNAUTHORIZED,
        "Upload Key không hợp lệ hoặc thiếu header x-picare-s3-upload-key",
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware xác thực API xem file (view) cho thực tập sinh.
 * Header bắt buộc: x-picare-s3-view-key (hoặc query param k)
 */
const protectInternView = (req, res, next) => {
  try {
    const configuredKey = process.env.INTERN_VIEW_API_KEY;
    if (!configuredKey) {
      throw new ForbiddenException(
        ErrorCodes.FORBIDDEN,
        "Chưa cấu hình INTERN_VIEW_API_KEY trên hệ thống",
      );
    }

    const apiKey =
      req.headers["x-picare-s3-view-key"] ||
      req.query?.k ||
      req.query?.key ||
      req.headers["x-api-key"] ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7).trim()
        : null);

    if (!apiKey || apiKey !== configuredKey) {
      throw new UnauthorizedException(
        ErrorCodes.UNAUTHORIZED,
        "View Key không hợp lệ hoặc thiếu header x-picare-s3-view-key (hoặc query k)",
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  protect,
  protectContractAccess,
  restrictTo,
  protectInternUpload,
  protectInternView,
};


