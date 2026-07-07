const { body, param, query } = require("express-validator");
const { ContractTypeRegistry } = require("../contracts");

const CONTRACT_STATUS_VALUES = [
  "draft",
  "unsigned",
  "owner_signed",
  "completed",
];

class ContractDetailItemDTO {
  constructor(detail) {
    this.id = detail.id;
    this.contractDetailId = detail.contractDetailId;
    this.detailKey = detail.detailKey;
    this.detailType = detail.detailType;
    this.detailData = detail.detailData;
    this.productName = detail.productName;
    this.price = detail.price;
    this.createdAt = detail.createdAt;
    this.updatedAt = detail.updatedAt;
  }

  static fromDetail(detail) {
    return new ContractDetailItemDTO(detail);
  }

  static fromDetails(details = []) {
    return details.map((detail) => this.fromDetail(detail));
  }
}

class ContractListDTO {
  constructor(contract) {
    this.id = contract.id;
    this.contractId = contract.contractId;
    this.contractNumber = contract.contractNumber;
    this.ownerCompanyInfo = contract.ownerCompanyInfo;
    this.partnerCompanyInfo = contract.partnerCompanyInfo;
    this.contractDueDate = contract.contractDueDate;
    this.contractData = contract.contractData;
    this.contractChecksum = contract.contractChecksum;
    this.contractType = contract.contractType;
    this.contractMode = contract.contractMode;
    this.signerType = contract.signerType;
    this.status = contract.status;
    this.contractUrl = contract.contractUrl;
    this.individualCredential = contract.individualCredential;
    this.organizationCredential = contract.organizationCredential;
    this.createdAt = contract.createdAt;
    this.updatedAt = contract.updatedAt;
  }

  static fromContract(contract) {
    return new ContractListDTO(contract);
  }

  static fromContracts(contracts = []) {
    return contracts.map((contract) => this.fromContract(contract));
  }
}

class ContractDetailDTO extends ContractListDTO {
  constructor(contract) {
    super(contract);
    this.details = ContractDetailItemDTO.fromDetails(contract.details || []);
    this.documents = (contract.documents || []).map((document) => ({
      contractDocumentId: document.contractDocumentId,
      version: document.version,
      status: document.status,
      fileUrl: document.fileUrl,
      fileHash: document.fileHash,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    }));
    this.signatures = (contract.signatures || []).map((signature) => ({
      contractSignatureId: signature.contractSignatureId,
      contractDocumentId: signature.contractDocumentId,
      signerType: signature.signerType,
      signerName: signature.signerName,
      signerEmail: signature.signerEmail,
      signingMethod: signature.signingMethod,
      status: signature.status,
      pdfHashBeforeSign: signature.pdfHashBeforeSign,
      handwrittenSignatureImageUrl: signature.handwrittenSignatureImageUrl,
      handwrittenSignatureImageKey: signature.handwrittenSignatureImageKey,
      signatureMetadata: signature.signatureMetadata,
      preparedPdfHash: signature.preparedPdfHash,
      byteRange: signature.byteRange,
      signatureLength: signature.signatureLength,
      certificateSerial: signature.certificateSerial,
      certificateSubject: signature.certificateSubject,
      certificateIssuer: signature.certificateIssuer,
      vendor: signature.vendor,
      signedPdfHash: signature.signedPdfHash,
      signedPdfUrl: signature.signedPdfUrl,
      signedAt: signature.signedAt,
      createdAt: signature.createdAt,
      updatedAt: signature.updatedAt,
    }));
  }

  static fromContract(contract) {
    return new ContractDetailDTO(contract);
  }
}

function validateContractTypePayload(_, { req }) {
  return ContractTypeRegistry.validateInput(req.body || {});
}

const getContractsPaginateSchema = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("page phải là số nguyên lớn hơn 0"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit phải là số nguyên từ 1 đến 100"),
  query("search").optional().isString().withMessage("search phải là chuỗi"),
  query("status")
    .optional()
    .isIn(CONTRACT_STATUS_VALUES)
    .withMessage("status không hợp lệ"),
  query("contractType")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("contractType phải là chuỗi không rỗng"),
  query("contractMode")
    .optional()
    .isIn(["digital", "upload"])
    .withMessage("contractMode chỉ nhận digital hoặc upload"),
];

const contractIdSchema = [
  param("contractId").isUUID().withMessage("contractId phải là UUID hợp lệ"),
];

const contractSignatureIdSchema = [
  ...contractIdSchema,
  param("contractSignatureId")
    .isUUID()
    .withMessage("contractSignatureId phải là UUID hợp lệ"),
];

const createContractTemplateSchema = [
  body().custom(validateContractTypePayload),
  body("contractData")
    .optional({ nullable: true })
    .isObject()
    .withMessage("contractData phải là object"),
  body("ownerCompanyInfo")
    .optional({ nullable: true })
    .isObject()
    .withMessage("ownerCompanyInfo phải là object"),
  body("partnerCompanyInfo")
    .optional({ nullable: true })
    .isObject()
    .withMessage("partnerCompanyInfo phải là object"),
  body("personalInfo")
    .optional({ nullable: true })
    .isObject()
    .withMessage("personalInfo phải là object"),
  body("parentContractId")
    .optional({ nullable: true, checkFalsy: true })
    .isUUID()
    .withMessage("parentContractId phải là UUID hợp lệ"),
  body("parentContractNumber")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("parentContractNumber phải là chuỗi"),
  body("contractDueDate")
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601()
    .withMessage("contractDueDate phải là ngày ISO8601 hợp lệ"),
  body("principleContractNumber")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("principleContractNumber phải là chuỗi"),
  body("principleContractSignedDate")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("principleContractSignedDate phải là chuỗi"),
  body("products")
    .optional({ nullable: true })
    .isArray()
    .withMessage("products phải là mảng"),
  body("products.*")
    .optional({ nullable: true })
    .custom((value) => typeof value === "string" || typeof value === "object")
    .withMessage("products item phải là chuỗi richtext hoặc object"),
  body("productRichTexts")
    .optional({ nullable: true })
    .isArray()
    .withMessage("productRichTexts phải là mảng"),
  body("productRichTexts.*")
    .optional({ nullable: true })
    .isString()
    .withMessage("productRichTexts item phải là chuỗi richtext"),
  body("contractType")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("contractType phải là chuỗi không rỗng"),
  body("details")
    .optional({ nullable: true })
    .isArray()
    .withMessage("details phải là mảng"),
  body("details.*.productName")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("productName phải là chuỗi"),
  body("details.*.price")
    .optional({ nullable: true, checkFalsy: true })
    .isNumeric()
    .withMessage("price phải là số"),
  body("details.*.detailKey")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("detailKey phải là chuỗi"),
  body("details.*.detailType")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("detailType phải là chuỗi"),
  body("details.*.detailData")
    .optional({ nullable: true })
    .isObject()
    .withMessage("detailData phải là object"),
];

const uploadContractSchema = [
  body("file")
    .isString()
    .notEmpty()
    .withMessage("file base64 là bắt buộc"),
  body("fileName")
    .isString()
    .trim()
    .notEmpty()
    .withMessage("fileName là bắt buộc"),
  body("contractNumber")
    .isString()
    .trim()
    .notEmpty()
    .withMessage("contractNumber là bắt buộc"),
  body("contractType")
    .isString()
    .trim()
    .notEmpty()
    .withMessage("contractType là bắt buộc"),
  body("ownerCompanyInfo")
    .isObject()
    .withMessage("ownerCompanyInfo phải là object"),
  body("partnerCompanyInfo")
    .isObject()
    .withMessage("partnerCompanyInfo phải là object"),
  body("contractDueDate")
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601()
    .withMessage("contractDueDate phải là ngày ISO8601 hợp lệ"),
];

const updateDraftContractSchema = [
  ...contractIdSchema,
  ...createContractTemplateSchema.slice(1),
];

const createSigningSessionSchema = [
  ...contractIdSchema,
  body("signerType")
    .isIn(["owner", "partner"])
    .withMessage("signerType chỉ nhận owner hoặc partner"),
  body("signerName")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("signerName phải là chuỗi"),
  body("signerEmail")
    .optional({ nullable: true, checkFalsy: true })
    .isEmail()
    .withMessage("signerEmail không hợp lệ"),
];

const completeSigningSessionSchema = [
  ...contractSignatureIdSchema,
  body("signatureHex")
    .notEmpty()
    .withMessage("signatureHex là bắt buộc")
    .isString()
    .withMessage("signatureHex phải là chuỗi")
    .matches(/^[0-9a-fA-F]+$/)
    .withMessage("signatureHex phải là chuỗi hex hợp lệ"),
  body("certificatePem")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("certificatePem phải là chuỗi"),
  body("certificateSerial")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("certificateSerial phải là chuỗi"),
  body("certificateSubject")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("certificateSubject phải là chuỗi"),
  body("certificateIssuer")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("certificateIssuer phải là chuỗi"),
  body("vendor")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("vendor phải là chuỗi"),
];

const uploadIndividualCredentialSchema = [...contractIdSchema];

const updatePartnerSignerTypeSchema = [
  ...contractIdSchema,
  body("signerType")
    .isIn(["individual", "organization"])
    .withMessage("signerType chỉ nhận individual hoặc organization"),
];

const uploadOrganizationCredentialSchema = [...contractIdSchema];

const deletePartnerCredentialSchema = [
  ...contractIdSchema,
  body("credentialType")
    .isIn(["individual", "organization"])
    .withMessage("credentialType chỉ nhận individual hoặc organization"),
];

const completeHandwrittenSignatureSchema = [
  ...contractIdSchema,
  body("signerType")
    .optional({ nullable: true, checkFalsy: true })
    .isIn(["individual", "organization"])
    .withMessage("signerType chỉ nhận individual hoặc organization"),
  body("signerName")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("signerName phải là chuỗi"),
  body("signerEmail")
    .optional({ nullable: true, checkFalsy: true })
    .isEmail()
    .withMessage("signerEmail không hợp lệ"),
];

module.exports = {
  ContractListDTO,
  ContractDetailDTO,
  createContractTemplateSchema,
  uploadContractSchema,
  updateDraftContractSchema,
  createSigningSessionSchema,
  completeSigningSessionSchema,
  uploadIndividualCredentialSchema,
  updatePartnerSignerTypeSchema,
  uploadOrganizationCredentialSchema,
  deletePartnerCredentialSchema,
  completeHandwrittenSignatureSchema,
  getContractsPaginateSchema,
  contractIdSchema,
  contractSignatureIdSchema,
};
