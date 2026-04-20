const ResponseHandler = require("../common/response.handler");
const { BaseException } = require("../common/exceptions/BaseException");

/**
 * Global Error Handler Middleware
 * Tự động bắt mọi lỗi trong ứng dụng và format về định dạng chuẩn.
 */
const globalErrorHandler = (err, req, res, next) => {
  // 1. Phân loại lỗi
  let { statusCode = 500, message = "Internal Server Error", errorCode = "ERR_INTERNAL_001", details = null } = err;

  // 2. Xử lý các loại lỗi hệ thống khác nhau
  
  // A. Trường hợp là lỗi tùy chỉnh (BaseException) của chúng ta
  if (err instanceof BaseException) {
    statusCode = err.statusCode;
    message = err.message;
    errorCode = err.errorCode;
    details = err.details;
  }
  // B. Lỗi từ Sequelize
  else if (err.name === "SequelizeUniqueConstraintError") {
    statusCode = 409;
    message = "Dữ liệu đã tồn tại trong hệ thống (Unique Constraint)";
    errorCode = "ERR_DB_002";
    details = err.errors;
  }
  // C. Lỗi validate từ express-validator (Tùy chọn)
  else if (err.name === "ValidationError") {
    statusCode = 400;
    message = "Dữ liệu yêu cầu không hợp lệ";
    errorCode = "ERR_BAD_REQUEST_001";
    details = err.errors;
  }

  // 3. In log ra console phục vụ debug (chỉ in ở DEV hoặc với lỗi 500)
  if (statusCode === 500 || process.env.NODE_ENV === "development") {
    console.error(`[ERROR] ${req.method} ${req.url} - ${message}`, {
      errorCode,
      details,
      stack: err.stack,
    });
  }

  // 4. Trả về Response chuẩn qua ResponseHandler
  if (statusCode >= 500) {
    return ResponseHandler.internalError(res, message, err, errorCode, details);
  }

  return ResponseHandler.error(res, message, statusCode, errorCode, details);
};

module.exports = globalErrorHandler;

