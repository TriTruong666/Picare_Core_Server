const S3FolderService = require("../services/s3_folder.service");
const ResponseHandler = require("../common/response.handler");
const { validationResult } = require("express-validator");
const { BadRequestException } = require("../common/exceptions/BaseException");
const { S3FolderDTO } = require("../schemas/s3_folder.schema");

class S3FolderController {
  /**
   * POST /api/v1/s3-folders
   */
  static async create(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
      }

      const folder = await S3FolderService.create(req.body);
      return ResponseHandler.created(
        res,
        S3FolderDTO.fromFolder(folder),
        "Tạo thư mục thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/s3-folders
   */
  static async getAll(req, res, next) {
    try {
      const { page, limit, search } = req.query;
      const { rows, count } = await S3FolderService.getAll({ page, limit, search });
      
      return ResponseHandler.paginate(
        res,
        S3FolderDTO.fromFolders(rows),
        count,
        page || 1,
        limit || 20,
        "Lấy danh sách thư mục thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/s3-folders/:folderId
   */
  static async getById(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
      }

      const folder = await S3FolderService.getById(req.params.folderId);
      return ResponseHandler.success(
        res,
        S3FolderDTO.fromFolder(folder),
        "Lấy chi tiết thư mục thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/s3-folders/:folderId
   */
  static async update(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
      }

      const folder = await S3FolderService.update(req.params.folderId, req.body);
      return ResponseHandler.success(
        res,
        S3FolderDTO.fromFolder(folder),
        "Cập nhật thư mục thành công"
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/s3-folders/:folderId
   */
  static async delete(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
      }

      const result = await S3FolderService.delete(req.params.folderId);
      return ResponseHandler.success(res, null, result.message);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = S3FolderController;
