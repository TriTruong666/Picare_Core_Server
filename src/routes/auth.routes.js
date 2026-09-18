const express = require("express");
const router = express.Router();
const AuthController = require("../controllers/auth.controller");
const { protect } = require("../middlewares/auth.middleware");
const {
  loginSchema,
  registerSchema,
  logoutSchema,
  changePasswordSchema,
  loginVerificationSchema,
  resendLoginCodeSchema,
  revokeTrustedIpSchema,
} = require("../schemas/auth.schema");

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication APIs
 */

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Login
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login success or email verification required for an unknown IP
 *       401:
 *         description: Invalid email or password
 *       403:
 *         description: Account is inactive
 */
router.post("/login", loginSchema, AuthController.login);

/**
 * @swagger
 * /api/v1/auth/login/verify:
 *   post:
 *     summary: Verify the 6-digit code for a login from an unknown IP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [challengeId, code]
 *             properties:
 *               challengeId:
 *                 type: string
 *                 format: uuid
 *               code:
 *                 type: string
 *                 pattern: '^\\d{6}$'
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Verification succeeded and the authentication cookie was issued
 *       400:
 *         description: Invalid or expired verification code
 *       401:
 *         description: Verification IP does not match
 *       429:
 *         description: Verification attempt limit exceeded
 */
router.post(
  "/login/verify",
  loginVerificationSchema,
  AuthController.verifyLogin,
);

/**
 * @swagger
 * /api/v1/auth/login/resend-code:
 *   post:
 *     summary: Resend the login verification code
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [challengeId]
 *             properties:
 *               challengeId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Verification code resent
 *       400:
 *         description: Challenge expired
 *       429:
 *         description: Resend cooldown or limit reached
 */
router.post(
  "/login/resend-code",
  resendLoginCodeSchema,
  AuthController.resendLoginCode,
);

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Register
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: Register success; the user must log in to start IP verification
 */
router.post("/register", registerSchema, AuthController.register);

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     summary: Logout
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Logout success
 */
router.post("/logout", logoutSchema, AuthController.logout);

/**
 * @swagger
 * /api/v1/auth/trusted-ips:
 *   get:
 *     summary: Get the current user's trusted login IPs
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Trusted IP list returned successfully
 */
router.get("/trusted-ips", protect, AuthController.getTrustedIps);

/**
 * @swagger
 * /api/v1/auth/trusted-ips:
 *   delete:
 *     summary: Revoke one trusted login IP from the current user
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ipAddress]
 *             properties:
 *               ipAddress:
 *                 type: string
 *                 example: 203.0.113.10
 *     responses:
 *       200:
 *         description: Trusted IP revoked
 *       404:
 *         description: Trusted IP not found
 */
router.delete(
  "/trusted-ips",
  protect,
  revokeTrustedIpSchema,
  AuthController.revokeTrustedIp,
);

/**
 * @swagger
 * /api/v1/auth/trusted-ips/all:
 *   delete:
 *     summary: Revoke all trusted login IPs from the current user
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: All trusted IPs revoked
 */
router.delete(
  "/trusted-ips/all",
  protect,
  AuthController.revokeAllTrustedIps,
);

/**
 * @swagger
 * /api/v1/auth/change-password:
 *   post:
 *     summary: Change password
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChangePasswordRequest'
 *     responses:
 *       200:
 *         description: Password changed successfully
 */
router.post("/change-password", protect, changePasswordSchema, AuthController.changePassword);

module.exports = router;
