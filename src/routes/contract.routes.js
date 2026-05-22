const express = require("express");
const router = express.Router();
const ContractController = require("../controllers/contract.controller");
const { protect } = require("../middlewares/auth.middleware");
const {
  createContractTemplateSchema,
  getContractsPaginateSchema,
  contractIdSchema,
} = require("../schemas/contract.schema");

/**
 * @swagger
 * tags:
 *   name: Contracts
 *   description: API quản lý hợp đồng
 */

/**
 * @swagger
 * /api/v1/contracts:
 *   post:
 *     summary: Tạo hợp đồng mẫu từ contract_template.pdf
 *     tags: [Contracts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ownerCompanyInfo
 *               - partnerCompanyInfo
 *               - contractDueDate
 *               - details
 *             properties:
 *               contractNumber:
 *                 type: string
 *                 example: 1/01/2026/TH
 *               ownerCompanyInfo:
 *                 type: object
 *               partnerCompanyInfo:
 *                 type: object
 *               contractDueDate:
 *                 type: string
 *                 format: date
 *                 example: 2027-12-31
 *               details:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productName:
 *                       type: string
 *                     price:
 *                       type: number
 *     responses:
 *       201:
 *         description: Tạo hợp đồng mẫu thành công
 */
router.post(
  "/",
  protect,
  createContractTemplateSchema,
  ContractController.createContractTemplate
);

/**
 * @swagger
 * /api/v1/contracts:
 *   get:
 *     summary: Lấy danh sách hợp đồng có phân trang
 *     tags: [Contracts]
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
 *         description: Tìm theo contract number hoặc company code/name
 *     responses:
 *       200:
 *         description: Thành công
 */
router.get("/", protect, getContractsPaginateSchema, ContractController.getContractsPaginate);

/**
 * @swagger
 * /api/v1/contracts/{contractId}:
 *   get:
 *     summary: Lấy chi tiết hợp đồng theo contractId
 *     tags: [Contracts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID public của contract
 *     responses:
 *       200:
 *         description: Thành công
 *       404:
 *         description: Không tìm thấy hợp đồng
 */
router.get(
  "/:contractId",
  protect,
  contractIdSchema,
  ContractController.getContractById
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/template-pdf:
 *   get:
 *     summary: Preview file PDF hợp đồng mẫu đã tạo
 *     tags: [Contracts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: File PDF
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get(
  "/:contractId/template-pdf",
  protect,
  contractIdSchema,
  ContractController.previewContractPdf
);

module.exports = router;
