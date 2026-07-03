const { validationResult } = require("express-validator");
const LicenseService = require("../services/license.service");
const ResponseHandler = require("../common/response.handler");
const { BadRequestException } = require("../common/exceptions/BaseException");

const validate = (req) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
};

class LicenseController {
  static async check(req, res, next) { try { validate(req); return ResponseHandler.success(res, await LicenseService.checkSoftwareAccess(req.body), "License hợp lệ"); } catch (e) { next(e); } }
  static async create(req, res, next) { try { validate(req); return ResponseHandler.created(res, await LicenseService.createLicense(req.body), "Tạo license thành công"); } catch (e) { next(e); } }
  static async getAll(req, res, next) { try { validate(req); const result = await LicenseService.getLicenses(req.query); return ResponseHandler.paginate(res, result.rows, result.count, result.page, result.limit, "Lấy danh sách license thành công"); } catch (e) { next(e); } }
  static async getById(req, res, next) { try { validate(req); return ResponseHandler.success(res, await LicenseService.getLicenseById(req.params.licenseId)); } catch (e) { next(e); } }
  static async update(req, res, next) { try { validate(req); return ResponseHandler.success(res, await LicenseService.updateLicense(req.params.licenseId, req.body), "Cập nhật license thành công"); } catch (e) { next(e); } }
  static async delete(req, res, next) { try { validate(req); return ResponseHandler.success(res, await LicenseService.deleteLicense(req.params.licenseId), "Xoá license thành công"); } catch (e) { next(e); } }

  static async createSoftware(req, res, next) { try { validate(req); return ResponseHandler.created(res, await LicenseService.createSoftware(req.params.licenseId, req.body), "Tạo phần mềm thành công"); } catch (e) { next(e); } }
  static async getSoftware(req, res, next) { try { validate(req); return ResponseHandler.success(res, await LicenseService.getSoftware(req.params.licenseId, req.params.softwareId)); } catch (e) { next(e); } }
  static async updateSoftware(req, res, next) { try { validate(req); return ResponseHandler.success(res, await LicenseService.updateSoftware(req.params.licenseId, req.params.softwareId, req.body), "Cập nhật phần mềm thành công"); } catch (e) { next(e); } }
  static async deleteSoftware(req, res, next) { try { validate(req); return ResponseHandler.success(res, await LicenseService.deleteSoftware(req.params.licenseId, req.params.softwareId), "Xoá phần mềm thành công"); } catch (e) { next(e); } }

  static async createTicket(req, res, next) { try { validate(req); return ResponseHandler.created(res, await LicenseService.createTicket(req.params.licenseId, req.body), "Tạo ticket thành công"); } catch (e) { next(e); } }
  static async getTickets(req, res, next) { try { validate(req); return ResponseHandler.success(res, await LicenseService.getTickets(req.params.licenseId, req.query.status)); } catch (e) { next(e); } }
  static async getTicket(req, res, next) { try { validate(req); return ResponseHandler.success(res, await LicenseService.getTicket(req.params.licenseId, req.params.ticketId)); } catch (e) { next(e); } }
  static async updateTicket(req, res, next) { try { validate(req); return ResponseHandler.success(res, await LicenseService.updateTicket(req.params.licenseId, req.params.ticketId, req.body), "Cập nhật ticket thành công"); } catch (e) { next(e); } }
  static async deleteTicket(req, res, next) { try { validate(req); return ResponseHandler.success(res, await LicenseService.deleteTicket(req.params.licenseId, req.params.ticketId), "Xoá ticket thành công"); } catch (e) { next(e); } }
}

module.exports = LicenseController;
