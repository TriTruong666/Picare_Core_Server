const express = require("express");
const LicenseController = require("../controllers/license.controller");
const { protect, restrictTo } = require("../middlewares/auth.middleware");
const {
  createLicenseSchema,
  checkLicenseSchema,
  licenseIdSchema,
  updateSoftwareSchema,
} = require("../schemas/license.schema");

const router = express.Router();

/**
 * @swagger
 * /api/v1/licenses/check:
 *   post:
 *     summary: Kiểm tra quyền chạy của một server bằng license key
 *     tags: [Licenses]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [licenseKey, softwareId]
 *             properties:
 *               licenseKey: { type: string, format: uuid }
 *               softwareId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Server được phép hoạt động }
 *       403: { description: Server bị khoá }
 */
router.post("/check", checkLicenseSchema, LicenseController.check);

router.use(protect, restrictTo("admin"));

/**
 * @swagger
 * /api/v1/licenses:
 *   post:
 *     summary: Tạo license và danh sách phần mềm; licenseKey được tự sinh
 *     tags: [Licenses]
 *     responses:
 *       201: { description: Tạo license thành công }
 *   get:
 *     summary: Lấy danh sách license
 *     tags: [Licenses]
 *     responses:
 *       200: { description: Thành công }
 */
router.route("/").post(createLicenseSchema, LicenseController.create).get(LicenseController.getAll);

router.get("/:licenseId", licenseIdSchema, LicenseController.getById);
router.patch(
  "/:licenseId/software/:softwareId",
  updateSoftwareSchema,
  LicenseController.updateSoftware,
);

module.exports = router;
