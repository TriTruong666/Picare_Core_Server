const { validationResult } = require("express-validator");
const ProductQRService = require("../services/product_qr.service");
const ResponseHandler = require("../common/response.handler");
const { BadRequestException } = require("../common/exceptions/BaseException");

class ProductQRController {
  static async getProductQRsPaginate(req, res, next) {
    try {
      const { page = 1, limit = 20, search = "" } = req.query;
      const result = await ProductQRService.getProductQRsPaginate({
        page,
        limit,
        search,
      });

      return ResponseHandler.paginate(
        res,
        result.productQRs,
        result.count,
        result.page,
        result.limit,
        "Lấy danh sách QR sản phẩm thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  static async getProductQRById(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
      }

      const { productId } = req.params;
      const productQR = await ProductQRService.getProductQRByProductId(productId);

      return ResponseHandler.success(
        res,
        productQR,
        "Lấy chi tiết QR sản phẩm thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
      }

      const productQR = await ProductQRService.create({
        linkUrl: req.body.linkUrl,
        rawContent: req.body.rawContent,
        note: req.body.note,
        uploadedBy: req.user?.userId || null,
        imageFile: req.file || null,
      });

      return ResponseHandler.created(
        res,
        productQR,
        "Tạo mã QR sản phẩm thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  static async update(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
      }

      const { productId } = req.params;
      const productQR = await ProductQRService.update(productId, req.body, {
        imageFile: req.file || null,
        uploadedBy: req.user?.userId || null,
      });

      return ResponseHandler.success(
        res,
        productQR,
        "Cập nhật QR sản phẩm thành công",
      );
    } catch (error) {
      next(error);
    }
  }

  static async delete(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
      }

      const { productId } = req.params;
      const result = await ProductQRService.delete(productId);

      return ResponseHandler.success(res, null, result.message);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ProductQRController;
