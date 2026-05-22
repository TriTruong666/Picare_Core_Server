const { body, param, query } = require("express-validator");

class ContractDetailItemDTO {
  constructor(detail) {
    this.id = detail.id;
    this.contractDetailId = detail.contractDetailId;
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
    this.contractChecksum = contract.contractChecksum;
    this.contractType = contract.contractType;
    this.contractUrl = contract.contractUrl;
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

const getContractsPaginateSchema = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("page phải là số nguyên lớn hơn 0"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit phải là số nguyên từ 1 đến 100"),
  query("search")
    .optional()
    .isString()
    .withMessage("search phải là chuỗi"),
];

const contractIdSchema = [
  param("contractId")
    .isUUID()
    .withMessage("contractId phải là UUID hợp lệ"),
];

const contractSignatureIdSchema = [
  ...contractIdSchema,
  param("contractSignatureId")
    .isUUID()
    .withMessage("contractSignatureId phải là UUID hợp lệ"),
];

const companyInfoSchema = (field) => [
  body(`${field}.companyName`)
    .notEmpty()
    .withMessage(`${field}.companyName là bắt buộc`)
    .isString()
    .withMessage(`${field}.companyName phải là chuỗi`),
  body(`${field}.address`)
    .notEmpty()
    .withMessage(`${field}.address là bắt buộc`)
    .isString()
    .withMessage(`${field}.address phải là chuỗi`),
  body(`${field}.phone`)
    .notEmpty()
    .withMessage(`${field}.phone là bắt buộc`)
    .isString()
    .withMessage(`${field}.phone phải là chuỗi`),
  body(`${field}.email`)
    .optional({ nullable: true, checkFalsy: true })
    .isEmail()
    .withMessage(`${field}.email không hợp lệ`),
  body(`${field}.bankInfo`)
    .notEmpty()
    .withMessage(`${field}.bankInfo là bắt buộc`)
    .isString()
    .withMessage(`${field}.bankInfo phải là chuỗi`),
  body(`${field}.mst`)
    .notEmpty()
    .withMessage(`${field}.mst là bắt buộc`)
    .isString()
    .withMessage(`${field}.mst phải là chuỗi`),
  body(`${field}.ownerName`)
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage(`${field}.ownerName phải là chuỗi`),
  body(`${field}.owner`)
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage(`${field}.owner phải là chuỗi`),
  body(`${field}.role`)
    .notEmpty()
    .withMessage(`${field}.role là bắt buộc`)
    .isString()
    .withMessage(`${field}.role phải là chuỗi`),
];

const createContractTemplateSchema = [
  body("ownerCompanyInfo")
    .isObject()
    .withMessage("ownerCompanyInfo phải là object")
    .custom((ownerCompanyInfo) => {
      if (!ownerCompanyInfo?.companyCode) {
        throw new Error(
          "ownerCompanyInfo.companyCode là bắt buộc để tự tạo contractNumber"
        );
      }

      return true;
    }),
  ...companyInfoSchema("ownerCompanyInfo"),
  body("partnerCompanyInfo")
    .isObject()
    .withMessage("partnerCompanyInfo phải là object"),
  ...companyInfoSchema("partnerCompanyInfo"),
  body("contractDueDate")
    .notEmpty()
    .withMessage("contractDueDate là bắt buộc")
    .isISO8601()
    .withMessage("contractDueDate phải là ngày ISO8601 hợp lệ"),
  body("contractType")
    .optional()
    .isIn(["digital", "default"])
    .withMessage("contractType chỉ nhận digital hoặc default"),
  body("contractUrl")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("contractUrl phải là chuỗi"),
  body("details")
    .isArray({ min: 1 })
    .withMessage("details phải là array và có ít nhất 1 sản phẩm"),
  body("details.*.productName")
    .notEmpty()
    .withMessage("productName là bắt buộc")
    .isString()
    .withMessage("productName phải là chuỗi"),
  body("details.*.price")
    .notEmpty()
    .withMessage("price là bắt buộc")
    .isNumeric()
    .withMessage("price phải là số"),
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

module.exports = {
  ContractListDTO,
  ContractDetailDTO,
  createContractTemplateSchema,
  createSigningSessionSchema,
  completeSigningSessionSchema,
  getContractsPaginateSchema,
  contractIdSchema,
  contractSignatureIdSchema,
};
