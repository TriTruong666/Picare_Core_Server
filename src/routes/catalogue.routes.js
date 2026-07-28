const express = require("express");
const multer = require("multer");
const CatalogueController = require("../controllers/catalogue.controller");
const { protect } = require("../middlewares/auth.middleware");
const {
  catalogueIdSchema,
  createCatalogueSchema,
  updateCatalogueSchema,
  catalogueListSchema,
} = require("../schemas/catalogue.schema");
const { maxFileUploadBytes } = require("../config/upload.config");

const router = express.Router();
const MAX_CATALOGUE_IMAGES = 100;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxFileUploadBytes,
    files: MAX_CATALOGUE_IMAGES,
  },
  fileFilter: (req, file, callback) => {
    callback(null, file.mimetype.startsWith("image/"));
  },
});

/**
 * @swagger
 * tags:
 *   name: Catalogues
 *   description: Quản lý catalogue và danh sách ảnh trên S3
 */

/**
 * @swagger
 * /api/v1/catalogues:
 *   get:
 *     summary: Lấy danh sách catalogue để quản lý
 *     tags: [Catalogues]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Tìm theo tên catalogue
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [ACTIVE, INACTIVE] }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [createdAt, updatedAt, catalogueName], default: createdAt }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [ASC, DESC], default: DESC }
 *     responses:
 *       200:
 *         description: Danh sách catalogue và chỉ details[0] (ảnh cover theo sortOrder); dùng GET /catalogues/{catalogueId} để lấy toàn bộ ảnh.
 */
router.get("/", catalogueListSchema, CatalogueController.list);

/**
 * @swagger
 * /api/v1/catalogues/{catalogueId}:
 *   get:
 *     summary: Lấy chi tiết catalogue và toàn bộ ảnh
 *     tags: [Catalogues]
 *     parameters:
 *       - in: path
 *         name: catalogueId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Catalogue được tìm thấy }
 *       404: { description: Không tìm thấy catalogue }
 */
router.get("/:catalogueId", catalogueIdSchema, CatalogueController.get);

/**
 * @swagger
 * /api/v1/catalogues:
 *   post:
 *     summary: Tạo catalogue và upload nhiều ảnh lên S3
 *     description: Ảnh luôn được lưu trong folder S3 catalogue; client không truyền hoặc thay đổi folder.
 *     tags: [Catalogues]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [catalogueName]
 *             properties:
 *               catalogueName: { type: string }
 *               status: { type: string, enum: [ACTIVE, INACTIVE], default: ACTIVE }
 *               note: { type: string, nullable: true }
 *               images:
 *                 type: array
 *                 maxItems: 100
 *                 items: { type: string, format: binary }
 *     responses:
 *       201: { description: Tạo catalogue thành công }
 *       400: { description: Dữ liệu hoặc file không hợp lệ }
 *       401: { description: Chưa xác thực }
 */
router.post("/", protect, upload.array("images", MAX_CATALOGUE_IMAGES), createCatalogueSchema, CatalogueController.create);

/**
 * @swagger
 * /api/v1/catalogues/{catalogueId}:
 *   put:
 *     summary: Cập nhật catalogue, thêm hoặc xóa ảnh
 *     description: details nhận mảng JSON để đổi sortOrder của ảnh hiện có. removeDetailIds nhận mảng JSON các catalogueDetailId cần xóa. Ảnh mới luôn được upload vào folder S3 catalogue.
 *     tags: [Catalogues]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: catalogueId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               catalogueName: { type: string }
 *               status: { type: string, enum: [ACTIVE, INACTIVE] }
 *               note: { type: string, nullable: true }
 *               removeDetailIds:
 *                 type: string
 *                 example: '["c1b1f2ad-5fe8-4e07-906a-e454f14a1eaf"]'
 *               details:
 *                 type: string
 *                 description: Mảng JSON cập nhật thứ tự các ảnh đã tồn tại
 *                 example: '[{"catalogueDetailId":"c1b1f2ad-5fe8-4e07-906a-e454f14a1eaf","sortOrder":0},{"catalogueDetailId":"a2c3d4e5-5fe8-4e07-906a-e454f14a1eaf","sortOrder":1}]'
 *               images:
 *                 type: array
 *                 maxItems: 100
 *                 items: { type: string, format: binary }
 *     responses:
 *       200: { description: Cập nhật thành công }
 *       401: { description: Chưa xác thực }
 *       404: { description: Không tìm thấy catalogue }
 */
router.put("/:catalogueId", protect, upload.array("images", MAX_CATALOGUE_IMAGES), updateCatalogueSchema, CatalogueController.update);

/**
 * @swagger
 * /api/v1/catalogues/{catalogueId}/details/{catalogueDetailId}:
 *   delete:
 *     summary: Xóa một ảnh catalogue khỏi S3 và database
 *     tags: [Catalogues]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: catalogueId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: catalogueDetailId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Xóa ảnh thành công }
 *       404: { description: Không tìm thấy ảnh }
 */
router.delete(
  "/:catalogueId/details/:catalogueDetailId",
  protect,
  catalogueIdSchema,
  require("express-validator").param("catalogueDetailId").isUUID(4).withMessage("catalogueDetailId không hợp lệ"),
  CatalogueController.deleteDetail,
);

/**
 * @swagger
 * /api/v1/catalogues/{catalogueId}:
 *   delete:
 *     summary: Xóa catalogue cùng toàn bộ ảnh S3
 *     tags: [Catalogues]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: catalogueId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Xóa catalogue thành công }
 *       404: { description: Không tìm thấy catalogue }
 */
router.delete("/:catalogueId", protect, catalogueIdSchema, CatalogueController.delete);

module.exports = router;
