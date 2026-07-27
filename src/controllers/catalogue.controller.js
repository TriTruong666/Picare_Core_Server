const { validationResult } = require("express-validator");
const CatalogueService = require("../services/catalogue.service");
const ResponseHandler = require("../common/response.handler");
const { BadRequestException } = require("../common/exceptions/BaseException");

const validate = (req) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
};

const parseDetailIds = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [value];
    } catch (_) {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
};

const parseDetails = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") {
    throw new BadRequestException("details phải là mảng JSON");
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error("Not an array");
    return parsed;
  } catch (_) {
    throw new BadRequestException("details phải là mảng JSON hợp lệ");
  }
};

class CatalogueController {
  static async list(req, res, next) {
    try {
      validate(req);
      const result = await CatalogueService.list(req.query);
      return ResponseHandler.paginate(res, result.rows, result.count, result.page, result.limit, "Lấy danh sách catalogue thành công");
    } catch (error) { next(error); }
  }

  static async get(req, res, next) {
    try {
      validate(req);
      return ResponseHandler.success(res, await CatalogueService.get(req.params.catalogueId), "Lấy catalogue thành công");
    } catch (error) { next(error); }
  }

  static async create(req, res, next) {
    try {
      validate(req);
      const catalogue = await CatalogueService.create({
        ...req.body,
        imageFiles: req.files || [],
        uploadedBy: req.user?.userId || null,
      });
      return ResponseHandler.created(res, catalogue, "Tạo catalogue thành công");
    } catch (error) { next(error); }
  }

  static async update(req, res, next) {
    try {
      validate(req);
      const catalogue = await CatalogueService.update(req.params.catalogueId, req.body, {
        imageFiles: req.files || [],
        uploadedBy: req.user?.userId || null,
        removeDetailIds: parseDetailIds(req.body.removeDetailIds),
        details: parseDetails(req.body.details),
      });
      return ResponseHandler.success(res, catalogue, "Cập nhật catalogue thành công");
    } catch (error) { next(error); }
  }

  static async deleteDetail(req, res, next) {
    try {
      validate(req);
      await CatalogueService.deleteDetail(req.params.catalogueId, req.params.catalogueDetailId);
      return ResponseHandler.success(res, null, "Xóa hình ảnh catalogue thành công");
    } catch (error) { next(error); }
  }

  static async delete(req, res, next) {
    try {
      validate(req);
      await CatalogueService.delete(req.params.catalogueId);
      return ResponseHandler.success(res, null, "Xóa catalogue thành công");
    } catch (error) { next(error); }
  }
}

module.exports = CatalogueController;
