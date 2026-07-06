const express = require("express");
const LicenseController = require("../controllers/license.controller");
const { protect, restrictTo } = require("../middlewares/auth.middleware");
const {
  createLicenseSchema, updateLicenseSchema, listLicenseSchema,
  licenseIdSchema, softwareIdSchema, createSoftwareSchema, updateSoftwareSchema,
  ticketIdSchema, createTicketSchema, updateTicketSchema, listTicketSchema,
} = require("../schemas/license.schema");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Licenses
 *     description: Quản lý license, phần mềm và ticket hỗ trợ
 * components:
 *   parameters:
 *     LicenseId:
 *       in: path
 *       name: licenseId
 *       required: true
 *       schema: { type: string, format: uuid }
 *     SoftwareId:
 *       in: path
 *       name: softwareId
 *       required: true
 *       schema: { type: string, example: OMS-SERVER }
 *     TicketId:
 *       in: path
 *       name: ticketId
 *       required: true
 *       schema: { type: string, format: uuid }
 *   schemas:
 *     LicenseContractInput:
 *       type: object
 *       required: [name, url]
 *       properties:
 *         name: { type: string, example: Hop dong Happycare 2026 }
 *         url: { type: string, format: uri, example: https://example.com/contracts/happycare-2026 }
 *     LicenseStatusInput:
 *       type: string
 *       enum: [paid, partialy_paid, unpaid]
 *     LicenseSoftwareInput:
 *       type: object
 *       required: [softwareId, name, price, type]
 *       properties:
 *         softwareId: { type: string, example: OMS-SERVER }
 *         name: { type: string }
 *         price: { type: number }
 *         status: { type: string, enum: [active, error] }
 *         domain: { type: string, nullable: true }
 *         type: { type: string, enum: [client, server] }
 *         serverConfig:
 *           type: array
 *           nullable: true
 *           items:
 *             type: object
 *             required: [name, active]
 *             properties:
 *               name: { type: string, example: hub-clients }
 *               active: { type: boolean, example: false }
 *         note: { type: string, nullable: true }
 *     LicenseTicketInput:
 *       type: object
 *       required: [title, message]
 *       properties:
 *         title: { type: string }
 *         message: { type: string }
 *         attachments: { type: array, items: { type: string } }
 *         status: { type: string, enum: [pending, completed, cancelled] }
 *         cancelReason: { type: string, nullable: true }
 *         note: { type: string, nullable: true }
 */

router.use(protect, restrictTo("admin"));

/**
 * @swagger
 * /api/v1/licenses:
 *   get:
 *     summary: Danh sách license có phân trang và tìm kiếm
 *     tags: [Licenses]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Thành công }
 *   post:
 *     summary: Tạo license, tự sinh licenseKey và có thể tạo kèm software
 *     tags: [Licenses]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerName, customerPhone, customerEmail]
 *             properties:
 *               customerName: { type: string }
 *               customerPhone: { type: string }
 *               customerEmail: { type: string, format: email }
 *               yearlyCost: { type: number }
 *               oncePaymentStatus: { $ref: '#/components/schemas/LicenseStatusInput' }
 *               licenseContract:
 *                 nullable: true
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/LicenseContractInput'
 *               note: { type: string }
 *               software: { type: array, items: { $ref: '#/components/schemas/LicenseSoftwareInput' } }
 *     responses:
 *       201: { description: Đã tạo }
 */
router.route("/").get(listLicenseSchema, LicenseController.getAll).post(createLicenseSchema, LicenseController.create);

/**
 * @swagger
 * /api/v1/licenses/{licenseId}:
 *   get:
 *     summary: Chi tiết license kèm software và ticket
 *     tags: [Licenses]
 *     parameters: [{ in: path, name: licenseId, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Thành công }, 404: { description: Không tìm thấy } }
 *   put:
 *     summary: Cập nhật thông tin license
 *     tags: [Licenses]
 *     parameters: [{ in: path, name: licenseId, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customerName: { type: string }
 *               customerPhone: { type: string }
 *               customerEmail: { type: string, format: email }
 *               yearlyCost: { type: number }
 *               oncePaymentStatus: { $ref: '#/components/schemas/LicenseStatusInput' }
 *               licenseContract:
 *                 nullable: true
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/LicenseContractInput'
 *               note: { type: string }
 *     responses: { 200: { description: Đã cập nhật } }
 *   delete:
 *     summary: Xoá license và toàn bộ software, ticket liên quan
 *     tags: [Licenses]
 *     parameters: [{ in: path, name: licenseId, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Đã xoá } }
 */
router.route("/:licenseId")
  .get(licenseIdSchema, LicenseController.getById)
  .put(updateLicenseSchema, LicenseController.update)
  .delete(licenseIdSchema, LicenseController.delete);

/**
 * @swagger
 * /api/v1/licenses/{licenseId}/software:
 *   post:
 *     summary: Thêm phần mềm vào license
 *     tags: [Licenses]
 *     parameters: [{ in: path, name: licenseId, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/LicenseSoftwareInput' } } }
 *     responses: { 201: { description: Đã tạo } }
 */
router.post("/:licenseId/software", createSoftwareSchema, LicenseController.createSoftware);

/**
 * @swagger
 * /api/v1/licenses/{licenseId}/software/{softwareId}:
 *   parameters:
 *     - { $ref: '#/components/parameters/LicenseId' }
 *     - { $ref: '#/components/parameters/SoftwareId' }
 *   get:
 *     summary: Chi tiết phần mềm
 *     tags: [Licenses]
 *     responses: { 200: { description: Thành công } }
 *   put:
 *     summary: Cập nhật phần mềm, trạng thái hoặc serverConfig
 *     tags: [Licenses]
 *     responses: { 200: { description: Đã cập nhật } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LicenseSoftwareInput'
 *   delete:
 *     summary: Xoá phần mềm khỏi license
 *     tags: [Licenses]
 *     responses: { 200: { description: Đã xoá } }
 */
router.route("/:licenseId/software/:softwareId")
  .get(softwareIdSchema, LicenseController.getSoftware)
  .put(updateSoftwareSchema, LicenseController.updateSoftware)
  .delete(softwareIdSchema, LicenseController.deleteSoftware);

/**
 * @swagger
 * /api/v1/licenses/{licenseId}/tickets:
 *   parameters:
 *     - { $ref: '#/components/parameters/LicenseId' }
 *   get:
 *     summary: Danh sách ticket của license, có thể lọc status
 *     tags: [Licenses]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [pending, completed, cancelled] } }
 *     responses: { 200: { description: Thành công } }
 *   post:
 *     summary: Tạo ticket hỗ trợ
 *     tags: [Licenses]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/LicenseTicketInput' } } }
 *     responses: { 201: { description: Đã tạo } }
 */
router.route("/:licenseId/tickets")
  .get(listTicketSchema, LicenseController.getTickets)
  .post(createTicketSchema, LicenseController.createTicket);

/**
 * @swagger
 * /api/v1/licenses/{licenseId}/tickets/{ticketId}:
 *   parameters:
 *     - { $ref: '#/components/parameters/LicenseId' }
 *     - { $ref: '#/components/parameters/TicketId' }
 *   get:
 *     summary: Chi tiết ticket
 *     tags: [Licenses]
 *     responses: { 200: { description: Thành công } }
 *   put:
 *     summary: Cập nhật ticket hoặc trạng thái xử lý
 *     tags: [Licenses]
 *     responses: { 200: { description: Đã cập nhật } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LicenseTicketInput'
 *   delete:
 *     summary: Xoá ticket
 *     tags: [Licenses]
 *     responses: { 200: { description: Đã xoá } }
 */
router.route("/:licenseId/tickets/:ticketId")
  .get(ticketIdSchema, LicenseController.getTicket)
  .put(updateTicketSchema, LicenseController.updateTicket)
  .delete(ticketIdSchema, LicenseController.deleteTicket);

module.exports = router;
