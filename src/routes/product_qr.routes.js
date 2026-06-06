const express = require("express");
const ProductQRController = require("../controllers/product_qr.controller");
const { createProductQRSchema } = require("../schemas/product_qr.schema");
const { protect } = require("../middlewares/auth.middleware");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Product QR
 *   description: API tạo mã QR chứa thông tin sản phẩm
 */

/**
 * @swagger
 * /api/v1/product-qrs:
 *   post:
 *     summary: Tạo record sản phẩm và ảnh QR
 *     description: Nhận rich text, tách thành JSON theo các nhãn sản phẩm, tạo QR có logo Picare và upload ảnh PNG lên S3.
 *     tags: [Product QR]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rawContent]
 *             properties:
 *               rawContent:
 *                 type: string
 *                 description: Nội dung plain text hoặc HTML từ rich text editor
 *               note:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       201:
 *         description: Record và ảnh QR được tạo thành công
 *       400:
 *         description: Dữ liệu không hợp lệ hoặc nội dung vượt dung lượng QR
 *       401:
 *         description: Chưa đăng nhập
 */
router.post("/", protect, createProductQRSchema, ProductQRController.create);

module.exports = router;
