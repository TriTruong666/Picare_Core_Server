const { validationResult } = require("express-validator");
const LicenseService = require("../services/license.service");
const ResponseHandler = require("../common/response.handler");
const { BadRequestException } = require("../common/exceptions/BaseException");

const validate = (req) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
};

class LicenseController {
  static async create(req, res, next) {
    try {
      validate(req);
      const result = await LicenseService.createLicense(req.body);
      return ResponseHandler.created(res, result, "Tạo license thành công");
    } catch (error) { next(error); }
  }

  static async getAll(req, res, next) {
    try {
      return ResponseHandler.success(res, await LicenseService.getLicenses());
    } catch (error) { next(error); }
  }

  static async getById(req, res, next) {
    try {
      validate(req);
      return ResponseHandler.success(res, await LicenseService.getLicenseById(req.params.licenseId));
    } catch (error) { next(error); }
  }

  static async check(req, res, next) {
    try {
      validate(req);
      return ResponseHandler.success(
        res,
        await LicenseService.checkSoftwareAccess(req.body),
        "License hợp lệ",
      );
    } catch (error) { next(error); }
  }

  static async updateSoftware(req, res, next) {
    try {
      validate(req);
      const result = await LicenseService.updateSoftware(
        req.params.licenseId,
        req.params.softwareId,
        req.body,
      );
      return ResponseHandler.success(res, result, "Cập nhật phần mềm thành công");
    } catch (error) { next(error); }
  }
}

module.exports = LicenseController;
