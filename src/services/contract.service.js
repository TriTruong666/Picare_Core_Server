const { Op } = require("sequelize");
const fs = require("fs/promises");
const path = require("path");
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

const CONTRACT_OUTPUT_DIR =
  process.env.CONTRACT_OUTPUT_DIR ||
  path.resolve(__dirname, "../..", "storage", "contracts");

class ContractService {
  static async createContractTemplate({
    ownerCompanyInfo,
    partnerCompanyInfo,
    contractDueDate,
    contractType = "default",
    contractUrl,
    details = [],
  }) {
    return Contract.sequelize.transaction(async (transaction) => {
      const contract = await Contract.create(
        {
          ownerCompanyInfo,
          partnerCompanyInfo,
          contractDueDate,
          contractType,
          contractUrl,
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

      const { pdfHashHex, fileName, filePath } =
        await ContractPdfService.generateContractPdf(contract, createdDetails);
      const documentUrl = `/api/v1/contracts/${contract.contractId}/template-pdf`;

      await contract.update(
        {
          contractChecksum: pdfHashHex,
          contractUrl: contractUrl || documentUrl,
        },
        { transaction }
      );

      await ContractDocument.create(
        {
          contractId: contract.contractId,
          version: 1,
          status: "unsigned",
          fileName,
          filePath,
          fileUrl: documentUrl,
          fileHash: pdfHashHex,
        },
        { transaction }
      );

      contract.details = createdDetails;

      return {
        contract: ContractDetailDTO.fromContract(contract),
        pdfHashHex,
        previewUrl: documentUrl,
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

      const latestDocument = await this.getLatestContractDocument(contractId, {
        transaction,
      });

      const preparedSignaturePdf =
        await ContractPdfService.prepareByteRangeSignaturePdf({
          sourceFilePath: latestDocument.filePath,
          contract,
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
        throw new BadRequestException("Signing session không còn ở trạng thái pending");
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
      const nextStatus =
        signature.signerType === "partner" ? "completed" : "owner_signed";
      const signedPdfUrl = `/api/v1/contracts/${contractId}/template-pdf`;

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
    const filePath = latestDocument.filePath;

    try {
      await fs.access(filePath);
    } catch (error) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    return {
      filePath,
      fileName: latestDocument.fileName || `${contract.contractNumber}.pdf`.replace(/[\\/]/g, "-"),
    };
  }
}

module.exports = ContractService;
