const User = require("../models/user.model");
const Role = require("../models/role.model");
const JWTService = require("./jwt.service");
const LoginVerificationService = require("./login_verification.service");

const { UserDTO } = require("../schemas/user.schema");
const { USER_STATUS } = require("../common/enum/user.enum");
const { UserRoles } = require("../common/enum/role.enum");
const { normalizeIpAddress } = require("../utils/ip.util");

const {
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
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
   * Complete a login after all authentication factors have passed.
   */
  static async completeLogin({ userId, ipAddress, trustIp = false }) {
    const transaction = await User.sequelize.transaction();
    let user;

    try {
      user = await User.findOne({
        where: { userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!user) {
        throw new UnauthorizedException(ErrorCodes.USER_NOT_FOUND);
      }

      if (user.status !== USER_STATUS.ACTIVE) {
        throw new ForbiddenException(ErrorCodes.AUTH_ACCOUNT_INACTIVE);
      }

      const trustedIps = [...new Set(
        (Array.isArray(user.trustedIps) ? user.trustedIps : [])
          .map(normalizeIpAddress)
          .filter((ip) => ip && ip !== "unknown"),
      )];

      if (trustIp && !trustedIps.includes(ipAddress)) {
        trustedIps.push(ipAddress);
      }

      await user.update(
        {
          ...(trustIp ? { trustedIps } : {}),
          loginIp: ipAddress,
          loginAt: new Date(),
          isOnline: true,
        },
        { transaction },
      );
      await transaction.commit();
    } catch (error) {
      if (!transaction.finished) await transaction.rollback();
      throw error;
    }

    return {
      message: "Đăng nhập thành công",
      requiresVerification: false,
      token: JWTService.signUser(user.name, user.role, user.userId),
    };
  }

  /**
   * Login with password, then require an email OTP for an unknown IP.
   */
  static async login({ email, password, ipAddress }) {
    const user = await User.findOne({ where: { email } });

    if (!user) {
      throw new UnauthorizedException(ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new UnauthorizedException(ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }

    if (user.status !== USER_STATUS.ACTIVE) {
      throw new ForbiddenException(ErrorCodes.AUTH_ACCOUNT_INACTIVE);
    }

    const normalizedIpAddress = normalizeIpAddress(ipAddress);
    const trustedIps = (Array.isArray(user.trustedIps) ? user.trustedIps : [])
      .map(normalizeIpAddress);

    if (
      user.bypassIpVerification ||
      trustedIps.includes(normalizedIpAddress)
    ) {
      return this.completeLogin({
        userId: user.userId,
        ipAddress: normalizedIpAddress,
      });
    }

    const challenge = await LoginVerificationService.createChallenge({
      user,
      ipAddress: normalizedIpAddress,
    });

    return {
      message: "Mã xác thực đã được gửi tới email",
      requiresVerification: true,
      ...challenge,
    };
  }

  static async verifyLogin({ challengeId, code, ipAddress }) {
    const normalizedIpAddress = normalizeIpAddress(ipAddress);
    const { userId } = await LoginVerificationService.verifyChallenge({
      challengeId,
      code,
      ipAddress: normalizedIpAddress,
    });

    return this.completeLogin({
      userId,
      ipAddress: normalizedIpAddress,
      trustIp: true,
    });
  }

  static async resendLoginCode({ challengeId, ipAddress }) {
    return LoginVerificationService.resendChallenge({
      challengeId,
      ipAddress: normalizeIpAddress(ipAddress),
      findUserById: (userId) => User.findOne({ where: { userId } }),
    });
  }

  static async getTrustedIps({ userId }) {
    const user = await User.findOne({
      where: { userId },
      attributes: ["trustedIps", "loginIp"],
    });
    if (!user) throw new NotFoundException(ErrorCodes.USER_NOT_FOUND);

    return {
      trustedIps: Array.isArray(user.trustedIps) ? user.trustedIps : [],
      currentLoginIp: user.loginIp,
    };
  }

  static async revokeTrustedIp({ userId, ipAddress }) {
    const user = await User.findOne({ where: { userId } });
    if (!user) throw new NotFoundException(ErrorCodes.USER_NOT_FOUND);

    const normalizedIpAddress = normalizeIpAddress(ipAddress);
    const trustedIps = (Array.isArray(user.trustedIps) ? user.trustedIps : [])
      .map(normalizeIpAddress);
    if (!trustedIps.includes(normalizedIpAddress)) {
      throw new NotFoundException(ErrorCodes.AUTH_TRUSTED_IP_NOT_FOUND);
    }

    await user.update({
      trustedIps: trustedIps.filter((ip) => ip !== normalizedIpAddress),
    });
    return { message: "Đã thu hồi địa chỉ IP tin cậy" };
  }

  static async revokeAllTrustedIps({ userId }) {
    const [updated] = await User.update(
      { trustedIps: [] },
      { where: { userId } },
    );
    if (!updated) throw new NotFoundException(ErrorCodes.USER_NOT_FOUND);
    return { message: "Đã thu hồi toàn bộ địa chỉ IP tin cậy" };
  }

  /**
   * Register a new user
   * @param {Object} userData
   * @returns {Object} { user: UserDTO, requiresLogin: boolean }
   */
  static async register(userData) {
    const existingUser = await User.findOne({
      where: { email: userData.email },
    });
    if (existingUser) {
      throw new BadRequestException(ErrorCodes.AUTH_EMAIL_TAKEN);
    }

    const normalizedRole = UserRoles.DEFAULT;
    const roleRecord = await this.resolveRole(normalizedRole);
    const normalizedPhone =
      userData.phone === undefined || userData.phone === null
        ? userData.phone ?? null
        : String(userData.phone).trim() || null;

    const user = await User.create({
      name: userData.name,
      email: userData.email,
      password: userData.password,
      phone: normalizedPhone,
      role: normalizedRole,
      roleId: roleRecord?.id ?? null,
    });

    return {
      user: UserDTO.fromUser(user),
      requiresLogin: true,
    };
  }

  /**
   * Logout user
   * @returns {Object} { message: string }
   */
  static async logout({ email }) {
    const user = await User.findOne({ where: { email } });
    if (user) {
      await user.update({ isOnline: false, logoutAt: new Date() });
    }

    return { message: "Đăng xuất thành công" };
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

    return { message: "Đổi mật khẩu thành công" };
  }
}

module.exports = AuthService;
