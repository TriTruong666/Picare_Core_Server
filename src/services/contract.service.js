const { Op } = require("sequelize");
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


const INDIVIDUAL_CREDENTIAL_FOLDER = "individual_credential";
const ORGANIZATION_CREDENTIAL_FOLDER = "organization_credential";
const HANDWRITTEN_SIGNATURE_FOLDER = "handwritten_signature";

const CONTRACT_STATUS = {
  DRAFT: "draft",
  UNSIGNED: "unsigned",
  OWNER_SIGNED: "owner_signed",
  COMPLETED: "completed",
};

const PRINCIPLE_CONTRACT_TYPE = "principle";
const LEGACY_PRINCIPLE_CONTRACT_TYPES = new Set(["default", "digital"]);

function normalizeContractType(contractType) {
  const normalizedType = String(contractType || PRINCIPLE_CONTRACT_TYPE)
    .trim()
    .toLowerCase();

  if (!normalizedType || LEGACY_PRINCIPLE_CONTRACT_TYPES.has(normalizedType)) {
    return PRINCIPLE_CONTRACT_TYPE;
  }

  return normalizedType;
}

function normalizeContractData(input = {}) {
  const contractType = normalizeContractType(input.contractType);
  const sourceData =
    input.contractData && typeof input.contractData === "object"
      ? input.contractData
      : {};
  const details = Array.isArray(input.details)
    ? input.details
    : Array.isArray(sourceData.details)
      ? sourceData.details
      : [];
  const ownerCompanyInfo =
    input.ownerCompanyInfo || sourceData.ownerCompanyInfo || null;
  const partnerCompanyInfo =
    input.partnerCompanyInfo || sourceData.partnerCompanyInfo || null;
  const contractDueDate =
    input.contractDueDate || sourceData.contractDueDate || null;

  return {
    contractType,
    ownerCompanyInfo,
    partnerCompanyInfo,
    contractDueDate,
    details,
    contractData: {
      ...sourceData,
      ownerCompanyInfo,
      partnerCompanyInfo,
      contractDueDate,
      details,
    },
  };
}

function buildContractDetailRows(contractId, details = []) {
  return details.map((detail, index) => {
    const detailData =
      detail.detailData && typeof detail.detailData === "object"
        ? detail.detailData
        : detail;

    return {
      contractId,
      detailKey:
        detail.detailKey ||
        detail.key ||
        detail.productName ||
        `detail_${index + 1}`,
      detailType: detail.detailType || detail.type || "item",
      detailData,
      productName: detail.productName ?? detailData.productName ?? null,
      price: detail.price ?? detailData.price ?? null,
    };
  });
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
    return "Chỉ có thể phát hành hợp đồng đang ở trạng thái unsigned";
  }

  if (status === CONTRACT_STATUS.OWNER_SIGNED) {
    return "Chỉ có thể publish hợp đồng đang ở trạng thái owner_signed";
  }

  if (status === CONTRACT_STATUS.COMPLETED) {
    return "Chỉ có thể publish hợp đồng đang ở trạng thái completed";
  }

  return "Trạng thái hợp đồng không hợp lệ để publish";
}

function ensureContractSigningState(contract, signerType) {
  if (contract.status === CONTRACT_STATUS.DRAFT) {
    throw new BadRequestException(
      "Hợp đồng đang ở trạng thái nháp, cần phát hành bản unsigned trước khi ký"
    );
  }

  if (contract.status === CONTRACT_STATUS.COMPLETED) {
    throw new BadRequestException("Hợp đồng đã hoàn tất ký");
  }

  if (contract.status === CONTRACT_STATUS.UNSIGNED && signerType !== "owner") {
    throw new BadRequestException("Owner phải ký trước");
  }

  if (
    contract.status === CONTRACT_STATUS.OWNER_SIGNED &&
    signerType !== "partner"
  ) {
    throw new BadRequestException("Partner phải ký sau khi owner đã ký");
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
      "Đối tác phải cập nhật signerType trước khi thực hiện flow ký"
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
        "Đối tác cá nhân phải upload đủ 2 mặt CMND/CCCD trước khi ký tay"
      );
    }
  }

  if (contract.signerType === "organization") {
    const credential = contract.organizationCredential || {};

    if (!credential.business_license) {
      throw new BadRequestException(
        "Đối tác tổ chức phải upload giấy phép kinh doanh trước khi ký số"
      );
    }
  }
}

function assertImageOrPdfFile(file, message = "File phải là ảnh hoặc PDF") {
  const mimeType = String(file?.mimetype || "").toLowerCase();
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";

  if (!file?.buffer || (!isImage && !isPdf)) {
    throw new BadRequestException(message);
  }
}

function assertImageFile(file, message = "File phải là ảnh") {
  const mimeType = String(file?.mimetype || "").toLowerCase();

  if (!file?.buffer || !mimeType.startsWith("image/")) {
    throw new BadRequestException(message);
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
    extractS3KeyFromUrl(credential.first_identification_image),
    extractS3KeyFromUrl(credential.second_identification_image),
    extractS3KeyFromUrl(credential.business_license),
    extractS3KeyFromUrl(credential.power_of_attorney_image),
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
  const s3Key = S3Service.buildKey(folder, fileName);
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
    type.includes("back") ||
    Boolean(data.issue_date) ||
    Boolean(data.features)
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
      { transaction: options.transaction }
    );

    await contract.update(
      {
        contractChecksum: pdfHashHex,
      },
      { transaction: options.transaction }
    );

    return document;
  }

  static async createContractTemplate({
    ownerCompanyInfo,
    partnerCompanyInfo,
    contractDueDate,
    contractType = PRINCIPLE_CONTRACT_TYPE,
    contractData = {},
    details = [],
  } = {}) {
    const normalizedContract = normalizeContractData({
      ownerCompanyInfo,
      partnerCompanyInfo,
      contractDueDate,
      contractType,
      contractData,
      details,
    });

    return Contract.sequelize.transaction(async (transaction) => {
      const contract = await Contract.create(
        {
          ownerCompanyInfo: normalizedContract.ownerCompanyInfo,
          partnerCompanyInfo: normalizedContract.partnerCompanyInfo,
          contractDueDate: normalizedContract.contractDueDate,
          contractType: normalizedContract.contractType,
          contractData: normalizedContract.contractData,
          status: CONTRACT_STATUS.DRAFT,
        },
        { transaction }
      );

      const createdDetails = await ContractDetail.bulkCreate(
        buildContractDetailRows(contract.contractId, normalizedContract.details),
        { transaction, returning: true }
      );

      const { pdfHashHex, fileName } =
        await ContractPdfService.generateContractPdfBuffer(
          contract,
          createdDetails
        );
      const previewUrl = buildContractPreviewUrl(contract.contractId);

      await contract.update(
        {
          contractChecksum: pdfHashHex,
          contractUrl: null,
          status: CONTRACT_STATUS.DRAFT,
        },
        { transaction }
      );

      await ContractDocument.create(
        {
          contractId: contract.contractId,
          version: 1,
          status: CONTRACT_STATUS.DRAFT,
          fileName,
          filePath: null,
          fileUrl: null,
          fileHash: pdfHashHex,
        },
        { transaction }
      );

      contract.details = createdDetails;

      return {
        contract: ContractDetailDTO.fromContract(contract),
        pdfHashHex,
        previewUrl,
      };
    });
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
          "Chỉ có thể phát hành hợp đồng đang ở trạng thái nháp"
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

      const sourceBuffer = await readPdfBufferFromSource(latestDocument.fileUrl);
      const s3Result = await uploadPdfBufferToS3({
        pdfBuffer: sourceBuffer,
        fileName: latestDocument.fileName,
        folder: "unsigned-contracts",
        description: formatContractCreatedDescription(),
      });

      await latestDocument.update(
        {
          status: CONTRACT_STATUS.UNSIGNED,
          fileUrl: s3Result.url,
        },
        { transaction }
      );

      await contract.update(
        {
          status: CONTRACT_STATUS.UNSIGNED,
          contractUrl: s3Result.url,
        },
        { transaction }
      );

      return {
        contractId,
        contractDocumentId: latestDocument.contractDocumentId,
        documentVersion: latestDocument.version,
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
          "Chỉ có thể publish hợp đồng đang ở trạng thái owner_signed"
        );
      }

      const latestDocument = await this.getLatestContractDocument(contractId, {
        transaction,
      });

      if (latestDocument.status !== CONTRACT_STATUS.OWNER_SIGNED) {
        throw new BadRequestException(
          "Phiên bản hợp đồng mới nhất không ở trạng thái owner_signed"
        );
      }

      const sourceBuffer = await readPdfBufferFromSource(latestDocument.fileUrl);
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
        { transaction }
      );

      await contract.update(
        {
          contractUrl: s3Result.url,
        },
        { transaction }
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
          { transaction }
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
          "Chỉ có thể publish hợp đồng đang ở trạng thái completed"
        );
      }

      const latestDocument = await this.getLatestContractDocument(contractId, {
        transaction,
      });

      if (latestDocument.status !== CONTRACT_STATUS.COMPLETED) {
        throw new BadRequestException(
          "Phiên bản hợp đồng mới nhất không ở trạng thái completed"
        );
      }

      const sourceBuffer = await readPdfBufferFromSource(latestDocument.fileUrl);
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
        { transaction }
      );

      await contract.update(
        {
          contractUrl: s3Result.url,
        },
        { transaction }
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
          { transaction }
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

  static async updateDraftContract(
    contractId,
    {
      ownerCompanyInfo,
      partnerCompanyInfo,
      contractDueDate,
      contractType = PRINCIPLE_CONTRACT_TYPE,
      contractData = {},
      details = [],
    } = {}
  ) {
    const normalizedContract = normalizeContractData({
      ownerCompanyInfo,
      partnerCompanyInfo,
      contractDueDate,
      contractType,
      contractData,
      details,
    });

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
          "Chỉ được cập nhật hợp đồng ở trạng thái draft"
        );
      }

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
        buildContractDetailRows(contractId, normalizedContract.details),
        { transaction, returning: true }
      );

      const latestDocument = await this.getLatestContractDocument(contractId, {
        transaction,
      });

      const previousFileUrl = latestDocument.fileUrl;
      const { pdfBuffer, pdfHashHex, fileName } =
        await ContractPdfService.generateContractPdf(contract, updatedDetails);
      const uploadedDraftPdf = await uploadPdfBufferToS3({
        pdfBuffer,
        fileName,
        folder: "draft-contracts",
        description: formatContractCreatedDescription(),
      });

      await contract.update(
        {
          contractChecksum: pdfHashHex,
          status: CONTRACT_STATUS.DRAFT,
        },
        { transaction }
      );

      await latestDocument.update(
        {
          status: CONTRACT_STATUS.DRAFT,
          fileName,
          filePath: null,
          fileUrl: uploadedDraftPdf.url,
          fileHash: pdfHashHex,
        },
        { transaction }
      );

      if (previousFileUrl && previousFileUrl !== uploadedDraftPdf.url) {
        try {
          const previousKey = extractS3KeyFromUrl(previousFileUrl);
          if (previousKey) {
            await deleteS3ObjectAndRecordIfExists(previousKey);
          }
        } catch (error) {
          // Ignore cleanup failure because it should not break contract updates.
        }
      }

      contract.details = updatedDetails;
      contract.documents = [latestDocument];

      return {
        contract: ContractDetailDTO.fromContract(contract),
        pdfHashHex,
        previewUrl: buildContractPreviewUrl(contractId),
      };
    });
  }

  static async getLatestContractDocument(contractId, options = {}) {
    const document = await ContractDocument.findOne({
      where: { contractId },
      order: [["version", "DESC"]],
      transaction: options.transaction,
    });

    if (!document) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    return document;
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
            "Đối tác cá nhân không có chữ ký số, vui lòng sử dụng flow ký tay"
          );
        }
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

      const sourceBuffer = await readPdfBufferFromSource(latestDocument.fileUrl);
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
        fileName: `hop-dong-picare-${
          contract.contractId
        }-byte-range-${preparedSignaturePdf.preparedPdfHash.slice(0, 12)}.pdf`,
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
        { transaction }
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
            "Đối tác cá nhân không có chữ ký số, vui lòng sử dụng flow ký tay"
          );
        }
      }

      if (signature.status !== "pending") {
        throw new BadRequestException(
          "Phiên ký không còn ở trạng thái pending"
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
        { transaction }
      );

      const preparedPdfBuffer = await readPdfBufferFromSource(
        signature.preparedPdfPath
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
        { transaction }
      );

      await signature.update(
        {
          status: "signed",
          signedPdfHash: signedPdf.signedPdfHash,
          signedPdfUrl,
          signedAt: new Date(),
        },
        { transaction }
      );

      await contract.update(
        {
          contractChecksum: signedPdf.signedPdfHash,
          contractUrl: signedPdfUrl,
          status: nextStatus,
        },
        { transaction }
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
        "Hợp đồng đã hoàn tất, không thể cập nhật signerType"
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
        "Cần upload đủ 2 ảnh CMND/CCCD mặt trước và mặt sau"
      );
    }

    const contract = await Contract.findOne({ where: { contractId } });

    if (!contract) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    if (!contract.signerType) {
      throw new BadRequestException(
        "Vui lòng cập nhật signerType trước khi upload hồ sơ cá nhân"
      );
    }

    if (contract.signerType !== "individual") {
      throw new BadRequestException(
        "Chỉ signerType individual mới được upload CMND/CCCD"
      );
    }

    const oldCredentialS3Keys = new Set(
      collectCredentialS3Keys(contract.individualCredential)
    );

    assertImageFile(
      firstIdentificationImage,
      "Ảnh mặt trước CMND/CCCD không hợp lệ"
    );
    assertImageFile(
      secondIdentificationImage,
      "Ảnh mặt sau CMND/CCCD không hợp lệ"
    );

    const [firstUpload, secondUpload] = await Promise.all([
      S3Service.upload({
        key: S3Service.buildKey(
          INDIVIDUAL_CREDENTIAL_FOLDER,
          firstIdentificationImage.originalname
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
          secondIdentificationImage.originalname
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
    uploadedBy = null,
  }) {
    if (!businessLicense) {
      throw new BadRequestException("Giấy phép kinh doanh là bắt buộc");
    }

    const contract = await Contract.findOne({ where: { contractId } });

    if (!contract) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    if (!contract.signerType) {
      throw new BadRequestException(
        "Vui lòng cập nhật signerType trước khi upload hồ sơ tổ chức"
      );
    }

    if (contract.signerType !== "organization") {
      throw new BadRequestException(
        "Chỉ signerType organization mới được upload hồ sơ tổ chức"
      );
    }

    assertImageOrPdfFile(
      businessLicense,
      "Giấy phép kinh doanh phải là file ảnh hoặc PDF"
    );

    if (powerOfAttorney) {
      assertImageOrPdfFile(
        powerOfAttorney,
        "Giấy uỷ quyền phải là file ảnh hoặc PDF"
      );
    }

    const uploadFile = (file, description) =>
      S3Service.upload({
        key: S3Service.buildKey(
          ORGANIZATION_CREDENTIAL_FOLDER,
          file.originalname
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

    const [businessLicenseUpload, powerOfAttorneyUpload] = await Promise.all([
      uploadFile(businessLicense, "Organization business license"),
      powerOfAttorney
        ? uploadFile(powerOfAttorney, "Organization power of attorney")
        : Promise.resolve(null),
    ]);

    const organizationCredential = {
      business_license: businessLicenseUpload.url,
      business_license_key: businessLicenseUpload.key,
      power_of_attorney_image: powerOfAttorneyUpload?.url || null,
      power_of_attorney_image_key: powerOfAttorneyUpload?.key || null,
    };

    await contract.update({ organizationCredential });

    return {
      contractId,
      signerType: contract.signerType,
      organizationCredential,
    };
  }

  static async deletePartnerCredential({ contractId, credentialType }) {
    if (!["individual", "organization"].includes(credentialType)) {
      throw new BadRequestException(
        "credentialType ch\u1ec9 nh\u1eadn individual ho\u1eb7c organization"
      );
    }

    const contract = await Contract.findOne({ where: { contractId } });

    if (!contract) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    if (contract.status === CONTRACT_STATUS.COMPLETED) {
      throw new BadRequestException(
        "H\u1ee3p \u0111\u1ed3ng \u0111\u00e3 ho\u00e0n t\u1ea5t, kh\u00f4ng th\u1ec3 xo\u00e1 h\u1ed3 s\u01a1 k\u00fd"
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
    assertImageFile(signatureImage, "Ảnh chữ ký tay không hợp lệ");

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
          "Đối tác phải cập nhật signerType trước khi thực hiện flow ký tay"
        );
      }

      if (
        !["individual", "organization"].includes(resolvedPartnerSignerType)
      ) {
        throw new BadRequestException(
          "signerType chỉ nhận individual hoặc organization"
        );
      }

      if (contract.signerType !== resolvedPartnerSignerType) {
        throw new BadRequestException(
          "signerType không khớp với loại đối tác đã cập nhật trên hợp đồng"
        );
      }

      if (resolvedPartnerSignerType !== "individual") {
        throw new BadRequestException(
          "Đối tác tổ chức phải sử dụng flow ký số"
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

      const sourcePdfHash = latestDocument.fileHash || contract.contractChecksum;
      const signatureImageUpload = await S3Service.upload({
        key: S3Service.buildKey(
          HANDWRITTEN_SIGNATURE_FOLDER,
          signatureImage.originalname
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
        { transaction }
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
        { transaction }
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
        { transaction }
      );

      await contract.update(
        {
          contractChecksum: signedPdf.signedPdfHash,
          contractUrl: signedPdfUrl,
          status: nextStatus,
        },
        { transaction }
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
            "text"
          ),
          { [Op.iLike]: `%${normalizedSearch}%` }
        ),
        Contract.sequelize.where(
          Contract.sequelize.cast(
            Contract.sequelize.col("Contract.partner_company_info"),
            "text"
          ),
          { [Op.iLike]: `%${normalizedSearch}%` }
        ),
        Contract.sequelize.where(
          Contract.sequelize.cast(
            Contract.sequelize.col("Contract.contract_data"),
            "text"
          ),
          { [Op.iLike]: `%${normalizedSearch}%` }
        ),
      ];
    }

    if (status) {
      where.status = status.trim();
    }

    if (contractType) {
      where.contractType = normalizeContractType(contractType);
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
      s3Keys.add(key)
    );
    collectCredentialS3Keys(contract.organizationCredential).forEach((key) =>
      s3Keys.add(key)
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
        signature.handwrittenSignatureImageUrl
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
        "Chỉ có thể sinh link ký cho đối tác khi hợp đồng ở trạng thái đối tác ký (owner_signed)"
      );
    }

    const partnerEmail = contract.partnerCompanyInfo?.email || "partner@example.com";

    // Sinh secure JWT token có thời gian hết hạn là 7 ngày cho đối tác
    const token = JWTService.signJson(
      {
        contractId,
        role: "partner",
        email: partnerEmail,
      },
      { expiresIn: "7d" }
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
