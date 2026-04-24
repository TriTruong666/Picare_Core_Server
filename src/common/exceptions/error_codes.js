/**
 * Danh sách toàn bộ Error Codes của hệ thống.
 * Giúp quản lý thông điệp lỗi tập trung, dễ dàng thay đổi hoặc đa ngôn ngữ sau này.
 */
const ErrorCodes = {
  // Lỗi chung (General)
  INTERNAL_SERVER_ERROR: {
    code: "ERR_INTERNAL_001",
    message: "Đã có lỗi xảy ra phía máy chủ",
    statusCode: 500,
  },
  BAD_REQUEST: {
    code: "ERR_BAD_REQUEST_001",
    message: "Dữ liệu yêu cầu không hợp lệ",
    statusCode: 400,
  },
  UNAUTHORIZED: {
    code: "ERR_UNAUTHORIZED_001",
    message: "Phiên đăng nhập đã hết hạn hoặc không hợp lệ",
    statusCode: 401,
  },
  FORBIDDEN: {
    code: "ERR_FORBIDDEN_001",
    message: "Bạn không có quyền thực hiện hành động này",
    statusCode: 403,
  },
  NOT_FOUND: {
    code: "ERR_NOT_FOUND_001",
    message: "Không tìm thấy tài nguyên yêu cầu",
    statusCode: 404,
  },

  // Lỗi liên quan đến Database/Sequelize
  DATABASE_ERROR: {
    code: "ERR_DB_001",
    message: "Lỗi kết nối cơ sở dữ liệu",
    statusCode: 500,
  },
  DUPLICATE_ENTRY: {
    code: "ERR_DB_002",
    message: "Dữ liệu đã tồn tại trong hệ thống",
    statusCode: 409,
  },

  // Lỗi liên quan đến Auth
  AUTH_INVALID_CREDENTIALS: {
    code: "ERR_AUTH_001",
    message: "Email hoặc mật khẩu không chính xác",
    statusCode: 401,
  },
  AUTH_EMAIL_TAKEN: {
    code: "ERR_AUTH_002",
    message: "Email đã được sử dụng",
    statusCode: 400,
  },
  AUTH_ROLE_NOT_ALLOWED: {
    code: "ERR_AUTH_003",
    message: "Tài khoản của bạn không có quyền truy cập vào hệ thống này",
    statusCode: 403,
  },
  CLIENT_NOT_FOUND: {
    code: "ERR_CLIENT_001",
    message: "Không tìm thấy client hệ thống",
    statusCode: 404,
  },

  USER_NOT_FOUND: {
    code: "ERR_USER_001",
    message: "Không tìm thấy người dùng",
    statusCode: 400,
  },
  COMPANY_NOT_FOUND: {
    code: "ERR_COMPANY_001",
    message: "Không tìm thấy công ty",
    statusCode: 404,
  },
  SHOP_NOT_FOUND: {
    code: "ERR_SHOP_001",
    message: "Không tìm thấy shop",
    statusCode: 404,
  },
  ORDER_NOT_FOUND: {
    code: "ERR_ORDER_001",
    message: "Không tìm thấy đơn hàng",
    statusCode: 404,
  },
};

module.exports = ErrorCodes;
