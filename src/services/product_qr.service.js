const path = require("path");
const { randomUUID } = require("crypto");
const { Op } = require("sequelize");
const QRCode = require("qrcode");
const sharp = require("sharp");
const ProductQR = require("../models/product_qr/product_qr.model");
const S3Service = require("./s3.service");
const { AssetVisibility } = require("../common/enum/s3_asset.enum");
const { ProductQRDTO } = require("../schemas/product_qr.schema");
const { NotFoundException } = require("../common/exceptions/BaseException");

const LOGO_PATH = path.join(process.cwd(), "picare_logo_light.svg");
const QR_FOLDER = "product_qr";
const QR_SIZE = 1000;
const LOGO_SIZE = 180;

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

  buildJsonContent(productId, linkUrl, rawContent) {
    return {
      productId,
      linkUrl,
      ...this.parseRichTextContent(rawContent),
    };
  }

  extractS3KeyFromUrl(fileUrl) {
    if (!fileUrl) return null;

    try {
      const parsedUrl = new URL(fileUrl);
      return decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));
    } catch (error) {
      return null;
    }
  }

  async getProductQRModelByProductId(productId) {
    const productQR = await ProductQR.findOne({
      where: { productId },
    });

    if (!productQR) {
      throw new NotFoundException("Không tìm thấy QR sản phẩm");
    }

    return productQR;
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

  async uploadProductImage(imageFile, uploadedBy) {
    if (!imageFile) return null;

    const key = S3Service.buildKey(QR_FOLDER, imageFile.originalname);
    return S3Service.upload({
      key,
      body: imageFile.buffer,
      mimeType: imageFile.mimetype,
      originalName: imageFile.originalname,
      fileSize: imageFile.size,
      folder: QR_FOLDER,
      uploadedBy,
      description: `Product QR source image ${imageFile.originalname}`,
      visibility: AssetVisibility.PUBLIC,
    });
  }

  async getProductQRsPaginate({ page = 1, limit = 20, search = "" } = {}) {
    const where = {};

    if (search) {
      where[Op.or] = [
        { productId: { [Op.iLike]: `%${search}%` } },
        { linkUrl: { [Op.iLike]: `%${search}%` } },
        { rawContent: { [Op.iLike]: `%${search}%` } },
        { note: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const pLimit = parseInt(limit, 10);
    const pPage = parseInt(page, 10);
    const offset = (pPage - 1) * pLimit;

    const { count, rows } = await ProductQR.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: pLimit,
      offset,
    });

    return {
      count,
      productQRs: ProductQRDTO.fromProductQRs(rows),
      page: pPage,
      limit: pLimit,
      totalPages: Math.ceil(count / pLimit),
    };
  }

  async getProductQRByProductId(productId) {
    const productQR = await this.getProductQRModelByProductId(productId);
    return ProductQRDTO.fromProductQR(productQR);
  }

  async create({ linkUrl, rawContent, note = null, uploadedBy = null, imageFile = null }) {
    const productId = randomUUID();
    const jsonContent = this.buildJsonContent(productId, linkUrl, rawContent);
    const qrBuffer = await this.generateQRCodeBuffer(linkUrl);
    const qrFilename = `${productId}.png`;
    const qrKey = S3Service.buildKey(QR_FOLDER, qrFilename);
    let uploadedQrAsset = null;
    let uploadedImageAsset = null;

    try {
      uploadedQrAsset = await S3Service.upload({
        key: qrKey,
        body: qrBuffer,
        mimeType: "image/png",
        originalName: qrFilename,
        fileSize: qrBuffer.length,
        folder: QR_FOLDER,
        uploadedBy,
        description: `Product QR for ${productId}`,
        visibility: AssetVisibility.PUBLIC,
      });

      uploadedImageAsset = await this.uploadProductImage(imageFile, uploadedBy);

      const productQR = await ProductQR.create({
        productId,
        rawContent,
        jsonContent,
        qrImage: uploadedQrAsset.url,
        linkUrl,
        imageUrl: uploadedImageAsset?.url || null,
        note,
      });

      return ProductQRDTO.fromProductQR(productQR);
    } catch (error) {
      if (uploadedQrAsset?.key) {
        try {
          await S3Service.deleteAndRecord(uploadedQrAsset.key);
        } catch (cleanupError) {
          console.error(
            `[PRODUCT_QR]: Failed to clean up ${uploadedQrAsset.key}:`,
            cleanupError.message,
          );
        }
      }

      if (uploadedImageAsset?.key) {
        try {
          await S3Service.deleteAndRecord(uploadedImageAsset.key);
        } catch (cleanupError) {
          console.error(
            `[PRODUCT_QR]: Failed to clean up ${uploadedImageAsset.key}:`,
            cleanupError.message,
          );
        }
      }
      throw error;
    }
  }

  async update(
    productId,
    updateData,
    { imageFile = null, uploadedBy = null } = {},
  ) {
    const productQR = await this.getProductQRModelByProductId(productId);
    const nextLinkUrl =
      Object.prototype.hasOwnProperty.call(updateData, "linkUrl")
        ? updateData.linkUrl
        : productQR.linkUrl;
    const nextRawContent =
      Object.prototype.hasOwnProperty.call(updateData, "rawContent")
        ? updateData.rawContent
        : productQR.rawContent;
    const payload = {};
    let uploadedImageAsset = null;
    const oldImageKey = this.extractS3KeyFromUrl(productQR.imageUrl);

    if (Object.prototype.hasOwnProperty.call(updateData, "linkUrl")) {
      payload.linkUrl = updateData.linkUrl;
    }

    if (Object.prototype.hasOwnProperty.call(updateData, "rawContent")) {
      payload.rawContent = updateData.rawContent;
    }

    if (
      Object.prototype.hasOwnProperty.call(updateData, "linkUrl") ||
      Object.prototype.hasOwnProperty.call(updateData, "rawContent")
    ) {
      payload.jsonContent = this.buildJsonContent(productId, nextLinkUrl, nextRawContent);
    }

    if (Object.prototype.hasOwnProperty.call(updateData, "note")) {
      payload.note = updateData.note;
    }

    try {
      if (imageFile) {
        uploadedImageAsset = await this.uploadProductImage(imageFile, uploadedBy);
        payload.imageUrl = uploadedImageAsset.url;
      }

      await productQR.update(payload);

      if (imageFile && oldImageKey) {
        await S3Service.deleteAndRecord(oldImageKey);
      }
    } catch (error) {
      if (uploadedImageAsset?.key) {
        try {
          await S3Service.deleteAndRecord(uploadedImageAsset.key);
        } catch (cleanupError) {
          console.error(
            `[PRODUCT_QR]: Failed to clean up ${uploadedImageAsset.key}:`,
            cleanupError.message,
          );
        }
      }

      throw error;
    }

    return ProductQRDTO.fromProductQR(productQR);
  }

  async delete(productId) {
    const productQR = await this.getProductQRModelByProductId(productId);
    const qrKey = this.extractS3KeyFromUrl(productQR.qrImage);
    const imageKey = this.extractS3KeyFromUrl(productQR.imageUrl);

    if (qrKey) {
      await S3Service.deleteAndRecord(qrKey);
    }

    if (imageKey) {
      await S3Service.deleteAndRecord(imageKey);
    }

    await productQR.destroy();
    return { message: "Xóa QR sản phẩm thành công" };
  }
}

module.exports = new ProductQRService();
