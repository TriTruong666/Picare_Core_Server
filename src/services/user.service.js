const { Op } = require("sequelize");
const ErrorCodes = require("../common/exceptions/error_codes");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const JWTService = require("./jwt.service");
const {
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} = require("../common/exceptions/BaseException");
const { UserDTO } = require("../schemas/user.schema");

class UserService {
  static normalizePhone(phone) {
    if (phone === undefined) {
      return undefined;
    }

    if (phone === null) {
      return null;
    }

    const normalizedPhone = String(phone).trim();
    return normalizedPhone || null;
  }

  static async resolveRole(roleName) {
    const normalizedRole = String(roleName || "").trim().toLowerCase();

    if (!normalizedRole) {
      return null;
    }

    const [role] = await Role.findOrCreate({
      where: { name: normalizedRole },
      defaults: { name: normalizedRole },
    });

    return role;
  }

  /**
   * Get current user profile from token
   */
  static async getMe(token) {
    if (!token) {
      throw new UnauthorizedException(ErrorCodes.UNAUTHORIZED);
    }

    const decoded = await JWTService.verify(token);

    const user = await User.findOne({
      where: { userId: decoded.userId },
    });

    if (!user) {
      throw new UnauthorizedException(ErrorCodes.USER_NOT_FOUND);
    }

    return UserDTO.fromUser(user);
  }

  /**
   * Get user with pagination
   */
  static async getUserPaginate({
    page = 1,
    limit = 20,
    search = "",
    role = "",
  } = {}) {
    const where = {};
    if (role) {
      where.role = role;
    } else {
      where.role = { [Op.notIn]: ["admin"] };
    }

    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { phone: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const pLimit = parseInt(limit);
    const pPage = parseInt(page);
    const offset = (pPage - 1) * pLimit;

    const { count, rows } = await User.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: pLimit,
      offset,
    });

    return {
      count,
      users: UserDTO.fromUsers(rows),
      page: pPage,
      limit: pLimit,
      totalPages: Math.ceil(count / pLimit),
    };
  }

  /**
   * Get all users
   */
  static async getAllUsers() {
    const users = await User.findAll({
      order: [["createdAt", "DESC"]],
    });
    return UserDTO.fromUsers(users);
  }

  /**
   * Get user by userId (UUID)
   */
  static async getUserByUserId(userId) {
    const user = await User.findOne({
      where: { userId },
    });

    if (!user) {
      throw new NotFoundException(ErrorCodes.USER_NOT_FOUND);
    }

    return UserDTO.fromUser(user);
  }

  /**
   * Create a new user
   */
  static async createUser(userData, currentUser) {
    if (!currentUser || currentUser.role !== "admin") {
      throw new ForbiddenException(ErrorCodes.FORBIDDEN);
    }

    const existingUser = await User.findOne({
      where: { email: userData.email },
    });
    if (existingUser) {
      throw new BadRequestException(ErrorCodes.AUTH_EMAIL_TAKEN);
    }

    const normalizedRole = String(userData.role || "default").trim().toLowerCase();
    const roleRecord = await this.resolveRole(normalizedRole);

    const newUser = await User.create({
      ...userData,
      phone: this.normalizePhone(userData.phone),
      role: normalizedRole,
      roleId: roleRecord?.id ?? null,
    });

    return UserDTO.fromUser(newUser);
  }

  /**
   * Update user information
   */
  static async updateUser(userId, updateData) {
    const user = await User.findOne({ where: { userId } });

    if (!user) {
      throw new NotFoundException(ErrorCodes.USER_NOT_FOUND);
    }

    if (updateData.email && updateData.email !== user.email) {
      const existingEmail = await User.findOne({
        where: { email: updateData.email },
      });
      if (existingEmail) {
        throw new BadRequestException(ErrorCodes.AUTH_EMAIL_TAKEN);
      }
    }

    const nextData = { ...updateData };

    if (Object.prototype.hasOwnProperty.call(updateData, "phone")) {
      nextData.phone = this.normalizePhone(updateData.phone);
    }

    if (updateData.role !== undefined) {
      const normalizedRole = String(updateData.role || "").trim().toLowerCase();

      if (!normalizedRole) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, [
          { path: "role", msg: "Role khong duoc de trong" },
        ]);
      }

      const roleRecord = await this.resolveRole(normalizedRole);
      nextData.role = normalizedRole;
      nextData.roleId = roleRecord?.id ?? null;
    }

    await user.update(nextData);
    return UserDTO.fromUser(user);
  }

  /**
   * Delete user
   */
  static async deleteUser(userId) {
    const user = await User.findOne({ where: { userId } });

    if (!user) {
      throw new NotFoundException(ErrorCodes.USER_NOT_FOUND);
    }

    await user.destroy();
    return { message: "Xoa nguoi dung thanh cong" };
  }
}

module.exports = UserService;
