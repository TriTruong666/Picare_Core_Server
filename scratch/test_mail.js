const MailService = require("../src/services/mail.service");

const recipient =
  process.argv[2] ||
  process.env.MAIL_TEST_TO ||
  process.env.SMTP_USER ||
  "";

async function main() {
  if (!recipient) {
    throw new Error(
      "Thiếu email nhận. Dùng: node scratch/test_mail.js your-email@example.com"
    );
  }

  const connectionInfo = await MailService.verifyConnection();
  console.log("SMTP connection OK:");
  console.log(connectionInfo);

  const result = await MailService.sendTemplateMail({
    to: recipient,
    subject: "[Picare Test] Kiểm tra gửi mail SMTP",
    title: "Kiểm tra mail service",
    intro: "Đây là mail test được gửi từ Picare Core Hub.",
    bodyLines: [
      `Thời gian gửi: ${new Date().toISOString()}`,
      "Nếu bạn nhận được mail này thì cấu hình SMTP đang hoạt động bình thường.",
    ],
    footer: "Mail này chỉ dùng để test trong môi trường development.",
  });

  console.log("Send mail success:");
  console.log(result);
}

main().catch((error) => {
  console.error("Send mail failed:");
  console.error({
    message: error.message,
    statusCode: error.statusCode,
    errorCode: error.errorCode,
    details: error.details || null,
  });
  process.exitCode = 1;
});
