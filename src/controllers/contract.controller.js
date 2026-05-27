const { validationResult } = require("express-validator");
const ResponseHandler = require("../common/response.handler");
const ContractService = require("../services/contract.service");
const { BadRequestException } = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");

const base64ToMulterFile = ({
  value,
  fieldName,
  filename,
  mimeType,
}) => {
  if (!value || typeof value !== "string") {
    return null;
  }

  const dataUriMatch = value.match(/^data:([^;]+);base64,(.+)$/);
  const resolvedMimeType = dataUriMatch?.[1] || mimeType || "image/jpeg";
  const base64Payload = dataUriMatch?.[2] || value;
  const buffer = Buffer.from(base64Payload, "base64");

  if (!buffer.length) {
    return null;
  }

  return {
    fieldname: fieldName,
    originalname:
      filename || `${fieldName}_${Date.now()}.${resolvedMimeType.split("/")[1] || "jpg"}`,
    encoding: "7bit",
    mimetype: resolvedMimeType,
    buffer,
    size: buffer.length,
  };
};

const getFileFromRequest = (req, fieldName) => {
  if (fieldName === "signature_image" && req.file) {
    return req.file;
  }

  const multipartFile = req.files?.[fieldName]?.[0];
  if (multipartFile) {
    return multipartFile;
  }

  return base64ToMulterFile({
    value: req.body?.[fieldName],
    fieldName,
    filename: req.body?.[`${fieldName}_filename`],
    mimeType: req.body?.[`${fieldName}_mimeType`] || req.body?.[`${fieldName}_mimetype`],
  });
};

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

      const { page = 1, limit = 20, search = "", status = "" } = req.query;
      const result = await ContractService.getContractsPaginate({
        page,
        limit,
        search,
        status,
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

  static async deleteContract(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { contractId } = req.params;
      const result = await ContractService.deleteContract(contractId);

      return ResponseHandler.success(
        res,
        result,
        "Xoá hợp đồng thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  static async updateDraftContract(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { contractId } = req.params;
      const result = await ContractService.updateDraftContract(
        contractId,
        req.body
      );

      return ResponseHandler.success(
        res,
        result,
        "Cập nhật hợp đồng draft thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  static async publishUnsignedContract(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { contractId } = req.params;
      const result = await ContractService.publishUnsignedContract(contractId);

      return ResponseHandler.success(
        res,
        result,
        "Publish hợp đồng unsigned lên S3 thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  static async publishOwnerSignedContract(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { contractId } = req.params;
      const result = await ContractService.publishOwnerSignedContract(contractId);

      return ResponseHandler.success(
        res,
        result,
        "Publish hợp đồng owner_signed lên S3 thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  static async publishCompletedContract(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { contractId } = req.params;
      const result = await ContractService.publishCompletedContract(contractId);

      return ResponseHandler.success(
        res,
        result,
        "Publish hợp đồng completed lên S3 thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  static async createSigningSession(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { contractId } = req.params;
      const result = await ContractService.createSigningSession({
        contractId,
        ...req.body,
      });

      return ResponseHandler.created(
        res,
        result,
        "Tạo phiên ký số thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  static async completeSigningSession(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { contractId, contractSignatureId } = req.params;
      const result = await ContractService.completeSigningSession({
        contractId,
        contractSignatureId,
        ...req.body,
      });

      return ResponseHandler.success(
        res,
        result,
        "Hoàn tất ký số hợp đồng thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  static async updatePartnerSignerType(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { contractId } = req.params;
      const result = await ContractService.updatePartnerSignerType({
        contractId,
        signerType: req.body.signerType,
      });

      return ResponseHandler.success(
        res,
        result,
        "Cập nhật loại đối tác ký hợp đồng thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  static async uploadIndividualCredential(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { contractId } = req.params;
      const result = await ContractService.uploadIndividualCredential({
        contractId,
        firstIdentificationImage: getFileFromRequest(
          req,
          "first_identification_image"
        ),
        secondIdentificationImage: getFileFromRequest(
          req,
          "second_identification_image"
        ),
        uploadedBy: req.user?.userId || null,
      });

      return ResponseHandler.success(
        res,
        result,
        "Upload và trích xuất thông tin CMND/CCCD thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  static async uploadOrganizationCredential(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { contractId } = req.params;
      const result = await ContractService.uploadOrganizationCredential({
        contractId,
        businessLicense: req.files?.business_license?.[0],
        powerOfAttorney: req.files?.power_of_attorney_image?.[0],
        uploadedBy: req.user?.userId || null,
      });

      return ResponseHandler.success(
        res,
        result,
        "Upload hồ sơ tổ chức thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  static async deletePartnerCredential(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { contractId } = req.params;
      const result = await ContractService.deletePartnerCredential({
        contractId,
        credentialType: req.body.credentialType,
      });

      return ResponseHandler.success(
        res,
        result,
        "XoÃ¡ há»“ sÆ¡ kÃ½ cá»§a Ä‘á»‘i tÃ¡c thÃ nh cÃ´ng"
      );
    } catch (error) {
      next(error);
    }
  }

  static async completeHandwrittenSignature(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { contractId } = req.params;
      const result = await ContractService.completeHandwrittenSignature({
        contractId,
        partnerSignerType: req.body.signerType,
        signerName: req.body.signerName,
        signerEmail: req.body.signerEmail,
        signatureImage: getFileFromRequest(req, "signature_image"),
        uploadedBy: req.user?.userId || null,
      });

      return ResponseHandler.success(
        res,
        result,
        "Hoàn tất ký tay hợp đồng thành công"
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

  static async generatePartnerSigningLink(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException(ErrorCodes.BAD_REQUEST, errors.array());
      }

      const { contractId } = req.params;
      const result = await ContractService.generatePartnerSigningLink(contractId);

      return ResponseHandler.success(
        res,
        result,
        "Sinh đường dẫn ký hợp đồng cho đối tác thành công"
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ContractController;
