const User = require("../models/user.model");
const Role = require("../models/role.model");
const bcrypt = require("bcrypt");
const JWTService = require("./jwt.service");
const LoginVerificationService = require("./login_verification.service");
const LoginRateLimitService = require("./login_rate_limit.service");
const SocketService = require("./socket.service");
const appConfig = require("../config/app.config");

const { UserDTO } = require("../schemas/user.schema");
const { USER_STATUS } = require("../common/enum/user.enum");
const { UserRoles } = require("../common/enum/role.enum");
const { normalizeIpAddress } = require("../utils/ip.util");
const {
  createTrustedIpRecord,
  normalizeTrustedIpRecords,
  sanitizeDevice,
} = require("../utils/trusted_ip.util");

const {
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");

const INVALID_PASSWORD_HASH =
  "$2b$12$tOw8wGFPGISwIZEiuQYj/em5OAo2TMLkJpMIoi3Jz3gTgAVYIA0Kq";

class AuthService {
  static normalizeTrustedIpRecords(user, now = new Date()) {
    return normalizeTrustedIpRecords({
      records: user.trustedIpRecords,
      legacyIps: user.trustedIps,
      now,
      ttlDays: appConfig.auth.loginVerification.trustedIpTtlDays,
      maxRecords: appConfig.auth.loginVerification.maxTrustedIps,
    });
  }

  static async resolveRole(roleName) {
    const normalizedRole = String(roleName || "")
      .trim()
      .toLowerCase();

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
  static async completeLogin({
    userId,
    ipAddress,
    trustIp = false,
    touchTrustedIp = false,
    device,
  }) {
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

      const now = new Date();
      let trustedIpRecords = this.normalizeTrustedIpRecords(user, now);
      const recordIndex = trustedIpRecords.findIndex(
        (record) => record.ipAddress === ipAddress,
      );

      if (trustIp && ipAddress !== "unknown") {
        const trustedRecord = createTrustedIpRecord({
          ipAddress,
          device,
          now,
          ttlDays: appConfig.auth.loginVerification.trustedIpTtlDays,
        });
        if (recordIndex >= 0) trustedIpRecords[recordIndex] = trustedRecord;
        else trustedIpRecords.unshift(trustedRecord);
      } else if (touchTrustedIp && recordIndex >= 0) {
        trustedIpRecords[recordIndex] = {
          ...trustedIpRecords[recordIndex],
          lastUsedAt: now.toISOString(),
          device: sanitizeDevice(
            device || trustedIpRecords[recordIndex].device,
          ),
        };
      }

      trustedIpRecords = trustedIpRecords
        .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
        .slice(0, appConfig.auth.loginVerification.maxTrustedIps);
      const trustedIps = trustedIpRecords.map((record) => record.ipAddress);

      await user.update(
        {
          trustedIps,
          trustedIpRecords,
          loginIp: ipAddress,
          loginAt: now,
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
      token: JWTService.signUser(
        user.name,
        user.role,
        user.userId,
        user.sessionVersion,
      ),
    };
  }

  /**
   * Login with password, then require an email OTP for an unknown IP.
   */
  static async login({ email, password, ipAddress, device }) {
    const normalizedEmail = String(email || "")
      .trim()
      .toLowerCase();
    const normalizedIpAddress = normalizeIpAddress(ipAddress);
    const rateLimitContext = {
      email: normalizedEmail,
      ipAddress: normalizedIpAddress,
    };
    await LoginRateLimitService.assertAllowed(rateLimitContext);

    const user = await User.findOne({ where: { email: normalizedEmail } });

    if (!user) {
      await bcrypt.compare(password, INVALID_PASSWORD_HASH);
      await LoginRateLimitService.recordFailure(rateLimitContext);
      throw new UnauthorizedException(ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      await LoginRateLimitService.recordFailure(rateLimitContext);
      throw new UnauthorizedException(ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }

    await LoginRateLimitService.clearAccountFailures(rateLimitContext);

    if (user.status !== USER_STATUS.ACTIVE) {
      throw new ForbiddenException(ErrorCodes.AUTH_ACCOUNT_INACTIVE);
    }

    const trustedIpRecords = this.normalizeTrustedIpRecords(user);
    const isTrustedIp = trustedIpRecords.some(
      (record) => record.ipAddress === normalizedIpAddress,
    );

    if (
      !appConfig.auth.loginVerification.enabled ||
      user.bypassIpVerification ||
      isTrustedIp
    ) {
      return this.completeLogin({
        userId: user.userId,
        ipAddress: normalizedIpAddress,
        touchTrustedIp: isTrustedIp,
        device,
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

  static async verifyLogin({ challengeId, code, ipAddress, device }) {
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
      device,
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
      attributes: ["trustedIps", "trustedIpRecords", "loginIp", "loginAt", "bypassIpVerification"],
    });
    if (!user) throw new NotFoundException(ErrorCodes.USER_NOT_FOUND);

    const trustedIpRecords = this.normalizeTrustedIpRecords(user);
    return {
      trustedIps: trustedIpRecords.map((record) => record.ipAddress),
      trustedIpRecords,
      currentLoginIp: user.loginIp,
      lastLoginAt: user.loginAt ?? null,
      bypassIpVerification: Boolean(user.bypassIpVerification),
      policy: {
        ttlDays: appConfig.auth.loginVerification.trustedIpTtlDays,
        maxRecords: appConfig.auth.loginVerification.maxTrustedIps,
      },
    };
  }

  static async revokeTrustedIp({ userId, ipAddress }) {
    const user = await User.findOne({ where: { userId } });
    if (!user) throw new NotFoundException(ErrorCodes.USER_NOT_FOUND);

    const normalizedIpAddress = normalizeIpAddress(ipAddress);
    const trustedIpRecords = this.normalizeTrustedIpRecords(user);
    if (
      !trustedIpRecords.some(
        (record) => record.ipAddress === normalizedIpAddress,
      )
    ) {
      throw new NotFoundException(ErrorCodes.AUTH_TRUSTED_IP_NOT_FOUND);
    }

    const nextRecords = trustedIpRecords.filter(
      (record) => record.ipAddress !== normalizedIpAddress,
    );
    await user.update({
      trustedIps: nextRecords.map((record) => record.ipAddress),
      trustedIpRecords: nextRecords,
    });
    return { message: "Đã thu hồi địa chỉ IP tin cậy" };
  }

  static async revokeAllTrustedIps({ userId }) {
    const [updated] = await User.update(
      { trustedIps: [], trustedIpRecords: [] },
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
        ? (userData.phone ?? null)
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
      throw new BadRequestException(
        ErrorCodes.AUTH_NEW_PASSWORD_MUST_DIFFERENT,
      );
    }

    await user.update({ password: newPassword });
    SocketService.disconnectUser(user.userId, "password_changed");

    return { message: "Đổi mật khẩu thành công" };
  }
}

module.exports = AuthService;
