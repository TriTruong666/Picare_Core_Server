const { Op } = require("sequelize");
const fs = require("fs/promises");
const path = require("path");
const { Contract, ContractDetail } = require("../models");
const {
  ContractListDTO,
  ContractDetailDTO,
} = require("../schemas/contract.schema");
const ErrorCodes = require("../common/exceptions/error_codes");
const { NotFoundException } = require("../common/exceptions/BaseException");
const ContractPdfService = require("./contract_pdf.service");

const CONTRACT_OUTPUT_DIR =
  process.env.CONTRACT_OUTPUT_DIR ||
  path.resolve(__dirname, "../..", "storage", "contracts");

class ContractService {
  static async createContractTemplate({
    contractNumber,
    ownerCompanyInfo,
    partnerCompanyInfo,
    contractDueDate,
    contractType = "default",
    details = [],
  }) {
    return Contract.sequelize.transaction(async (transaction) => {
      const contract = await Contract.create(
        {
          contractNumber,
          ownerCompanyInfo,
          partnerCompanyInfo,
          contractDueDate,
          contractType,
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

      const { pdfHashHex, contractUrl } =
        await ContractPdfService.generateContractPdf(contract, createdDetails);

      await contract.update(
        {
          contractChecksum: pdfHashHex,
          contractUrl,
        },
        { transaction }
      );

      contract.details = createdDetails;

      return {
        contract: ContractDetailDTO.fromContract(contract),
        pdfHashHex,
        previewUrl: contractUrl,
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

    const filePrefix = `${contract.contractId}-${contract.contractChecksum.slice(
      0,
      12
    )}`;
    const filePath = path.join(CONTRACT_OUTPUT_DIR, `${filePrefix}.pdf`);

    try {
      await fs.access(filePath);
    } catch (error) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND);
    }

    return {
      filePath,
      fileName: `${contract.contractNumber}.pdf`.replace(/[\\/]/g, "-"),
    };
  }
}

module.exports = ContractService;
