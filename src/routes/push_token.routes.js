"use strict";

const express = require("express");
const { body } = require("express-validator");
const router = express.Router();
const PushTokenController = require("../controllers/push_token.controller");
const { protect } = require("../middlewares/auth.middleware");

router.use(protect);

const registerPushTokenSchema = [
  body("token")
    .isString()
    .trim()
    .isLength({ min: 10, max: 512 })
    .withMessage("token phải là chuỗi từ 10 đến 512 ký tự"),
  body("deviceId")
    .isString()
    .trim()
    .isLength({ min: 3, max: 128 })
    .withMessage("deviceId không hợp lệ"),
  body("platform")
    .isIn(["ios", "android"])
    .withMessage("platform phải là 'ios' hoặc 'android'"),
  body("tokenType")
    .optional()
    .isIn(["expo", "apns", "fcm"])
    .withMessage("tokenType phải là 'expo', 'apns' hoặc 'fcm'"),
  body("appBundleId")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 3, max: 128 }),
];

router.post("/register", registerPushTokenSchema, PushTokenController.register);
router.delete("/", PushTokenController.unregister);
router.get("/me", PushTokenController.listMine);

module.exports = router;
