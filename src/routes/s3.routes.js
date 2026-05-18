const express = require("express");
const multer = require("multer");
const router = express.Router();
const S3Controller = require("../controllers/s3.controller");
const { protect } = require("../middlewares/auth.middleware");
const {
  getPresignedUrlSchema,
  getPresignedUploadUrlSchema,
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
 *     summary: Upload file lên AWS S3 và lưu record vào DB
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
 *                 description: Thư mục đích trong bucket (mặc định "uploads")
 *                 example: avatars
 *               clientId:
 *                 type: string
 *                 format: uuid
 *                 description: UUID của HubClient sở hữu file (tuỳ chọn)
 *               description:
 *                 type: string
 *                 description: Mô tả ngắn về file (tuỳ chọn)
 *               visibility:
 *                 type: string
 *                 enum: [public, private]
 *                 default: private
 *                 description: Quyền truy cập file
 *     responses:
 *       201:
 *         description: Upload thành công, record đã được lưu vào DB
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
 *                 record:
 *                   type: object
 *                   description: Record S3Asset đã được lưu trong DB
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
router.get(/^\/objects\/exists\/(.+)$/, protect, S3Controller.checkExists);

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
router.get(/^\/objects\/metadata\/(.+)$/, protect, S3Controller.getMetadata);

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
router.delete(/^\/objects\/(.+)$/, protect, S3Controller.deleteObject);

/**
 * @swagger
 * /api/v1/s3/assets:
 *   get:
 *     summary: Lấy danh sách asset từ database
 *     tags: [S3]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: folder
 *         schema:
 *           type: string
 *         description: folderId (UUID) hoặc folderName (string) để lọc
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: assetType
 *         schema:
 *           type: string
 *           enum: [image, video, document, audio, other]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Thành công
 */
router.get("/assets", protect, S3Controller.getAssets);

/**
 * @swagger
 * /api/v1/s3/view/{key}:
 *   get:
 *     summary: Redirect trực tiếp tới presigned URL để xem ảnh/file
 *     tags: [S3]
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Object key
 *     responses:
 *       302:
 *         description: Redirect tới S3
 */
router.get(/^\/view\/(.+)$/, S3Controller.viewObject);

/**
 * @swagger
 * /api/v1/s3/download:
 *   get:
 *     summary: Tải trực tiếp một file bất kỳ từ S3 về máy (với Content-Disposition attachment)
 *     tags: [S3]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: key
 *         required: false
 *         schema:
 *           type: string
 *         description: Object key của file trong S3 bucket (nếu dùng query param)
 *         example: donghang/1779077292048_upload1779077292047.webm
 *     responses:
 *       200:
 *         description: Trả về file stream nhị phân (binary) kèm header tải xuống
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Lỗi yêu cầu (thiếu key hoặc file không tồn tại)
 *       401:
 *         description: Chưa xác thực
 */
router.get("/download", protect, S3Controller.downloadObject);

/**
 * @swagger
 * /api/v1/s3/download/{key}:
 *   get:
 *     summary: Tải trực tiếp một file bất kỳ từ S3 bằng đường dẫn (đường dẫn có chứa dấu gạch chéo '/')
 *     tags: [S3]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Object key của file trong S3 bucket
 *         example: donghang/1779077292048_upload1779077292047.webm
 *     responses:
 *       200:
 *         description: Trả về file stream nhị phân
 *       400:
 *         description: Lỗi yêu cầu
 *       401:
 *         description: Chưa xác thực
 */
router.get(/^\/download\/(.+)$/, protect, S3Controller.downloadObject);

/**
 * @swagger
 * /api/v1/s3/merge-videos:
 *   post:
 *     summary: Ghép hai video (.webm) từ S3 thành một video duy nhất bằng FFmpeg
 *     tags: [S3]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mainVideoKey
 *               - secondVideoKey
 *             properties:
 *               mainVideoKey:
 *                 type: string
 *                 description: S3 key của video chính
 *                 example: donghang/1779077292048_upload1779077292047.webm
 *               secondVideoKey:
 *                 type: string
 *                 description: S3 key của video thứ hai
 *                 example: donghang/1779077292309_upload1779077292308.webm
 *               clientId:
 *                 type: string
 *                 format: uuid
 *                 description: UUID của HubClient sở hữu video đã ghép (tuỳ chọn)
 *               visibility:
 *                 type: string
 *                 enum: [public, private]
 *                 default: private
 *                 description: Chế độ hiển thị của video đã ghép
 *     responses:
 *       201:
 *         description: Ghép video thành công, trả về link S3 và record DB mới
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Ghép video và upload thành công
 *                 data:
 *                   type: object
 *                   properties:
 *                     key:
 *                       type: string
 *                       example: merged_videos/1715604000000_merged_video.webm
 *                     url:
 *                       type: string
 *                       example: https://picare-test.s3.ap-southeast-1.amazonaws.com/merged_videos/1715604000000_merged_video.webm
 *                     presignedUrl:
 *                       type: string
 *                       example: https://picare-test.s3.ap-southeast-1.amazonaws.com/merged_videos/1715604000000_merged_video.webm?AWSAccessKeyId=...
 *                     etag:
 *                       type: string
 *                     record:
 *                       type: object
 */
router.post("/merge-videos", protect, S3Controller.mergeVideos);

module.exports = router;
