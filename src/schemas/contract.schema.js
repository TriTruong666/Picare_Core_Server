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
    this.status = contract.status;
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
    .withMessage("page phai la so nguyen lon hon 0"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit phai la so nguyen tu 1 den 100"),
  query("search")
    .optional()
    .isString()
    .withMessage("search phai la chuoi"),
  query("status")
    .optional()
    .isIn(["draft", "unsigned", "owner_signed", "completed"])
    .withMessage("status phai la draft, unsigned, owner_signed hoac completed"),
];

const contractIdSchema = [
  param("contractId")
    .isUUID()
    .withMessage("contractId phai la UUID hop le"),
];

const contractSignatureIdSchema = [
  ...contractIdSchema,
  param("contractSignatureId")
    .isUUID()
    .withMessage("contractSignatureId phai la UUID hop le"),
];

const companyInfoSchema = (field) => [
  body(`${field}.companyName`)
    .notEmpty()
    .withMessage(`${field}.companyName la bat buoc`)
    .isString()
    .withMessage(`${field}.companyName phai la chuoi`),
  body(`${field}.address`)
    .notEmpty()
    .withMessage(`${field}.address la bat buoc`)
    .isString()
    .withMessage(`${field}.address phai la chuoi`),
  body(`${field}.phone`)
    .notEmpty()
    .withMessage(`${field}.phone la bat buoc`)
    .isString()
    .withMessage(`${field}.phone phai la chuoi`),
  body(`${field}.email`)
    .optional({ nullable: true, checkFalsy: true })
    .isEmail()
    .withMessage(`${field}.email khong hop le`),
  body(`${field}.bankInfo`)
    .notEmpty()
    .withMessage(`${field}.bankInfo la bat buoc`)
    .isString()
    .withMessage(`${field}.bankInfo phai la chuoi`),
  body(`${field}.mst`)
    .notEmpty()
    .withMessage(`${field}.mst la bat buoc`)
    .isString()
    .withMessage(`${field}.mst phai la chuoi`),
  body(`${field}.ownerName`)
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage(`${field}.ownerName phai la chuoi`),
  body(`${field}.owner`)
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage(`${field}.owner phai la chuoi`),
  body(`${field}.role`)
    .notEmpty()
    .withMessage(`${field}.role la bat buoc`)
    .isString()
    .withMessage(`${field}.role phai la chuoi`),
];

const createContractTemplateSchema = [
  body("ownerCompanyInfo")
    .isObject()
    .withMessage("ownerCompanyInfo phai la object")
    .custom((ownerCompanyInfo) => {
      if (!ownerCompanyInfo?.companyCode) {
        throw new Error(
          "ownerCompanyInfo.companyCode la bat buoc de tu tao contractNumber"
        );
      }

      return true;
    }),
  ...companyInfoSchema("ownerCompanyInfo"),
  body("partnerCompanyInfo")
    .isObject()
    .withMessage("partnerCompanyInfo phai la object"),
  ...companyInfoSchema("partnerCompanyInfo"),
  body("contractDueDate")
    .notEmpty()
    .withMessage("contractDueDate la bat buoc")
    .isISO8601()
    .withMessage("contractDueDate phai la ngay ISO8601 hop le"),
  body("contractType")
    .optional()
    .isIn(["digital", "default"])
    .withMessage("contractType chi nhan digital hoac default"),
  body("details")
    .isArray({ min: 1 })
    .withMessage("details phai la array va co it nhat 1 san pham"),
  body("details.*.productName")
    .notEmpty()
    .withMessage("productName la bat buoc")
    .isString()
    .withMessage("productName phai la chuoi"),
  body("details.*.price")
    .notEmpty()
    .withMessage("price la bat buoc")
    .isNumeric()
    .withMessage("price phai la so"),
];

const updateDraftContractSchema = [
  ...contractIdSchema,
  ...createContractTemplateSchema,
];

const createSigningSessionSchema = [
  ...contractIdSchema,
  body("signerType")
    .isIn(["owner", "partner"])
    .withMessage("signerType chi nhan owner hoac partner"),
  body("signerName")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("signerName phai la chuoi"),
  body("signerEmail")
    .optional({ nullable: true, checkFalsy: true })
    .isEmail()
    .withMessage("signerEmail khong hop le"),
];

const completeSigningSessionSchema = [
  ...contractSignatureIdSchema,
  body("signatureHex")
    .notEmpty()
    .withMessage("signatureHex la bat buoc")
    .isString()
    .withMessage("signatureHex phai la chuoi")
    .matches(/^[0-9a-fA-F]+$/)
    .withMessage("signatureHex phai la chuoi hex hop le"),
  body("certificatePem")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("certificatePem phai la chuoi"),
  body("certificateSerial")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("certificateSerial phai la chuoi"),
  body("certificateSubject")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("certificateSubject phai la chuoi"),
  body("certificateIssuer")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("certificateIssuer phai la chuoi"),
  body("vendor")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("vendor phai la chuoi"),
];

module.exports = {
  ContractListDTO,
  ContractDetailDTO,
  createContractTemplateSchema,
  updateDraftContractSchema,
  createSigningSessionSchema,
  completeSigningSessionSchema,
  getContractsPaginateSchema,
  contractIdSchema,
  contractSignatureIdSchema,
};
