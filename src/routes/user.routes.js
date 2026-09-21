const express = require("express");
const router = express.Router();
const UserController = require("../controllers/user.controller");
const { protect, restrictTo } = require("../middlewares/auth.middleware");
const {
  createUserSchema,
  updateUserSchema,
  userIdSchema,
  authPolicySchema,
} = require("../schemas/user.schema");

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: API quản lý người dùng
 */

/**
 * @swagger
 * /api/v1/users/me:
 *   get:
 *     summary: Lấy thông tin hồ sơ người dùng hiện tại
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Thành công
 */
router.get("/me", protect, UserController.getMe);

/**
 * @swagger
 * /api/v1/users:
 *   get:
 *     summary: Lấy danh sách người dùng phân trang
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Thành công
 */
router.get("/", protect, UserController.getUserPaginate);

/**
 * @swagger
 * /api/v1/users/{userId}:
 *   get:
 *     summary: Lấy thông tin người dùng theo ID
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Thành công
 */
router.get("/:userId", protect, userIdSchema, UserController.getUserById);

/**
 * @swagger
 * /api/v1/users:
 *   post:
 *     summary: Tạo người dùng mới
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *               phone:
 *                 type: string
 *                 nullable: true
 *               role:
 *                 type: string
 *                 description: Bất kỳ giá trị role nào cũng được chấp nhận. API sẽ tự động tạo bản ghi role nếu cần thiết.
 *     responses:
 *       201:
 *         description: Đã tạo thành công
 */
router.post(
  "/",
  protect,
  restrictTo("admin"),
  createUserSchema,
  UserController.createUser,
);

/**
 * @swagger
 * /api/v1/users/{userId}:
 *   put:
 *     summary: Cập nhật thông tin người dùng
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateUserRequest'
 *     responses:
 *       200:
 *         description: Thành công
 */
router.put(
  "/:userId",
  protect,
  restrictTo("admin"),
  updateUserSchema,
  UserController.updateUser,
);

/**
 * @swagger
 * /api/v1/users/{userId}/auth-policy:
 *   patch:
 *     summary: Cập nhật chính sách bỏ qua xác thực IP của người dùng
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bypassIpVerification]
 *             properties:
 *               bypassIpVerification:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Cập nhật chính sách xác thực thành công
 *       403:
 *         description: Chỉ quản trị viên được phép thực hiện
 */
router.patch(
  "/:userId/auth-policy",
  protect,
  restrictTo("admin"),
  authPolicySchema,
  UserController.updateAuthPolicy,
);

/**
 * @swagger
 * /api/v1/users/{userId}/trusted-ips:
 *   get:
 *     summary: Lấy metadata các IP tin cậy của người dùng
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Danh sách IP, thiết bị, lần sử dụng gần nhất và hạn tin cậy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     currentLoginIp:
 *                       type: string
 *                       nullable: true
 *                       description: IP đăng nhập gần nhất của tài khoản được xem
 *                     lastLoginAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     bypassIpVerification:
 *                       type: boolean
 *                     trustedIps:
 *                       type: array
 *                       items:
 *                         type: string
 *                     trustedIpRecords:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           ipAddress:
 *                             type: string
 *                           device:
 *                             type: string
 *                           trustedAt:
 *                             type: string
 *                             format: date-time
 *                           lastUsedAt:
 *                             type: string
 *                             format: date-time
 *                           expiresAt:
 *                             type: string
 *                             format: date-time
 *                     policy:
 *                       type: object
 *                       properties:
 *                         ttlDays:
 *                           type: integer
 *                         maxRecords:
 *                           type: integer
 *       403:
 *         description: Chỉ quản trị viên được phép thực hiện
 */
router.get(
  "/:userId/trusted-ips",
  protect,
  restrictTo("admin"),
  userIdSchema,
  UserController.getTrustedIps,
);

/**
 * @swagger
 * /api/v1/users/{userId}/trusted-ips:
 *   delete:
 *     summary: Thu hồi toàn bộ IP tin cậy của người dùng
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Thu hồi thành công
 *       403:
 *         description: Chỉ quản trị viên được phép thực hiện
 */
router.delete(
  "/:userId/trusted-ips",
  protect,
  restrictTo("admin"),
  userIdSchema,
  UserController.revokeAllTrustedIps,
);

/**
 * @swagger
 * /api/v1/users/{userId}:
 *   delete:
 *     summary: Xóa người dùng
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Thành công
 */
router.delete(
  "/:userId",
  protect,
  restrictTo("admin"),
  userIdSchema,
  UserController.deleteUser,
);

module.exports = router;
