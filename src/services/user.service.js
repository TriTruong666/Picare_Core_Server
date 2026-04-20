const { Op } = require("sequelize");
const ErrorCodes = require("../common/exceptions/error_codes");
const User = require("../models/user.model");
const JWTService = require("./jwt.service");
const {
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} = require("../common/exceptions/BaseException");
const { UserDTO } = require("../schemas/user.schema");
const CacheService = require("./cache.service");

class UserService {
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

    if (role) {
      where.role = role;
    }

    const pLimit = parseInt(limit);
    const pPage = parseInt(page);
    const offset = (pPage - 1) * pLimit;

    const { count, rows } = await User.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],

      limit: pLimit,
      offset: offset,
    });

    const result = {
      count,
      users: UserDTO.fromUsers(rows),
      page: pPage,
      limit: pLimit,
      totalPages: Math.ceil(count / pLimit),
    };

    return result;
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
  static async createUser(userData) {
    // Check if email already exists
    const existingUser = await User.findOne({
      where: { email: userData.email },
    });
    if (existingUser) {
      throw new BadRequestException(ErrorCodes.AUTH_EMAIL_TAKEN);
    }

    const newUser = await User.create(userData);
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

    // If updating email, check uniqueness
    if (updateData.email && updateData.email !== user.email) {
      const existingEmail = await User.findOne({
        where: { email: updateData.email },
      });
      if (existingEmail) {
        throw new BadRequestException(ErrorCodes.AUTH_EMAIL_TAKEN);
      }
    }

    await user.update(updateData);
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
    return { message: "Xóa người dùng thành công" };
  }
}

module.exports = UserService;
