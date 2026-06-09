const User = require("../models/user.model");
const Role = require("../models/role.model");
const JWTService = require("./jwt.service");

const { UserDTO } = require("../schemas/user.schema");

const {
  UnauthorizedException,
  BadRequestException,
} = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");

class AuthService {
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
   * Login user and return user data with token
   * @param {Object} credentials - email and password
   * @returns {Object} { message: string, token: string }
   */
  static async login({ email, password }) {
    const user = await User.findOne({ where: { email } });

    if (!user) {
      throw new UnauthorizedException(ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new UnauthorizedException(ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }

    const token = JWTService.signUser(user.name, user.role, user.userId);

    return {
      message: "Dang nhap thanh cong",
      token,
    };
  }

  /**
   * Register a new user
   * @param {Object} userData
   * @returns {Object} { user: UserDTO, token: string }
   */
  static async register(userData) {
    const existingUser = await User.findOne({
      where: { email: userData.email },
    });
    if (existingUser) {
      throw new BadRequestException(ErrorCodes.AUTH_EMAIL_TAKEN);
    }

    const normalizedRole = String(userData.role || "default").trim().toLowerCase();
    const roleRecord = await this.resolveRole(normalizedRole);
    const normalizedPhone =
      userData.phone === undefined || userData.phone === null
        ? userData.phone ?? null
        : String(userData.phone).trim() || null;

    const user = await User.create({
      ...userData,
      phone: normalizedPhone,
      role: normalizedRole,
      roleId: roleRecord?.id ?? null,
    });

    const token = JWTService.signUser(user.name, user.role, user.userId);

    return {
      user: UserDTO.fromUser(user),
      token,
    };
  }

  /**
   * Logout user
   * @returns {Object} { message: string }
   */
  static async logout({ email }) {
    const user = await User.findOne({ where: { email } });
    if (user) {
      await user.update({ isOnline: false });
    }

    return { message: "Dang xuat thanh cong" };
  }

  /**
   * Change current user's password
   * @param {Object} payload
   * @returns {Object} { message: string }
   */
  static async changePassword({ userId, oldPassword, newPassword }) {
    const user = await User.findOne({ where: { userId } });

    if (!user) {
      throw new UnauthorizedException(ErrorCodes.USER_NOT_FOUND);
    }

    const isOldPasswordMatch = await user.comparePassword(oldPassword);
    if (!isOldPasswordMatch) {
      throw new BadRequestException(ErrorCodes.AUTH_OLD_PASSWORD_INCORRECT);
    }

    if (oldPassword === newPassword) {
      throw new BadRequestException(ErrorCodes.AUTH_NEW_PASSWORD_MUST_DIFFERENT);
    }

    await user.update({ password: newPassword });

    return { message: "Doi mat khau thanh cong" };
  }
}

module.exports = AuthService;
