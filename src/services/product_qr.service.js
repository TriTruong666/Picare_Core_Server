const path = require("path");
const { randomUUID } = require("crypto");
const { Op } = require("sequelize");
const QRCode = require("qrcode");
const sharp = require("sharp");
const appConfig = require("../config/app.config");
const ProductQR = require("../models/product_qr/product_qr.model");
const S3Service = require("./s3.service");
const { AssetVisibility } = require("../common/enum/s3_asset.enum");
const { ProductQRDTO } = require("../schemas/product_qr.schema");
const { NotFoundException } = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");

const DEFAULT_LOGO = "picare";
const LOGO_PATHS = Object.freeze({
  picare: path.join(process.cwd(), "picare_logo_light.svg"),
  dermacoon: path.join(process.cwd(), "dermacoon_logo.svg"),
});
const QR_FOLDER = "product_qr";
const QR_SIZE = 1000;
const LOGO_SIZE = 180;

const FIELD_DEFINITIONS = [
  { key: "productName", labels: ["Tên sản phẩm"] },
  { key: "sku", labels: ["Mã sản phẩm"] },
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
  { key: "ingredients", labels: ["Thành phần", "Thành phần chính"] },
  { key: "packageSpecification", labels: ["Quy cách"] },
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

  buildClientQrUrl(productId) {
    const clientBaseUrl = appConfig.client.baseUrl.replace(/\/+$/, "");
    return `${clientBaseUrl}/qr-products/${productId}`;
  }

  buildJsonContent(productId, linkUrl, rawContent) {
    return {
      productId,
      qrUrl: linkUrl,
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
      throw new NotFoundException(ErrorCodes.QR_PRODUCT_NOT_FOUND);
    }

    return productQR;
  }

  async generateQRCodeBuffer(url, logo = DEFAULT_LOGO) {
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

    const logoPath = LOGO_PATHS[logo] || LOGO_PATHS[DEFAULT_LOGO];
    const logoBuffer = await sharp(logoPath)
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

  async uploadProductImages(imageFiles, uploadedBy) {
    if (!Array.isArray(imageFiles) || imageFiles.length === 0) return [];

    return Promise.all(
      imageFiles.map((imageFile) => {
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
      }),
    );
  }

  extractS3KeysFromUrls(fileUrls) {
    const normalizedUrls = Array.isArray(fileUrls)
      ? fileUrls
      : (fileUrls ? [fileUrls] : []);

    return normalizedUrls
      .map((fileUrl) => this.extractS3KeyFromUrl(fileUrl))
      .filter(Boolean);
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

  async create({
    linkUrl,
    rawContent,
    logo = DEFAULT_LOGO,
    note = null,
    uploadedBy = null,
    imageFiles = [],
  }) {
    const productId = randomUUID();
    const resolvedLinkUrl = linkUrl || this.buildClientQrUrl(productId);
    const jsonContent = this.buildJsonContent(productId, resolvedLinkUrl, rawContent);
    const qrBuffer = await this.generateQRCodeBuffer(resolvedLinkUrl, logo);
    const qrFilename = `${productId}.png`;
    const qrKey = S3Service.buildKey(QR_FOLDER, qrFilename);
    let uploadedQrAsset = null;
    let uploadedImageAssets = [];

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

      uploadedImageAssets = await this.uploadProductImages(imageFiles, uploadedBy);

      const productQR = await ProductQR.create({
        productId,
        rawContent,
        jsonContent,
        qrImage: uploadedQrAsset.url,
        linkUrl: resolvedLinkUrl,
        imageUrl: uploadedImageAssets.map((asset) => asset.url),
        logo,
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

      for (const uploadedImageAsset of uploadedImageAssets) {
        if (!uploadedImageAsset?.key) continue;

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
    { imageFiles = [], uploadedBy = null } = {},
  ) {
    const productQR = await this.getProductQRModelByProductId(productId);
    const nextLinkUrl =
      Object.prototype.hasOwnProperty.call(updateData, "linkUrl")
        ? updateData.linkUrl
        : (productQR.linkUrl || productQR.jsonContent?.qrUrl || this.buildClientQrUrl(productId));
    const nextRawContent =
      Object.prototype.hasOwnProperty.call(updateData, "rawContent")
        ? updateData.rawContent
        : productQR.rawContent;
    const nextLogo = Object.prototype.hasOwnProperty.call(updateData, "logo")
      ? updateData.logo
      : (productQR.logo || DEFAULT_LOGO);
    const payload = {};
    let uploadedImageAssets = [];
    let uploadedQrAsset = null;
    const oldImageKeys = this.extractS3KeysFromUrls(productQR.imageUrl);
    const oldQrKey = this.extractS3KeyFromUrl(productQR.qrImage);
    let productUpdated = false;

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

    if (Object.prototype.hasOwnProperty.call(updateData, "logo")) {
      payload.logo = nextLogo;
    }

    try {
      if (nextLogo !== (productQR.logo || DEFAULT_LOGO)) {
        const qrBuffer = await this.generateQRCodeBuffer(nextLinkUrl, nextLogo);
        const qrFilename = `${productId}.png`;
        uploadedQrAsset = await S3Service.upload({
          key: S3Service.buildKey(QR_FOLDER, qrFilename),
          body: qrBuffer,
          mimeType: "image/png",
          originalName: qrFilename,
          fileSize: qrBuffer.length,
          folder: QR_FOLDER,
          uploadedBy,
          description: `Product QR for ${productId}`,
          visibility: AssetVisibility.PUBLIC,
        });
        payload.qrImage = uploadedQrAsset.url;
      }

      if (Array.isArray(imageFiles) && imageFiles.length > 0) {
        uploadedImageAssets = await this.uploadProductImages(imageFiles, uploadedBy);
        payload.imageUrl = uploadedImageAssets.map((asset) => asset.url);
      }

      await productQR.update(payload);
      productUpdated = true;

      if (uploadedQrAsset && oldQrKey) {
        await S3Service.deleteAndRecord(oldQrKey);
      }

      if (uploadedImageAssets.length > 0) {
        for (const oldImageKey of oldImageKeys) {
          await S3Service.deleteAndRecord(oldImageKey);
        }
      }
    } catch (error) {
      // Once the database row points to the new assets, never clean them up
      // merely because deleting an old asset failed.
      if (!productUpdated && uploadedQrAsset?.key) {
        try {
          await S3Service.deleteAndRecord(uploadedQrAsset.key);
        } catch (cleanupError) {
          console.error(`[PRODUCT_QR]: Failed to clean up ${uploadedQrAsset.key}:`, cleanupError.message);
        }
      }

      if (!productUpdated) {
        for (const uploadedImageAsset of uploadedImageAssets) {
          if (!uploadedImageAsset?.key) continue;

          try {
            await S3Service.deleteAndRecord(uploadedImageAsset.key);
          } catch (cleanupError) {
            console.error(
              `[PRODUCT_QR]: Failed to clean up ${uploadedImageAsset.key}:`,
              cleanupError.message,
            );
          }
        }
      }

      throw error;
    }

    return ProductQRDTO.fromProductQR(productQR);
  }

  async delete(productId) {
    const productQR = await this.getProductQRModelByProductId(productId);
    const qrKey = this.extractS3KeyFromUrl(productQR.qrImage);
    const imageKeys = this.extractS3KeysFromUrls(productQR.imageUrl);

    if (qrKey) {
      await S3Service.deleteAndRecord(qrKey);
    }

    for (const imageKey of imageKeys) {
      await S3Service.deleteAndRecord(imageKey);
    }

    await productQR.destroy();
    return { message: "Xóa QR sản phẩm thành công" };
  }
}

module.exports = new ProductQRService();
