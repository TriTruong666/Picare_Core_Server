const path = require("path");
const { randomUUID } = require("crypto");
const QRCode = require("qrcode");
const sharp = require("sharp");
const appConfig = require("../config/app.config");
const ProductQR = require("../models/product_qr/product_qr.model");
const S3Service = require("./s3.service");
const { AssetVisibility } = require("../common/enum/s3_asset.enum");

const LOGO_PATH = path.join(process.cwd(), "picare_logo_light.svg");
const QR_FOLDER = "product_qr";
const QR_SIZE = 1000;
const LOGO_SIZE = 100;

const FIELD_DEFINITIONS = [
  { key: "productName", labels: ["Tên sản phẩm"] },
  { key: "notificationNumber", labels: ["Số công bố"] },
  { key: "uses", labels: ["Công dụng"] },
  { key: "usageInstructions", labels: ["Cách sử dụng"] },
  { key: "warnings", labels: ["Lưu ý"] },
  { key: "storage", labels: ["Bảo quản"] },
  {
    key: "marketResponsible",
    labels: ["Chịu trách nhiệm đưa sản phẩm ra thị trường"],
  },
  {
    key: "manufacturer",
    labels: ["Tên đơn vị sản xuất, kinh doanh"],
  },
  { key: "shelfLife", labels: ["Hạn sử dụng"] },
  { key: "ingredients", labels: ["Thành phần"] },
  { key: "batchNumber", labels: ["Số Lô", "Số lô"] },
  { key: "manufacturingDate", labels: ["Ngày sản xuất"] },
  { key: "expirationDate", labels: ["Ngày hết hạn"] },
  { key: "netVolume", labels: ["Thể tích thực"] },
  { key: "origin", labels: ["Xuất xứ"] },
  { key: "website", labels: ["Website"] },
];

const decodeHtmlEntities = (value) => {
  const entities = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, entity) => {
      if (entity[0] === "#") {
        const isHex = entity[1].toLowerCase() === "x";
        const codePoint = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
      }

      return entities[entity.toLowerCase()] || match;
    },
  );
};

const richTextToPlainText = (rawContent) => {
  return decodeHtmlEntities(
    String(rawContent)
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
      .replace(/<\s*li(?:\s[^>]*)?>/gi, "")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const normalizeLabel = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const labelLookup = new Map(
  FIELD_DEFINITIONS.flatMap(({ key, labels }) =>
    labels.map((label) => [normalizeLabel(label), key]),
  ),
);

const splitLabelAndValue = (line) => {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1) return null;

  const label = normalizeLabel(line.slice(0, separatorIndex));
  const key = labelLookup.get(label);
  if (!key) return null;

  return {
    key,
    value: line.slice(separatorIndex + 1).trim(),
  };
};

const parseRichTextContent = (rawContent) => {
  const plainText = richTextToPlainText(rawContent);
  const result = Object.fromEntries(
    FIELD_DEFINITIONS.map(({ key }) => [key, null]),
  );
  const unmappedLines = [];
  let currentKey = null;

  for (const rawLine of plainText.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const field = splitLabelAndValue(line);
    if (field) {
      currentKey = field.key;
      result[currentKey] = field.value || null;
      continue;
    }

    if (currentKey) {
      result[currentKey] = [result[currentKey], line].filter(Boolean).join("\n");
    } else {
      unmappedLines.push(line);
    }
  }

  return {
    ...result,
    unmappedContent: unmappedLines.length ? unmappedLines.join("\n") : null,
  };
};

class ProductQRService {
  parseRichTextContent(rawContent) {
    return parseRichTextContent(rawContent);
  }

  async generateQRCodeBuffer(url) {
    const qrBuffer = await QRCode.toBuffer(url, {
      type: "png",
      width: QR_SIZE,
      margin: 4,
      errorCorrectionLevel: "H",
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    });

    const logoBuffer = await sharp(LOGO_PATH)
      .resize(LOGO_SIZE, LOGO_SIZE, { fit: "contain" })
      .png()
      .toBuffer();

    return sharp(qrBuffer)
      .composite([
        {
          input: logoBuffer,
          gravity: "center",
        },
      ])
      .png()
      .toBuffer();
  }

  async create({ rawContent, note = null, uploadedBy = null }) {
    const productId = randomUUID();
    const clientBaseUrl = appConfig.client.baseUrl.replace(/\/+$/, "");
    const qrUrl = `${clientBaseUrl}/qr-products/${productId}`;
    const jsonContent = {
      productId,
      qrUrl,
      ...this.parseRichTextContent(rawContent),
    };
    const qrBuffer = await this.generateQRCodeBuffer(qrUrl);
    const filename = `${productId}.png`;
    const key = S3Service.buildKey(QR_FOLDER, filename);
    let uploadedAsset = null;

    try {
      uploadedAsset = await S3Service.upload({
        key,
        body: qrBuffer,
        mimeType: "image/png",
        originalName: filename,
        fileSize: qrBuffer.length,
        folder: QR_FOLDER,
        uploadedBy,
        description: `Product QR for ${productId}`,
        visibility: AssetVisibility.PUBLIC,
      });

      return await ProductQR.create({
        productId,
        rawContent,
        jsonContent,
        qrImage: uploadedAsset.url,
        note,
      });
    } catch (error) {
      if (uploadedAsset?.key) {
        try {
          await S3Service.deleteAndRecord(uploadedAsset.key);
        } catch (cleanupError) {
          console.error(
            `[PRODUCT_QR]: Failed to clean up ${uploadedAsset.key}:`,
            cleanupError.message,
          );
        }
      }
      throw error;
    }
  }
}

module.exports = new ProductQRService();
