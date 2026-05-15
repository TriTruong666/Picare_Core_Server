const express = require("express");
const router = express.Router();
const S3FolderController = require("../controllers/s3_folder.controller");
const { protect, restrictTo } = require("../middlewares/auth.middleware");
const {
  createFolderSchema,
  updateFolderSchema,
  folderIdParamSchema,
} = require("../schemas/s3_folder.schema");

/**
 * @swagger
 * tags:
 *   name: S3Folders
 *   description: API quản lý thư mục lưu trữ S3
 */

/**
 * @swagger
 * /api/v1/s3-folders:
 *   post:
 *     summary: Tạo thư mục mới
 *     tags: [S3Folders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Tạo thành công
 */
router.post("/", protect, createFolderSchema, S3FolderController.create);

/**
 * @swagger
 * /api/v1/s3-folders:
 *   get:
 *     summary: Lấy danh sách thư mục
 *     tags: [S3Folders]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Thành công
 */
router.get("/", S3FolderController.getAll);

/**
 * @swagger
 * /api/v1/s3-folders/{folderId}:
 *   get:
 *     summary: Lấy chi tiết thư mục
 *     tags: [S3Folders]
 *     parameters:
 *       - in: path
 *         name: folderId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Thành công
 */
router.get("/:folderId", folderIdParamSchema, S3FolderController.getById);

/**
 * @swagger
 * /api/v1/s3-folders/{folderId}:
 *   put:
 *     summary: Cập nhật thư mục
 *     tags: [S3Folders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: folderId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.put("/:folderId", protect, updateFolderSchema, S3FolderController.update);

/**
 * @swagger
 * /api/v1/s3-folders/{folderId}:
 *   delete:
 *     summary: Xóa thư mục (CASCADE Delete Assets)
 *     tags: [S3Folders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: folderId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Xóa thành công
 */
router.delete("/:folderId", protect, folderIdParamSchema, S3FolderController.delete);

module.exports = router;
