const JWTService = require("./jwt.service");
const { Op } = require("sequelize");
const { User, Role, Permission } = require("../models");

const toHubUser = (user) => ({
  userId: user.userId,
  name: user.name,
  email: user.email,
  phone: user.phone || "",
  role: user.role,
  isOnline: Boolean(user.isOnline),
  note: user.note || "",
});

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

      return callback(null, { allowed: isAllowed });
    } catch (error) {
      console.error("[gRPC Auth]: Lỗi khi kiểm tra quyền:", error.message);
      return callback(error);
    }
  },

  /**
   * RPC: ListUsers
   * Chỉ trả dữ liệu an toàn để service khác tham chiếu userId, không lộ password.
   */
  listUsers: async (call, callback) => {
    try {
      const page = Math.max(Number(call.request.page) || 1, 1);
      const limit = Math.min(Math.max(Number(call.request.limit) || 20, 1), 100);
      const search = String(call.request.search || "").trim();
      const role = String(call.request.role || "").trim();
      const where = {};

      if (role) where.role = role;
      if (search) {
        where[Op.or] = [
          { name: { [Op.iLike]: `%${search}%` } },
          { email: { [Op.iLike]: `%${search}%` } },
          { phone: { [Op.iLike]: `%${search}%` } },
        ];
      }

      const { count, rows } = await User.findAndCountAll({
        where,
        order: [["createdAt", "DESC"]],
        limit,
        offset: (page - 1) * limit,
      });

      return callback(null, {
        users: rows.map(toHubUser),
        totalRecords: count,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        pageSize: limit,
      });
    } catch (error) {
      return callback(error);
    }
  },

  /** RPC: GetUser */
  getUser: async (call, callback) => {
    try {
      const userId = String(call.request.userId || "").trim();
      if (!userId) return callback(null, { found: false });

      const user = await User.findOne({ where: { userId } });
      return callback(null, {
        found: Boolean(user),
        user: user ? toHubUser(user) : undefined,
      });
    } catch (error) {
      return callback(error);
    }
  },
};

module.exports = grpcAuthHandler;
