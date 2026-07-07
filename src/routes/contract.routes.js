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
  uploadContractSchema,
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
 *     description: Tạo hợp đồng ở trạng thái nháp. contractType được resolve qua contract type registry; principle và appendix dùng builder riêng, type chưa đăng ký dùng generic builder với dữ liệu động trong contractData/details.
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
 *               personalInfo:
 *                 type: object
 *                 description: Thông tin người cam kết. Dùng cho contractType=livestream_responsibility_commitment thay cho partnerCompanyInfo.
 *               parentContractId:
 *                 type: string
 *                 format: uuid
 *                 description: ID hợp đồng chính. Dùng cho contractType=livestream_responsibility_commitment_appendix để liên kết phụ lục với hợp đồng gốc.
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
 *             livestreamResponsibilityCommitment:
 *               summary: Cam kết trách nhiệm livestream
 *               value:
 *                 contractType: livestream_responsibility_commitment
 *                 ownerCompanyInfo:
 *                   companyCode: PIC
 *                   companyName: CÔNG TY TNHH PICARE VIỆT NAM
 *                   address: 38/11 Nguyễn Giản Thanh, P.15, Quận 10, TP.HCM
 *                   mst: "0315127257"
 *                   ownerName: Nguyễn Thành Trung
 *                   role: Giám đốc
 *                 personalInfo:
 *                   fullName: Nguyễn Văn A
 *                   dateOfBirth: 1995-05-20
 *                   position: Nhân viên Livestream
 *                   department: Kinh doanh
 *                   permanentAddress: 123 Nguyễn Trãi, TP.HCM
 *                   citizenId: "079095001234"
 *                   citizenIdIssuedDate: 2021-06-15
 *                   citizenIdIssuedPlace: Cục Cảnh sát QLHC về TTXH
 *             appendix:
 *               summary: Phụ lục hợp đồng
 *               value:
 *                 contractType: appendix
 *                 principleContractNumber: 08/2026/HĐNT/MOCELUX-PICARE
 *                 ownerCompanyInfo:
 *                   companyCode: PIC
 *                   companyName: CÔNG TY CỔ PHẦN PICARE VIỆT NAM
 *                   address: 123 Nguyễn Trãi, TP.HCM
 *                   phone: "0900000000"
 *                   bankInfo: "0123456789 - Vietcombank"
 *                   mst: "0312345678"
 *                   ownerName: Nguyễn Văn A
 *                   role: Giám đốc
 *                 partnerCompanyInfo:
 *                   companyName: CÔNG TY TNHH MOCELUX
 *                   address: 456 Lê Lợi, TP.HCM
 *                   phone: "0911111111"
 *                   bankInfo: "9876543210 - ACB"
 *                   mst: "0398765432"
 *                   ownerName: Trần Văn B
 *                   role: Giám đốc
 *                 products:
 *                   - rawContent: "<ol><li><p><strong>Tên sản phẩm: </strong>Mocelux Collagen</p></li><li><p><strong>Số công bố:</strong> 1234/2026/ĐKSP</p></li><li><p><strong>Thành phần:</strong> Collagen peptide, Vitamin C</p></li><li><p><strong>Quy cách đóng gói:</strong> Hộp 30 gói x 10ml</p></li><li><p><strong>Nước sản xuất:</strong> Việt Nam</p></li><li><p><strong>Đơn giá(+VAT):</strong> 350000</p></li><li><p><strong>Phân loại:</strong> Thực phẩm bảo vệ sức khỏe</p></li></ol>"
 *                   - rawContent: "- Tên sản phẩm: Sản phẩm plain text- Số công bố: 12345/PCB- Thành phần chính: Thành phần A- Quy cách: Hộp 10 đơn vị- Xuất xứ: Việt Nam- Đơn giá: 250000"
 *                     html: "<ol><li><p><strong>Tên sản phẩm: </strong>Sản phẩm plain text</p></li><li><p><strong>Số công bố:</strong> 12345/PCB</p></li><li><p><strong>Thành phần chính:</strong> Thành phần A</p></li><li><p><strong>Quy cách:</strong> Hộp 10 đơn vị</p></li><li><p><strong>Xuất xứ:</strong> Việt Nam</p></li><li><p><strong>Đơn giá:</strong> 250000</p></li></ol>"
 *             livestreamResponsibilityCommitmentAppendix:
 *               summary: Phụ lục cam kết trách nhiệm livestream
 *               value:
 *                 contractType: livestream_responsibility_commitment_appendix
 *                 ownerCompanyInfo:
 *                   companyCode: PIC
 *                   companyName: CÔNG TY TNHH PICARE VIỆT NAM
 *                   address: 38/11 Nguyễn Giản Thanh, P. Hòa Hưng, TP.HCM
 *                   ownerName: Nguyễn Thành Trung
 *                   role: Giám đốc
 *                 parentContractId: 550e8400-e29b-41d4-a716-446655440000
 *                 personalInfo:
 *                   fullName: Nguyễn Văn A
 *                   email: nguyenvana@example.com
 *                   dateOfBirth: 1995-05-20
 *                   position: Nhân viên Livestream
 *                   department: Kinh doanh
 *                   permanentAddress: 123 Nguyễn Trãi, TP.HCM
 *                   citizenId: "079095001234"
 *                   citizenIdIssuedDate: 2021-06-15
 *                   citizenIdIssuedPlace: Cục Cảnh sát QLHC về TTXH
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
 * /api/v1/contracts/upload:
 *   post:
 *     summary: Tải hợp đồng có sẵn lên hệ thống
 *     description: Dùng cho hợp đồng chỉ cần lưu trữ, không thực hiện quy trình ký trên hệ thống. Hợp đồng được tạo với contractMode=upload, status=completed và document version 1.
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
 *               - file
 *               - fileName
 *               - contractNumber
 *               - contractType
 *               - ownerCompanyInfo
 *               - partnerCompanyInfo
 *             properties:
 *               file:
 *                 type: string
 *                 format: byte
 *                 description: PDF dạng base64 hoặc data URI, tối đa 20MB sau khi decode
 *                 example: data:application/pdf;base64,JVBERi0xLjQK...
 *               fileName:
 *                 type: string
 *                 example: hop_dong_001.pdf
 *               contractNumber:
 *                 type: string
 *                 example: 001/06/2026/HDNT/PIC
 *               contractType:
 *                 type: string
 *                 example: principle
 *               ownerCompanyInfo:
 *                 type: object
 *                 example:
 *                   companyCode: PIC
 *                   companyName: Công ty Picare
 *               partnerCompanyInfo:
 *                 type: object
 *                 example:
 *                   companyName: Công ty đối tác
 *               contractDueDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Tải hợp đồng lên thành công
 *       400:
 *         description: Dữ liệu hoặc file PDF không hợp lệ
 */
router.post(
  "/upload",
  protect,
  uploadContractSchema,
  ContractController.uploadContract,
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
 *         name: contractMode
 *         schema:
 *           type: string
 *           enum: [digital, upload]
 *         description: Lọc theo quy trình xử lý hợp đồng
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
 *               personalInfo:
 *                 type: object
 *                 description: Thông tin người cam kết. Dùng cho contractType=livestream_responsibility_commitment thay cho partnerCompanyInfo.
 *               parentContractId:
 *                 type: string
 *                 format: uuid
 *                 description: ID hợp đồng chính. Dùng cho contractType=livestream_responsibility_commitment_appendix; thông tin cá nhân được lấy từ record hợp đồng chính.
 *               contractDueDate:
 *                 type: string
 *                 format: date
 *               principleContractNumber:
 *                 type: string
 *                 description: Số hợp đồng nguyên tắc đính kèm. Dùng cho contractType=appendix.
 *                 example: 001/06/2026/HDNT/PIC
 *               principleContractSignedDate:
 *                 type: string
 *                 description: Ngày ký hợp đồng nguyên tắc đính kèm. Dùng cho contractType=appendix.
 *                 example: 15/06/2026
 *               products:
 *                 type: array
 *                 description: Danh sách sản phẩm phụ lục. Mỗi item có thể là richtext HTML string hoặc object. Nếu có html/rawHtml/richText/productRichText thì rawContent lưu HTML gốc; nếu chỉ có plain text thì API tự dựng rawContent thành HTML list sạch cho màn edit.
 *                 items:
 *                   oneOf:
 *                     - type: string
 *                       description: Richtext HTML hoặc plain text từ editor/QR product.
 *                     - type: object
 *                       properties:
 *                         rawContent:
 *                           type: string
 *                           description: HTML gốc hoặc plain text. Nếu plain text, API parse field và tự dựng lại rawContent dạng HTML list sạch.
 *                         rawHtml:
 *                           type: string
 *                           description: HTML gốc, được ưu tiên để lưu lại rawContent.
 *                         html:
 *                           type: string
 *                           description: HTML gốc, được ưu tiên nếu rawContent đang là plain text.
 *                         richText:
 *                           type: string
 *                           description: HTML/rich text gốc.
 *                         productRichText:
 *                           type: string
 *                           description: HTML/rich text gốc.
 *                         productName:
 *                           type: string
 *                         ingredients:
 *                           type: string
 *                         packageSpecification:
 *                           type: string
 *                         registrationNumber:
 *                           type: string
 *                         origin:
 *                           type: string
 *                         unitPriceVat:
 *                           type: string
 *                         classification:
 *                           type: string
 *               productRichTexts:
 *                 type: array
 *                 description: Alias của products khi chỉ truyền array richtext string.
 *                 items:
 *                   type: string
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
 *           examples:
 *             principle:
 *               summary: Cập nhật hợp đồng nguyên tắc
 *               value:
 *                 contractType: principle
 *                 ownerCompanyInfo:
 *                   companyCode: PIC
 *                   companyName: CÔNG TY CỔ PHẦN PICARE VIỆT NAM
 *                   address: 123 Nguyễn Trãi, TP.HCM
 *                   phone: "0900000000"
 *                   email: contract@picare.vn
 *                   bankInfo: 0123456789 - Vietcombank
 *                   mst: "0312345678"
 *                   ownerName: Nguyễn Văn A
 *                   role: Giám đốc
 *                 partnerCompanyInfo:
 *                   companyName: CÔNG TY TNHH MOCELUX
 *                   address: 456 Lê Lợi, TP.HCM
 *                   phone: "0911111111"
 *                   email: purchase@mocelux.vn
 *                   bankInfo: 9876543210 - ACB
 *                   mst: "0398765432"
 *                   ownerName: Trần Văn B
 *                   role: Giám đốc
 *                 contractDueDate: 2027-12-31
 *                 contractData:
 *                   paymentTermDays: 30
 *                   creditLimit: Theo giá trị nhập hàng
 *             appendix:
 *               summary: Cập nhật phụ lục hợp đồng bằng richtext sản phẩm
 *               value:
 *                 contractType: appendix
 *                 principleContractNumber: 001/06/2026/HDNT/PIC
 *                 principleContractSignedDate: 15/06/2026
 *                 ownerCompanyInfo:
 *                   companyCode: PIC
 *                   companyName: CÔNG TY CỔ PHẦN PICARE VIỆT NAM
 *                   address: 123 Nguyễn Trãi, TP.HCM
 *                   phone: "0900000000"
 *                   bankInfo: 0123456789 - Vietcombank
 *                   mst: "0312345678"
 *                   ownerName: Nguyễn Văn A
 *                   role: Giám đốc
 *                 partnerCompanyInfo:
 *                   companyName: CÔNG TY TNHH MOCELUX
 *                   address: 456 Lê Lợi, TP.HCM
 *                   phone: "0911111111"
 *                   bankInfo: 9876543210 - ACB
 *                   mst: "0398765432"
 *                   ownerName: Trần Văn B
 *                   role: Giám đốc
 *                 products:
 *                   - rawContent: "<ol><li><p><strong>Tên sản phẩm: </strong>MIẾNG DÁN LOẠI BỎ MỤN CÓC TIMODORE&nbsp;</p></li><li><p><strong>Số công bố:</strong> 240001022/PCBA-HCM</p></li><li><p><strong>Thành phần chính: </strong>Salicylic 30%</p></li><li><p><strong>Quy cách: </strong>6 miếng/gói</p></li><li><p><strong>Xuất xứ: </strong>Ý</p></li><li><p><strong>Giá sản phẩm: </strong>125000</p></li><li><p><strong>Phân loại: </strong>Thiết bị y tế</p></li></ol>"
 *                   - rawContent: "- Tên sản phẩm: Sản phẩm plain text- Số công bố: 12345/PCB- Thành phần chính: Thành phần A- Quy cách: Hộp 10 đơn vị- Xuất xứ: Việt Nam- Đơn giá: 250000"
 *                     html: "<ol><li><p><strong>Tên sản phẩm: </strong>Sản phẩm plain text</p></li><li><p><strong>Số công bố:</strong> 12345/PCB</p></li><li><p><strong>Thành phần chính:</strong> Thành phần A</p></li><li><p><strong>Quy cách:</strong> Hộp 10 đơn vị</p></li><li><p><strong>Xuất xứ:</strong> Việt Nam</p></li><li><p><strong>Đơn giá:</strong> 250000</p></li></ol>"
 *                   - productName: Sản phẩm nhập tay
 *                     ingredients: Thành phần A
 *                     packageSpecification: Hộp 10 đơn vị
 *                     registrationNumber: 12345/PCB
 *                     origin: Việt Nam
 *                     unitPriceVat: "250000"
 *                     classification: Thực phẩm bảo vệ sức khỏe
 *             livestreamResponsibilityCommitment:
 *               summary: Cập nhật cam kết trách nhiệm livestream
 *               value:
 *                 contractType: livestream_responsibility_commitment
 *                 ownerCompanyInfo:
 *                   companyCode: PIC
 *                   companyName: CÔNG TY TNHH PICARE VIỆT NAM
 *                   ownerName: Nguyễn Thành Trung
 *                   role: Giám đốc
 *                 personalInfo:
 *                   fullName: Nguyễn Văn A
 *                   dateOfBirth: 1995-05-20
 *                   position: Nhân viên Livestream
 *                   department: Kinh doanh
 *                   permanentAddress: 123 Nguyễn Trãi, TP.HCM
 *                   citizenId: "079095001234"
 *                   citizenIdIssuedDate: 2021-06-15
 *                   citizenIdIssuedPlace: Cục Cảnh sát QLHC về TTXH
 *             livestreamResponsibilityCommitmentAppendix:
 *               summary: Cập nhật phụ lục cam kết trách nhiệm livestream
 *               value:
 *                 contractType: livestream_responsibility_commitment_appendix
 *                 ownerCompanyInfo:
 *                   companyCode: PIC
 *                   companyName: CÔNG TY TNHH PICARE VIỆT NAM
 *                   ownerName: Nguyễn Thành Trung
 *                   role: Giám đốc
 *                 parentContractId: 550e8400-e29b-41d4-a716-446655440000
 *                 personalInfo:
 *                   fullName: Nguyễn Văn A
 *                   email: nguyenvana@example.com
 *                   dateOfBirth: 1995-05-20
 *                   position: Nhân viên Livestream
 *                   department: Kinh doanh
 *                   permanentAddress: 123 Nguyễn Trãi, TP.HCM
 *                   citizenId: "079095001234"
 *                   citizenIdIssuedDate: 2021-06-15
 *                   citizenIdIssuedPlace: Cục Cảnh sát QLHC về TTXH
 *             custom:
 *               summary: Cập nhật loại hợp đồng động
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
 * /api/v1/contracts/{contractId}/draft-download:
 *   post:
 *     summary: Tạo link tải bản hợp đồng nháp
 *     description: Chỉ áp dụng cho hợp đồng draft. Nếu chưa có document v1 draft thì API render PDF, upload lên S3, lưu contract_document version 1 và trả link /api/v1/s3/download/{key} để client tải file.
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
 *         description: Tạo link tải bản nháp thành công
 *       400:
 *         description: Hợp đồng không ở trạng thái draft
 *       404:
 *         description: Không tìm thấy hợp đồng
 */
router.post(
  "/:contractId/draft-download",
  protect,
  contractIdSchema,
  ContractController.downloadDraftContract,
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
 *     summary: Upload 2 mặt CMND/CCCD
 *     description: Chỉ dùng khi signerType = individual. API lưu hai ảnh lên S3 và lưu đường dẫn vào individualCredential; hiện không thực hiện OCR.
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
 *         description: Upload ảnh CMND/CCCD thành công
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
 *     description: Chỉ dùng khi signerType = organization. business_license là bắt buộc; power_of_attorney_image, gdp và ccddk là không bắt buộc. Mỗi file có thể là ảnh hoặc PDF.
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
 *               gdp:
 *                 type: string
 *                 format: binary
 *                 nullable: true
 *                 description: Ảnh hoặc PDF hồ sơ GDP
 *               ccddk:
 *                 type: string
 *                 format: binary
 *                 nullable: true
 *                 description: Ảnh hoặc PDF hồ sơ CCDDK
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
    { name: "gdp", maxCount: 1 },
    { name: "ccddk", maxCount: 1 },
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
