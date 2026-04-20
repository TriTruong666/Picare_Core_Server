const JWTService = require("./jwt.service");
const { User, Role, Permission } = require("../models");

/**
 * Handler cho các RPC của AuthService
 */
const grpcAuthHandler = {
  /**
   * RPC: VerifyToken
   */
  verifyToken: (call, callback) => {
    const { token } = call.request;

    if (!token) {
      return callback(null, { valid: false });
    }

    const decoded = JWTService.verify(token);

    if (!decoded) {
      return callback(null, { valid: false });
    }

    return callback(null, {
      valid: true,
      userId: decoded.userId,
      name: decoded.name,
      role: decoded.role,
    });
  },

  /**
   * RPC: CheckPermission
   */
  checkPermission: async (call, callback) => {
    try {
      const { userId, permission } = call.request;

      if (!userId || !permission) {
        return callback(null, { allowed: false });
      }

      // 1. Tìm user cùng với Role và các Permission liên kết
      // Chúng ta kiểm tra quyền cụ thể HOẶC quyền admin (*)
      const user = await User.findOne({
        where: { userId },
        include: [
          {
            model: Role,
            include: [
              {
                model: Permission,
                where: {
                  name: [permission, "*"], // Tìm một trong hai permission này
                },
                required: false,
              },
            ],
          },
        ],
      });

      if (!user) {
        console.log(`[gRPC Auth]: User ${userId} không tồn tại.`);
        return callback(null, { allowed: false });
      }

      // Kiểm tra logic: Nếu User có Role gắn với Permission hợp lệ
      const hasPermission =
        user.Role && user.Role.Permissions && user.Role.Permissions.length > 0;

      // Fallback cho legacy system: Kiểm tra role string "admin"
      const isLegacyAdmin = user.role === "admin";

      const isAllowed = hasPermission || isLegacyAdmin;

      console.log(
        `[gRPC Auth]: CheckPermission -> User: ${user.email}, Permission: ${permission} -> ${isAllowed ? "ALLOWED" : "DENIED"}`,
      );

      return callback(null, { allowed: isAllowed });
    } catch (error) {
      console.error("[gRPC Auth]: Lỗi khi kiểm tra quyền:", error.message);
      return callback(error);
    }
  },
};

module.exports = grpcAuthHandler;
