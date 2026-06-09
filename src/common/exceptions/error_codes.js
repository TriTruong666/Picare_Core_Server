/**
 * Centralized error codes for the application.
 */
const ErrorCodes = {
  INTERNAL_SERVER_ERROR: {
    code: "ERR_INTERNAL_001",
    message: "Da co loi xay ra phia may chu",
    statusCode: 500,
  },
  BAD_REQUEST: {
    code: "ERR_BAD_REQUEST_001",
    message: "Du lieu yeu cau khong hop le",
    statusCode: 400,
  },
  UNAUTHORIZED: {
    code: "ERR_UNAUTHORIZED_001",
    message: "Phien dang nhap da het han hoac khong hop le",
    statusCode: 401,
  },
  FORBIDDEN: {
    code: "ERR_FORBIDDEN_001",
    message: "Ban khong co quyen thuc hien hanh dong nay",
    statusCode: 403,
  },
  NOT_FOUND: {
    code: "ERR_NOT_FOUND_001",
    message: "Khong tim thay tai nguyen yeu cau",
    statusCode: 404,
  },

  DATABASE_ERROR: {
    code: "ERR_DB_001",
    message: "Loi ket noi co so du lieu",
    statusCode: 500,
  },
  DUPLICATE_ENTRY: {
    code: "ERR_DB_002",
    message: "Du lieu da ton tai trong he thong",
    statusCode: 409,
  },

  AUTH_INVALID_CREDENTIALS: {
    code: "ERR_AUTH_001",
    message: "Email hoac mat khau khong chinh xac",
    statusCode: 401,
  },
  AUTH_EMAIL_TAKEN: {
    code: "ERR_AUTH_002",
    message: "Email da duoc su dung",
    statusCode: 400,
  },
  AUTH_ROLE_NOT_ALLOWED: {
    code: "ERR_AUTH_003",
    message: "Tai khoan cua ban khong co quyen truy cap vao he thong nay",
    statusCode: 403,
  },
  AUTH_OLD_PASSWORD_INCORRECT: {
    code: "ERR_AUTH_004",
    message: "Mat khau cu khong chinh xac",
    statusCode: 400,
  },
  AUTH_NEW_PASSWORD_MUST_DIFFERENT: {
    code: "ERR_AUTH_005",
    message: "Mat khau moi phai khac mat khau cu",
    statusCode: 400,
  },
  CLIENT_NOT_FOUND: {
    code: "ERR_CLIENT_001",
    message: "Khong tim thay client he thong",
    statusCode: 404,
  },

  USER_NOT_FOUND: {
    code: "ERR_USER_001",
    message: "Khong tim thay nguoi dung",
    statusCode: 400,
  },
  COMPANY_NOT_FOUND: {
    code: "ERR_COMPANY_001",
    message: "Khong tim thay cong ty",
    statusCode: 404,
  },
  SHOP_NOT_FOUND: {
    code: "ERR_SHOP_001",
    message: "Khong tim thay shop",
    statusCode: 404,
  },
  ORDER_NOT_FOUND: {
    code: "ERR_ORDER_001",
    message: "Khong tim thay don hang",
    statusCode: 404,
  },
};

module.exports = ErrorCodes;
