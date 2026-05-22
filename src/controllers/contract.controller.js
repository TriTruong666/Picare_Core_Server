const { validationResult } = require("express-validator");
const ResponseHandler = require("../common/response.handler");
const ContractService = require("../services/contract.service");
const { BadRequestException } = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");

class ContractController {
  static async createContractTemplate(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const result = await ContractService.createContractTemplate(req.body);

      return ResponseHandler.created(
        res,
        result,
        "Tạo hợp đồng mẫu thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  static async getContractsPaginate(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { page = 1, limit = 20, search = "" } = req.query;
      const result = await ContractService.getContractsPaginate({
        page,
        limit,
        search,
      });

      return ResponseHandler.paginate(
        res,
        result.contracts,
        result.count,
        result.page,
        result.limit,
        "Lấy danh sách hợp đồng thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  static async getContractById(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { contractId } = req.params;
      const contract = await ContractService.getContractById(contractId);

      return ResponseHandler.success(
        res,
        contract,
        "Lấy chi tiết hợp đồng thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  static async previewContractPdf(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { contractId } = req.params;
      const { filePath, fileName } = await ContractService.getContractPdf(
        contractId
      );

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
      return res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ContractController;
