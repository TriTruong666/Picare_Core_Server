const test = require("node:test");
const assert = require("node:assert/strict");
const grpc = require("@grpc/grpc-js");
const MailService = require("../src/services/mail.service");
const handler = require("../src/services/grpc_mail.handler");

const request = {
  to: "customer@example.com",
  signerName: "Nguyễn Văn A",
  returnId: "RTSF-PIC-180926-000001",
  orderId: "SO-1",
  actionUrl: "https://sales.picare.vn/order-return/RT-1/sign?token=secret",
  expiresAt: "2026-09-21T10:00:00.000Z",
};

test("gRPC mail handler validates and forwards order-return signing mail", async (t) => {
  t.mock.method(MailService, "sendOrderReturnSigningMail", async (payload) => {
    assert.deepEqual(payload, request);
    return { messageId: "mail-1" };
  });
  const result = await new Promise((resolve, reject) => {
    handler.sendOrderReturnSigningMail({ request }, (error, response) =>
      error ? reject(error) : resolve(response),
    );
  });
  assert.equal(result.success, true);
  assert.equal(result.messageId, "mail-1");
});

test("gRPC mail handler rejects incomplete payload", async () => {
  const error = await new Promise((resolve) => {
    handler.sendOrderReturnSigningMail(
      { request: { ...request, actionUrl: "" } },
      (cause) => resolve(cause),
    );
  });
  assert.equal(error.code, grpc.status.INVALID_ARGUMENT);
});
