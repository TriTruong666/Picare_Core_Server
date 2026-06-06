const { validationResult } = require("express-validator");
const ProductQRService = require("../services/product_qr.service");
const ResponseHandler = require("../common/response.handler");
const { BadRequestException } = require("../common/exceptions/BaseException");

class ProductQRController {
  static async create(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Dữ liệu không hợp lệ", errors.array());
      }

      const productQR = await ProductQRService.create({
        rawContent: req.body.rawContent,
        note: req.body.note,
        uploadedBy: req.user?.userId || null,
      });

      return ResponseHandler.created(
        res,
        productQR.toJSON(),
        "Tạo mã QR sản phẩm thành công",
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ProductQRController;
