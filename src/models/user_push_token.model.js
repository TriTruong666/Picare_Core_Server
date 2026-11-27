"use strict";

const { DataTypes } = require("sequelize");
const sequelize = require("../config/postgres.config");

/**
 * UserPushToken Model
 * Lưu danh sách thiết bị di động (iOS / Android) đã đăng ký nhận Push Notification
 * (Expo Push Token, APNs Device Token, hoặc FCM Registration Token).
 */
const UserPushToken = sequelize.define(
  "UserPushToken",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "user_id",
      comment: "FK tới users.user_id",
    },
    deviceId: {
      type: DataTypes.STRING(128),
      allowNull: false,
      field: "device_id",
      comment: "Mã định danh thiết bị (ổn định theo từng máy)",
    },
    platform: {
      type: DataTypes.STRING(16),
      allowNull: false,
      validate: {
        isIn: [["ios", "android"]],
      },
      comment: "Nền tảng thiết bị: ios | android",
    },
    tokenType: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: "expo",
      field: "token_type",
      validate: {
        isIn: [["expo", "apns", "fcm"]],
      },
      comment: "Loại token: expo | apns | fcm",
    },
    token: {
      type: DataTypes.STRING(512),
      allowNull: false,
      unique: true,
      comment: "Chuỗi Push Token dùng để gửi thông báo đẩy",
    },
    appBundleId: {
      type: DataTypes.STRING(128),
      allowNull: false,
      defaultValue: "vn.picare.office",
      field: "app_bundle_id",
      comment: "Bundle ID / Package Name của app mobile",
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "is_active",
      comment: "Tự động tắt nếu Expo/APNs/FCM trả về DeviceNotRegistered",
    },
    lastSeenAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "last_seen_at",
      comment: "Thời điểm thiết bị đăng ký / làm mới token gần nhất",
    },
  },
  {
    tableName: "user_push_tokens",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["token"], name: "uq_user_push_tokens_token" },
      { fields: ["user_id", "is_active"], name: "idx_user_push_tokens_user_active" },
      { fields: ["user_id", "device_id"], name: "idx_user_push_tokens_user_device" },
    ],
  },
);

module.exports = UserPushToken;
