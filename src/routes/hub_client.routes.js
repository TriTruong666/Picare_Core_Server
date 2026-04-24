const express = require("express");
const router = express.Router();
const HubClientController = require("../controllers/hub_client.controller");
const { protect } = require("../middlewares/auth.middleware");
const {
  createHubClientSchema,
  updateHubClientSchema,
  clientIdSchema,
  checkAccessSchema,
} = require("../schemas/hub_client.schema");

/**
 * @swagger
 * tags:
 *   name: HubClients
 *   description: API Quản lý các client kết nối với Hub
 */

/**
 * @swagger
 * /api/v1/hub-clients:
 *   get:
 *     summary: Lấy danh sách Hub Clients (Phân trang & Tìm kiếm)
 *     tags: [HubClients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Số trang hiện tại
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Số lượng bản ghi trên một trang
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Tìm kiếm theo tên hoặc mô tả
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Lọc theo trạng thái
 *     responses:
 *       200:
 *         description: Thành công
 */
router.get("/", HubClientController.getClientsPaginate);

/**
 * @swagger
 * /api/v1/hub-clients/{clientId}:
 *   get:
 *     summary: Lấy chi tiết một Hub Client theo ID
 *     tags: [HubClients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Thành công
 */
router.get("/:clientId", clientIdSchema, HubClientController.getClientById);

/**
 * @swagger
 * /api/v1/hub-clients:
 *   post:
 *     summary: Tạo mới một Hub Client
 *     tags: [HubClients]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientName, clientInternalUrl, clientExternalUrl, clientStatus]
 *             properties:
 *               clientName:
 *                 type: string
 *               clientDescription:
 *                 type: string
 *               clientInternalUrl:
 *                 type: string
 *               clientExternalUrl:
 *                 type: string
 *               clientLogoImage:
 *                 type: string
 *               clientMockupImage:
 *                 type: string
 *               clientStatus:
 *                 type: string
 *               allowedRoles:
 *                 type: array
 *                 items:
 *                   type: string
 *               note:
 *                 type: string
 *     responses:
 *       201:
 *         description: Tạo thành công
 */
router.post(
  "/",
  protect,
  createHubClientSchema,
  HubClientController.createClient,
);

/**
 * @swagger
 * /api/v1/hub-clients/{clientId}:
 *   put:
 *     summary: Cập nhật thông tin Hub Client
 *     tags: [HubClients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               clientName:
 *                 type: string
 *               clientDescription:
 *                 type: string
 *               clientInternalUrl:
 *                 type: string
 *               clientExternalUrl:
 *                 type: string
 *               clientLogoImage:
 *                 type: string
 *               clientMockupImage:
 *                 type: string
 *               clientStatus:
 *                 type: string
 *               allowedRoles:
 *                 type: array
 *                 items:
 *                   type: string
 *               note:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.put(
  "/:clientId",
  protect,
  updateHubClientSchema,
  HubClientController.updateClient,
);

/**
 * @swagger
 * /api/v1/hub-clients/{clientId}:
 *   delete:
 *     summary: Xóa một Hub Client khỏi hệ thống
 *     tags: [HubClients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Xóa thành công
 */
router.delete(
  "/:clientId",
  protect,
  clientIdSchema,
  HubClientController.deleteClient,
);

/**
 * @swagger
 * /api/v1/hub-clients/{clientId}/check-access:
 *   get:
 *     summary: Kiểm tra quyền truy cập của user hiện tại vào một client
 *     description: |
 *       Dùng khi user đã có session (cookie token). Không cần đăng nhập lại.
 *       API sẽ decode token từ cookie, lấy role và kiểm tra xem role đó có trong allowedRoles của client không.
 *     tags: [HubClients]
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID của client cần kiểm tra quyền
 *     responses:
 *       200:
 *         description: User có quyền truy cập. Trả về thông tin client và user.
 *       401:
 *         description: Không có token hoặc token không hợp lệ / hết hạn
 *       403:
 *         description: Role của user không được phép truy cập client này
 *       404:
 *         description: Không tìm thấy client
 */
router.get(
  "/:clientId/check-access",
  checkAccessSchema,
  HubClientController.checkClientAccess,
);

module.exports = router;
