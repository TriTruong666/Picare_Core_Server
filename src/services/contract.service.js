const { Op } = require("sequelize");
const crypto = require("crypto");
const fs = require("fs/promises");
const {
  Contract,
  ContractDetail,
  ContractDocument,
  ContractSignature,
} = require("../models");
const {
  ContractListDTO,
  ContractDetailDTO,
} = require("../schemas/contract.schema");
const ErrorCodes = require("../common/exceptions/error_codes");
const {
  BadRequestException,
  NotFoundException,
} = require("../common/exceptions/BaseException");
const ContractPdfService = require("./contract_pdf.service");
const S3Service = require("./s3.service");
const FptAiService = require("./fpt_ai.service");
const appConfig = require("../config/app.config");
const JWTService = require("./jwt.service");
const { ContractTypeRegistry } = require("../contracts");

const INDIVIDUAL_CREDENTIAL_FOLDER = "individual_credential";
const ORGANIZATION_CREDENTIAL_FOLDER = "organization_credential";
const HANDWRITTEN_SIGNATURE_FOLDER = "handwritten_signature";
const UPLOADED_CONTRACT_FOLDER = "uploaded-contracts";
const MAX_UPLOADED_CONTRACT_FILE_SIZE = 20 * 1024 * 1024;

const CONTRACT_STATUS = {
  DRAFT: "draft",
  UNSIGNED: "unsigned",
  OWNER_SIGNED: "owner_signed",
  COMPLETED: "completed",
};

function validateContractTypeInput(input) {
  try {
    ContractTypeRegistry.validateInput(input);
  } catch (error) {
    throw new BadRequestException(error.message);
  }
}

function formatContractCreatedDescription(date = new Date()) {
  const parts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour12: false,
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  return `Tạo vào ${parts.hour}:${parts.minute} ${parts.day}/${parts.month}/${parts.year}`;
}

function buildContractPreviewUrl(contractId) {
  return `${appConfig.client.baseUrl}/contracts/${contractId}/preview`;
}

function buildS3DownloadUrl(key) {
  return `${appConfig.server.baseUrl.replace(/\/+$/, "")}/api/v1/s3/download/${encodeURIComponent(key)}`;
}

function getSignedContractFolder(status) {
  if (status === CONTRACT_STATUS.OWNER_SIGNED) {
    return "owner_signed";
  }

  if (status === CONTRACT_STATUS.COMPLETED) {
    return "complete_contract";
  }

  return "signed-contracts";
}

function getPublishContractErrorMessage(status) {
  if (status === CONTRACT_STATUS.UNSIGNED) {
    return ErrorCodes.CONTRACT_UNSIGNED_PUBLISH_ONLY;
  }

  if (status === CONTRACT_STATUS.OWNER_SIGNED) {
    return ErrorCodes.CONTRACT_OWNER_SIGNED_PUBLISH_ONLY;
  }

  if (status === CONTRACT_STATUS.COMPLETED) {
    return ErrorCodes.CONTRACT_COMPLETED_PUBLISH_ONLY;
  }

  return ErrorCodes.CONTRACT_PUBLISH_STATUS_INVALID;
}

function ensureContractSigningState(contract, signerType) {
  if (contract.status === CONTRACT_STATUS.DRAFT) {
    throw new BadRequestException(
      ErrorCodes.CONTRACT_DRAFT_MUST_BE_PUBLISHED,
    );
  }

  if (contract.status === CONTRACT_STATUS.COMPLETED) {
    throw new BadRequestException(ErrorCodes.CONTRACT_SIGNING_COMPLETED);
  }

  if (contract.status === CONTRACT_STATUS.UNSIGNED && signerType !== "owner") {
    throw new BadRequestException(ErrorCodes.CONTRACT_OWNER_MUST_SIGN_FIRST);
  }

  if (
    contract.status === CONTRACT_STATUS.OWNER_SIGNED &&
    signerType !== "partner"
  ) {
    throw new BadRequestException(ErrorCodes.CONTRACT_PARTNER_MUST_SIGN_AFTER_OWNER);
  }
}

function getNextContractStatus(contract, signerType) {
  ensureContractSigningState(contract, signerType);

  if (contract.status === CONTRACT_STATUS.UNSIGNED) {
    return CONTRACT_STATUS.OWNER_SIGNED;
  }

  return CONTRACT_STATUS.COMPLETED;
}

function ensurePartnerSignerTypeSelected(contract) {
  if (!contract.signerType) {
    throw new BadRequestException(
      ErrorCodes.CONTRACT_SIGNER_TYPE_REQUIRED,
    );
  }
}

function ensurePartnerCredentialReady(contract) {
  ensurePartnerSignerTypeSelected(contract);

  if (contract.signerType === "individual") {
    const credential = contract.individualCredential || {};

    if (
      !credential.first_identification_image ||
      !credential.second_identification_image
    ) {
      throw new BadRequestException(
        ErrorCodes.CONTRACT_INDIVIDUAL_ID_REQUIRED,
      );
    }
  }

  if (contract.signerType === "organization") {
    const credential = contract.organizationCredential || {};

    if (!credential.business_license) {
      throw new BadRequestException(
        ErrorCodes.CONTRACT_ORGANIZATION_LICENSE_REQUIRED,
      );
    }
  }
}

function assertImageOrPdfFile(file, errorCode = ErrorCodes.CONTRACT_IMAGE_OR_PDF_REQUIRED) {
  const mimeType = String(file?.mimetype || "").toLowerCase();
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";

  if (!file?.buffer || (!isImage && !isPdf)) {
    throw new BadRequestException(errorCode);
  }
}

function assertImageFile(file, errorCode = ErrorCodes.CONTRACT_IMAGE_REQUIRED) {
  const mimeType = String(file?.mimetype || "").toLowerCase();

  if (!file?.buffer || !mimeType.startsWith("image/")) {
    throw new BadRequestException(errorCode);
  }
}

function extractS3KeyFromUrl(url) {
  if (!url || typeof url !== "string") {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const key = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));
    return key || null;
  } catch (error) {
    return null;
  }
}

function collectCredentialS3Keys(credential = {}) {
  if (!credential || typeof credential !== "object") {
    return [];
  }

  return [
    credential.first_identification_image_key,
    credential.second_identification_image_key,
    credential.business_license_key,
    credential.power_of_attorney_image_key,
    credential.gdp_key,
    credential.ccddk_key,
    extractS3KeyFromUrl(credential.first_identification_image),
    extractS3KeyFromUrl(credential.second_identification_image),
    extractS3KeyFromUrl(credential.business_license),
    extractS3KeyFromUrl(credential.power_of_attorney_image),
    extractS3KeyFromUrl(credential.gdp),
    extractS3KeyFromUrl(credential.ccddk),
  ].filter(Boolean);
}

async function deleteLocalFileIfExists(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

async function deleteS3ObjectAndRecordIfExists(key) {
  if (!key) {
    return false;
  }

  try {
    await S3Service.deleteAndRecord(key);
    return true;
  } catch (error) {
    return false;
  }
}

async function readS3ObjectBuffer(key) {
  const streamData = await S3Service.getDownloadStream(key);
  const chunks = [];

  for await (const chunk of streamData.Body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function readPdfBufferFromSource(source) {
  if (!source) {
    throw new NotFoundException(ErrorCodes.NOT_FOUND);
  }

  if (Buffer.isBuffer(source)) {
    return source;
  }

  if (typeof source === "string") {
    const key = extractS3KeyFromUrl(source);
    if (key) {
      return readS3ObjectBuffer(key);
    }

    try {
      return await fs.readFile(source);
    } catch (error) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }
  }

  if (typeof source === "object") {
    if (source.fileUrl) {
      const key = extractS3KeyFromUrl(source.fileUrl);
      if (key) {
        return readS3ObjectBuffer(key);
      }
    }

    if (source.filePath) {
      try {
        return await fs.readFile(source.filePath);
      } catch (error) {
        throw new NotFoundException(ErrorCodes.NOT_FOUND);
      }
    }
  }

  throw new NotFoundException(ErrorCodes.NOT_FOUND);
}

async function uploadPdfBufferToS3({
  pdfBuffer,
  fileName,
  folder,
  description,
  visibility = "private",
}) {
  const safeFileName = String(fileName || "contract.pdf").replace(/[\\/]/g, "-");
  const s3Key = `${folder}/${safeFileName}`;
  const s3Result = await S3Service.upload({
    key: s3Key,
    body: pdfBuffer,
    mimeType: "application/pdf",
    originalName: fileName,
    fileSize: pdfBuffer.length,
    folder,
    clientId: null,
    description,
    visibility,
  });

  return s3Result;
}

function extractFptIdData(response) {
  return Array.isArray(response?.data) && response.data.length > 0
    ? response.data[0]
    : {};
}

function isBackSideIdData(data = {}) {
  const type = String(data.type_new || data.type || "").toLowerCase();
  return (
    type.includes("back") || Boolean(data.issue_date) || Boolean(data.features)
  );
}

function normalizeFptValue(value) {
  if (value === undefined || value === null || value === "N/A") {
    return null;
  }

  return value;
}

function buildIndividualCredentialFromOcr({
  firstImage,
  secondImage,
  firstOcr,
  secondOcr,
}) {
  const firstData = extractFptIdData(firstOcr);
  const secondData = extractFptIdData(secondOcr);
  const frontData = isBackSideIdData(firstData) ? secondData : firstData;
  const backData = isBackSideIdData(firstData) ? firstData : secondData;

  return {
    credentialId: normalizeFptValue(frontData.id),
    name: normalizeFptValue(frontData.name),
    dob: normalizeFptValue(frontData.dob),
    home: normalizeFptValue(frontData.home),
    address: normalizeFptValue(frontData.address),
    address_entities: normalizeFptValue(frontData.address_entities),
    sex: normalizeFptValue(frontData.sex),
    nationality: normalizeFptValue(frontData.nationality),
    ethnicity: normalizeFptValue(backData.ethnicity || frontData.ethnicity),
    religion: normalizeFptValue(backData.religion),
    doe: normalizeFptValue(frontData.doe),
    features: normalizeFptValue(backData.features),
    issue_date: normalizeFptValue(backData.issue_date),
    issue_loc: normalizeFptValue(backData.issue_loc),
    type: normalizeFptValue(frontData.type),
    type_new: normalizeFptValue(frontData.type_new),
    first_identification_image: firstImage.url,
    second_identification_image: secondImage.url,
    first_identification_image_key: firstImage.key,
    second_identification_image_key: secondImage.key,
    ocr: {
      first: firstOcr,
      second: secondOcr,
    },
  };
}

class ContractService {
  static async getContractDetails(contractId, options = {}) {
    return ContractDetail.findAll({
      where: { contractId },
      order: [["createdAt", "ASC"]],
      transaction: options.transaction,
    });
  }

  static async getLatestContractDocument(contractId, options = {}) {
    const document = await ContractDocument.findOne({
      where: { contractId },
      order: [["version", "DESC"]],
      transaction: options.transaction,
    });

    if (!document && options.required === false) {
      return null;
    }

    if (!document) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    return document;
  }

  static async getNextContractDocumentVersion(contractId, options = {}) {
    const latestDocument = await this.getLatestContractDocument(contractId, {
      ...options,
      required: false,
    });

    return latestDocument ? latestDocument.version + 1 : 1;
  }

  static async ensureContractDocumentFile(contract, document, options = {}) {
    if (document.fileUrl) {
      return document;
    }

    const details =
      options.details ||
      (await this.getContractDetails(contract.contractId, options));
    const { pdfBuffer, pdfHashHex, fileName } =
      await ContractPdfService.generateContractPdf(contract, details);
    const generatedPdf = await uploadPdfBufferToS3({
      pdfBuffer,
      fileName,
      folder: "draft-contracts",
      description: formatContractCreatedDescription(),
    });

    await document.update(
      {
        fileName,
        filePath: null,
        fileUrl: generatedPdf.url,
        fileHash: pdfHashHex,
      },
      { transaction: options.transaction },
    );

    await contract.update(
      {
        contractChecksum: pdfHashHex,
      },
      { transaction: options.transaction },
    );

    return document;
  }

  static async createContractDocumentFromPdf({
    contract,
    details,
    status,
    folder,
    version,
    transaction,
  }) {
    const { pdfBuffer, pdfHashHex, fileName } =
      await ContractPdfService.generateContractPdf(contract, details);
    const uploadedPdf = await uploadPdfBufferToS3({
      pdfBuffer,
      fileName,
      folder,
      description: formatContractCreatedDescription(),
    });
    const document = await ContractDocument.create(
      {
        contractId: contract.contractId,
        version,
        status,
        fileName,
        filePath: null,
        fileUrl: uploadedPdf.url,
        fileHash: pdfHashHex,
      },
      { transaction },
    );

    await contract.update(
      {
        contractChecksum: pdfHashHex,
      },
      { transaction },
    );

    return {
      document,
      pdfHashHex,
      fileName,
      fileUrl: uploadedPdf.url,
      fileKey: uploadedPdf.key,
      downloadUrl: buildS3DownloadUrl(uploadedPdf.key),
    };
  }

  static async ensureSigningSourceDocument(contract, options = {}) {
    const details =
      options.details ||
      (await this.getContractDetails(contract.contractId, options));
    const latestDocument = await this.getLatestContractDocument(
      contract.contractId,
      {
        transaction: options.transaction,
        required: false,
      },
    );

    if (latestDocument) {
      await this.ensureContractDocumentFile(contract, latestDocument, {
        transaction: options.transaction,
        details,
      });

      return {
        document: latestDocument,
        details,
      };
    }

    const created = await this.createContractDocumentFromPdf({
      contract,
      details,
      status: contract.status,
      folder: getSignedContractFolder(contract.status),
      version: 1,
      transaction: options.transaction,
    });

    return {
      document: created.document,
      details,
    };
  }

  static async downloadDraftContract(contractId) {
    return Contract.sequelize.transaction(async (transaction) => {
      const contract = await Contract.findOne({
        where: { contractId },
        transaction,
      });

      if (!contract) {
        throw new NotFoundException(ErrorCodes.NOT_FOUND);
      }

      if (contract.status !== CONTRACT_STATUS.DRAFT) {
        throw new BadRequestException(
          ErrorCodes.CONTRACT_DRAFT_DOWNLOAD_ONLY,
        );
      }

      const details = await this.getContractDetails(contractId, {
        transaction,
      });
      let draftDocument = await ContractDocument.findOne({
        where: {
          contractId,
          status: CONTRACT_STATUS.DRAFT,
        },
        order: [["version", "ASC"]],
        transaction,
      });

      if (!draftDocument) {
        const created = await this.createContractDocumentFromPdf({
          contract,
          details,
          status: CONTRACT_STATUS.DRAFT,
          folder: "draft-contracts",
          version: 1,
          transaction,
        });
        draftDocument = created.document;

        return {
          contractId,
          contractDocumentId: draftDocument.contractDocumentId,
          documentVersion: draftDocument.version,
          status: draftDocument.status,
          fileName: draftDocument.fileName,
          fileUrl: created.fileUrl,
          fileKey: created.fileKey,
          downloadUrl: created.downloadUrl,
          pdfHashHex: created.pdfHashHex,
        };
      }

      await this.ensureContractDocumentFile(contract, draftDocument, {
        transaction,
        details,
      });

      const fileKey = extractS3KeyFromUrl(draftDocument.fileUrl);
      if (!fileKey) {
        throw new NotFoundException(ErrorCodes.NOT_FOUND);
      }

      return {
        contractId,
        contractDocumentId: draftDocument.contractDocumentId,
        documentVersion: draftDocument.version,
        status: draftDocument.status,
        fileName: draftDocument.fileName,
        fileUrl: draftDocument.fileUrl,
        fileKey,
        downloadUrl: buildS3DownloadUrl(fileKey),
        pdfHashHex: draftDocument.fileHash,
      };
    });
  }

  static async createContractTemplate(input = {}) {
    validateContractTypeInput(input);
    const normalizedContract = ContractTypeRegistry.normalizeInput(input);

    return Contract.sequelize.transaction(async (transaction) => {
      const contract = await Contract.create(
        {
          ownerCompanyInfo: normalizedContract.ownerCompanyInfo,
          partnerCompanyInfo: normalizedContract.partnerCompanyInfo,
          contractDueDate: normalizedContract.contractDueDate,
          contractType: normalizedContract.contractType,
          contractMode: "digital",
          contractData: normalizedContract.contractData,
          status: CONTRACT_STATUS.DRAFT,
        },
        { transaction },
      );

      const createdDetails = await ContractDetail.bulkCreate(
        ContractTypeRegistry.buildDetailRows(
          contract.contractId,
          normalizedContract.details,
          normalizedContract.contractType,
        ),
        { transaction, returning: true },
      );

      const previewUrl = buildContractPreviewUrl(contract.contractId);

      contract.details = createdDetails;
      contract.documents = [];

      return {
        contract: ContractDetailDTO.fromContract(contract),
        previewUrl,
      };
    });
  }

  static async createUploadedContract({
    contractNumber,
    contractType,
    ownerCompanyInfo,
    partnerCompanyInfo,
    contractDueDate = null,
    file,
    uploadedBy = null,
  }) {
    if (
      !file?.buffer?.length ||
      file.buffer.length > MAX_UPLOADED_CONTRACT_FILE_SIZE ||
      file.mimetype !== "application/pdf" ||
      file.buffer.subarray(0, 5).toString("ascii") !== "%PDF-"
    ) {
      throw new BadRequestException(ErrorCodes.CONTRACT_PDF_INVALID);
    }

    const normalizedContractNumber = String(contractNumber || "").trim();
    const normalizedContractType = ContractTypeRegistry.normalizeType(contractType);
    const existingContract = await Contract.findOne({
      where: { contractNumber: normalizedContractNumber },
      attributes: ["contractId"],
    });

    if (existingContract) {
      throw new BadRequestException(ErrorCodes.CONTRACT_NUMBER_TAKEN);
    }

    const transaction = await Contract.sequelize.transaction();
    let uploadedKey = null;
    let isCommitted = false;

    try {
      const contract = await Contract.create(
        {
          contractNumber: normalizedContractNumber,
          ownerCompanyInfo,
          partnerCompanyInfo,
          contractDueDate: contractDueDate || null,
          contractData: {},
          contractType: normalizedContractType,
          contractMode: "upload",
          signerType: null,
          status: CONTRACT_STATUS.COMPLETED,
          individualCredential: null,
          organizationCredential: null,
        },
        { transaction },
      );

      const fileHash = crypto
        .createHash("sha256")
        .update(file.buffer)
        .digest("hex");
      const safeFileName = String(file.originalname || "contract.pdf")
        .replace(/[\\/]/g, "-")
        .replace(/[<>:"|?*]/g, "-");
      uploadedKey = `${UPLOADED_CONTRACT_FOLDER}/${contract.contractId}/${safeFileName}`;
      const uploadedFile = await S3Service.upload({
        key: uploadedKey,
        body: file.buffer,
        mimeType: "application/pdf",
        originalName: safeFileName,
        fileSize: file.buffer.length,
        folder: UPLOADED_CONTRACT_FOLDER,
        uploadedBy,
        description: "Hợp đồng được tải lên hệ thống",
        visibility: "private",
      });
      const document = await ContractDocument.create(
        {
          contractId: contract.contractId,
          version: 1,
          status: CONTRACT_STATUS.COMPLETED,
          fileName: safeFileName,
          filePath: null,
          fileUrl: uploadedFile.url,
          fileHash,
        },
        { transaction },
      );

      await contract.update(
        {
          contractUrl: uploadedFile.url,
          contractChecksum: fileHash,
        },
        { transaction },
      );
      await transaction.commit();
      isCommitted = true;

      contract.details = [];
      contract.documents = [document];
      contract.signatures = [];

      return {
        contract: ContractDetailDTO.fromContract(contract),
        fileKey: uploadedFile.key,
        downloadUrl: buildS3DownloadUrl(uploadedFile.key),
      };
    } catch (error) {
      if (!isCommitted) {
        await transaction.rollback();
      }

      if (uploadedKey && !isCommitted) {
        await S3Service.deleteAndRecord(uploadedKey).catch(() => null);
      }

      if (error.name === "SequelizeUniqueConstraintError") {
        throw new BadRequestException(ErrorCodes.CONTRACT_NUMBER_TAKEN);
      }

      throw error;
    }
  }

  static async publishUnsignedContract(contractId) {
    return Contract.sequelize.transaction(async (transaction) => {
      const contract = await Contract.findOne({
        where: { contractId },
        transaction,
      });

      if (!contract) {
        throw new NotFoundException(ErrorCodes.NOT_FOUND);
      }

      if (contract.status !== CONTRACT_STATUS.DRAFT) {
        throw new BadRequestException(
          ErrorCodes.CONTRACT_DRAFT_PUBLISH_ONLY,
        );
      }

      const details = await this.getContractDetails(contractId, {
        transaction,
      });
      const latestDocument = await this.getLatestContractDocument(contractId, {
        transaction,
        required: false,
      });
      let sourceBuffer;
      let sourceFileName;
      let sourceFileHash;

      if (latestDocument) {
        await this.ensureContractDocumentFile(contract, latestDocument, {
          transaction,
          details,
        });
        sourceBuffer = await readPdfBufferFromSource(latestDocument.fileUrl);
        sourceFileName = latestDocument.fileName;
        sourceFileHash = latestDocument.fileHash;
      } else {
        const generatedPdf = await ContractPdfService.generateContractPdf(
          contract,
          details,
        );
        sourceBuffer = generatedPdf.pdfBuffer;
        sourceFileName = generatedPdf.fileName;
        sourceFileHash = generatedPdf.pdfHashHex;
      }

      const nextVersion = await this.getNextContractDocumentVersion(contractId, {
        transaction,
      });
      const s3Result = await uploadPdfBufferToS3({
        pdfBuffer: sourceBuffer,
        fileName: sourceFileName,
        folder: "unsigned-contracts",
        description: formatContractCreatedDescription(),
      });

      const unsignedDocument = await ContractDocument.create(
        {
          contractId,
          version: nextVersion,
          status: CONTRACT_STATUS.UNSIGNED,
          fileName: sourceFileName,
          filePath: null,
          fileUrl: s3Result.url,
          fileHash: sourceFileHash,
        },
        { transaction },
      );

      await contract.update(
        {
          status: CONTRACT_STATUS.UNSIGNED,
          contractUrl: s3Result.url,
          contractChecksum: sourceFileHash,
        },
        { transaction },
      );

      return {
        contractId,
        contractDocumentId: unsignedDocument.contractDocumentId,
        documentVersion: unsignedDocument.version,
        status: CONTRACT_STATUS.UNSIGNED,
        contractUrl: s3Result.url,
        previewUrl: buildContractPreviewUrl(contractId),
      };
    });
  }

  static async publishOwnerSignedContract(contractId) {
    return Contract.sequelize.transaction(async (transaction) => {
      const contract = await Contract.findOne({
        where: { contractId },
        transaction,
      });

      if (!contract) {
        throw new NotFoundException(ErrorCodes.NOT_FOUND);
      }

      if (contract.status !== CONTRACT_STATUS.OWNER_SIGNED) {
        throw new BadRequestException(
          ErrorCodes.CONTRACT_OWNER_SIGNED_PUBLISH_ONLY,
        );
      }

      const latestDocument = await this.getLatestContractDocument(contractId, {
        transaction,
      });

      if (latestDocument.status !== CONTRACT_STATUS.OWNER_SIGNED) {
        throw new BadRequestException(
          ErrorCodes.CONTRACT_LATEST_NOT_OWNER_SIGNED,
        );
      }

      const sourceBuffer = await readPdfBufferFromSource(
        latestDocument.fileUrl,
      );
      const s3Result = await uploadPdfBufferToS3({
        pdfBuffer: sourceBuffer,
        fileName: latestDocument.fileName,
        folder: "owner_signed",
        description: formatContractCreatedDescription(),
      });

      await latestDocument.update(
        {
          fileUrl: s3Result.url,
        },
        { transaction },
      );

      await contract.update(
        {
          contractUrl: s3Result.url,
        },
        { transaction },
      );

      const ownerSignature = await ContractSignature.findOne({
        where: {
          contractId,
          signerType: "owner",
          status: "signed",
        },
        order: [["updatedAt", "DESC"]],
        transaction,
      });

      if (ownerSignature) {
        await ownerSignature.update(
          {
            signedPdfUrl: s3Result.url,
          },
          { transaction },
        );
      }

      return {
        contractId,
        contractDocumentId: latestDocument.contractDocumentId,
        documentVersion: latestDocument.version,
        status: CONTRACT_STATUS.OWNER_SIGNED,
        contractUrl: s3Result.url,
        previewUrl: buildContractPreviewUrl(contractId),
      };
    });
  }

  static async publishCompletedContract(contractId) {
    return Contract.sequelize.transaction(async (transaction) => {
      const contract = await Contract.findOne({
        where: { contractId },
        transaction,
      });

      if (!contract) {
        throw new NotFoundException(ErrorCodes.NOT_FOUND);
      }

      if (contract.status !== CONTRACT_STATUS.COMPLETED) {
        throw new BadRequestException(
          ErrorCodes.CONTRACT_COMPLETED_PUBLISH_ONLY,
        );
      }

      const latestDocument = await this.getLatestContractDocument(contractId, {
        transaction,
      });

      if (latestDocument.status !== CONTRACT_STATUS.COMPLETED) {
        throw new BadRequestException(
          ErrorCodes.CONTRACT_LATEST_NOT_COMPLETED,
        );
      }

      const sourceBuffer = await readPdfBufferFromSource(
        latestDocument.fileUrl,
      );
      const s3Result = await uploadPdfBufferToS3({
        pdfBuffer: sourceBuffer,
        fileName: latestDocument.fileName,
        folder: "complete_contract",
        description: formatContractCreatedDescription(),
      });

      await latestDocument.update(
        {
          fileUrl: s3Result.url,
        },
        { transaction },
      );

      await contract.update(
        {
          contractUrl: s3Result.url,
        },
        { transaction },
      );

      const partnerSignature = await ContractSignature.findOne({
        where: {
          contractId,
          signerType: "partner",
          status: "signed",
        },
        order: [["updatedAt", "DESC"]],
        transaction,
      });

      if (partnerSignature) {
        await partnerSignature.update(
          {
            signedPdfUrl: s3Result.url,
          },
          { transaction },
        );
      }

      return {
        contractId,
        contractDocumentId: latestDocument.contractDocumentId,
        documentVersion: latestDocument.version,
        status: CONTRACT_STATUS.COMPLETED,
        contractUrl: s3Result.url,
        previewUrl: buildContractPreviewUrl(contractId),
      };
    });
  }

  static async updateDraftContract(contractId, updateData = {}) {
    return Contract.sequelize.transaction(async (transaction) => {
      const contract = await Contract.findOne({
        where: { contractId },
        transaction,
      });

      if (!contract) {
        throw new NotFoundException(ErrorCodes.NOT_FOUND);
      }

      if (contract.status !== CONTRACT_STATUS.DRAFT) {
        throw new BadRequestException(
          ErrorCodes.CONTRACT_DRAFT_UPDATE_ONLY,
        );
      }

      const currentDetails = await this.getContractDetails(contractId, {
        transaction,
      });
      const sourceData =
        updateData.contractData && typeof updateData.contractData === "object"
          ? updateData.contractData
          : {};
      const hasDetailsUpdate =
        Object.prototype.hasOwnProperty.call(updateData, "details") ||
        Object.prototype.hasOwnProperty.call(sourceData, "details");
      const normalizedContract = ContractTypeRegistry.normalizeInput({
        ...updateData,
        ownerCompanyInfo:
          updateData.ownerCompanyInfo ?? contract.ownerCompanyInfo,
        partnerCompanyInfo:
          updateData.partnerCompanyInfo ?? contract.partnerCompanyInfo,
        contractDueDate:
          updateData.contractDueDate ?? contract.contractDueDate,
        contractType: updateData.contractType ?? contract.contractType,
        contractData: {
          ...(contract.contractData || {}),
          ...sourceData,
        },
        details: hasDetailsUpdate
          ? (updateData.details ?? sourceData.details ?? [])
          : currentDetails,
      });
      validateContractTypeInput(normalizedContract);

      const contractUpdateData = {
        ownerCompanyInfo: normalizedContract.ownerCompanyInfo,
        partnerCompanyInfo: normalizedContract.partnerCompanyInfo,
        contractDueDate: normalizedContract.contractDueDate,
        contractType: normalizedContract.contractType,
        contractData: normalizedContract.contractData,
        contractUrl: null,
      };

      await contract.update(contractUpdateData, { transaction });

      await ContractDetail.destroy({
        where: { contractId },
        transaction,
      });

      const updatedDetails = await ContractDetail.bulkCreate(
        ContractTypeRegistry.buildDetailRows(
          contractId,
          normalizedContract.details,
          normalizedContract.contractType,
        ),
        { transaction, returning: true },
      );

      const draftDocument = await ContractDocument.findOne({
        where: {
          contractId,
          status: CONTRACT_STATUS.DRAFT,
        },
        order: [["version", "ASC"]],
        transaction,
      });

      if (draftDocument?.fileUrl) {
        try {
          const previousKey = extractS3KeyFromUrl(draftDocument.fileUrl);
          if (previousKey) {
            await deleteS3ObjectAndRecordIfExists(previousKey);
          }
        } catch (error) {
          // Ignore cleanup failure because stale draft files are not business-critical.
        }
      }

      if (draftDocument) {
        await draftDocument.update(
          {
            filePath: null,
            fileUrl: null,
          },
          { transaction },
        );
      }

      await contract.update(
        {
          contractChecksum: null,
          status: CONTRACT_STATUS.DRAFT,
        },
        { transaction },
      );

      contract.details = updatedDetails;
      contract.documents = draftDocument ? [draftDocument] : [];

      return {
        contract: ContractDetailDTO.fromContract(contract),
        previewUrl: buildContractPreviewUrl(contractId),
      };
    });
  }

  static async createSigningSession({
    contractId,
    signerType,
    signerName,
    signerEmail,
  }) {
    return Contract.sequelize.transaction(async (transaction) => {
      const contract = await Contract.findOne({
        where: { contractId },
        transaction,
      });

      if (!contract) {
        throw new NotFoundException(ErrorCodes.NOT_FOUND);
      }

      ensureContractSigningState(contract, signerType);

      if (signerType === "partner") {
        ensurePartnerCredentialReady(contract);

        if (contract.signerType === "individual") {
          throw new BadRequestException(
            ErrorCodes.CONTRACT_INDIVIDUAL_DIGITAL_SIGNATURE_UNAVAILABLE,
          );
        }
      }

      const details = await this.getContractDetails(contractId, {
        transaction,
      });
      const { document: latestDocument } =
        await this.ensureSigningSourceDocument(contract, {
          transaction,
          details,
        });

      const sourceBuffer = await readPdfBufferFromSource(
        latestDocument.fileUrl,
      );
      const preparedSignaturePdf =
        await ContractPdfService.prepareByteRangeSignaturePdf({
          sourceBytes: sourceBuffer,
          contract,
          details,
          signerName,
          signerType,
        });
      const preparedPdfUpload = await uploadPdfBufferToS3({
        pdfBuffer: preparedSignaturePdf.preparedPdfBuffer,
        fileName: preparedSignaturePdf.fileName,
        folder: "byte-range",
        description: formatContractCreatedDescription(),
      });

      const signature = await ContractSignature.create(
        {
          contractId,
          contractDocumentId: latestDocument.contractDocumentId,
          signerType,
          signerName,
          signerEmail,
          signingMethod: "pdf_byte_range",
          status: "pending",
          pdfHashBeforeSign: latestDocument.fileHash,
          preparedPdfPath: preparedPdfUpload.url,
          preparedPdfHash: preparedSignaturePdf.preparedPdfHash,
          byteRange: preparedSignaturePdf.byteRange,
          signatureLength: preparedSignaturePdf.signatureLength,
        },
        { transaction },
      );

      return {
        contractId,
        contractSignatureId: signature.contractSignatureId,
        contractDocumentId: latestDocument.contractDocumentId,
        documentVersion: latestDocument.version,
        hashToSign: preparedSignaturePdf.preparedPdfHash,
        pdfHashBeforeSign: latestDocument.fileHash,
        byteRange: preparedSignaturePdf.byteRange,
        algorithm: "SHA256_WITH_RSA_PKCS7_DETACHED",
        signatureFormat: "CMS_PKCS7_DER_HEX",
        localSignUrl: "http://127.0.0.1:9999/sign-pdf-cms",
      };
    });
  }

  static async completeSigningSession({
    contractId,
    contractSignatureId,
    signatureHex,
    certificatePem,
    certificateSerial,
    certificateSubject,
    certificateIssuer,
    vendor,
  }) {
    return Contract.sequelize.transaction(async (transaction) => {
      const contract = await Contract.findOne({
        where: { contractId },
        transaction,
      });

      if (!contract) {
        throw new NotFoundException(ErrorCodes.NOT_FOUND);
      }

      const signature = await ContractSignature.findOne({
        where: { contractId, contractSignatureId },
        transaction,
      });

      if (!signature) {
        throw new NotFoundException(ErrorCodes.NOT_FOUND);
      }

      if (signature.signerType === "partner") {
        ensurePartnerCredentialReady(contract);

        if (contract.signerType === "individual") {
          throw new BadRequestException(
            ErrorCodes.CONTRACT_INDIVIDUAL_DIGITAL_SIGNATURE_UNAVAILABLE,
          );
        }
      }

      if (signature.status !== "pending") {
        throw new BadRequestException(
          ErrorCodes.CONTRACT_SIGNING_SESSION_NOT_PENDING,
        );
      }

      const sourceDocument = await ContractDocument.findOne({
        where: {
          contractId,
          contractDocumentId: signature.contractDocumentId,
        },
        transaction,
      });

      if (!sourceDocument) {
        throw new NotFoundException(ErrorCodes.NOT_FOUND);
      }

      await signature.update(
        {
          signatureHex,
          certificatePem,
          certificateSerial,
          certificateSubject,
          certificateIssuer,
          vendor,
        },
        { transaction },
      );

      const preparedPdfBuffer = await readPdfBufferFromSource(
        signature.preparedPdfPath,
      );
      const signedPdf = await ContractPdfService.embedByteRangeSignature({
        preparedBytes: preparedPdfBuffer,
        contract,
        signatureHex,
      });
      const nextVersion = sourceDocument.version + 1;
      const nextStatus = getNextContractStatus(contract, signature.signerType);
      const signedFolder = getSignedContractFolder(nextStatus);
      const signedS3Result = await uploadPdfBufferToS3({
        pdfBuffer: signedPdf.signedPdfBuffer,
        fileName: signedPdf.fileName,
        folder: signedFolder,
        description: formatContractCreatedDescription(),
      });
      const signedPdfUrl = signedS3Result.url;

      const signedDocument = await ContractDocument.create(
        {
          contractId,
          version: nextVersion,
          status: nextStatus,
          fileName: signedPdf.fileName,
          filePath: null,
          fileUrl: signedPdfUrl,
          fileHash: signedPdf.signedPdfHash,
        },
        { transaction },
      );

      await signature.update(
        {
          status: "signed",
          signedPdfHash: signedPdf.signedPdfHash,
          signedPdfUrl,
          signedAt: new Date(),
        },
        { transaction },
      );

      await contract.update(
        {
          contractChecksum: signedPdf.signedPdfHash,
          contractUrl: signedPdfUrl,
          status: nextStatus,
        },
        { transaction },
      );

      return {
        contractId,
        contractSignatureId,
        signedDocumentId: signedDocument.contractDocumentId,
        signedPdfHash: signedPdf.signedPdfHash,
        signedPdfUrl,
        documentVersion: nextVersion,
        status: nextStatus,
      };
    });
  }

  static async updatePartnerSignerType({ contractId, signerType }) {
    const contract = await Contract.findOne({ where: { contractId } });

    if (!contract) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    if (contract.status === CONTRACT_STATUS.COMPLETED) {
      throw new BadRequestException(
        ErrorCodes.CONTRACT_SIGNER_TYPE_UPDATE_COMPLETED,
      );
    }

    const updateData = { signerType };

    await contract.update(updateData);

    return {
      contractId,
      signerType: contract.signerType,
      individualCredential: contract.individualCredential,
      organizationCredential: contract.organizationCredential,
    };
  }

  static async uploadIndividualCredential({
    contractId,
    firstIdentificationImage,
    secondIdentificationImage,
    uploadedBy = null,
  }) {
    if (!firstIdentificationImage || !secondIdentificationImage) {
      throw new BadRequestException(
        ErrorCodes.CONTRACT_TWO_ID_IMAGES_REQUIRED,
      );
    }

    const contract = await Contract.findOne({ where: { contractId } });

    if (!contract) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    if (!contract.signerType) {
      throw new BadRequestException(
        ErrorCodes.CONTRACT_SIGNER_TYPE_REQUIRED_FOR_INDIVIDUAL,
      );
    }

    if (contract.signerType !== "individual") {
      throw new BadRequestException(
        ErrorCodes.CONTRACT_INDIVIDUAL_UPLOAD_ONLY,
      );
    }

    const oldCredentialS3Keys = new Set(
      collectCredentialS3Keys(contract.individualCredential),
    );

    assertImageFile(
      firstIdentificationImage,
      ErrorCodes.CONTRACT_ID_FRONT_IMAGE_INVALID,
    );
    assertImageFile(
      secondIdentificationImage,
      ErrorCodes.CONTRACT_ID_BACK_IMAGE_INVALID,
    );

    const [firstUpload, secondUpload] = await Promise.all([
      S3Service.upload({
        key: S3Service.buildKey(
          INDIVIDUAL_CREDENTIAL_FOLDER,
          firstIdentificationImage.originalname,
        ),
        body: firstIdentificationImage.buffer,
        mimeType: firstIdentificationImage.mimetype,
        originalName: firstIdentificationImage.originalname,
        fileSize: firstIdentificationImage.size,
        folder: INDIVIDUAL_CREDENTIAL_FOLDER,
        uploadedBy,
        description: "Individual credential first identification image",
        visibility: "private",
      }),
      S3Service.upload({
        key: S3Service.buildKey(
          INDIVIDUAL_CREDENTIAL_FOLDER,
          secondIdentificationImage.originalname,
        ),
        body: secondIdentificationImage.buffer,
        mimeType: secondIdentificationImage.mimetype,
        originalName: secondIdentificationImage.originalname,
        fileSize: secondIdentificationImage.size,
        folder: INDIVIDUAL_CREDENTIAL_FOLDER,
        uploadedBy,
        description: "Individual credential second identification image",
        visibility: "private",
      }),
    ]);

    const [firstOcr, secondOcr] = await Promise.all([
      FptAiService.recognizeVietnamIdCard(firstIdentificationImage),
      FptAiService.recognizeVietnamIdCard(secondIdentificationImage),
    ]);

    const individualCredential = buildIndividualCredentialFromOcr({
      firstImage: firstUpload,
      secondImage: secondUpload,
      firstOcr,
      secondOcr,
    });

    await contract.update({
      individualCredential,
    });

    let oldS3ObjectsDeleted = 0;
    for (const key of oldCredentialS3Keys) {
      if (await deleteS3ObjectAndRecordIfExists(key)) {
        oldS3ObjectsDeleted += 1;
      }
    }

    return {
      contractId,
      signerType: contract.signerType,
      individualCredential,
      cleanup: {
        oldS3ObjectsDeleted,
      },
    };
  }

  static async uploadOrganizationCredential({
    contractId,
    businessLicense,
    powerOfAttorney = null,
    gdp = null,
    ccddk = null,
    uploadedBy = null,
  }) {
    if (!businessLicense) {
      throw new BadRequestException(ErrorCodes.CONTRACT_BUSINESS_LICENSE_REQUIRED);
    }

    const contract = await Contract.findOne({ where: { contractId } });

    if (!contract) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    if (!contract.signerType) {
      throw new BadRequestException(
        ErrorCodes.CONTRACT_SIGNER_TYPE_REQUIRED_FOR_ORGANIZATION,
      );
    }

    if (contract.signerType !== "organization") {
      throw new BadRequestException(
        ErrorCodes.CONTRACT_ORGANIZATION_UPLOAD_ONLY,
      );
    }

    assertImageOrPdfFile(
      businessLicense,
      ErrorCodes.CONTRACT_BUSINESS_LICENSE_FILE_INVALID,
    );

    if (powerOfAttorney) {
      assertImageOrPdfFile(
        powerOfAttorney,
        ErrorCodes.CONTRACT_POWER_OF_ATTORNEY_FILE_INVALID,
      );
    }

    if (gdp) {
      assertImageOrPdfFile(gdp, ErrorCodes.CONTRACT_GDP_FILE_INVALID);
    }

    if (ccddk) {
      assertImageOrPdfFile(ccddk, ErrorCodes.CONTRACT_CCDDK_FILE_INVALID);
    }

    const oldCredentialS3Keys = new Set(
      collectCredentialS3Keys(contract.organizationCredential),
    );

    const uploadFile = (file, description) =>
      S3Service.upload({
        key: S3Service.buildKey(
          ORGANIZATION_CREDENTIAL_FOLDER,
          file.originalname,
        ),
        body: file.buffer,
        mimeType: file.mimetype,
        originalName: file.originalname,
        fileSize: file.size,
        folder: ORGANIZATION_CREDENTIAL_FOLDER,
        uploadedBy,
        description,
        visibility: "private",
      });

    const [
      businessLicenseUpload,
      powerOfAttorneyUpload,
      gdpUpload,
      ccddkUpload,
    ] = await Promise.all([
      uploadFile(businessLicense, "Organization business license"),
      powerOfAttorney
        ? uploadFile(powerOfAttorney, "Organization power of attorney")
        : Promise.resolve(null),
      gdp ? uploadFile(gdp, "Organization GDP") : Promise.resolve(null),
      ccddk ? uploadFile(ccddk, "Organization CCDDK") : Promise.resolve(null),
    ]);

    const organizationCredential = {
      business_license: businessLicenseUpload.url,
      business_license_key: businessLicenseUpload.key,
      power_of_attorney_image: powerOfAttorneyUpload?.url || null,
      power_of_attorney_image_key: powerOfAttorneyUpload?.key || null,
      gdp: gdpUpload?.url || null,
      gdp_key: gdpUpload?.key || null,
      ccddk: ccddkUpload?.url || null,
      ccddk_key: ccddkUpload?.key || null,
    };

    await contract.update({ organizationCredential });

    let oldS3ObjectsDeleted = 0;
    for (const key of oldCredentialS3Keys) {
      if (await deleteS3ObjectAndRecordIfExists(key)) {
        oldS3ObjectsDeleted += 1;
      }
    }

    return {
      contractId,
      signerType: contract.signerType,
      organizationCredential,
      cleanup: {
        oldS3ObjectsDeleted,
      },
    };
  }

  static async deletePartnerCredential({ contractId, credentialType }) {
    if (!["individual", "organization"].includes(credentialType)) {
      throw new BadRequestException(
        ErrorCodes.CONTRACT_CREDENTIAL_TYPE_INVALID,
      );
    }

    const contract = await Contract.findOne({ where: { contractId } });

    if (!contract) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    if (contract.status === CONTRACT_STATUS.COMPLETED) {
      throw new BadRequestException(
        ErrorCodes.CONTRACT_CREDENTIAL_DELETE_COMPLETED,
      );
    }

    const credentialField =
      credentialType === "individual"
        ? "individualCredential"
        : "organizationCredential";
    const credential = contract[credentialField];
    const s3Keys = new Set(collectCredentialS3Keys(credential));

    await contract.update({ [credentialField]: null });

    let s3ObjectsDeleted = 0;
    for (const key of s3Keys) {
      if (await deleteS3ObjectAndRecordIfExists(key)) {
        s3ObjectsDeleted += 1;
      }
    }

    return {
      contractId,
      credentialType,
      deleted: true,
      signerType: contract.signerType,
      individualCredential: contract.individualCredential,
      organizationCredential: contract.organizationCredential,
      cleanup: {
        s3ObjectsDeleted,
      },
    };
  }

  static async completeHandwrittenSignature({
    contractId,
    partnerSignerType,
    signerName,
    signerEmail,
    signatureImage,
    uploadedBy = null,
  }) {
    assertImageFile(signatureImage, ErrorCodes.CONTRACT_HANDWRITTEN_SIGNATURE_INVALID);

    return Contract.sequelize.transaction(async (transaction) => {
      const contract = await Contract.findOne({
        where: { contractId },
        transaction,
      });

      if (!contract) {
        throw new NotFoundException(ErrorCodes.NOT_FOUND);
      }

      const resolvedPartnerSignerType =
        partnerSignerType || contract.signerType || null;

      ensureContractSigningState(contract, "partner");
      ensurePartnerCredentialReady(contract);

      if (!resolvedPartnerSignerType) {
        throw new BadRequestException(
          ErrorCodes.CONTRACT_HANDWRITTEN_SIGNER_TYPE_REQUIRED,
        );
      }

      if (!["individual", "organization"].includes(resolvedPartnerSignerType)) {
        throw new BadRequestException(
          ErrorCodes.CONTRACT_SIGNER_TYPE_INVALID,
        );
      }

      if (contract.signerType !== resolvedPartnerSignerType) {
        throw new BadRequestException(
          ErrorCodes.CONTRACT_SIGNER_TYPE_MISMATCH,
        );
      }

      if (resolvedPartnerSignerType !== "individual") {
        throw new BadRequestException(
          ErrorCodes.CONTRACT_ORGANIZATION_DIGITAL_FLOW_REQUIRED,
        );
      }

      const latestDocument = await this.getLatestContractDocument(contractId, {
        transaction,
      });
      const details = await this.getContractDetails(contractId, {
        transaction,
      });

      await this.ensureContractDocumentFile(contract, latestDocument, {
        transaction,
        details,
      });

      const sourcePdfHash =
        latestDocument.fileHash || contract.contractChecksum;
      const signatureImageUpload = await S3Service.upload({
        key: S3Service.buildKey(
          HANDWRITTEN_SIGNATURE_FOLDER,
          signatureImage.originalname,
        ),
        body: signatureImage.buffer,
        mimeType: signatureImage.mimetype,
        originalName: signatureImage.originalname,
        fileSize: signatureImage.size,
        folder: HANDWRITTEN_SIGNATURE_FOLDER,
        uploadedBy,
        description: "Handwritten contract signature image",
        visibility: "private",
      });

      const signature = await ContractSignature.create(
        {
          contractId,
          contractDocumentId: latestDocument.contractDocumentId,
          signerType: "partner",
          signerName,
          signerEmail,
          signingMethod: "handwritten",
          status: "pending",
          pdfHashBeforeSign: sourcePdfHash,
          handwrittenSignatureImageUrl: signatureImageUpload.url,
          handwrittenSignatureImageKey: signatureImageUpload.key,
        },
        { transaction },
      );

      const signedPdf = await ContractPdfService.embedHandwrittenSignature({
        sourceBytes: await readPdfBufferFromSource(latestDocument.fileUrl),
        contract,
        details,
        signerType: "partner",
        signerName,
        signatureImageBuffer: signatureImage.buffer,
        signatureImageMimeType: signatureImage.mimetype,
      });
      const nextVersion = latestDocument.version + 1;
      const nextStatus = getNextContractStatus(contract, "partner");
      const signedFolder = getSignedContractFolder(nextStatus);
      const signedS3Result = await uploadPdfBufferToS3({
        pdfBuffer: signedPdf.signedPdfBuffer,
        fileName: signedPdf.fileName,
        folder: signedFolder,
        description: formatContractCreatedDescription(),
      });
      const signedPdfUrl = signedS3Result.url;

      const signedDocument = await ContractDocument.create(
        {
          contractId,
          version: nextVersion,
          status: nextStatus,
          fileName: signedPdf.fileName,
          filePath: null,
          fileUrl: signedPdfUrl,
          fileHash: signedPdf.signedPdfHash,
        },
        { transaction },
      );

      await signature.update(
        {
          status: "signed",
          signedPdfHash: signedPdf.signedPdfHash,
          signedPdfUrl,
          signedAt: new Date(),
          signatureMetadata: {
            widgetRect: signedPdf.widgetRect,
          },
        },
        { transaction },
      );

      await contract.update(
        {
          contractChecksum: signedPdf.signedPdfHash,
          contractUrl: signedPdfUrl,
          status: nextStatus,
        },
        { transaction },
      );

      return {
        contractId,
        signerType: resolvedPartnerSignerType,
        contractSignatureId: signature.contractSignatureId,
        signedDocumentId: signedDocument.contractDocumentId,
        signedPdfHash: signedPdf.signedPdfHash,
        signedPdfUrl,
        documentVersion: nextVersion,
        status: nextStatus,
      };
    });
  }

  static async getContractsPaginate({
    page = 1,
    limit = 20,
    search = "",
    status = "",
    contractType = "",
    contractMode = "",
  } = {}) {
    const pPage = parseInt(page, 10);
    const pLimit = parseInt(limit, 10);
    const offset = (pPage - 1) * pLimit;
    const where = {};

    if (search) {
      const normalizedSearch = search.trim();

      where[Op.or] = [
        { contractNumber: { [Op.iLike]: `%${normalizedSearch}%` } },
        Contract.sequelize.where(
          Contract.sequelize.cast(
            Contract.sequelize.col("Contract.owner_company_info"),
            "text",
          ),
          { [Op.iLike]: `%${normalizedSearch}%` },
        ),
        Contract.sequelize.where(
          Contract.sequelize.cast(
            Contract.sequelize.col("Contract.partner_company_info"),
            "text",
          ),
          { [Op.iLike]: `%${normalizedSearch}%` },
        ),
        Contract.sequelize.where(
          Contract.sequelize.cast(
            Contract.sequelize.col("Contract.contract_data"),
            "text",
          ),
          { [Op.iLike]: `%${normalizedSearch}%` },
        ),
      ];
    }

    if (status) {
      where.status = status.trim();
    }

    if (contractType) {
      where.contractType = ContractTypeRegistry.normalizeType(contractType);
    }

    if (contractMode) {
      where.contractMode = contractMode.trim();
    }

    const { count, rows } = await Contract.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: pLimit,
      offset,
    });

    return {
      count,
      contracts: ContractListDTO.fromContracts(rows),
      page: pPage,
      limit: pLimit,
      totalPages: Math.ceil(count / pLimit),
    };
  }

  static async getContractById(contractId) {
    const contract = await Contract.findOne({
      where: { contractId },
      include: [
        {
          model: ContractDetail,
          as: "details",
          separate: true,
          order: [["createdAt", "ASC"]],
        },
        {
          model: ContractDocument,
          as: "documents",
          separate: true,
          order: [["version", "ASC"]],
        },
        {
          model: ContractSignature,
          as: "signatures",
          separate: true,
          order: [["createdAt", "ASC"]],
        },
      ],
    });

    if (!contract) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    contract.setDataValue(
      "contractData",
      ContractTypeRegistry.normalizeResponse(contract.contractData),
    );

    return ContractDetailDTO.fromContract(contract);
  }

  static async deleteContract(contractId) {
    const contract = await Contract.findOne({
      where: { contractId },
      include: [
        {
          model: ContractDocument,
          as: "documents",
          separate: true,
        },
        {
          model: ContractSignature,
          as: "signatures",
          separate: true,
        },
      ],
    });

    if (!contract) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    const localFilePaths = new Set();
    const s3Keys = new Set();

    if (contract.contractUrl) {
      const key = extractS3KeyFromUrl(contract.contractUrl);
      if (key) s3Keys.add(key);
    }

    collectCredentialS3Keys(contract.individualCredential).forEach((key) =>
      s3Keys.add(key),
    );
    collectCredentialS3Keys(contract.organizationCredential).forEach((key) =>
      s3Keys.add(key),
    );

    for (const document of contract.documents || []) {
      if (document.filePath) localFilePaths.add(document.filePath);
      const key = extractS3KeyFromUrl(document.fileUrl);
      if (key) s3Keys.add(key);
    }

    for (const signature of contract.signatures || []) {
      if (signature.preparedPdfPath) {
        const preparedKey = extractS3KeyFromUrl(signature.preparedPdfPath);
        if (preparedKey) {
          s3Keys.add(preparedKey);
        } else {
          localFilePaths.add(signature.preparedPdfPath);
        }
      }

      const signedPdfKey = extractS3KeyFromUrl(signature.signedPdfUrl);
      if (signedPdfKey) s3Keys.add(signedPdfKey);

      if (signature.handwrittenSignatureImageKey) {
        s3Keys.add(signature.handwrittenSignatureImageKey);
      }

      const handwrittenKey = extractS3KeyFromUrl(
        signature.handwrittenSignatureImageUrl,
      );
      if (handwrittenKey) s3Keys.add(handwrittenKey);
    }

    const cleanupResult = {
      localFilesDeleted: 0,
      s3ObjectsDeleted: 0,
    };

    await Contract.sequelize.transaction(async (transaction) => {
      await ContractDetail.destroy({ where: { contractId }, transaction });
      await ContractSignature.destroy({ where: { contractId }, transaction });
      await ContractDocument.destroy({ where: { contractId }, transaction });
      await contract.destroy({ transaction });
    });

    for (const filePath of localFilePaths) {
      if (await deleteLocalFileIfExists(filePath)) {
        cleanupResult.localFilesDeleted += 1;
      }
    }

    for (const key of s3Keys) {
      if (await deleteS3ObjectAndRecordIfExists(key)) {
        cleanupResult.s3ObjectsDeleted += 1;
      }
    }

    return {
      contractId,
      deleted: true,
      cleanup: cleanupResult,
    };
  }

  static async getContractPdf(contractId) {
    const contract = await Contract.findOne({ where: { contractId } });

    if (!contract || !contract.contractChecksum) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    const latestDocument = await this.getLatestContractDocument(contractId);
    const details = await this.getContractDetails(contractId);

    await this.ensureContractDocumentFile(contract, latestDocument, {
      details,
    });
    const fileUrl = latestDocument.fileUrl || contract.contractUrl;
    const fileKey = extractS3KeyFromUrl(fileUrl);

    if (!fileKey) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    return {
      fileUrl,
      fileKey,
      fileName:
        latestDocument.fileName ||
        `${contract.contractNumber}.pdf`.replace(/[\\/]/g, "-"),
    };
  }

  static async generatePartnerSigningLink(contractId) {
    const contract = await Contract.findOne({ where: { contractId } });
    if (!contract) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    if (contract.status !== CONTRACT_STATUS.OWNER_SIGNED) {
      throw new BadRequestException(
        ErrorCodes.CONTRACT_PARTNER_SIGN_LINK_STATE_INVALID,
      );
    }

    const partnerEmail =
      contract.partnerCompanyInfo?.email || "partner@example.com";

    // Sinh secure JWT token có thời gian hết hạn là 7 ngày cho đối tác
    const token = JWTService.signJson(
      {
        contractId,
        role: "partner",
        email: partnerEmail,
      },
      { expiresIn: "7d" },
    );

    const signingUrl = `${appConfig.client.baseUrl}/contracts/${contractId}/sign-partner?token=${token}`;

    return {
      contractId,
      partnerEmail,
      token,
      signingUrl,
    };
  }
}

module.exports = ContractService;
