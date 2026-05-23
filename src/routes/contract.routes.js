const express = require("express");
const router = express.Router();
const ContractController = require("../controllers/contract.controller");
const { protect } = require("../middlewares/auth.middleware");
const {
  createContractTemplateSchema,
  createSigningSessionSchema,
  completeSigningSessionSchema,
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
 *     description: API tự tạo PDF ban đầu, upload lên S3 folder unsigned-contracts với visibility private, lưu URL file vào contractUrl và trả previewUrl là đường dẫn client để xem/ký hợp đồng.
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
 *               ownerCompanyInfo:
 *                 type: object
 *               partnerCompanyInfo:
 *                 type: object
 *               contractDueDate:
 *                 type: string
 *                 format: date
 *                 example: 2027-12-31
 *               contractType:
 *                 type: string
 *                 enum: [digital, default]
 *                 example: digital
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
 * /api/v1/contracts/{contractId}/signing-sessions:
 *   post:
 *     summary: Tạo phiên ký số PDF chuẩn ByteRange cho version mới nhất của hợp đồng
 *     description: API tạo PDF tạm có signature placeholder, tính hash theo ByteRange và trả hashToSign để client gửi sang app ký số local qua http://127.0.0.1:9999/sign-pdf-cms. Chữ ký trả về ở bước complete phải là CMS/PKCS#7 DER dạng hex.
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
 *         description: UUID của hợp đồng cần tạo phiên ký
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signerType
 *             properties:
 *               signerType:
 *                 type: string
 *                 enum: [owner, partner]
 *               signerName:
 *                 type: string
 *               signerEmail:
 *                 type: string
 *     responses:
 *       201:
 *         description: Trả về hashToSign, byteRange và signingSessionId
 */
router.post(
  "/:contractId/signing-sessions",
  protect,
  createSigningSessionSchema,
  ContractController.createSigningSession
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/signing-sessions/{contractSignatureId}/complete:
 *   post:
 *     summary: Hoàn tất ký số PDF ByteRange và tạo PDF version mới
 *     description: signatureHex phải là CMS/PKCS#7 detached signature dạng DER hex, không phải raw RSA signature. API sẽ nhúng signature vào /Contents của PDF placeholder.
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
 *         description: UUID của hợp đồng cần hoàn tất ký số
 *       - in: path
 *         name: contractSignatureId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID của signing session cần hoàn tất
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signatureHex
 *             properties:
 *               signatureHex:
 *                 type: string
 *                 description: CMS/PKCS#7 detached signature DER hex
 *               certificatePem:
 *                 type: string
 *               certificateSerial:
 *                 type: string
 *               certificateSubject:
 *                 type: string
 *               certificateIssuer:
 *                 type: string
 *               vendor:
 *                 type: string
 *     responses:
 *       200:
 *         description: PDF đã được nhúng chữ ký số ByteRange
 */
router.post(
  "/:contractId/signing-sessions/:contractSignatureId/complete",
  protect,
  completeSigningSessionSchema,
  ContractController.completeSigningSession
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
