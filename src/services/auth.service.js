const User = require("../models/user.model");
const JWTService = require("./jwt.service");

const { UserDTO } = require("../schemas/user.schema");

const {
  UnauthorizedException,
  BadRequestException,
} = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");

class AuthService {
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
    await user.update({ isOnline: true });

    return {
      message: "Đăng nhập thành công",
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

    const user = await User.create(userData);

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

    return { message: "Đăng xuất thành công" };
  }
}

module.exports = AuthService;
