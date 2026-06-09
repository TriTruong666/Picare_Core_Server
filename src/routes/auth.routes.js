const express = require("express");
const router = express.Router();
const AuthController = require("../controllers/auth.controller");
const { protect } = require("../middlewares/auth.middleware");
const {
  loginSchema,
  registerSchema,
  logoutSchema,
  changePasswordSchema,
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
 *     parameters:
 *       - in: query
 *         name: clientId
 *         required: false
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Optional client id for client-specific access checks.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login success
 *       401:
 *         description: Invalid email or password
 *       403:
 *         description: Role is not allowed for this client
 *       404:
 *         description: Client not found
 */
router.post("/login", loginSchema, AuthController.login);

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
 *         description: Register success
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
 * /api/v1/auth/change-password:
 *   post:
 *     summary: Change password
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
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
