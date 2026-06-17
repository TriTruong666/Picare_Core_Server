const express = require("express");
const multer = require("multer");
const router = express.Router();
const ContractController = require("../controllers/contract.controller");
const {
  protect,
  protectContractAccess,
} = require("../middlewares/auth.middleware");
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
 *     summary: Tạo hợp đồng theo loại hợp đồng
 *     description: Tạo hợp đồng ở trạng thái nháp. contractType=principle dùng template hợp đồng nguyên tắc hiện tại; các loại khác lưu input động trong contractData/details và render PDF generic.
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
 *               - contractType
 *             properties:
 *               contractType:
 *                 type: string
 *                 example: principle
 *               contractData:
 *                 type: object
 *                 description: Payload động theo từng loại hợp đồng
 *               ownerCompanyInfo:
 *                 type: object
 *                 description: Thông tin bên sở hữu hợp đồng. Bắt buộc với contractType=principle.
 *               partnerCompanyInfo:
 *                 type: object
 *                 description: Thông tin đối tác. Bắt buộc với contractType=principle.
 *               contractDueDate:
 *                 type: string
 *                 format: date
 *                 example: 2027-12-31
 *               details:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     detailKey:
 *                       type: string
 *                     detailType:
 *                       type: string
 *                     detailData:
 *                       type: object
 *                     productName:
 *                       type: string
 *                       description: Trường legacy, không còn bắt buộc với hợp đồng nguyên tắc.
 *                     price:
 *                       type: number
 *                       description: Trường legacy, không còn bắt buộc với hợp đồng nguyên tắc.
 *           examples:
 *             principle:
 *               summary: Hợp đồng nguyên tắc
 *               value:
 *                 contractType: principle
 *                 ownerCompanyInfo:
 *                   companyCode: PIC
 *                   companyName: Công ty Picare
 *                   address: 123 Nguyễn Trãi, TP.HCM
 *                   phone: "0900000000"
 *                   bankInfo: "0123456789 - Vietcombank"
 *                   mst: "0312345678"
 *                   ownerName: Nguyễn Văn A
 *                   role: Giám đốc
 *                 partnerCompanyInfo:
 *                   companyName: Công ty Đối tác
 *                   address: 456 Lê Lợi, TP.HCM
 *                   phone: "0911111111"
 *                   bankInfo: "9876543210 - ACB"
 *                   mst: "0398765432"
 *                   ownerName: Trần Văn B
 *                   role: Giám đốc
 *                 contractData:
 *                   paymentTermDays: 30
 *                   creditLimit: null
 *             custom:
 *               summary: Loại hợp đồng động
 *               value:
 *                 contractType: service
 *                 contractData:
 *                   title: Hợp đồng dịch vụ
 *                   scope: Triển khai hệ thống
 *                   paymentTerm: Thanh toán trong 30 ngày
 *                 details:
 *                   - detailKey: implementation
 *                     detailType: service_fee
 *                     detailData:
 *                       name: Phí triển khai
 *                       fee: 5000000
 *     responses:
 *       201:
 *         description: Tạo hợp đồng thành công
 *       400:
 *         description: Dữ liệu yêu cầu không hợp lệ
 */
router.post(
  "/",
  protect,
  createContractTemplateSchema,
  ContractController.createContractTemplate,
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
 *         description: Số lượng bản ghi trên mỗi trang
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Tìm theo số hợp đồng, thông tin công ty hoặc contractData
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, unsigned, owner_signed, completed]
 *         description: Lọc theo trạng thái hiện tại của hợp đồng
 *       - in: query
 *         name: contractType
 *         schema:
 *           type: string
 *         description: Lọc theo loại hợp đồng
 *     responses:
 *       200:
 *         description: Lấy danh sách hợp đồng thành công
 */
router.get(
  "/",
  protect,
  getContractsPaginateSchema,
  ContractController.getContractsPaginate,
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/signing-link:
 *   get:
 *     summary: Sinh đường dẫn ký hợp đồng cho đối tác
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
 *         description: UUID public của hợp đồng
 *     responses:
 *       200:
 *         description: Sinh đường dẫn ký hợp đồng thành công
 *       404:
 *         description: Không tìm thấy hợp đồng
 */
router.get(
  "/:contractId/signing-link",
  protect,
  contractIdSchema,
  ContractController.generatePartnerSigningLink,
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
 *         description: UUID public của hợp đồng
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
  ContractController.deleteContract,
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}:
 *   put:
 *     summary: Cập nhật hợp đồng nháp
 *     description: Chỉ cho phép cập nhật hợp đồng đang ở trạng thái nháp. Sau khi cập nhật sẽ tạo lại PDF preview.
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
 *         description: UUID public của hợp đồng
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               contractType:
 *                 type: string
 *                 example: principle
 *               contractData:
 *                 type: object
 *                 description: Payload động theo từng loại hợp đồng
 *               ownerCompanyInfo:
 *                 type: object
 *               partnerCompanyInfo:
 *                 type: object
 *               contractDueDate:
 *                 type: string
 *                 format: date
 *               contractData:
 *                 type: object
 *                 description: Payload động theo từng loại hợp đồng
 *               details:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     detailKey:
 *                       type: string
 *                     detailType:
 *                       type: string
 *                     detailData:
 *                       type: object
 *                     productName:
 *                       type: string
 *                     price:
 *                       type: number
 *     responses:
 *       200:
 *         description: Cập nhật hợp đồng nháp thành công
 *       400:
 *         description: Hợp đồng không ở trạng thái nháp hoặc dữ liệu không hợp lệ
 */
router.put(
  "/:contractId",
  protect,
  updateDraftContractSchema,
  ContractController.updateDraftContract,
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/publish-unsigned:
 *   post:
 *     summary: Phát hành bản hợp đồng chưa ký lên S3
 *     description: Chỉ áp dụng cho hợp đồng đang ở trạng thái nháp. Sau khi upload thành công, contract và document hiện tại chuyển sang unsigned.
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
 *         description: Phát hành hợp đồng chưa ký thành công
 */
router.post(
  "/:contractId/publish-unsigned",
  protect,
  contractIdSchema,
  ContractController.publishUnsignedContract,
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/publish-owner-signed:
 *   post:
 *     summary: Phát hành bản hợp đồng đã được bên sở hữu ký lên S3
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
 *         description: Phát hành hợp đồng đã được bên sở hữu ký thành công
 */
router.post(
  "/:contractId/publish-owner-signed",
  protect,
  contractIdSchema,
  ContractController.publishOwnerSignedContract,
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/publish-completed:
 *   post:
 *     summary: Phát hành bản hợp đồng đã hoàn tất lên S3
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
 *         description: Phát hành hợp đồng đã hoàn tất thành công
 */
router.post(
  "/:contractId/publish-completed",
  protectContractAccess,
  contractIdSchema,
  ContractController.publishCompletedContract,
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/signing-sessions:
 *   post:
 *     summary: Tạo phiên ký số PDF
 *     description: Tạo PDF tạm có signature placeholder, tính hash theo ByteRange và trả hashToSign để client ký số. Luồng này áp dụng cho mọi contractType; nội dung PDF được render theo template của hợp đồng hiện tại.
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
 *                 enum: [owner, partner]
 *               signerName:
 *                 type: string
 *               signerEmail:
 *                 type: string
 *     responses:
 *       201:
 *         description: Tạo phiên ký số thành công
 */
router.post(
  "/:contractId/signing-sessions",
  protectContractAccess,
  createSigningSessionSchema,
  ContractController.createSigningSession,
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/signing-sessions/{contractSignatureId}/complete:
 *   post:
 *     summary: Hoàn tất ký số PDF
 *     description: Nhúng signatureHex vào PDF placeholder và tạo version PDF mới. Luồng này áp dụng cho mọi contractType.
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
 *       - in: path
 *         name: contractSignatureId
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
 *               - signatureHex
 *             properties:
 *               signatureHex:
 *                 type: string
 *                 description: CMS/PKCS#7 detached signature dạng DER hex
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
 *         description: Hoàn tất ký số hợp đồng thành công
 */
router.post(
  "/:contractId/signing-sessions/:contractSignatureId/complete",
  protectContractAccess,
  completeSigningSessionSchema,
  ContractController.completeSigningSession,
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
 *         description: Cập nhật loại đối tác ký hợp đồng thành công
 */
router.patch(
  "/:contractId/partner-signer-type",
  protectContractAccess,
  updatePartnerSignerTypeSchema,
  ContractController.updatePartnerSignerType,
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/individual-credential:
 *   post:
 *     summary: Upload 2 mặt CMND/CCCD và trích xuất thông tin cá nhân
 *     description: Chỉ dùng khi signerType = individual. API upload ảnh lên S3, gọi FPT.AI ID Recognition và lưu kết quả OCR vào individualCredential.
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
 *         description: Upload và trích xuất thông tin CMND/CCCD thành công
 */
router.post(
  "/:contractId/individual-credential",
  protectContractAccess,
  credentialUpload.fields([
    { name: "first_identification_image", maxCount: 1 },
    { name: "second_identification_image", maxCount: 1 },
  ]),
  uploadIndividualCredentialSchema,
  ContractController.uploadIndividualCredential,
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/organization-credential:
 *   post:
 *     summary: Upload hồ sơ tổ chức của đối tác
 *     description: Chỉ dùng khi signerType = organization. business_license là bắt buộc, power_of_attorney_image là không bắt buộc. Mỗi file có thể là ảnh hoặc PDF.
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
 *                 description: Ảnh hoặc PDF giấy phép kinh doanh
 *               power_of_attorney_image:
 *                 type: string
 *                 format: binary
 *                 description: Ảnh hoặc PDF giấy uỷ quyền
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
  ContractController.uploadOrganizationCredential,
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/credential:
 *   delete:
 *     summary: Xoá hồ sơ ký của đối tác theo loại
 *     description: Dùng khi đối tác đổi luồng ký từ cá nhân sang tổ chức hoặc ngược lại. API xoá credential JSON và các file S3 liên quan của loại được chọn.
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
 *         description: Xoá hồ sơ ký của đối tác thành công
 */
router.delete(
  "/:contractId/credential",
  protectContractAccess,
  deletePartnerCredentialSchema,
  ContractController.deletePartnerCredential,
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/handwritten-signatures:
 *   post:
 *     summary: Hoàn tất ký tay và tạo PDF version mới
 *     description: Nhận ảnh chữ ký tay từ client, lưu ảnh lên S3, embed vào ô chữ ký trong PDF và cập nhật trạng thái hợp đồng. Luồng này áp dụng cho mọi contractType.
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
 *               - signature_image
 *             properties:
 *               signerType:
 *                 type: string
 *                 enum: [individual, organization]
 *               signerName:
 *                 type: string
 *               signerEmail:
 *                 type: string
 *               signature_image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Hoàn tất ký tay hợp đồng thành công
 */
router.post(
  "/:contractId/handwritten-signatures",
  protectContractAccess,
  credentialUpload.single("signature_image"),
  completeHandwrittenSignatureSchema,
  ContractController.completeHandwrittenSignature,
);

/**
 * @swagger
 * /api/v1/contracts/{contractId}/template-pdf:
 *   get:
 *     summary: Preview file PDF hợp đồng đã tạo
 *     description: Trả PDF preview hiện tại của hợp đồng theo contractType đã lưu.
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
  ContractController.previewContractPdf,
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
 *         description: UUID public của hợp đồng
 *     responses:
 *       200:
 *         description: Lấy chi tiết hợp đồng thành công
 *       404:
 *         description: Không tìm thấy hợp đồng
 */
router.get(
  "/:contractId",
  protectContractAccess,
  contractIdSchema,
  ContractController.getContractById,
);

module.exports = router;
