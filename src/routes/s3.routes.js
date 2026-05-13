const express = require("express");
const multer = require("multer");
const router = express.Router();
const S3Controller = require("../controllers/s3.controller");
const { protect } = require("../middlewares/auth.middleware");
const {
  getPresignedUrlSchema,
  getPresignedUploadUrlSchema,
  listObjectsSchema,
} = require("../schemas/s3.schema");

// Multer – lưu file vào memory buffer (không ghi ra disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// ─── UPLOAD ──────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/s3/upload:
 *   post:
 *     summary: Upload file lên AWS S3
 *     tags: [S3]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: File cần upload (tối đa 50MB)
 *               folder:
 *                 type: string
 *                 description: Thư mục đích trong bucket (mặc định là "uploads")
 *                 example: avatars
 *     responses:
 *       201:
 *         description: Upload thành công
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 key:
 *                   type: string
 *                   example: avatars/1715604000000_photo.jpg
 *                 url:
 *                   type: string
 *                   example: https://my-bucket.s3.ap-southeast-1.amazonaws.com/avatars/...
 *                 etag:
 *                   type: string
 *       400:
 *         description: Không có file trong request
 *       401:
 *         description: Chưa xác thực
 */
router.post("/upload", protect, upload.single("file"), S3Controller.uploadFile);

// ─── PRESIGNED URLs ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/s3/presigned-url:
 *   get:
 *     summary: Lấy presigned URL để download file từ S3
 *     tags: [S3]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Object key trong bucket
 *         example: avatars/1715604000000_photo.jpg
 *       - in: query
 *         name: expiresIn
 *         schema:
 *           type: integer
 *           minimum: 60
 *           maximum: 604800
 *           default: 3600
 *         description: Thời gian hết hạn URL (giây)
 *     responses:
 *       200:
 *         description: Lấy presigned URL thành công
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 presignedUrl:
 *                   type: string
 *                 key:
 *                   type: string
 *                 expiresIn:
 *                   type: integer
 *       400:
 *         description: Thiếu hoặc sai tham số
 *       401:
 *         description: Chưa xác thực
 */
router.get(
  "/presigned-url",
  protect,
  getPresignedUrlSchema,
  S3Controller.getPresignedDownloadUrl,
);

/**
 * @swagger
 * /api/v1/s3/presigned-upload-url:
 *   get:
 *     summary: Lấy presigned URL để client upload trực tiếp lên S3 (PUT)
 *     tags: [S3]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Object key đích trong bucket
 *         example: documents/report.pdf
 *       - in: query
 *         name: mimeType
 *         required: true
 *         schema:
 *           type: string
 *         description: Content-Type của file sẽ upload
 *         example: application/pdf
 *       - in: query
 *         name: expiresIn
 *         schema:
 *           type: integer
 *           minimum: 60
 *           maximum: 3600
 *           default: 300
 *         description: Thời gian hết hạn URL (giây)
 *     responses:
 *       200:
 *         description: Lấy presigned upload URL thành công
 *       400:
 *         description: Thiếu hoặc sai tham số
 *       401:
 *         description: Chưa xác thực
 */
router.get(
  "/presigned-upload-url",
  protect,
  getPresignedUploadUrlSchema,
  S3Controller.getPresignedUploadUrl,
);

// ─── OBJECTS ─────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/s3/objects:
 *   get:
 *     summary: Liệt kê các object trong bucket theo prefix
 *     tags: [S3]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: prefix
 *         schema:
 *           type: string
 *         description: Prefix để lọc (vd "images/")
 *       - in: query
 *         name: maxKeys
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000
 *           default: 100
 *         description: Số lượng object tối đa trả về
 *     responses:
 *       200:
 *         description: Lấy danh sách thành công
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   key:
 *                     type: string
 *                   size:
 *                     type: integer
 *                   lastModified:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Chưa xác thực
 */
router.get("/objects", protect, listObjectsSchema, S3Controller.listObjects);

/**
 * @swagger
 * /api/v1/s3/objects/exists/{key}:
 *   get:
 *     summary: Kiểm tra object có tồn tại trong bucket không
 *     tags: [S3]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Object key (có thể chứa "/", encode thành %2F nếu cần)
 *         example: avatars%2F1715604000000_photo.jpg
 *     responses:
 *       200:
 *         description: Kết quả kiểm tra
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 key:
 *                   type: string
 *                 exists:
 *                   type: boolean
 *       401:
 *         description: Chưa xác thực
 */
router.get("/objects/exists/*", protect, S3Controller.checkExists);

/**
 * @swagger
 * /api/v1/s3/objects/metadata/{key}:
 *   get:
 *     summary: Lấy metadata của một object trong S3
 *     tags: [S3]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Object key
 *         example: avatars%2F1715604000000_photo.jpg
 *     responses:
 *       200:
 *         description: Lấy metadata thành công
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 key:
 *                   type: string
 *                 contentType:
 *                   type: string
 *                 contentLength:
 *                   type: integer
 *                 lastModified:
 *                   type: string
 *                   format: date-time
 *                 etag:
 *                   type: string
 *       401:
 *         description: Chưa xác thực
 *       404:
 *         description: Object không tồn tại
 */
router.get("/objects/metadata/*", protect, S3Controller.getMetadata);

/**
 * @swagger
 * /api/v1/s3/objects/{key}:
 *   delete:
 *     summary: Xoá một object khỏi S3
 *     tags: [S3]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Object key cần xoá
 *         example: avatars%2F1715604000000_photo.jpg
 *     responses:
 *       200:
 *         description: Xoá thành công
 *       401:
 *         description: Chưa xác thực
 *       404:
 *         description: Object không tồn tại
 */
router.delete("/objects/*", protect, S3Controller.deleteObject);

module.exports = router;
