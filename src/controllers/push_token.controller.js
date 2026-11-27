"use strict";

const { validationResult } = require("express-validator");
const PushNotificationService = require("../services/push_notification.service");
const ResponseHandler = require("../utils/response_handler");
const { BadRequestException } = require("../common/exceptions");

class PushTokenController {
  /**
   * POST /api/v1/push-tokens/register
   */
  static async register(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Lỗi validation", errors.array());
      }

      const { userId } = req.user;
      const { token, deviceId, platform, tokenType, appBundleId } = req.body;
      const record = await PushNotificationService.registerToken(userId, {
        token,
        deviceId,
        platform,
        tokenType,
        appBundleId,
      });

      return ResponseHandler.success(
        res,
        {
          id: record.id,
          deviceId: record.deviceId,
          platform: record.platform,
          tokenType: record.tokenType,
          isActive: record.isActive,
          lastSeenAt: record.lastSeenAt,
        },
        "Đăng ký Push Token thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/push-tokens
   */
  static async unregister(req, res, next) {
    try {
      const { userId } = req.user;
      const token = req.body?.token || req.query?.token;
      const deviceId = req.body?.deviceId || req.query?.deviceId;
      const result = await PushNotificationService.unregisterToken(userId, {
        token,
        deviceId,
      });

      return ResponseHandler.success(
        res,
        result,
        "Huỷ đăng ký Push Token thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/push-tokens/me
   */
  static async listMine(req, res, next) {
    try {
      const { userId } = req.user;
      const records = await PushNotificationService.listUserTokens(userId);
      return ResponseHandler.success(
        res,
        records.map((r) => ({
          id: r.id,
          deviceId: r.deviceId,
          platform: r.platform,
          tokenType: r.tokenType,
          appBundleId: r.appBundleId,
          lastSeenAt: r.lastSeenAt,
        })),
        "Lấy danh sách thiết bị push thành công",
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = PushTokenController;
