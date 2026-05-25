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
const appConfig = require("../config/app.config");

const CONTRACT_STATUS = {
  DRAFT: "draft",
  UNSIGNED: "unsigned",
  OWNER_SIGNED: "owner_signed",
  COMPLETED: "completed",
};

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

class ContractService {
  static async getContractDetails(contractId, options = {}) {
    return ContractDetail.findAll({
      where: { contractId },
      order: [["createdAt", "ASC"]],
      transaction: options.transaction,
    });
  }

  static async ensureContractDocumentFile(contract, document, options = {}) {
    if (document.filePath) {
      return document;
    }

    const details =
      options.details ||
      (await this.getContractDetails(contract.contractId, options));
    const { pdfHashHex, fileName, filePath } =
      await ContractPdfService.generateContractPdf(contract, details);

    await document.update(
      {
        fileName,
        filePath,
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
    contractType = "default",
    details = [],
  }) {
    return Contract.sequelize.transaction(async (transaction) => {
      const contract = await Contract.create(
        {
          ownerCompanyInfo,
          partnerCompanyInfo,
          contractDueDate,
          contractType,
          status: CONTRACT_STATUS.DRAFT,
        },
        { transaction }
      );

      const createdDetails = await ContractDetail.bulkCreate(
        details.map((detail) => ({
          contractId: contract.contractId,
          productName: detail.productName,
          price: detail.price,
        })),
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

      const fileBuffer = await fs.readFile(latestDocument.filePath);
      const fileSize = (await fs.stat(latestDocument.filePath)).size;
      const s3Key = S3Service.buildKey(
        "unsigned-contracts",
        latestDocument.fileName
      );
      const s3Result = await S3Service.upload({
        key: s3Key,
        body: fileBuffer,
        mimeType: "application/pdf",
        originalName: latestDocument.fileName,
        fileSize,
        folder: "unsigned-contracts",
        clientId: null,
        description: formatContractCreatedDescription(),
        visibility: "private",
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

      const fileBuffer = await fs.readFile(latestDocument.filePath);
      const fileSize = (await fs.stat(latestDocument.filePath)).size;
      const s3Key = S3Service.buildKey("owner_signed", latestDocument.fileName);
      const s3Result = await S3Service.upload({
        key: s3Key,
        body: fileBuffer,
        mimeType: "application/pdf",
        originalName: latestDocument.fileName,
        fileSize,
        folder: "owner_signed",
        clientId: null,
        description: formatContractCreatedDescription(),
        visibility: "private",
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

      const fileBuffer = await fs.readFile(latestDocument.filePath);
      const fileSize = (await fs.stat(latestDocument.filePath)).size;
      const s3Key = S3Service.buildKey(
        "complete_contract",
        latestDocument.fileName
      );
      const s3Result = await S3Service.upload({
        key: s3Key,
        body: fileBuffer,
        mimeType: "application/pdf",
        originalName: latestDocument.fileName,
        fileSize,
        folder: "complete_contract",
        clientId: null,
        description: formatContractCreatedDescription(),
        visibility: "private",
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
      contractType = "default",
      details = [],
    }
  ) {
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

      await contract.update(
        {
          ownerCompanyInfo,
          partnerCompanyInfo,
          contractDueDate,
          contractType,
          contractUrl: null,
        },
        { transaction }
      );

      await ContractDetail.destroy({
        where: { contractId },
        transaction,
      });

      const updatedDetails = await ContractDetail.bulkCreate(
        details.map((detail) => ({
          contractId,
          productName: detail.productName,
          price: detail.price,
        })),
        { transaction, returning: true }
      );

      const latestDocument = await this.getLatestContractDocument(contractId, {
        transaction,
      });

      const previousFilePath = latestDocument.filePath;
      const { pdfHashHex, fileName, filePath } =
        await ContractPdfService.generateContractPdf(contract, updatedDetails);

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
          filePath,
          fileUrl: null,
          fileHash: pdfHashHex,
        },
        { transaction }
      );

      if (previousFilePath && previousFilePath !== filePath) {
        try {
          await fs.unlink(previousFilePath);
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

      const preparedSignaturePdf =
        await ContractPdfService.prepareByteRangeSignaturePdf({
          sourceFilePath: latestDocument.filePath,
          contract,
          details,
          signerName,
          signerType,
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
          preparedPdfPath: preparedSignaturePdf.preparedPdfPath,
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

      const signedPdf = await ContractPdfService.embedByteRangeSignature({
        preparedPdfPath: signature.preparedPdfPath,
        contract,
        signatureHex,
      });
      const nextVersion = sourceDocument.version + 1;
      const nextStatus = getNextContractStatus(contract, signature.signerType);
      const signedFolder = getSignedContractFolder(nextStatus);
      const signedPdfBuffer = await fs.readFile(signedPdf.filePath);
      const signedPdfFileSize = (await fs.stat(signedPdf.filePath)).size;
      const signedS3Key = S3Service.buildKey(signedFolder, signedPdf.fileName);
      const signedS3Result = await S3Service.upload({
        key: signedS3Key,
        body: signedPdfBuffer,
        mimeType: "application/pdf",
        originalName: signedPdf.fileName,
        fileSize: signedPdfFileSize,
        folder: signedFolder,
        clientId: null,
        description: formatContractCreatedDescription(),
        visibility: "private",
      });
      const signedPdfUrl = signedS3Result.url;

      const signedDocument = await ContractDocument.create(
        {
          contractId,
          version: nextVersion,
          status: nextStatus,
          fileName: signedPdf.fileName,
          filePath: signedPdf.filePath,
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

  static async getContractsPaginate({
    page = 1,
    limit = 20,
    search = "",
    status = "",
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
      ];
    }

    if (status) {
      where.status = status.trim();
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
    const filePath = latestDocument.filePath;

    try {
      await fs.access(filePath);
    } catch (error) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    return {
      filePath,
      fileName:
        latestDocument.fileName ||
        `${contract.contractNumber}.pdf`.replace(/[\\/]/g, "-"),
    };
  }
}

module.exports = ContractService;
