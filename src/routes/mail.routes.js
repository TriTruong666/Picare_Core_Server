const express = require("express");
const router = express.Router();
const MailController = require("../controllers/mail.controller");
const { protect } = require("../middlewares/auth.middleware");
const {
  sendMailSchema,
  sendTemplateMailSchema,
} = require("../schemas/mail.schema");

/**
 * @swagger
 * tags:
 *   name: Mail
 *   description: API gửi email qua SMTP
 */

/**
 * @swagger
 * /api/v1/mail/verify:
 *   get:
 *     summary: Kiểm tra kết nối SMTP
 *     tags: [Mail]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Kết nối SMTP thành công
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
 *                   example: Kết nối SMTP thành công
 *                 data:
 *                   type: object
 *                   properties:
 *                     host:
 *                       type: string
 *                       example: smtp.gmail.com
 *                     port:
 *                       type: integer
 *                       example: 587
 *                     secure:
 *                       type: boolean
 *                       example: false
 *                     from:
 *                       type: string
 *                       example: no-reply@picare.vn
 *       401:
 *         description: Chưa xác thực
 */
router.get("/verify", protect, MailController.verify);

/**
 * @swagger
 * /api/v1/mail/send:
 *   post:
 *     summary: Gửi email thường qua SMTP
 *     tags: [Mail]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - subject
 *             properties:
 *               to:
 *                 oneOf:
 *                   - type: string
 *                     example: partner@example.com
 *                   - type: array
 *                     items:
 *                       type: string
 *                     example: ["partner@example.com", "legal@example.com"]
 *               cc:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *               bcc:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *               subject:
 *                 type: string
 *                 example: Yêu cầu ký hợp đồng
 *               text:
 *                 type: string
 *                 example: Vui lòng mở link để ký hợp đồng.
 *               html:
 *                 type: string
 *                 example: <p>Vui lòng mở link để ký hợp đồng.</p>
 *               replyTo:
 *                 type: string
 *                 format: email
 *                 example: support@picare.vn
 *           examples:
 *             basic:
 *               summary: Gửi mail text
 *               value:
 *                 to: partner@example.com
 *                 subject: Yêu cầu ký hợp đồng
 *                 text: Vui lòng mở link để ký hợp đồng.
 *     responses:
 *       200:
 *         description: Gửi mail thành công
 *       400:
 *         description: Dữ liệu request không hợp lệ
 *       401:
 *         description: Chưa xác thực
 */
router.post("/send", protect, sendMailSchema, MailController.sendMail);

/**
 * @swagger
 * /api/v1/mail/send-template:
 *   post:
 *     summary: Gửi email theo template có tiêu đề, nội dung và nút hành động
 *     tags: [Mail]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - subject
 *             properties:
 *               to:
 *                 oneOf:
 *                   - type: string
 *                     example: partner@example.com
 *                   - type: array
 *                     items:
 *                       type: string
 *               cc:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *               bcc:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *               subject:
 *                 type: string
 *                 example: Yêu cầu ký hợp đồng
 *               title:
 *                 type: string
 *                 example: Hợp đồng đang chờ ký
 *               intro:
 *                 type: string
 *                 example: Picare gửi bạn đường link xem và ký hợp đồng.
 *               bodyLines:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example:
 *                   - Vui lòng kiểm tra nội dung hợp đồng trước khi ký.
 *                   - Link có thể hết hạn sau 7 ngày.
 *               actionLabel:
 *                 type: string
 *                 example: Mở hợp đồng
 *               actionUrl:
 *                 type: string
 *                 format: uri
 *                 example: https://oms.picare.vn/contracts/external-sign/token
 *               footer:
 *                 type: string
 *                 example: Nếu bạn không yêu cầu email này, vui lòng bỏ qua.
 *               replyTo:
 *                 type: string
 *                 format: email
 *                 example: support@picare.vn
 *     responses:
 *       200:
 *         description: Gửi mail template thành công
 *       400:
 *         description: Dữ liệu request không hợp lệ
 *       401:
 *         description: Chưa xác thực
 */
router.post(
  "/send-template",
  protect,
  sendTemplateMailSchema,
  MailController.sendTemplateMail,
);

module.exports = router;
