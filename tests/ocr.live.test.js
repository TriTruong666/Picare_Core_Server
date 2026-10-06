// Opt-in smoke through actual gRPC → Core HTTP client → Python → PaddleOCR.
// Only generated test text; no real personal document or application database.
const { test } = require("node:test");
const assert = require("node:assert/strict");
test(
  "live OCR transport and real model inference",
  { skip: !process.env.CORE_OCR_LIVE_TEST, timeout: 110000 },
  async () => {
    require("dotenv").config({ path: ".env.development", quiet: true });
    const grpc = require("@grpc/grpc-js");
    const loader = require("@grpc/proto-loader");
    const sharp = require("sharp");
    const proto = grpc.loadPackageDefinition(
      loader.loadSync("proto/ocr.proto", { keepCase: true, defaults: true }),
    ).ocr;
    const server = new grpc.Server();
    server.addService(proto.OcrService.service, {
      Recognize: require("../src/controllers/ocr.controller").recognize,
    });
    const port = await new Promise((resolve, reject) =>
      server.bindAsync(
        "127.0.0.1:0",
        grpc.ServerCredentials.createInsecure(),
        (error, port) => (error ? reject(error) : resolve(port)),
      ),
    );
    const client = new proto.OcrService(
      `127.0.0.1:${port}`,
      grpc.credentials.createInsecure(),
    );
    try {
      const render = (texts) =>
        sharp(
          Buffer.from(
            `<svg width="1400" height="850" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>${texts.map((text, index) => `<text x="45" y="${80 + index * 80}" font-family="sans-serif" font-size="40" fill="black">${text}</text>`).join("")}</svg>`,
          ),
        )
          .png()
          .toBuffer();
      const front = await render([
        "OCR TEST DATA",
        "IDENTITY CARD",
        "No.: 012345678901",
        "Full name: NGUYEN VAN TEST",
        "Date of birth: 02/03/1990",
        "Sex: Male",
      ]);
      const back = await render([
        "OCR TEST DATA",
        "Date of issue: 05/06/2021",
        "Place of issue: TEST OFFICE",
      ]);
      const metadata = new grpc.Metadata();
      metadata.set(
        "x-service-token",
        process.env.GRPC_OCR_SERVICE_TOKEN ||
          process.env.GRPC_STORAGE_SERVICE_TOKEN,
      );
      const response = await new Promise((resolve, reject) =>
        client.Recognize(
          {
            documentType: "vn_identity_card",
            userId: "ocr-synthetic-smoke",
            front,
            back,
          },
          metadata,
          { deadline: new Date(Date.now() + 100000) },
          (error, data) => (error ? reject(error) : resolve(data)),
        ),
      );
      const data = JSON.parse(response.dataJson);
      assert.equal(response.success, true);
      assert.equal(data.fields.number, "012345678901");
      assert.equal(data.fields.birthdate, "1990-03-02");
      assert.equal(data.fields.issuedDate, "2021-06-05");
    } finally {
      client.close();
      server.forceShutdown();
    }
  },
);
