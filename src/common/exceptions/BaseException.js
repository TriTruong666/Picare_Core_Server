/**
 * BaseException - Lớp cha cho tất cả các loại lỗi tùy chỉnh trong ứng dụng.
 * Kế thừa lớp Error mặc định của JS để giữ lại stack trace và tính chất của lỗi.
 */
class BaseException extends Error {
  constructor(errObject, details = null) {
    const message = typeof errObject === "string" ? errObject : (errObject?.message || "Unknown Error");
    super(message);
    this.name = this.constructor.name;
    this.statusCode = errObject?.statusCode || 500;
    this.errorCode = errObject?.code || (typeof errObject === "string" ? "ERR_BAD_REQUEST" : "ERR_UNKNOWN");
    this.message = message;
    this.details = details; // Có thể chứa danh sách lỗi validation, hoặc lỗi gốc từ DB
    
    // Ghi nhận Stack Trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Các lớp lỗi con định nghĩa sẵn (Shorthands)
 */
class BadRequestException extends BaseException {
  constructor(errObject, details) {
    super(errObject, details);
    this.statusCode = 400;
  }
}

class UnauthorizedException extends BaseException {
  constructor(errObject, details) {
    super(errObject, details);
    this.statusCode = 401;
  }
}

class NotFoundException extends BaseException {
  constructor(errObject, details) {
    super(errObject, details);
    this.statusCode = 404;
  }
}

class ForbiddenException extends BaseException {
  constructor(errObject, details) {
    super(errObject, details);
    this.statusCode = 403;
  }
}

module.exports = {
  BaseException,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
};
