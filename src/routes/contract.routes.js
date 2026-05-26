const express = require("express");
const multer = require("multer");
const router = express.Router();
const ContractController = require("../controllers/contract.controller");
const { protect, protectContractAccess } = require("../middlewares/auth.middleware");
const {
  createContractTemplateSchema,
  updateDraftContractSchema,
  createSigningSessionSchema,
  completeSigningSessionSchema,
  getContractsPaginateSchema,
  contractIdSchema,
  uploadIndividualCredentialSchema,
  updatePartnerSignerTypeSchema,
  uploadOrganizationCredentialSchema,
  deletePartnerCredentialSchema,
  completeHandwrittenSignatureSchema,
} = require("../schemas/contract.schema");

const credentialUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

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
 *     description: API tạo contract ở trạng thái draft, sinh file PDF local và trả previewUrl để client xem hoặc chỉnh sửa trước khi publish bản unsigned lên S3.
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
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, unsigned, owner_signed, completed]
 *         description: Lọc theo trạng thái hiện tại của hợp đồng
 *     responses:
 *       200:
 *         description: Lấy danh sách hợp đồng thành công
 */
router.get(
  "/",
  protect,
  getContractsPaginateSchema,
  ContractController.getContractsPaginate
);

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
/**
 * @swagger
 * /api/v1/contracts/{contractId}/signing-link:
 *   get:
 *     summary: Sinh link ký hợp đồng bảo mật chứa JWT Token cho đối tác
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
 *         description: Sinh link thành công
 *       404:
 *         description: Không tìm thấy hợp đồng
 */
router.get(
  "/:contractId/signing-link",
  protect,
  contractIdSchema,
  ContractController.generatePartnerSigningLink
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}:
 *   delete:
 *     summary: Xoá hợp đồng và toàn bộ dữ liệu liên quan
 *     description: Xoá contract, detail, document, signature, file PDF local và các object S3 liên quan đến hợp đồng.
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
 *         description: Xoá hợp đồng thành công
 *       404:
 *         description: Không tìm thấy hợp đồng
 */
router.delete(
  "/:contractId",
  protect,
  contractIdSchema,
  ContractController.deleteContract
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}:
 *   put:
 *     summary: Cập nhật thông tin hợp đồng draft
 *     description: Chỉ cho phép cập nhật hợp đồng đang ở trạng thái draft. Sau khi cập nhật sẽ generate lại file PDF local và cập nhật preview.
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
 *       200:
 *         description: Cập nhật hợp đồng draft thành công
 */
router.put(
  "/:contractId",
  protect,
  updateDraftContractSchema,
  ContractController.updateDraftContract
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/publish-unsigned:
 *   post:
 *     summary: Upload bản unsigned hiện tại của hợp đồng lên S3
 *     description: Chỉ áp dụng cho contract đang ở trạng thái draft. Sau khi upload thành công, contract và document hiện tại sẽ chuyển sang unsigned.
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
 *         description: Publish unsigned lên S3 thành công
 */
router.post(
  "/:contractId/publish-unsigned",
  protect,
  contractIdSchema,
  ContractController.publishUnsignedContract
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/publish-owner-signed:
 *   post:
 *     summary: Upload bản owner_signed hiện tại của hợp đồng lên S3
 *     description: Chỉ áp dụng cho contract đang ở trạng thái owner_signed. Sau khi upload thành công, contractUrl sẽ được cập nhật sang bản S3 mới nhất.
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
 *         description: Publish owner_signed lên S3 thành công
 */
router.post(
  "/:contractId/publish-owner-signed",
  protect,
  contractIdSchema,
  ContractController.publishOwnerSignedContract
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/publish-completed:
 *   post:
 *     summary: Upload bản completed hiện tại của hợp đồng lên S3
 *     description: Chỉ áp dụng cho contract đang ở trạng thái completed. Sau khi upload thành công, contractUrl sẽ được cập nhật sang bản S3 mới nhất.
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
 *         description: Publish completed lên S3 thành công
 */
router.post(
  "/:contractId/publish-completed",
  protect,
  contractIdSchema,
  ContractController.publishCompletedContract
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
  protectContractAccess,
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
  protectContractAccess,
  completeSigningSessionSchema,
  ContractController.completeSigningSession
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/partner-signer-type:
 *   patch:
 *     summary: Cập nhật loại đối tác ký hợp đồng
 *     description: Đối tác phải chọn individual hoặc organization trước khi đi tiếp flow hồ sơ và ký.
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
 *                 enum: [individual, organization]
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.patch(
  "/:contractId/partner-signer-type",
  protectContractAccess,
  updatePartnerSignerTypeSchema,
  ContractController.updatePartnerSignerType
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/individual-credential:
 *   post:
 *     summary: Upload 2 mặt CMND/CCCD và trích xuất thông tin cá nhân bằng FPT AI
 *     description: Chỉ dùng khi signerType = individual. API upload ảnh vào S3 folder individual_credential, gọi FPT.AI ID Recognition cho từng ảnh và merge thông tin OCR vào individualCredential.
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
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - first_identification_image
 *               - second_identification_image
 *             properties:
 *               first_identification_image:
 *                 type: string
 *                 format: binary
 *                 description: Ảnh mặt trước CMND/CCCD, tối đa 5MB
 *               second_identification_image:
 *                 type: string
 *                 format: binary
 *                 description: Ảnh mặt sau CMND/CCCD, tối đa 5MB
 *     responses:
 *       200:
 *         description: Upload và trích xuất thông tin thành công
 */
router.post(
  "/:contractId/individual-credential",
  protectContractAccess,
  credentialUpload.fields([
    { name: "first_identification_image", maxCount: 1 },
    { name: "second_identification_image", maxCount: 1 },
  ]),
  uploadIndividualCredentialSchema,
  ContractController.uploadIndividualCredential
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/organization-credential:
 *   post:
 *     summary: Upload hồ sơ tổ chức của đối tác
 *     description: Chỉ dùng khi signerType = organization. business_license là bắt buộc, power_of_attorney_image là không bắt buộc.
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
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - business_license
 *             properties:
 *               business_license:
 *                 type: string
 *                 format: binary
 *               power_of_attorney_image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Upload hồ sơ tổ chức thành công
 */
router.post(
  "/:contractId/organization-credential",
  protectContractAccess,
  credentialUpload.fields([
    { name: "business_license", maxCount: 1 },
    { name: "power_of_attorney_image", maxCount: 1 },
  ]),
  uploadOrganizationCredentialSchema,
  ContractController.uploadOrganizationCredential
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/credential:
 *   delete:
 *     summary: XoÃ¡ há»“ sÆ¡ kÃ½ cá»§a Ä‘á»‘i tÃ¡c theo loáº¡i
 *     description: DÃ¹ng khi Ä‘á»‘i tÃ¡c Ä‘á»•i luá»“ng kÃ½ tá»« cÃ¡ nhÃ¢n sang tá»• chá»©c hoáº·c ngÆ°á»£c láº¡i. API xoÃ¡ credential JSON vÃ  cÃ¡c file S3 liÃªn quan cá»§a loáº¡i Ä‘Æ°á»£c chá»n.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - credentialType
 *             properties:
 *               credentialType:
 *                 type: string
 *                 enum: [individual, organization]
 *     responses:
 *       200:
 *         description: XoÃ¡ há»“ sÆ¡ kÃ½ thÃ nh cÃ´ng
 */
router.delete(
  "/:contractId/credential",
  protectContractAccess,
  deletePartnerCredentialSchema,
  ContractController.deletePartnerCredential
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/handwritten-signatures:
 *   post:
 *     summary: Hoàn tất ký tay và tạo PDF version mới
 *     description: Nhận ảnh chữ ký tay từ client editor, lưu ảnh lên S3, embed vào ô chữ ký trong PDF và cập nhật trạng thái hợp đồng.
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
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - signerType
 *               - signature_image
 *             properties:
 *               signerType:
 *                 type: string
 *                 enum: [owner, partner]
 *               signerName:
 *                 type: string
 *               signerEmail:
 *                 type: string
 *               signature_image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Ký tay thành công
 */
router.post(
  "/:contractId/handwritten-signatures",
  protectContractAccess,
  credentialUpload.single("signature_image"),
  completeHandwrittenSignatureSchema,
  ContractController.completeHandwrittenSignature
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
  protectContractAccess,
  contractIdSchema,
  ContractController.previewContractPdf
);

router.get(
  "/:contractId",
  protectContractAccess,
  contractIdSchema,
  ContractController.getContractById
);

module.exports = router;
