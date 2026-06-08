const express = require("express");
const multer = require("multer");
const ProductQRController = require("../controllers/product_qr.controller");
const {
  createProductQRSchema,
  updateProductQRSchema,
  productIdSchema,
} = require("../schemas/product_qr.schema");
const { protect } = require("../middlewares/auth.middleware");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

/**
 * @swagger
 * tags:
 *   name: Product QR
 *   description: API quản lý mã QR chứa thông tin sản phẩm
 */

/**
 * @swagger
 * /api/v1/product-qrs:
 *   get:
 *     summary: Lấy danh sách QR sản phẩm
 *     tags: [Product QR]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Số trang hiện tại
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Số lượng bản ghi trên một trang
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Tìm kiếm theo productId, nội dung thô hoặc tên sản phẩm
 *     responses:
 *       200:
 *         description: Thành công
 */
router.get("/", ProductQRController.getProductQRsPaginate);

/**
 * @swagger
 * /api/v1/product-qrs/{productId}:
 *   get:
 *     summary: Lấy chi tiết một QR sản phẩm theo productId
 *     tags: [Product QR]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Thành công
 *       404:
 *         description: Không tìm thấy dữ liệu
 */
router.get("/:productId", productIdSchema, ProductQRController.getProductQRById);

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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [rawContent]
 *             properties:
 *               linkUrl:
 *                 type: string
 *                 description: URL sẽ được encode vào mã QR. Nếu không truyền, backend tự sinh link mặc định của product QR.
 *               rawContent:
 *                 type: string
 *                 description: Nội dung plain text hoặc HTML từ rich text editor
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Ảnh sản phẩm upload lên S3, lưu tại imageUrl
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
router.post(
  "/",
  protect,
  upload.single("image"),
  createProductQRSchema,
  ProductQRController.create,
);

/**
 * @swagger
 * /api/v1/product-qrs/{productId}:
 *   put:
 *     summary: Cập nhật nội dung một QR sản phẩm
 *     tags: [Product QR]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               linkUrl:
 *                 type: string
 *               rawContent:
 *                 type: string
 *               image:
 *                 type: string
 *                 format: binary
 *               note:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy dữ liệu
 */
router.put(
  "/:productId",
  protect,
  upload.single("image"),
  updateProductQRSchema,
  ProductQRController.update,
);

/**
 * @swagger
 * /api/v1/product-qrs/{productId}:
 *   delete:
 *     summary: Xóa một QR sản phẩm
 *     tags: [Product QR]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Xóa thành công
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy dữ liệu
 */
router.delete("/:productId", protect, productIdSchema, ProductQRController.delete);

module.exports = router;
