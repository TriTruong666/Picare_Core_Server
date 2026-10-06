const test = require("node:test");
const assert = require("node:assert/strict");
const grpc = require("@grpc/grpc-js");
const MailService = require("../src/services/mail.service");
const handler = require("../src/services/grpc_mail.handler");
const request = {
  to: "member@example.com",
  recipientName: "Nguyễn Văn A <script>",
  companyName: "Picare & Co",
  accountEmail: "account@example.com",
  actionUrl: `https://office.example.com/member/setup#invitation=${"a".repeat(64)}`,
  expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
};
const call = (payload = request, token = "test-mail-secret") =>
  new Promise((resolve) => {
    const metadata = new grpc.Metadata();
    metadata.set("x-service-token", token);
    handler.sendOfficeInvitationMail(
      { request: payload, metadata },
      (error, response) => resolve({ error, response }),
    );
  });
test("Office mail renders escaped, formal content, noreply footer and fixed sender", async (t) => {
  t.mock.method(MailService, "sendMail", async (mail) => {
    assert.equal(mail.sender, "office");
    assert.equal(mail.mailFromName, "Picare Office");
    assert.match(mail.html, /&lt;script&gt;/);
    assert.doesNotMatch(mail.html, /<script>|<strong>|box-shadow/);
    assert.match(mail.text, /Kính gửi/);
    assert.match(mail.text, /Trân trọng,/);
    assert.match(mail.text, /03 ngày/);
    assert.match(mail.text, /noreply/);
    assert.match(mail.text, /account@example.com/);
    assert.ok(mail.html.includes(request.actionUrl));
    return { accepted: [mail.to], rejected: [], messageId: "mail-office" };
  });
  await MailService.sendOfficeInvitationMail(request);
});
test("Office RPC enforces service token, expected domain, expiration and SMTP acceptance", async (t) => {
  const oldSecret = process.env.GRPC_OFFICE_MAIL_SERVICE_TOKEN;
  const oldOrigin = process.env.OFFICE_CLIENT_URL;
  process.env.GRPC_OFFICE_MAIL_SERVICE_TOKEN = "test-mail-secret";
  process.env.OFFICE_CLIENT_URL = "https://office.example.com";
  t.after(() => {
    if (oldSecret === undefined)
      delete process.env.GRPC_OFFICE_MAIL_SERVICE_TOKEN;
    else process.env.GRPC_OFFICE_MAIL_SERVICE_TOKEN = oldSecret;
    if (oldOrigin === undefined) delete process.env.OFFICE_CLIENT_URL;
    else process.env.OFFICE_CLIENT_URL = oldOrigin;
  });
  const send = t.mock.method(
    MailService,
    "sendOfficeInvitationMail",
    async () => ({
      accepted: [request.to],
      rejected: [],
      messageId: "mail-office",
    }),
  );
  assert.equal(
    (await call(request, "wrong")).error.code,
    grpc.status.UNAUTHENTICATED,
  );
  assert.equal(send.mock.callCount(), 0);
  assert.equal(
    (
      await call({
        ...request,
        actionUrl: request.actionUrl.replace(
          "office.example.com",
          "evil.example.com",
        ),
      })
    ).error.code,
    grpc.status.INVALID_ARGUMENT,
  );
  assert.equal(
    (await call({ ...request, expiresAt: new Date(0).toISOString() })).error
      .code,
    grpc.status.INVALID_ARGUMENT,
  );
  assert.equal(
    (await call({ ...request, to: "" })).error.code,
    grpc.status.INVALID_ARGUMENT,
  );
  assert.equal((await call()).response.success, true);
  send.mock.mockImplementation(async () => ({
    accepted: [],
    rejected: [request.to],
  }));
  assert.equal((await call()).error.code, grpc.status.INTERNAL);
});
