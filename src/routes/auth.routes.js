const express = require("express");
const router = express.Router();
const AuthController = require("../controllers/auth.controller");
const { loginSchema, registerSchema, logoutSchema } = require("../schemas/auth.schema");

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: API Xác thực và Quản lý tài khoản người dùng
 */

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Đăng nhập vào hệ thống
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: clientId
 *         required: false
 *         schema:
 *           type: string
 *           format: uuid
 *         description: |
 *           UUID của client cần đăng nhập vào (ví dụ OMS, CRM...).
 *           Nếu được cung cấp, hệ thống sẽ kiểm tra role của user có được phép truy cập client đó không.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Đăng nhập thành công
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Email hoặc mật khẩu không đúng
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Role của tài khoản không được phép truy cập client này
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Không tìm thấy client với clientId đã cung cấp
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/login", loginSchema, AuthController.login);

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Ghi danh tài khoản người dùng mới
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: Đăng ký thành công
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 */
router.post("/register", registerSchema, AuthController.register);

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     summary: Đăng xuất người dùng
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
 *         description: Đăng xuất thành công
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CommonResponse'
 */
router.post("/logout", logoutSchema, AuthController.logout);

module.exports = router;

