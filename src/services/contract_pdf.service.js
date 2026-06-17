const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const fontkit = require("@pdf-lib/fontkit");
const PDFDocument = require("pdfkit");
const { PDFDocument: PDFLibDocument, StandardFonts, rgb } = require("pdf-lib");
const { pdflibAddPlaceholder } = require("@signpdf/placeholder-pdf-lib");
const sharp = require("sharp");
function resolveAssetPath(fileName) {
  return path.resolve(__dirname, "..", "..", fileName);
}

const PICARE_WATERMARK_LOGO_PATH = resolveAssetPath("picare_logo_light.svg");
const TRUNGHANH_WATERMARK_LOGO_PATH = resolveAssetPath("trunghanh.svg");
const SIGNATURE_APPEARANCE_THEMES = {
  PIC: {
    logoPath: PICARE_WATERMARK_LOGO_PATH,
    watermarkWidthInset: 6,
    watermarkHeightScale: 2.2,
    watermarkYOffset: 8,
    watermarkOpacity: 0.2,
  },
  TH: {
    logoPath: TRUNGHANH_WATERMARK_LOGO_PATH,
    watermarkWidthInset: 0.4,
    watermarkHeightScale: 0.6,
    watermarkYOffset: 10,
    watermarkOpacity: 0.16,
  },
  default: {
    logoPath: PICARE_WATERMARK_LOGO_PATH,
    watermarkWidthInset: 6,
    watermarkHeightScale: 2.2,
    watermarkYOffset: 8,
    watermarkOpacity: 0.2,
  },
};

const DEFAULT_FONT_PATHS = [
  process.env.CONTRACT_FONT_PATH,
  "C:/Windows/Fonts/times.ttf",
  "C:/Windows/Fonts/arial.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
].filter(Boolean);
const DEFAULT_BOLD_FONT_PATHS = [
  process.env.CONTRACT_BOLD_FONT_PATH,
  "C:/Windows/Fonts/timesbd.ttf",
  "C:/Windows/Fonts/arialbd.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/LiberationSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
].filter(Boolean);
const FONT_SEARCH_DIRS = [
  "/usr/share/fonts",
  "/usr/local/share/fonts",
  "C:/Windows/Fonts",
];
const REGULAR_FONT_FILE_NAMES = [
  "DejaVuSans.ttf",
  "LiberationSans-Regular.ttf",
  "Arial.ttf",
  "arial.ttf",
  "times.ttf",
];
const BOLD_FONT_FILE_NAMES = [
  "DejaVuSans-Bold.ttf",
  "LiberationSans-Bold.ttf",
  "Arial Bold.ttf",
  "arialbd.ttf",
  "timesbd.ttf",
];
const watermarkLogoDataUriPromises = new Map();
const DEFAULT_SIGNATURE_LENGTH = Number(
  process.env.PDF_SIGNATURE_PLACEHOLDER_LENGTH || 16384,
);
const BYTE_RANGE_PLACEHOLDER = "**********";
const SIGNATURE_WIDGET_RECTS = {
  owner: [75, 141, 255, 215],
  partner: [340, 141, 520, 215],
  default: [75, 141, 255, 215],
};

function asText(value, fallback = "") {
  return value === null || value === undefined ? fallback : String(value);
}

function normalizeVietnameseText(value, fallback = "") {
  return asText(value, fallback).normalize("NFC");
}

function escapeXml(value) {
  return normalizeVietnameseText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapePdfString(value) {
  return normalizeVietnameseText(value)
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function formatPdfDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (number) => String(number).padStart(2, "0");

  return `D:${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(
    date.getDate(),
  )}${pad(date.getHours())}${pad(date.getMinutes())}${pad(
    date.getSeconds(),
  )}+00'00'`;
}

function formatPdfTextDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (number) => String(number).padStart(2, "0");

  return `${pad(date.getDate())}/${pad(
    date.getMonth() + 1,
  )}/${date.getFullYear()} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

function getOwnerName(companyInfo = {}) {
  return (
    companyInfo.ownerName ||
    companyInfo.owner ||
    companyInfo.representative ||
    ""
  );
}

function formatDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return {
    day: String(date.getDate()).padStart(2, "0"),
    month: String(date.getMonth() + 1).padStart(2, "0"),
    year: date.getFullYear(),
  };
}

function formatLongVietnameseDate(value = new Date()) {
  const { day, month, year } = formatDate(value);
  return `ngày ${day} tháng ${month} năm ${year}`;
}

function formatShortDate(value = new Date()) {
  const { day, month, year } = formatDate(value);
  return `${day}/${month}/${year}`;
}

function formatVietnameseDateTime(value = new Date()) {
  const parts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour12: false,
  })
    .formatToParts(value instanceof Date ? value : new Date(value))
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatMoney(value) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return asText(value);
  }

  return `${new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 0,
  }).format(numberValue)} VND`;
}

function normalizeContractTypeForFileName(contractType) {
  const normalizedType = String(contractType || "principle")
    .trim()
    .toLowerCase();

  if (
    !normalizedType ||
    ["default", "digital", "principle"].includes(normalizedType)
  ) {
    return "nguyen_tac";
  }

  return (
    normalizeVietnameseText(normalizedType)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "hop_dong"
  );
}

function buildContractFilePrefix(contract) {
  return `hop_dong_${normalizeContractTypeForFileName(contract?.contractType)}_picare`;
}

function buildContractArtifactFileName(contract, variant, token) {
  const parts = [
    buildContractFilePrefix(contract),
    contract?.contractId,
    variant,
    token,
  ].filter(Boolean);

  return `${parts.join("-")}.pdf`;
}

function getSignatureWidgetRect(signerType) {
  return SIGNATURE_WIDGET_RECTS[signerType] || SIGNATURE_WIDGET_RECTS.default;
}

function getPartnerIdentityText(companyInfo = {}) {
  return companyInfo.mst || companyInfo.phone || "N/A";
}

function getSignatureIdentityLine(companyInfo = {}) {
  return `MST/SĐT: ${getPartnerIdentityText(companyInfo)}`;
}

function getDigitalSignatureAppearanceData({
  contract,
  signerType,
  signerName,
  signingTime,
}) {
  const companyInfo = getSignerCompanyInfo(contract, signerType);
  const companyName = normalizeVietnameseText(
    companyInfo.companyName || signerName || "",
  ).toLocaleUpperCase("vi-VN");
  const identityLine = getSignatureIdentityLine(companyInfo);
  const addressLine = `\u0110\u1ecba ch\u1ec9: ${formatOptionalText(companyInfo.address)}`;
  const timeLine = `Th\u1eddi gian: ${formatVietnameseDateTime(signingTime)}`;
  const signatureTheme = getSignatureAppearanceTheme(companyInfo);

  return {
    companyName,
    identityLine,
    addressLine,
    timeLine,
    signatureTheme,
  };
}
function truncatePdfText(value, maxLength) {
  const text = escapePdfString(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function getPdfKitFontName(font) {
  return font === "F2" ? "Times-Bold" : "Times-Roman";
}

function getCenteredTextX(text, width, fontSize, font = "F1", offsetX = 0) {
  const doc = new PDFDocument({ autoFirstPage: false });
  const textWidth = doc
    .font(getPdfKitFontName(font))
    .fontSize(fontSize)
    .widthOfString(text);

  return Math.max(offsetX, offsetX + (width - textWidth) / 2);
}

function pdfTextLine({
  text,
  width,
  y,
  font = "F1",
  fontSize,
  color,
  offsetX = 0,
}) {
  const safeText = text || "N/A";
  const x = getCenteredTextX(safeText, width, fontSize, font, offsetX);

  return `BT
/${font} ${fontSize} Tf
${color} rg
${x.toFixed(2)} ${y} Td
(${safeText}) Tj
ET`;
}

function getPdfSignatureAppearanceText({
  contract,
  signerType,
  signerName,
  signingTime,
}) {
  const data = getDigitalSignatureAppearanceData({
    contract,
    signerType,
    signerName,
    signingTime,
  });
  const companyName = truncatePdfText(data.companyName, 34);
  const taxOrPhone = truncatePdfText(
    data.identityLine.replace("SĐT", "SDT"),
    36,
  );
  const address = truncatePdfText(
    data.addressLine.replace("Địa chỉ", "Dia chi"),
    42,
  );
  const time = truncatePdfText(
    data.timeLine.replace("Thời gian", "Thoi gian"),
    40,
  );

  return {
    companyName,
    taxOrPhone,
    address,
    time,
  };
}

function topLeftRectToPdfRect(x, y, width, height, pageHeight) {
  return [x, pageHeight - y - height, x + width, pageHeight - y];
}

function fitTextToWidth(text, font, size, maxWidth) {
  const value = normalizeVietnameseText(text);

  if (font.widthOfTextAtSize(value, size) <= maxWidth) {
    return value;
  }

  let trimmed = value;

  while (
    trimmed.length > 3 &&
    font.widthOfTextAtSize(`${trimmed}...`, size) > maxWidth
  ) {
    trimmed = trimmed.slice(0, -1);
  }

  return `${trimmed}...`;
}

function fitTextForImage(text, fontPath, fontSize, maxWidth) {
  const doc = new PDFDocument({ autoFirstPage: false });
  const value = normalizeVietnameseText(text);

  doc.font(fontPath).fontSize(fontSize);

  if (doc.widthOfString(value) <= maxWidth) {
    return value;
  }

  let trimmed = value;

  while (trimmed.length > 3 && doc.widthOfString(`${trimmed}...`) > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }

  return `${trimmed}...`;
}

function getSignatureAppearanceTheme(companyInfo = {}) {
  const companyCode = String(companyInfo.companyCode || "")
    .trim()
    .toUpperCase();

  return (
    SIGNATURE_APPEARANCE_THEMES[companyCode] ||
    SIGNATURE_APPEARANCE_THEMES.default
  );
}

async function getWatermarkLogoDataUri(logoPath) {
  if (!watermarkLogoDataUriPromises.has(logoPath)) {
    watermarkLogoDataUriPromises.set(
      logoPath,
      fs
        .readFile(logoPath, "utf8")
        .then(async (svg) => {
          const cleanedSvg = svg.replace(
            /<path[^>]*fill="#FDFDFD"[^>]*\/>\s*/i,
            "",
          );
          const trimmedLogoBuffer = await sharp(Buffer.from(cleanedSvg, "utf8"))
            .trim({ background: "#ffffff" })
            .png()
            .toBuffer();

          return `data:image/png;base64,${trimmedLogoBuffer.toString("base64")}`;
        })
        .catch((error) => {
          if (error?.code === "ENOENT") {
            throw new Error(`Watermark logo asset not found at ${logoPath}`);
          }

          throw error;
        }),
    );
  }

  return watermarkLogoDataUriPromises.get(logoPath);
}

async function createDigitalSignatureAppearanceImage({
  width,
  height,
  contract,
  signerType,
  signerName,
  signingTime,
}) {
  const [fontPath, boldFontPath] = await Promise.all([
    findFontPath(),
    findBoldFontPath(),
  ]);
  const data = getDigitalSignatureAppearanceData({
    contract,
    signerType,
    signerName,
    signingTime,
  });
  const scale = 3;
  const imageWidth = Math.round(width * scale);
  const imageHeight = Math.round(height * scale);
  const contentWidth = width - 14;
  const companyName = fitTextForImage(
    data.companyName,
    boldFontPath,
    9.2,
    contentWidth,
  );
  const identityLine = fitTextForImage(
    data.identityLine,
    fontPath,
    8.2,
    contentWidth,
  );
  const addressLine = fitTextForImage(
    data.addressLine,
    fontPath,
    7.8,
    contentWidth,
  );
  const timeLine = fitTextForImage(data.timeLine, fontPath, 7.4, contentWidth);
  const logoDataUri = await getWatermarkLogoDataUri(
    data.signatureTheme.logoPath,
  );
  const watermarkWidth = Math.max(
    24,
    width - data.signatureTheme.watermarkWidthInset,
  );
  const watermarkHeight = Math.max(
    24,
    height * data.signatureTheme.watermarkHeightScale,
  );
  const watermarkX = (width - watermarkWidth) / 2;
  const watermarkY =
    (height - watermarkHeight) / 2 + data.signatureTheme.watermarkYOffset;
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
  <image href="${logoDataUri}" x="${watermarkX}" y="${watermarkY}" width="${watermarkWidth}" height="${watermarkHeight}" opacity="${data.signatureTheme.watermarkOpacity}" preserveAspectRatio="none"/>
  <text x="${width / 2}" y="${height * 0.22}" text-anchor="middle" font-family="Times New Roman, serif" font-size="8.2" font-weight="700" fill="#000000">${escapeXml(companyName)}</text>
  <text x="${width / 2}" y="${height * 0.45}" text-anchor="middle" font-family="Times New Roman, serif" font-size="7.2" fill="#111111">${escapeXml(identityLine)}</text>
  <text x="${width / 2}" y="${height * 0.63}" text-anchor="middle" font-family="Times New Roman, serif" font-size="7.8" fill="#111111">${escapeXml(addressLine)}</text>
  <text x="${width / 2}" y="${height * 0.81}" text-anchor="middle" font-family="Times New Roman, serif" font-size="7.4" fill="#111111">${escapeXml(timeLine)}</text>
</svg>`;
  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();

  return {
    buffer,
    width: imageWidth,
    height: imageHeight,
  };
}

function drawCenteredText(pdfPage, text, x, y, width, font, size, color) {
  const fittedText = fitTextToWidth(text, font, size, width);
  const textWidth = font.widthOfTextAtSize(fittedText, size);

  pdfPage.drawText(fittedText, {
    x: x + (width - textWidth) / 2,
    y,
    size,
    font,
    color,
  });
}

function getSignerCompanyInfo(contract, signerType) {
  return signerType === "partner"
    ? contract?.partnerCompanyInfo || {}
    : contract?.ownerCompanyInfo || {};
}

function formatOptionalText(value, fallback = "N/A") {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return value;
}

function drawVisibleSignatureAppearance(
  pdfPage,
  widgetRect,
  {
    signerName,
    signerType,
    contract,
    font,
    boldFont,
    signingTime = new Date(),
  },
) {
  return drawCompanyDigitalSignatureAppearance(pdfPage, widgetRect, {
    signerName,
    signerType,
    contract,
    font,
    boldFont,
    signingTime,
  });

  const [x1, y1, x2, y2] = widgetRect;
  const width = x2 - x1;
  const height = y2 - y1;
  const paddingX = 8;
  const contentWidth = width - paddingX * 2;
  const appearanceData = getDigitalSignatureAppearanceData({
    contract,
    signerType,
    signerName,
    signingTime,
  });

  pdfPage.drawRectangle({
    x: x1,
    y: y1,
    width,
    height,
    color: rgb(0.96, 0.99, 0.97),
    borderColor: rgb(0.07, 0.45, 0.24),
    borderWidth: 0.9,
  });

  pdfPage.drawRectangle({
    x: x1,
    y: y2 - 15,
    width,
    height: 15,
    color: rgb(0.07, 0.45, 0.24),
  });

  drawCenteredText(
    pdfPage,
    "ĐÃ KÝ SỐ",
    x1,
    y2 - 11,
    width,
    boldFont,
    7.5,
    rgb(1, 1, 1),
  );
  drawCenteredText(
    pdfPage,
    normalizeVietnameseText(signerName || signerRole).toLocaleUpperCase(
      "vi-VN",
    ),
    x1 + paddingX,
    y1 + Math.max(31, height - 39),
    contentWidth,
    boldFont,
    8,
    rgb(0.04, 0.25, 0.13),
  );
  drawCenteredText(
    pdfPage,
    `Vai trò: ${signerRole}`,
    x1 + paddingX,
    y1 + 20,
    contentWidth,
    font,
    7,
    rgb(0.1, 0.1, 0.1),
  );
  drawCenteredText(
    pdfPage,
    `Thời gian: ${formatVietnameseDateTime(signingTime)}`,
    x1 + paddingX,
    y1 + 9,
    contentWidth,
    font,
    6.5,
    rgb(0.1, 0.1, 0.1),
  );
}

async function drawCompanyDigitalSignatureAppearance(
  pdfPage,
  widgetRect,
  {
    signerName,
    signerType,
    contract,
    font,
    boldFont,
    signingTime = new Date(),
  },
) {
  const [x1, y1, x2, y2] = widgetRect;
  const width = x2 - x1;
  const height = y2 - y1;
  const appearanceImage = await createDigitalSignatureAppearanceImage({
    width,
    height,
    contract,
    signerType,
    signerName,
    signingTime,
  });
  const embeddedImage = await pdfPage.doc.embedJpg(appearanceImage.buffer);

  pdfPage.drawImage(embeddedImage, {
    x: x1,
    y: y1,
    width,
    height,
  });
}

async function embedImageByMimeType(pdfDoc, imageBytes, mimeType = "") {
  const normalizedMimeType = String(mimeType).toLowerCase();

  if (normalizedMimeType.includes("png")) {
    return pdfDoc.embedPng(imageBytes);
  }

  if (
    normalizedMimeType.includes("jpeg") ||
    normalizedMimeType.includes("jpg")
  ) {
    return pdfDoc.embedJpg(imageBytes);
  }

  try {
    return await pdfDoc.embedPng(imageBytes);
  } catch (error) {
    return pdfDoc.embedJpg(imageBytes);
  }
}

function drawHandwrittenSignatureAppearance(
  pdfPage,
  widgetRect,
  { image, signerName, signerType, font, boldFont, signingTime = new Date() },
) {
  const [x1, y1, x2, y2] = widgetRect;
  const width = x2 - x1;
  const height = y2 - y1;
  const paddingX = 8;
  const signerRole = signerType === "partner" ? "Bên B" : "Bên A";
  const maxImageWidth = width - paddingX * 2;
  const maxImageHeight = height - 31;
  const scale = Math.min(
    maxImageWidth / image.width,
    maxImageHeight / image.height,
    1,
  );
  const imageWidth = image.width * scale;
  const imageHeight = image.height * scale;

  pdfPage.drawRectangle({
    x: x1,
    y: y1,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.45, 0.45, 0.45),
    borderWidth: 0.6,
  });

  pdfPage.drawImage(image, {
    x: x1 + (width - imageWidth) / 2,
    y: y1 + 24,
    width: imageWidth,
    height: imageHeight,
  });

  drawCenteredText(
    pdfPage,
    normalizeVietnameseText(signerName || signerRole).toLocaleUpperCase(
      "vi-VN",
    ),
    x1 + paddingX,
    y1 + 12,
    width - paddingX * 2,
    boldFont,
    8,
    rgb(0.05, 0.05, 0.05),
  );
  drawCenteredText(
    pdfPage,
    `Ký tay lúc: ${formatVietnameseDateTime(signingTime)}`,
    x1 + paddingX,
    y1 + 3,
    width - paddingX * 2,
    font,
    5.8,
    rgb(0.25, 0.25, 0.25),
  );
}

async function findFontPath() {
  for (const fontPath of DEFAULT_FONT_PATHS) {
    try {
      await fs.access(fontPath);
      return fontPath;
    } catch (error) {
      // Try next configured/system font.
    }
  }

  const discoveredFontPath = await findSystemFontPath(REGULAR_FONT_FILE_NAMES);

  if (discoveredFontPath) {
    return discoveredFontPath;
  }

  throw new Error(
    "No Unicode font found. Set CONTRACT_FONT_PATH to a .ttf font file.",
  );
}

async function findBoldFontPath() {
  for (const fontPath of DEFAULT_BOLD_FONT_PATHS) {
    try {
      await fs.access(fontPath);
      return fontPath;
    } catch (error) {
      // Try next configured/system bold font.
    }
  }

  const discoveredFontPath = await findSystemFontPath(BOLD_FONT_FILE_NAMES);

  if (discoveredFontPath) {
    return discoveredFontPath;
  }

  return findFontPath();
}

async function findSystemFontPath(fileNames) {
  const targetFileNames = new Set(
    fileNames.map((fileName) => fileName.toLowerCase()),
  );

  for (const searchDir of FONT_SEARCH_DIRS) {
    const fontPath = await findFontPathInDir(searchDir, targetFileNames);

    if (fontPath) {
      return fontPath;
    }
  }

  return null;
}

async function findFontPathInDir(dirPath, targetFileNames) {
  let entries;

  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    return null;
  }

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isFile() && targetFileNames.has(entry.name.toLowerCase())) {
      return entryPath;
    }

    if (entry.isDirectory()) {
      const fontPath = await findFontPathInDir(entryPath, targetFileNames);

      if (fontPath) {
        return fontPath;
      }
    }
  }

  return null;
}

function collectPdfBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

class ContractPdfBuilder {
  constructor(fontPath, boldFontPath, contract) {
    this.doc = new PDFDocument({
      size: "A4",
      margin: 56,
      bufferPages: true,
      info: {
        Title: `Hợp đồng ${contract.contractNumber}` || "Hợp đồng nguyên tắc",
        Author: "Picare Việt Nam",
      },
    });
    this.fontPath = fontPath;
    this.boldFontPath = boldFontPath;
    this.signatureWidgets = {};
    this.doc.font(fontPath).fontSize(10);
  }

  get bufferPromise() {
    return collectPdfBuffer(this.doc);
  }

  text(value, options = {}) {
    this.doc
      .font(options.bold ? this.boldFontPath : this.fontPath)
      .fontSize(options.size || 10)
      .text(asText(value), {
        align: options.align || "left",
        width: options.width,
        continued: options.continued,
        indent: options.indent || 0,
      });

    if (options.gap) {
      this.doc.moveDown(options.gap);
    }
  }

  richText(parts = [], options = {}) {
    const filteredParts = parts.filter(
      (part) => part && part.text !== undefined && part.text !== null,
    );

    filteredParts.forEach((part, index) => {
      this.doc
        .font(part.bold ? this.boldFontPath : this.fontPath)
        .fontSize(options.size || 10)
        .text(asText(part.text), {
          align: options.align || "left",
          width: options.width,
          continued: index < filteredParts.length - 1,
        });
    });

    if (options.gap) {
      this.doc.moveDown(options.gap);
    }
  }

  labelValue(label, value, options = {}) {
    this.richText(
      [{ text: label }, { text: formatOptionalText(value), bold: true }],
      options,
    );
  }

  centered(value, size = 10, gap = 0.2, bold = false) {
    this.text(value, { align: "center", size, gap, bold });
  }

  rightBlock(value, options = {}) {
    this.text(value, {
      align: "center",
      bold: options.bold,
      size: options.size || 10,
      width: options.width || 265,
      gap: options.gap,
    });
  }

  heading(value) {
    this.doc.moveDown(0.4);
    this.text(value, { size: 11, bold: true, gap: 0.3 });
  }

  bullet(value) {
    this.text(`-    ${value}`, { gap: 0.1 });
  }

  bulletParts(parts = []) {
    this.richText([{ text: "-    " }, ...parts], { gap: 0.1 });
  }

  currentPageIndex() {
    const range = this.doc.bufferedPageRange();
    return range.start + range.count - 1;
  }

  drawSignatureBox(signerType, x, y, width, height) {
    const doc = this.doc;
    const pageHeight = doc.page.height;

    this.signatureWidgets[signerType] = {
      pageIndex: this.currentPageIndex(),
      rect: topLeftRectToPdfRect(x, y, width, height, pageHeight),
    };

    doc.save();
    doc
      .lineWidth(0.6)
      .dash(3, { space: 2 })
      .strokeColor("#777777")
      .rect(x, y, width, height)
      .stroke()
      .undash();
    doc.restore();
  }

  companyBlock(title, companyInfo, shortName) {
    this.text(`${title}: ${asText(companyInfo.companyName).toUpperCase()}`, {
      bold: true,
    });
    this.text(`Địa chỉ : ${formatOptionalText(companyInfo.address)}`, {
      bold: true,
    });
    this.text(`Điện thoại : ${formatOptionalText(companyInfo.phone)}`, {
      bold: true,
    });

    if (companyInfo.email) {
      this.text(`Email : ${formatOptionalText(companyInfo.email)}`, {
        bold: true,
      });
    }

    this.text(`Tài khoản số : ${formatOptionalText(companyInfo.bankInfo)}`, {
      bold: true,
    });
    this.text(`Mã số thuế : ${formatOptionalText(companyInfo.mst)}`, {
      bold: true,
    });
    this.text(
      `Đại diện là Ông/Bà : ${formatOptionalText(
        getOwnerName(companyInfo),
      )}    Chức vụ: ${formatOptionalText(companyInfo.role)}`,
      { bold: true },
    );
    this.text(`Sau đây gọi tắt là ${shortName}`, { gap: 0.35, bold: true });
  }

  table(details = []) {
    const doc = this.doc;
    const startX = doc.page.margins.left;
    const startY = doc.y + 4;
    const widths = [45, 370, 70];
    const rowHeight = 24;
    const tableWidth = widths.reduce((sum, width) => sum + width, 0);
    const rows = [
      ["STT", "TÊN SẢN PHẨM", "GIÁ"],
      ...details.map((detail, index) => [
        String(index + 1),
        detail.productName || detail.detailData?.productName,
        formatMoney(detail.price ?? detail.detailData?.price),
      ]),
    ];

    let y = startY;

    rows.forEach((row, rowIndex) => {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
      }

      let x = startX;

      row.forEach((cell, cellIndex) => {
        doc.rect(x, y, widths[cellIndex], rowHeight).stroke();
        doc
          .font(rowIndex === 0 ? this.boldFontPath : this.fontPath)
          .fontSize(9)
          .text(asText(cell), x + 5, y + 7, {
            width: widths[cellIndex] - 10,
            height: rowHeight - 8,
          });
        x += widths[cellIndex];
      });

      y += rowHeight;
    });

    doc.y = y + 14;
    doc.x = doc.page.margins.left;
    doc.moveDown(0.2);
  }

  signatureArea(ownerCompanyInfo = {}, partnerCompanyInfo = {}) {
    const doc = this.doc;

    if (doc.y > doc.page.height - 210) {
      doc.addPage();
    }

    doc.moveDown(1);
    const y = doc.y;
    const leftX = doc.page.margins.left + 35;
    const rightX = doc.page.width - doc.page.margins.right - 170;

    doc.font(this.boldFontPath).fontSize(10);
    doc.text("ĐẠI DIỆN BÊN A", leftX, y, { width: 160, align: "center" });
    doc.text("ĐẠI DIỆN BÊN B", rightX, y, { width: 160, align: "center" });
    doc.font(this.fontPath).fontSize(9);
    doc.text("(Ký, đóng dấu, ghi rõ họ và tên)", leftX - 8, y + 18, {
      width: 180,
      align: "center",
    });
    doc.text("(Ký, đóng dấu, ghi rõ họ và tên)", rightX - 8, y + 18, {
      width: 180,
      align: "center",
    });

    const signatureBoxY = y + 44;
    const signatureBoxWidth = 180;
    const signatureBoxHeight = 74;
    this.drawSignatureBox(
      "owner",
      leftX - 10,
      signatureBoxY,
      signatureBoxWidth,
      signatureBoxHeight,
    );
    this.drawSignatureBox(
      "partner",
      rightX - 10,
      signatureBoxY,
      signatureBoxWidth,
      signatureBoxHeight,
    );

    doc.font(this.boldFontPath).fontSize(10);
    doc.text(
      normalizeVietnameseText(getOwnerName(ownerCompanyInfo)).toLocaleUpperCase(
        "vi-VN",
      ),
      leftX,
      y + 128,
      {
        width: 160,
        align: "center",
      },
    );
    doc.text(
      normalizeVietnameseText(
        getOwnerName(partnerCompanyInfo),
      ).toLocaleUpperCase("vi-VN"),
      rightX,
      y + 128,
      {
        width: 160,
        align: "center",
      },
    );
    doc.y = y + 150;
  }

  renderPrincipleContract(contract, details) {
    const owner = contract.ownerCompanyInfo || {};
    const partner = contract.partnerCompanyInfo || {};
    const renderedAt = new Date();

    this.text(owner.companyName, { width: 245, bold: true });
    this.text(`Số: ${contract.contractNumber}`, { width: 245, bold: true });
    this.doc.y = 56;
    this.doc.x = 300;
    this.rightBlock("CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM", {
      size: 11,
      bold: true,
      gap: 0.1,
    });
    this.doc.x = 300;
    this.rightBlock("Độc lập - Tự do - Hạnh phúc", {
      size: 10,
      bold: true,
      gap: 1.2,
    });
    this.doc.x = 300;
    this.rightBlock(`Hôm nay, ${formatLongVietnameseDate(renderedAt)}`, {
      size: 10,
      bold: true,
      gap: 0.8,
    });
    this.doc.x = this.doc.page.margins.left;
    this.centered("HỢP ĐỒNG NGUYÊN TẮC", 14, 0.1, true);
    this.centered(`Số ${contract.contractNumber}`, 10, 0.1, true);
    this.centered("(Về việc: Bán hàng)", 10, 0.8);

    this.bullet(
      "Căn cứ Bộ Luật Dân sự số 91/2015/QH13 ngày 24/11/2015 của Quốc hội nước CHXHCN Việt Nam;",
    );
    this.bullet(
      "Căn cứ Luật Thương Mại số 36/2005/QH ngày 14/06/2005 của Quốc hội nước CHXHCN Việt Nam;",
    );
    this.bullet("Căn cứ vào khả năng và nhu cầu của hai bên.");
    this.text(
      `Hôm nay, ngày ${formatShortDate(
        renderedAt,
      )} tại văn phòng công ty chúng tôi gồm có:`,
      { gap: 0.35, bold: true },
    );

    this.companyBlock("CÔNG TY BÁN ( Bên A)", owner, "Bên A");
    this.companyBlock("CÔNG TY MUA ( Bên B)", partner, "Bên B");

    this.text(
      "Bên Mua, Bên Bán sau đây gọi riêng là “Bên” và gọi chung là “Hai Bên”.",
      { gap: 0.35 },
    );
    this.text(
      "Hai bên cùng thỏa thuận và ký kết Hợp đồng mua bán hàng hóa thường xuyên (sau đây gọi tắt là “Hợp đồng”) như sau:",
      { gap: 0.35 },
    );

    this.renderPrincipleClauses(contract, owner, partner);
    this.signatureArea(owner, partner);
    return;

    this.heading("ĐIỀU 1: CÁC ĐIỀU KHOẢN CHUNG");
    this.text(
      "1.1 Hợp đồng Nguyên tắc này là cơ sở để hai Bên thực hiện việc mua bán hàng hóa thường xuyên.",
    );
    this.text(
      "1.2 Căn cứ vào Hợp đồng này, hai Bên sẽ ký Đơn đặt hàng bằng văn bản và/hoặc thư điện tử đối với từng lô hàng cụ thể. Chi tiết hàng hóa, chất lượng, số lượng, giá cả, giao hàng và các điều khoản khác (nếu có) sẽ được chỉ rõ trong các Đơn đặt hàng tương ứng.",
    );
    this.text(
      "1.3 Trong trường hợp hai Bên có giao dịch mua bán mà nội dung thỏa thuận giữa hai Bên có các điều kiện bổ sung và chi tiết hơn so với Hợp đồng này, hoặc do hai Bên thống nhất, hai Bên sẽ ký Phụ lục Hợp đồng để thực hiện giao dịch. Trong trường hợp đó, Hợp đồng mua bán sẽ được ưu tiên áp dụng nếu có điều khoản trái với Hợp đồng này.",
    );

    this.heading("ĐIỀU 2: HÀNG HÓA");
    this.text(
      "2.1 Hàng hóa do Bên Bán cung cấp phải là các sản phẩm đủ điều kiện lưu thông trên thị trường và đạt các yêu cầu cụ thể như sau:",
    );
    this.bullet(
      "Đúng chủng loại, chất lượng theo tiêu chuẩn của nhà sản xuất, phù hợp với tiêu chuẩn đã đăng ký hoặc công bố với cơ quan quản lý nhà nước theo quy định pháp luật hiện hành.",
    );
    this.bullet(
      "Quy cách đóng gói, bảo quản theo đúng tiêu chuẩn nhà sản xuất.",
    );
    this.bullet(
      "Không móp méo, biến dạng vỏ hộp; màu sắc trên vỏ hộp sắc nét, không có dấu hiệu bạc hoặc phai màu.",
    );
    this.bullet(
      "Sản phẩm có dán nhãn hoặc nhãn phụ theo quy định pháp luật hiện hành.",
    );
    this.bullet("Được nhập khẩu hợp pháp nếu là hàng nhập khẩu.");
    this.bullet(
      "Hạn sử dụng còn lại của sản phẩm tại thời điểm Bên Mua nhập hàng phải phù hợp với thỏa thuận trong Đơn đặt hàng và quy định pháp luật hiện hành.",
    );
    this.bullet("Các tiêu chuẩn khác theo quy định pháp luật hiện hành.");
    this.text(
      "2.2 Chi tiết về hàng hóa sẽ được các Bên chỉ rõ trong các Đơn đặt hàng.",
    );

    this.heading("ĐIỀU 3: PHƯƠNG THỨC ĐẶT HÀNG VÀ GIAO NHẬN HÀNG HÓA");
    this.text(
      "3.1 Khi có nhu cầu đặt hàng, Bên Mua gửi Đơn đặt hàng cho Bên Bán bằng email từ địa chỉ được chỉ định hoặc bằng bản gốc Đơn đặt hàng có chữ ký, đóng dấu của người đại diện có thẩm quyền.",
    );
    this.text(
      "3.2 Trong thời gian 01 ngày làm việc kể từ khi nhận được Đơn đặt hàng, Bên Bán có trách nhiệm xác nhận đồng ý hoặc không đồng ý giao hàng và xác nhận thời gian giao hàng cụ thể.",
    );
    this.text(
      "3.3 Địa điểm nhận hàng được chỉ định cụ thể trong từng Đơn đặt hàng.",
    );
    this.text(
      "3.4 Hàng hóa được coi là đã giao khi có chữ ký của người nhận hàng được Bên Mua chỉ định trên Biên bản bàn giao.",
    );
    this.text(
      "3.5 Thời điểm giao hàng, số lần giao hàng và phương thức giao hàng được hai Bên thống nhất cụ thể trong từng Đơn đặt hàng. Bên Mua có quyền từ chối nhận hàng nếu sản phẩm không đạt chất lượng theo Hợp đồng này.",
    );
    this.text(
      `3.6 Chứng từ giao hàng gồm hóa đơn bán hàng hợp lệ, biên bản giao nhận hàng hóa hoặc chứng từ vận chuyển, Đơn đặt hàng đã được xác nhận và các giấy tờ chứng minh nguồn gốc xuất xứ hàng hóa theo quy định pháp luật. Thông tin xuất hóa đơn theo thông tin của ${formatOptionalText(partner.companyName)}.`,
    );

    this.heading("ĐIỀU 4: GIÁ CẢ VÀ PHƯƠNG THỨC THANH TOÁN");
    this.text(
      `4.1 Bảng giá chi tiết và chương trình hợp tác được các Bên thống nhất tại phụ lục hoặc thỏa thuận riêng kèm theo Hợp đồng này.`,
    );
    this.text(
      "4.2 Giá bán hàng hóa là giá Bên Bán niêm yết hoặc thông báo tùy từng thời điểm và có hiệu lực áp dụng vào thời điểm Bên Mua đặt hàng.",
    );
    this.text(
      "4.3 Trường hợp có điều chỉnh giá bán, Bên Bán cung cấp cho Bên Mua văn bản thông báo điều chỉnh giá bán trước thời điểm thay đổi giá ít nhất 03 ngày làm việc.",
    );
    this.text(
      "4.4 Thời hạn thanh toán là 30 ngày kể từ ngày Bên Bán hoàn thành việc giao hàng và cung cấp đầy đủ chứng từ giao hàng, trừ khi hai Bên có thỏa thuận khác trong Đơn đặt hàng hoặc phụ lục.",
    );
    this.text(
      "4.5 Hình thức thanh toán bằng tiền Việt Nam thông qua chuyển khoản hoặc tiền mặt. Trường hợp nhận tiền mặt, người nhận phải có giấy ủy quyền của Bên Bán.",
    );

    this.heading("ĐIỀU 5: TRÁCH NHIỆM CỦA CÁC BÊN");
    this.text("5.1 Bên Bán có các nghĩa vụ sau:");
    this.bullet(
      "Cung cấp đầy đủ thông tin về sản phẩm cho Bên Mua: danh mục, thông tin sản phẩm, hàm lượng, catalogue, giá cả, chương trình bán hàng, chương trình hỗ trợ, tổ chức đào tạo và giới thiệu sản phẩm mới.",
    );
    this.bullet(
      "Bằng chi phí của mình thực hiện thu hồi đối với các sản phẩm có lỗi nhà sản xuất hoặc theo yêu cầu của cơ quan quản lý nhà nước hoặc sản phẩm có các biến cố bất lợi tới sức khỏe người tiêu dùng và bồi thường thiệt hại nếu có.",
    );
    this.bullet(
      "Hỗ trợ tìm hiểu thị trường, xúc tiến thương mại, quảng bá sản phẩm.",
    );
    this.bullet(
      "Không chuyển nhượng Hợp đồng cho bên thứ ba khi chưa có sự đồng ý bằng văn bản của Bên Mua.",
    );
    this.bullet(
      "Cung cấp thông tin, tài liệu do Bên Mua yêu cầu trong vòng 24 giờ kể từ thời điểm nhận được yêu cầu trong các trường hợp cần thiết liên quan đến khiếu nại, phản ánh khách hàng hoặc thanh kiểm tra của cơ quan nhà nước.",
    );
    this.bullet("Các quyền, nghĩa vụ khác theo quy định pháp luật.");
    this.text("5.2 Bên Mua có các nghĩa vụ sau:");
    this.bullet("Đảm bảo thanh toán đúng thời hạn đã thỏa thuận.");
    this.bullet(
      "Bố trí nhận hàng và cử người có thẩm quyền kiểm tra, ký biên bản nhận hàng hóa đúng thời gian thỏa thuận.",
    );
    this.bullet(
      "Thực hiện nghiêm chỉnh các quy định của pháp luật Việt Nam về quản lý và lưu thông hàng hóa.",
    );
    this.bullet(
      "Đảm bảo tuân thủ việc bảo quản hàng hóa theo hướng dẫn và các tiêu chuẩn phù hợp để tránh tình trạng hàng hóa bị biến đổi về chất lượng do bảo quản không phù hợp.",
    );
    this.bullet("Các quyền, nghĩa vụ khác theo quy định pháp luật.");

    this.heading("ĐIỀU 6: CUNG CẤP VÀ TRAO ĐỔI THÔNG TIN GIỮA HAI BÊN");
    this.text(
      "6.1 Hai Bên thống nhất trao đổi thông tin thông qua các đại diện liên lạc. Trường hợp người được ủy quyền giao dịch không còn được quyền đại diện, Bên liên quan phải thông báo kịp thời bằng văn bản, email hoặc fax cho Bên kia.",
    );
    this.text(
      "6.2 Khi có thay đổi về trụ sở, mã số thuế, tài khoản hoặc thông tin liên quan đến quá trình giao dịch, Hai Bên phải thông báo bằng văn bản cho nhau trước khi phát sinh giao dịch mới.",
    );
    this.text(
      "6.3 Nếu Bên nào muốn thay đổi nội dung Hợp đồng, Bên đó phải thông báo cho Bên còn lại bằng văn bản và Hai Bên tiến hành thương thảo để ký kết Phụ lục Hợp đồng.",
    );
    this.text(
      "6.4 Hai Bên có trách nhiệm liên lạc kịp thời khi xảy ra các tình huống phát sinh trong quá trình giao hàng, vận hành để kịp thời giải quyết và hạn chế thiệt hại.",
    );

    this.heading("ĐIỀU 7: BỒI THƯỜNG THIỆT HẠI VÀ PHẠT VI PHẠM HỢP ĐỒNG");
    this.text(
      "7.1 Bên vi phạm nghĩa vụ thanh toán hoặc nghĩa vụ giao hàng, chất lượng hàng hóa theo Hợp đồng này phải chịu phạt vi phạm theo thỏa thuận của Hai Bên và quy định pháp luật hiện hành.",
    );
    this.text(
      "7.2 Bên vi phạm phải bồi thường toàn bộ các thiệt hại thực tế, trực tiếp phát sinh do hành vi vi phạm gây ra cho Bên còn lại.",
    );
    this.text(
      "7.3 Bên vi phạm được miễn trách nhiệm trong các trường hợp miễn trách nhiệm đã thỏa thuận, sự kiện bất khả kháng, lỗi hoàn toàn của Bên kia hoặc do thực hiện quyết định của cơ quan nhà nước có thẩm quyền mà các Bên không thể biết tại thời điểm giao kết Hợp đồng.",
    );

    this.heading("ĐIỀU 8: BẢO MẬT THÔNG TIN");
    this.text(
      "8.1 Mỗi Bên giữ bí mật nghiêm ngặt mọi thông tin có được trong quá trình ký kết và thực hiện Hợp đồng này, các Phụ lục Hợp đồng và Hợp đồng mua bán nếu có.",
    );
    this.text(
      "8.2 Nghĩa vụ bảo mật tiếp tục được áp dụng trong thời hạn 01 năm kể từ khi Hợp đồng chấm dứt hoặc kết thúc.",
    );

    this.heading("ĐIỀU 9: CHỐNG THAM NHŨNG");
    this.text(
      "9.1 Bên Bán không được dưới bất kỳ hình thức nào trao cho nhân viên của Bên Mua các lợi ích bằng tiền hoặc hiện vật như tặng quà, thưởng tiền, trích phần trăm hoa hồng hoặc các hành vi tương tự khi chưa có sự đồng ý bằng văn bản của Bên Mua.",
    );
    this.text(
      "9.2 Trường hợp Bên Bán biết nhân viên của Bên Mua có hành vi đề nghị nhận tiền hoặc lợi ích vật chất, Bên Bán phải thông báo ngay cho Bên Mua theo thông tin liên hệ đã được Hai Bên thống nhất.",
    );

    this.heading("ĐIỀU 10: CHẤM DỨT HỢP ĐỒNG");
    this.text(
      "10.1 Hợp đồng chấm dứt khi hết hạn mà Hai Bên không có nhu cầu gia hạn, hoặc theo thỏa thuận bằng văn bản của Hai Bên.",
    );
    this.text(
      "10.2 Một Bên được đơn phương chấm dứt Hợp đồng nếu Bên kia vi phạm Hợp đồng hoặc vi phạm pháp luật và không khắc phục trong vòng 10 ngày kể từ ngày nhận thông báo yêu cầu khắc phục.",
    );
    this.text(
      "10.3 Trừ trường hợp vi phạm nêu trên, nếu một Bên muốn chấm dứt Hợp đồng trước thời hạn thì phải thông báo bằng văn bản cho Bên còn lại trước 30 ngày.",
    );
    this.text(
      "10.4 Trong mọi trường hợp chấm dứt Hợp đồng trước thời hạn, Hai Bên phải hoàn thành đầy đủ nghĩa vụ đối với các giao dịch đã thực hiện trước đó.",
    );
    this.text(
      "10.5 Bên nào đơn phương chấm dứt Hợp đồng trái quy định tại Hợp đồng này hoặc trái pháp luật thì phải bồi thường cho Bên còn lại toàn bộ thiệt hại theo quy định pháp luật.",
    );

    this.heading("ĐIỀU 11: CAM KẾT CHUNG");
    this.text(
      "11.1 Hai Bên cam kết thực hiện đúng các điều khoản ghi trong Hợp đồng này. Nếu một trong hai Bên cố ý vi phạm, Bên vi phạm phải chịu trách nhiệm tài sản về hành vi vi phạm đó.",
    );
    this.text(
      "11.2 Trường hợp xảy ra tranh chấp, Hai Bên cùng nhau bàn bạc giải quyết trên tinh thần hòa giải, thiện chí và hợp tác. Nếu không thống nhất được cách giải quyết, Hai Bên sẽ đưa vụ việc ra Tòa án có thẩm quyền giải quyết.",
    );
    this.text(
      "11.3 Hợp đồng nguyên tắc này có giá trị 12 tháng kể từ ngày ký kết. Hết thời hạn trên, nếu Hai Bên không có ý kiến gì thì Hợp đồng được tự động gia hạn thêm 12 tháng tiếp theo và tối đa không quá 2 năm tính từ ngày ký Hợp đồng này.",
    );
    this.text(
      "11.4 Các Đơn đặt hàng cũng như các sửa đổi, bổ sung được coi như các phụ lục và là một phần không thể tách rời của Hợp đồng này.",
    );
    this.text(
      "Hợp đồng Nguyên tắc bán hàng này được lập thành 04 bản, mỗi bên giữ 02 bản có giá trị pháp lý như nhau. Hợp đồng có hiệu lực kể từ ngày ký.",
      {
        gap: 0.35,
      },
    );

    this.signatureArea(owner, partner);
  }

  renderPrincipleClauses(contract, owner = {}, partner = {}) {
    const contractData = contract.contractData || {};
    const paymentTermDays = contractData.paymentTermDays || 30;
    const creditLimit = contractData.creditLimit || "Theo giá trị nhập hàng";
    const antiCorruptionContact =
      contractData.antiCorruptionContact || partner.antiCorruptionContact || {};
    const contactName =
      antiCorruptionContact.name || getOwnerName(partner) || "";
    const contactRole = antiCorruptionContact.role || partner.role || "";
    const contactPhone = antiCorruptionContact.phone || partner.phone || "";
    const contactEmail = antiCorruptionContact.email || partner.email || "";

    this.heading("ĐIỀU 1: CÁC ĐIỀU KHOẢN CHUNG");
    this.text(
      "1.1 Hợp đồng Nguyên tắc này là cơ sở để hai Bên thực hiện việc mua bán hàng hóa thường xuyên.",
    );
    this.text(
      "1.2 Căn cứ vào Hợp đồng này, hai Bên sẽ ký Đơn đặt hàng (Bằng văn bản và/hoặc thư điện tử) đối với từng lô hàng cụ thể. Chi tiết hàng hóa, chất lượng, số lượng, giá cả, giao hàng và các điều khoản khác (nếu có) sẽ được chỉ rõ trong các Đơn đặt hàng tương ứng.",
    );
    this.text(
      "1.3 Trong trường hợp hai Bên có giao dịch mua bán mà nội dung thoả thuận giữa hai Bên có các điều kiện thỏa thuận bổ sung và chi tiết hơn so với nội dung Hợp đồng này, hoặc do hai Bên thống nhất, thoả thuận thì hai Bên sẽ ký Phụ Lục Hợp Đồng để thực hiện giao dịch. Trong trường hợp đó, Hợp đồng mua bán sẽ được ưu tiên áp dụng nếu có điều khoản trái với Hợp đồng này.",
    );

    this.heading("ĐIỀU 2: HÀNG HÓA");
    this.text(
      "2.1 Hàng hóa do Bên Bán cung cấp phải là các sản phẩm đủ điều kiện lưu thông trên thị trường và đạt các yêu cầu cụ thể như sau:",
    );
    this.text(
      "2.2.1. Đúng chủng loại, chất lượng theo tiêu chuẩn của nhà sản xuất, phù hợp với tiêu chuẩn đã đăng ký hoặc công bố với cơ quan quản lý nhà nước theo quy định pháp luật hiện hành. Bên Bán tự chịu trách nhiệm đối với nội dung này, bất cứ khi nào Bên Mua/ khách hàng của Bên Mua phát hiện sản phẩm không đạt tiêu chuẩn chất lượng theo quy định tại điểm này thì Bên Mua có quyền trả hàng, Bên Bán có nghĩa vụ hoàn tiền và chịu phạt vi phạm, bồi thường thiệt hại theo thỏa thuận tại Hợp đồng này hoặc quy định pháp luật hiện hành nếu Hợp đồng này chưa có thỏa thuận.",
    );
    this.text(
      "2.2.2. Quy cách đóng gói, bảo quản theo đúng tiêu chuẩn nhà sản xuất.",
    );
    this.text(
      "2.2.3. Không móp méo, biến dạng vỏ hộp; màu sắc trên vỏ hộp sắc nét không có dấu hiệu bạc/ phai màu.",
    );
    this.text(
      "2.2.4. Sản phẩm có dán nhãn/ nhãn phụ theo quy định pháp luật hiện hành.",
    );
    this.text("2.2.5. Được nhập khẩu hợp pháp.");
    this.text(
      "2.2.6. Date sản phẩm từ ngày sản xuất cho đến ngày Bên Mua nhập hàng HSD còn lại:",
    );
    this.bullet("Đối với thuốc: không ít hơn 12 tháng");
    this.text("2.2.7. Các tiêu chuẩn khác theo quy định pháp luật hiện hành.");
    this.text(
      "2.2.8 Chi tiết về hàng hóa sẽ được các Bên chỉ rõ trong các Đơn đặt hàng.",
    );

    this.heading("ĐIỀU 3: PHƯƠNG THỨC ĐẶT HÀNG VÀ GIAO NHẬN HÀNG HÓA");
    this.text("3.1 Quy trình đặt hàng:");
    this.text(
      "- Khi có nhu cầu đặt hàng, Bên Mua gửi Đơn đặt hàng cho Bên Bán bằng một trong các hình thức: (1) Gửi email từ địa chỉ mail được chỉ định sẵn trong Hợp đồng này đại diện cho Bên Mua để thực hiện việc đặt hàng, nội dung trên body mail phải đầy đủ các thông tin theo Mẫu Đơn Đặt hàng, hoặc; (2) gửi bản gốc Đơn Đặt hàng có chữ ký, đóng dấu của người đại diện (Đại diện theo pháp luật, đại diện theo ủy quyền, người được Bên Mua chỉ định bằng văn bản có thẩm quyền thực hiện việc đặt hàng theo Hợp đồng này).",
    );
    this.text(
      "- Trong khoảng thời gian 01 ngày làm việc kể từ khi nhận được Đơn đặt hàng của Bên Mua, Bên Bán có trách nhiệm xác nhận đồng ý/ không đồng ý giao hàng theo Đơn đặt hàng; xác nhận thời gian giao hàng cụ thể.",
    );
    this.text(
      "3.2 Người được chỉ định đại diện giao dịch của các Bên: Thông tin được báo trước khi Bên Bán giao hàng cho Bên mua.",
    );
    this.text(
      "3.3 Địa điểm nhận hàng: Được chỉ định cụ thể trong Đơn Đặt hàng.",
    );
    this.text(
      "3.4 Đại diện giao, nhận hàng hóa: Người đại diện nhận hàng của Bên Mua sẽ được chỉ định cụ thể trong từng Đơn Đặt hàng. Hàng hóa được coi là đã giao khi có chữ ký của người nhận hàng được Bên B chỉ định trên Biên bản bàn giao.",
    );
    this.text("3.5 Phương thức giao hàng:");
    this.bullet(
      "Thời điểm giao hàng: được hai bên thống nhất cụ thể tại từng Đơn Đặt hàng.",
    );
    this.bullet(
      "Hàng hóa có thể giao một lần hay nhiều lần tùy theo hai Bên thỏa thuận cụ thể trong từng Đơn Đặt hàng.",
    );
    this.bullet(
      "Tại thời điểm giao hàng, Bên Mua kiểm tra hàng hóa và có quyền từ chối nhận hàng nếu sản phẩm không đạt chất lượng theo quy định tại Khoản 2.1 Điều 2 Hợp đồng này. Nếu Bên Mua chấp nhận một phần trong tổng số hàng hóa được giao thì Hai Bên sẽ lập Biên bản bàn giao số hàng thực nhận.",
    );
    this.text("3.6 Chứng từ giao hàng gồm có:");
    this.text("Hóa đơn bán hàng hợp lệ. Thông tin viết hóa đơn:");
    this.labelValue("Tên Công ty : ", partner.companyName);
    this.labelValue("MST: ", partner.mst);
    this.labelValue("Địa chỉ: ", partner.address);
    this.text(
      "Biên bản giao nhận hàng hóa đối với trường hợp giao hàng trực tiếp. Trường hợp giao hàng qua nhà vận chuyển thì bill vận chuyển ghi rõ số kiện, trọng lượng và còn dấu niêm phong của Bên Bán, có danh mục hàng hóa, số lượng từng loại hàng được đóng trong từng kiện hàng.",
    );
    this.bullet(
      "Đơn đặt hàng đã được xác nhận theo Quy trình đặt hàng thỏa thuận tại Điều này.",
    );
    this.bullet(
      "Phiếu kiểm nghiệm, giấy phép lưu hành, giấy phép nhập khẩu (đối với hàng nhập khẩu), các giấy tờ chứng minh nguồn gốc xuất xứ hàng hóa theo quy định pháp luật.",
    );

    this.heading("ĐIỀU 4: GIÁ CẢ VÀ PHƯƠNG THỨC THANH TOÁN");
    this.text("4.1 Giá bán:");
    this.bulletParts([
      {
        text: "Bảng giá chi tiết và chương trình hợp tác đính kèm tại Phụ lục kèm theo",
      },
    ]);
    this.bullet(
      "Giá bán hàng hóa là giá Bên Bán niêm yết tùy từng thời điểm và có hiệu lực áp dụng vào thời điểm Bên Mua đặt hàng.",
    );
    this.bullet(
      "Trường hợp có điều chỉnh giá bán, Bên Bán cung cấp cho Bên Mua văn bản thông báo điều chỉnh giá bán trước thời điểm thay đổi giá ít nhất 03 ngày làm việc.",
    );
    this.richText([
      { text: "4.2 Thời hạn thanh toán: " },
      { text: paymentTermDays, bold: true },
      {
        text: " ngày kể từ ngày Bên Bán hoàn thành việc giao hàng và cung cấp đầy đủ chứng từ giao hàng theo quy định tại Khoản 3.6 Điều 3 Hợp đồng này. Trường hợp ngày thanh toán rơi vào ngày thứ 7, Chủ nhật hoặc ngày Lễ, Tết theo quy định của nhà nước thì ngày thanh toán được dời vào ngày làm việc kế tiếp.",
      },
    ]);
    this.labelValue("4.3 Hạn mức công nợ: ", creditLimit);
    this.text(
      "4.4 Hình thức thanh toán: thanh toán bằng tiền VND bằng hình thức chuyển khoản/ tiền mặt. Trường hợp nhận bằng tiền mặt, người nhận phải có giấy uỷ quyền của bên Bán.",
    );

    this.heading("ĐIỀU 5: TRÁCH NHIỆM CỦA CÁC BÊN");
    this.text("5.1 Bên Bán:");
    this.text(
      "Ngoài các quyền, nghĩa vụ đã thỏa thuận tại Hợp đồng này, Bên Bán có các nghĩa vụ như sau:",
    );
    this.text(
      "5.1.1 Cung cấp đầy đủ thông tin về sản phẩm cho bên mua: Danh mục, Thông tin sản phẩm, hàm lượng, Catalogue, giá cả, chương trình bán hàng, chương trình hỗ trợ, tổ chức đào tạo, giới thiệu sản phẩm mới…",
    );
    this.text(
      "5.1.2 Bằng chi phí của mình thực hiện thu hồi đối với các sản phẩm có lỗi nhà sản xuất hoặc theo yêu cầu của cơ quan quản lý nhà nước hoặc sản phẩm có các biến cố bất lợi tới sức khỏe người tiêu dùng và bồi thường thiệt hại (nếu có) gây ra cho Bên Mua, khách hàng của Bên Mua.",
    );
    this.text(
      "5.1.3 Hỗ trợ tìm hiểu thị trường, xúc tiến thương mại, quảng bá sản phẩm;",
    );
    this.text(
      "5.1.4 Không chuyển nhượng Hợp đồng cho bên thứ ba khi chưa có sự đồng ý bằng văn bản của Bên Mua.",
    );
    this.text(
      "5.1.5 Trường hợp (i) có khiếu nại khách hàng hoặc (ii) có phản ánh của khách hàng về các biến cố bất lợi tới sức khỏe người tiêu dùng khi sử dụng sản phẩm hoặc (iii) để bổ sung thông tin tài liệu cho hoạt động thanh kiểm tra của cơ quan nhà nước, Bên Bán phải cung cấp các thông tin, tài liệu do Bên Mua yêu cầu trong vòng 24h kể từ thời điểm nhận được yêu cầu từ Bên Mua.",
    );
    this.text("5.1.6 Các quyền, nghĩa vụ khác theo quy định pháp luật.");
    this.text("5.2 Bên Mua:");
    this.text(
      "Ngoài các quyền, nghĩa vụ đã thỏa thuận tại Hợp đồng này, Bên Mua có các nghĩa vụ như sau:",
    );
    this.text(
      "5.2.1 Đảm bảo thanh toán đúng thời hạn đã thỏa thuận theo điều 4.2 trong Hợp đồng này.",
    );
    this.text(
      "5.2.2 Bố trí nhận hàng và cử người kiểm tra hàng hóa có thẩm quyền theo sự công của bên Mua ký biên bản nhận hàng hóa đúng thời gian thỏa thuận giao hàng với Bên Bán.",
    );
    this.text(
      "5.2.3 Thực hiện nghiêm chỉnh các qui định của Pháp luật Việt Nam về quản lý và lưu thông hàng hóa.",
    );
    this.text(
      "5.2.4 Đảm bảo tuân thủ việc bảo quản hàng hóa theo hướng dẫn và các tiêu chuẩn phù hợp để tránh tình trạng hàng hóa bị biến đổi về chất lượng do bảo quản không phù hợp;",
    );
    this.text("5.2.5 Các quyền, nghĩa vụ khác theo quy định pháp luật.");

    this.heading("ĐIỀU 6: CUNG CẤP VÀ TRAO ĐỔI THÔNG TIN GIỮA HAI BÊN");
    this.text(
      "6.1 Hai bên thống nhất trao đổi thông tin thông qua các Đại diện liên lạc. Trong trường hợp nhân viên được ủy quyền giao dịch được ghi trên không được quyền tiếp tục đại diện trong việc giao dịch với Bên kia, hai bên cần có thông báo kịp thời, chính thức bằng văn bản/email/fax, gửi người đại diện liên lạc bên kia ngay lập tức và phải được đại diện liên lạc Bên kia xác nhận đã nhận được thông báo đó, nếu không, Bên gây thiệt hại phải chịu hoàn toàn trách nhiệm bồi hoàn chi phí thiệt hại cho Bên kia do việc chậm thông báo trên gây ra.",
    );
    this.text(
      "6.2 Trong trường hợp có sự thay đổi về những thông tin liên quan đến quá trình giao dịch giữa hai Bên như: thay đổi trụ sở làm việc, thay đổi mã số thuế, thay đổi tài khoản…vv hai Bên phải có trách nhiệm thông báo bằng văn bản cho nhau trước khi phát sinh việc mua bán mới.",
    );
    this.text(
      "6.3 Nếu bên nào muốn thay đổi các nội dung trong hợp đồng phải thông báo cho bên còn lại bằng văn bản và Hai Bên tiến hành thương thảo để ký kết Phụ lục Hợp đồng.",
    );
    this.text(
      "6.4 Hai bên có trách nhiệm liên lạc kịp thời khi xảy ra các tình huống phát sinh trong quá trình giao hàng, vận hành (ví dụ hết hàng, hàng không thể giao kịp, thay đổi chất lượng sản phẩm,…) để kịp thời giải quyết tránh các thiệt hại cho đôi bên. Trường hợp xảy ra thiệt hại, bên chậm thông báo sẽ chịu hoàn toàn trách nhiệm bồi thường cho phía bên kia.",
    );

    this.heading("ĐIỀU 7: BỒI THƯỜNG THIỆT HẠI VÀ PHẠT VI PHẠM HỢP ĐỒNG");
    this.text("7.1. Phạt vi phạm:");
    this.text(
      "7.1.1. Bên Mua chịu phạt vi phạm trong trường hợp thanh toán tiền hàng không đúng thời hạn quy định tại Hợp đồng này, tính từ thời điểm quá hạn thanh toán Bên mua phải chịu mức phạt vi phạm tương đương 8% giá trị đơn hàng, đồng thời phải chịu mức lãi suất chậm trả cho Bên Bán theo mức lãi xuất của Ngân hàng mà Bên Bán có tài khoản tại hợp đồng này theo mức lãi suất tại thời điểm vi phạm và các khoản bồi thường thiệt hại khác nếu có.",
    );
    this.text("7.1.2. Bên Bán chịu phạt vi phạm trong trường hợp:");
    this.bullet(
      "Hàng hóa không đúng chất lượng quy định tại Điểm 2.1.1 Khoản 2.1 Điều 2 Hợp đồng này.",
    );
    this.bullet(
      "Mức phạt vi phạm tương đương 8%/ giá trị đơn hàng. Ngoài chịu phạt vi phạm hợp đồng, Bên Mua được quyền trả lại hàng và yêu cầu Bên Bán bồi thường thiệt hại theo khoản 7.2 dưới đây.",
    );
    this.text("7.2. Bồi thường thiệt hại:");
    this.bullet(
      "Nguyên tắc bồi thường: các thiệt hại thực tế, trực tiếp phát sinh do hành vi trái pháp luật của Một Bên gây thiệt hại cho Bên kia sẽ phải được bên vi phạm bồi thường toàn bộ, kịp thời cho Bên bị vi phạm.",
    );
    this.bullet(
      "Bên Bán có nghĩa vụ bồi thường các thiệt hại (nếu có) do lỗi của Bên Bán bao gồm nhưng không giới hạn ở một số lỗi: sản phẩm không được công bố/đăng ký theo quy định pháp luật; công bố/đăng ký hết hạn; sản phẩm là hàng giả, hàng nhái, hàng kém chất lượng; sản phẩm không được dán tem nhãn theo đúng quy định pháp luật hiện hành, .....Mức bồi thường trong trường hợp này là toàn bộ số tiền phạt vi phạm từ cơ quan nhà nước, thiệt hại tiền hàng do hàng hóa bị thu hồi, chi phí thẩm định, chi phí tiêu hủy,...",
    );
    this.text("7.3 Miễn phạt vi phạm hợp đồng:");
    this.text(
      "1. Bên vi phạm hợp đồng được miễn trách nhiệm trong các trường hợp sau đây:",
    );
    this.text(
      "a) Xảy ra trường hợp miễn trách nhiệm mà các bên đã thoả thuận;",
    );
    this.text("b) Xảy ra sự kiện bất khả kháng;");
    this.text("c) Hành vi vi phạm của một bên hoàn toàn do lỗi của bên kia;");
    this.text(
      "d) Hành vi vi phạm của một bên do thực hiện quyết định của cơ quan quản lý nhà nước có thẩm quyền mà các bên không thể biết được vào thời điểm giao kết hợp đồng.",
    );
    this.text(
      "2. Bên vi phạm hợp đồng có nghĩa vụ chứng minh các trường hợp miễn trách nhiệm.",
    );

    this.heading("ĐIỀU 8: BẢO MẬT THÔNG TIN");
    this.text(
      "8.1. Mỗi Bên sẽ giữ bí mật nghiêm ngặt mọi thông tin có được trong quá trình ký kết và thực hiện Hợp đồng này và các Phụ lục Hợp đồng, Hợp đồng mua bán (nếu có) được ký kết giữa hai Bên. Không Bên nào được tiết lộ thông tin đó cho bất kỳ người nào ngoài những nhân viên và người lao động của mình, và việc tiết lộ như vậy cho các nhân viên hoặc người lao động sẽ chỉ được thực hiện trong phạm vi cần thiết với mục đích để thực hiện Hợp đồng này, người được tiết lộ phải được biết và tuân thủ nghĩa vụ bảo mật thông tin Hai Bên đã thỏa thuận.",
    );
    this.text(
      "8.2. Những quy định trên sẽ vẫn được áp dụng kể cả khi Hợp Đồng này đã kết thúc hoặc chấm dứt trong thời hạn 01 (một) năm kể từ khi chấm dứt Hợp đồng này.",
    );

    this.heading("ĐIỀU 9: CHỐNG THAM NHŨNG");
    this.text(
      "9.1. Bên Bán không được bằng bất kỳ hình thức nào trao cho nhân viên của Bên Mua các lợi ích bằng tiền hoặc/và hiện vật như tặng quà, thưởng tiền, trích phần trăm hoa hồng, cho nhân viên nâng giá để hưởng chênh lệch hoặc các hành vi có tính chất tương tự mà không có sự đồng ý bằng văn bản của Bên Mua. Bên Mua được quyền chấm dứt hợp đồng này nếu Bên Bán vi phạm cam kết này và đồng thời Bên Bán sẽ phải bồi thường cho Bên Mua tương đương số tiền mà Bên Bán đã chi trả cho nhân viên của Bên Mua.",
    );
    this.text(
      "9.2. Bên Bán cam kết rằng, nếu biết việc nhân viên của Bên Mua có các hành vi đề nghị việc được hưởng tiền/ lợi ích vật chất như đã nêu ở trên thì thông báo cho Bên Mua theo thông tin sau:",
    );
    this.bulletParts([
      { text: "Họ tên: " },
      { text: contactName, bold: true },
      { text: contactRole ? "                          Chức vụ: " : "" },
      { text: contactRole, bold: true },
    ]);
    this.bulletParts([
      { text: "Điện thoại: " },
      { text: contactPhone, bold: true },
    ]);
    this.bulletParts([{ text: "Email: " }, { text: contactEmail, bold: true }]);
    this.doc.moveDown(0.35);

    this.heading("ĐIỀU 10: CHẤM DỨT HỢP ĐỒNG");
    this.text("Hợp đồng này chấm dứt trong các trường hợp sau:");
    this.text("10.1. Hợp đồng hết hạn mà Hai Bên không có nhu cầu gia hạn.");
    this.text("10.2. Do hai Bên thỏa thuận chấm dứt Hợp đồng bằng văn bản.");
    this.text(
      "10.3. Do một Bên đơn phương chấm dứt hợp đồng. Một Bên được đơn phương chấm dứt hợp đồng trong các trường hợp sau:",
    );
    this.text(
      "10.3.1. Nếu một trong hai Bên vi phạm các quy định trong hợp đồng và/hoặc các quy định của pháp luật, Bên vi phạm phải khắc phục các thiệt hại (nếu có) trong vòng 10 (mười) ngày kể từ ngày nhận thông báo yêu cầu của phía Bên bị vi phạm. Nếu quá thời gian khắc phục nêu trên mà các vi phạm vẫn chưa được khắc phục, Bên bị vi phạm có quyền đơn phương chấm dứt hợp đồng theo quy định của pháp luật và Bên vi phạm có nghĩa vụ bồi thường toàn bộ các thiệt hại theo quy định của pháp luật.",
    );
    this.text(
      "10.3.2. Trừ trường hợp quy định tại điểm 10.3.1. nêu trên, nếu một Bên muốn chấm dứt hợp đồng trước thời hạn thì phải thông báo trước bằng văn bản cho Bên còn lại trước 30 (ba mươi) ngày.",
    );
    this.text(
      "10.4. Trong mọi trường hợp chấm dứt hợp đồng trước thời hạn, Hai Bên phải thực hiện thực hiện đầy đủ các nghĩa vụ quy định trong Hợp đồng cho các giao dịch đã thực hiện trước đó. Hợp đồng chỉ được chấm dứt khi Hai Bên hoàn thành quyết toán hàng hóa và công nợ và người đại diện có thẩm quyền của hai Bên ký và đóng dấu biên bản thanh lý hợp đồng.",
    );
    this.text(
      "10.5. Bên nào đơn phương chấm dứt hợp đồng trái các quy định tại Hợp đồng này và/hoặc trái pháp luật thì phải có nghĩa vụ bồi thường cho Bên còn lại toàn bộ các thiệt hại cho Bên kia theo quy định của pháp luật.",
    );

    this.heading("ĐIỀU 11: CAM KẾT CHUNG");
    this.text(
      "11.1. Hai bên cam kết thực hiện đúng những điều ghi trên Hợp đồng này. Nếu một trong hai bên cố ý vi phạm các điều khoản của Hợp đồng này sẽ phải chịu trách nhiệm tài sản về các hành vi vi phạm đó.",
    );
    this.text(
      "11.2. Trong trường hợp xảy ra tranh chấp, hai bên cùng nhau bàn bạc các biện pháp giải quyết trên tinh thần hòa giải, có thiện chí và hợp tác. Nếu vẫn không thống nhất cách giải quyết thì hai Bên sẽ đưa vụ việc ra Tòa án có thẩm quyền giải quyết.",
    );
    this.text(
      "11.3. Hợp đồng nguyên tắc này có giá trị 12 tháng kể từ ngày ký kết. Hết thời hạn trên, nếu hai Bên không có ý kiến gì thì Hợp đồng được tự động gia hạn thêm 12 tháng tiếp theo và tối đa không quá 2 năm tính từ ngày ký Hợp đồng này.",
    );
    this.text(
      "11.4. Các Đơn đặt hàng cũng như các sửa đổi, bổ sung được coi như các phụ lục và là một phần không thể tách rời của Hợp đồng này.",
    );
    this.text(
      "Hợp đồng Nguyên tắc bán hàng này được lập thành 04 bản, mỗi bên giữ 02 bản có giá trị pháp lý như nhau. Hợp đồng có hiệu lực kể từ ngày ký.",
      {
        gap: 0.35,
      },
    );
  }

  renderGenericValue(label, value, depth = 0) {
    const indent = "  ".repeat(depth);

    if (value === null || value === undefined || value === "") {
      return;
    }

    if (Array.isArray(value)) {
      this.text(`${indent}${label}:`, { bold: true });
      value.forEach((item, index) => {
        this.renderGenericValue(`${index + 1}`, item, depth + 1);
      });
      return;
    }

    if (typeof value === "object") {
      this.text(`${indent}${label}:`, { bold: true });
      Object.entries(value).forEach(([childKey, childValue]) => {
        this.renderGenericValue(childKey, childValue, depth + 1);
      });
      return;
    }

    this.text(`${indent}${label}: ${asText(value)}`);
  }

  renderGenericContract(contract, details = []) {
    const owner = contract.ownerCompanyInfo || {};
    const partner = contract.partnerCompanyInfo || {};
    const contractData = contract.contractData || {};
    const title =
      contractData.title ||
      contractData.contractTitle ||
      `HOP DONG ${asText(contract.contractType).toUpperCase()}`;

    this.text(owner.companyName || "", { width: 245, bold: true });
    this.text(`So: ${contract.contractNumber}`, { width: 245, bold: true });
    this.doc.y = 56;
    this.doc.x = 300;
    this.rightBlock("CONG HOA XA HOI CHU NGHIA VIET NAM", {
      size: 11,
      bold: true,
      gap: 0.1,
    });
    this.doc.x = 300;
    this.rightBlock("Doc lap - Tu do - Hanh phuc", {
      size: 10,
      bold: true,
      gap: 1.2,
    });
    this.doc.x = this.doc.page.margins.left;
    this.centered(title, 14, 0.8, true);

    Object.entries(contractData).forEach(([key, value]) => {
      if (["details", "ownerCompanyInfo", "partnerCompanyInfo"].includes(key)) {
        return;
      }

      this.renderGenericValue(key, value);
    });

    if (details.length) {
      this.heading("CHI TIET HOP DONG");
      details.forEach((detail, index) => {
        this.renderGenericValue(
          detail.detailKey || `detail_${index + 1}`,
          detail.detailData || detail,
        );
      });
    }

    this.signatureArea(owner, partner);
  }

  render(contract, details) {
    const contractType = String(contract.contractType || "").toLowerCase();

    if (["principle", "default", "digital"].includes(contractType)) {
      this.renderPrincipleContract(contract, details);
      return;
    }

    this.renderGenericContract(contract, details);
  }
}

class ContractPdfService {
  static async generateContractPdfBuffer(contract, details = []) {
    const fontPath = await findFontPath();
    const boldFontPath = await findBoldFontPath();
    const builder = new ContractPdfBuilder(fontPath, boldFontPath, contract);
    const pdfBufferPromise = builder.bufferPromise;

    builder.render(contract, details);
    builder.doc.end();

    const pdfBuffer = await pdfBufferPromise;
    const pdfHashHex = crypto
      .createHash("sha256")
      .update(pdfBuffer)
      .digest("hex");
    const fileName = buildContractArtifactFileName(
      contract,
      null,
      pdfHashHex.slice(0, 12),
    );

    return {
      pdfBuffer,
      pdfHashHex,
      fileName,
      signatureWidgets: builder.signatureWidgets,
    };
  }

  static async generateContractPdf(contract, details = []) {
    const { pdfBuffer, pdfHashHex, fileName, signatureWidgets } =
      await this.generateContractPdfBuffer(contract, details);

    return {
      pdfBuffer,
      pdfHashHex,
      fileName,
      signatureWidgets,
    };
  }

  static async generateDigitalSignaturePreview({
    contract,
    signerType = "owner",
    signerName,
    signingTime = new Date(),
    width = 430,
    height = 145,
  }) {
    return createDigitalSignatureAppearanceImage({
      width,
      height,
      contract,
      signerType,
      signerName,
      signingTime,
    });
  }

  static async appendDigitalSignaturePage({
    sourceFilePath,
    contract,
    signature,
    signedBy,
  }) {
    const sourceBytes = await fs.readFile(sourceFilePath);
    const pdfDoc = await PDFLibDocument.load(sourceBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const page = pdfDoc.addPage([595.28, 841.89]);
    const marginX = 56;
    let y = 760;

    const drawLabel = (label, value) => {
      page.drawText(label, {
        x: marginX,
        y,
        size: 11,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      page.drawText(String(value || ""), {
        x: 190,
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
        maxWidth: 340,
      });
      y -= 24;
    };

    page.drawText("PICARE DIGITAL SIGNATURE CONFIRMATION", {
      x: marginX,
      y,
      size: 16,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    y -= 40;

    drawLabel("Contract number:", contract.contractNumber);
    drawLabel("Signer type:", signature.signerType);
    drawLabel("Signer name:", signedBy || signature.signerName);
    drawLabel("Vendor:", signature.vendor);
    drawLabel("Signed at:", new Date().toISOString());
    drawLabel("PDF hash before sign:", signature.pdfHashBeforeSign);
    drawLabel("Certificate serial:", signature.certificateSerial || "N/A");

    page.drawText("Signature hex preview:", {
      x: marginX,
      y,
      size: 11,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    y -= 20;
    page.drawText(String(signature.signatureHex || "").slice(0, 512), {
      x: marginX,
      y,
      size: 8,
      font,
      color: rgb(0, 0, 0),
      maxWidth: 480,
      lineHeight: 11,
    });

    const signedBytes = await pdfDoc.save();
    const signedBuffer = Buffer.from(signedBytes);
    const signedPdfHash = crypto
      .createHash("sha256")
      .update(signedBuffer)
      .digest("hex");
    const fileName = buildContractArtifactFileName(
      contract,
      "signed",
      signedPdfHash.slice(0, 12),
    );
    return {
      signedPdfHash,
      fileName,
      signedPdfBuffer: signedBuffer,
    };
  }

  static buildByteRange(buffer) {
    const byteRangeToken = "/ByteRange [";
    const byteRangeStart = buffer.lastIndexOf(byteRangeToken);

    if (byteRangeStart < 0) {
      throw new Error("PDF signature placeholder is missing /ByteRange.");
    }

    const byteRangeEnd = buffer.indexOf("]", byteRangeStart);
    const placeholder = buffer
      .slice(byteRangeStart, byteRangeEnd + 1)
      .toString();
    const contentsTag = "/Contents ";
    const contentsStart = buffer.indexOf(contentsTag, byteRangeEnd);

    if (contentsStart < 0) {
      throw new Error("PDF signature placeholder is missing /Contents.");
    }

    const hexStart = buffer.indexOf("<", contentsStart);
    const hexEnd = buffer.indexOf(">", hexStart);

    if (hexStart < 0 || hexEnd < 0) {
      throw new Error("PDF signature /Contents hex placeholder is invalid.");
    }

    const byteRange = [0, hexStart, hexEnd + 1, buffer.length - hexEnd - 1];
    const replacement = `/ByteRange [${byteRange.join(" ")}]`;

    if (replacement.length > placeholder.length) {
      throw new Error("PDF ByteRange replacement is longer than placeholder.");
    }

    const preparedBuffer = Buffer.from(buffer);
    preparedBuffer.write(
      replacement.padEnd(placeholder.length, " "),
      byteRangeStart,
    );

    return {
      byteRange,
      preparedBuffer,
      contentsHexStart: hexStart + 1,
      contentsHexEnd: hexEnd,
    };
  }

  static hashByteRange(buffer, byteRange) {
    const signedData = Buffer.concat([
      buffer.slice(byteRange[0], byteRange[0] + byteRange[1]),
      buffer.slice(byteRange[2], byteRange[2] + byteRange[3]),
    ]);

    return crypto.createHash("sha256").update(signedData).digest("hex");
  }

  static getPdfObjectBody(buffer, objectNumber) {
    const objectPattern = new RegExp(
      `${objectNumber}\\s+0\\s+obj\\s*([\\s\\S]*?)\\s*endobj`,
      "g",
    );
    let match;
    let body = null;

    while ((match = objectPattern.exec(buffer.toString("latin1"))) !== null) {
      body = match[1];
    }

    return body;
  }

  static replaceOrAppendArrayItem(body, key, item) {
    const arrayPattern = new RegExp(`/${key}\\s*\\[([\\s\\S]*?)\\]`);

    if (arrayPattern.test(body)) {
      return body.replace(arrayPattern, `/${key} [$1 ${item}]`);
    }

    return body.replace(/>>\s*$/, `/${key} [${item}]\n>>`);
  }

  static async appendIncrementalSignaturePlaceholder({
    sourceBytes,
    contract,
    signerName,
    signerType,
    widgetRect,
    signatureLength,
    signingTime,
  }) {
    const sourceText = sourceBytes.toString("latin1");
    const rootMatch = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(sourceText);
    const startXrefMatch = /startxref\s+(\d+)\s+%%EOF\s*$/s.exec(sourceText);
    const objectMatches = [...sourceText.matchAll(/(\d+)\s+0\s+obj/g)];
    const widgetMatches = [
      ...sourceText.matchAll(
        /(\d+)\s+0\s+obj\s*<<[\s\S]*?\/Subtype\s*\/Widget[\s\S]*?\/FT\s*\/Sig[\s\S]*?\/P\s+(\d+)\s+0\s+R[\s\S]*?endobj/g,
      ),
    ];
    const acroFormMatch = /\/AcroForm\s+(\d+)\s+0\s+R/.exec(sourceText);

    if (!rootMatch || !startXrefMatch || objectMatches.length === 0) {
      throw new Error(
        "PDF structure is not supported for incremental signing.",
      );
    }

    if (!widgetMatches.length || !acroFormMatch) {
      throw new Error("PDF signature form is missing for incremental signing.");
    }

    const maxObjectNumber = Math.max(
      ...objectMatches.map((match) => Number(match[1])),
    );
    const rootObjectNumber = Number(rootMatch[1]);
    const prevStartXref = Number(startXrefMatch[1]);
    const acroFormObjectNumber = Number(acroFormMatch[1]);
    const pageObjectNumber = Number(widgetMatches[widgetMatches.length - 1][2]);
    const signatureObjectNumber = maxObjectNumber + 1;
    const widgetObjectNumber = maxObjectNumber + 2;
    const appearanceObjectNumber = maxObjectNumber + 3;
    const imageObjectNumber = maxObjectNumber + 4;
    const pageBody = this.getPdfObjectBody(sourceBytes, pageObjectNumber);
    const acroFormBody = this.getPdfObjectBody(
      sourceBytes,
      acroFormObjectNumber,
    );

    if (!pageBody || !acroFormBody) {
      throw new Error("PDF page or AcroForm object is missing.");
    }

    const widgetRef = `${widgetObjectNumber} 0 R`;
    const updatedPageBody = this.replaceOrAppendArrayItem(
      pageBody,
      "Annots",
      widgetRef,
    );
    const updatedAcroFormBody = this.replaceOrAppendArrayItem(
      acroFormBody,
      "Fields",
      widgetRef,
    );
    const resolvedWidgetRect = widgetRect || getSignatureWidgetRect(signerType);
    const widgetWidth = resolvedWidgetRect[2] - resolvedWidgetRect[0];
    const widgetHeight = resolvedWidgetRect[3] - resolvedWidgetRect[1];
    const appearanceImage = await createDigitalSignatureAppearanceImage({
      width: widgetWidth,
      height: widgetHeight,
      contract,
      signerType,
      signerName,
      signingTime,
    });
    const signatureHexPlaceholder = "0".repeat(signatureLength);
    const byteRangePlaceholder = `/ByteRange [${BYTE_RANGE_PLACEHOLDER} ${BYTE_RANGE_PLACEHOLDER} ${BYTE_RANGE_PLACEHOLDER} ${BYTE_RANGE_PLACEHOLDER}]`;
    const signatureObject = `<<
/Type /Sig
/Filter /Adobe.PPKLite
/SubFilter /adbe.pkcs7.detached
${byteRangePlaceholder}
/Contents <${signatureHexPlaceholder}>
/Reason (Picare contract ${escapePdfString(signerType || "digital")} signature)
/M (${formatPdfDate(signingTime)})
/ContactInfo ()
/Name (${escapePdfString(signerName)})
/Location (Vietnam)
>>`;
    const widgetObject = `<<
/Type /Annot
/Subtype /Widget
/FT /Sig
/Rect [${resolvedWidgetRect.join(" ")}]
/V ${signatureObjectNumber} 0 R
/T (Signature_${escapePdfString(signerType)}_${Date.now()})
/F 4
/P ${pageObjectNumber} 0 R
/AP << /N ${appearanceObjectNumber} 0 R >>
>>`;
    const appearanceStream = `q
${widgetWidth} 0 0 ${widgetHeight} 0 0 cm
/ImSig Do
Q`;
    const appearanceObject = `<<
/Type /XObject
/Subtype /Form
/BBox [0 0 ${widgetWidth} ${widgetHeight}]
/Resources <<
/XObject <<
/ImSig ${imageObjectNumber} 0 R
>>
>>
/Length ${Buffer.byteLength(appearanceStream, "latin1")}
>>
stream
${appearanceStream}
endstream`;
    const imageObject = Buffer.concat([
      Buffer.from(
        `<<
/Type /XObject
/Subtype /Image
/Width ${appearanceImage.width}
/Height ${appearanceImage.height}
/ColorSpace /DeviceRGB
/BitsPerComponent 8
/Filter /DCTDecode
/Length ${appearanceImage.buffer.length}
>>
stream
`,
        "latin1",
      ),
      appearanceImage.buffer,
      Buffer.from("\nendstream", "latin1"),
    ]);
    const objects = [
      [pageObjectNumber, updatedPageBody],
      [acroFormObjectNumber, updatedAcroFormBody],
      [signatureObjectNumber, signatureObject],
      [widgetObjectNumber, widgetObject],
      [appearanceObjectNumber, appearanceObject],
      [imageObjectNumber, imageObject],
    ].sort((left, right) => left[0] - right[0]);

    const chunks = [Buffer.from("\n", "latin1")];
    const offsets = [];

    for (const [objectNumber, body] of objects) {
      const currentLength = chunks.reduce(
        (sum, chunk) => sum + chunk.length,
        0,
      );
      offsets.push([objectNumber, sourceBytes.length + currentLength]);
      chunks.push(Buffer.from(`${objectNumber} 0 obj\n`, "latin1"));
      chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"));
      chunks.push(Buffer.from("\nendobj\n", "latin1"));
    }

    const incrementalBody = Buffer.concat(chunks);
    const xrefOffset = sourceBytes.length + incrementalBody.length;
    let trailer = "xref\n";

    for (const [objectNumber, offset] of offsets) {
      trailer += `${objectNumber} 1\n${String(offset).padStart(
        10,
        "0",
      )} 00000 n \n`;
    }

    trailer += `trailer
<<
/Size ${imageObjectNumber + 1}
/Root ${rootObjectNumber} 0 R
/Prev ${prevStartXref}
>>
startxref
${xrefOffset}
%%EOF
`;

    return Buffer.concat([
      sourceBytes,
      incrementalBody,
      Buffer.from(trailer, "latin1"),
    ]);
  }

  static async prepareByteRangeSignaturePdf({
    sourceBytes,
    contract,
    details = [],
    signerName,
    signerType,
    signatureLength = DEFAULT_SIGNATURE_LENGTH,
  }) {
    const inputBytes = Buffer.isBuffer(sourceBytes)
      ? sourceBytes
      : Buffer.from(sourceBytes || []);
    const isIncrementalSignature = inputBytes.includes(
      Buffer.from("/ByteRange ["),
    );

    if (isIncrementalSignature) {
      const signingTime = new Date();
      const { signatureWidgets } = await this.generateContractPdfBuffer(
        contract,
        details,
      );
      const signatureWidget = signatureWidgets?.[signerType];
      const placeholderBytes = await this.appendIncrementalSignaturePlaceholder(
        {
          sourceBytes,
          contract,
          signerName,
          signerType,
          widgetRect: signatureWidget?.rect,
          signatureLength,
          signingTime,
        },
      );
      const { byteRange, preparedBuffer, contentsHexStart, contentsHexEnd } =
        this.buildByteRange(Buffer.from(placeholderBytes));
      const hashToSign = this.hashByteRange(preparedBuffer, byteRange);
      const fileName = buildContractArtifactFileName(
        contract,
        "byte_range",
        hashToSign.slice(0, 12),
      );
      return {
        preparedPdfBuffer: preparedBuffer,
        preparedPdfHash: hashToSign,
        fileName,
        byteRange,
        signatureLength,
        contentsHexStart,
        contentsHexEnd,
      };
    }

    const pdfDoc = await PDFLibDocument.load(inputBytes);
    const pages = pdfDoc.getPages();
    const signingTime = new Date();
    const { signatureWidgets } = await this.generateContractPdfBuffer(
      contract,
      details,
    );
    const signatureWidget = signatureWidgets?.[signerType];
    const targetPage =
      pages[signatureWidget?.pageIndex] || pages[pages.length - 1];
    const widgetRect =
      signatureWidget?.rect || getSignatureWidgetRect(signerType);
    const [fontPath, boldFontPath] = await Promise.all([
      findFontPath(),
      findBoldFontPath(),
    ]);
    const [fontBytes, boldFontBytes] = await Promise.all([
      fs.readFile(fontPath),
      fs.readFile(boldFontPath),
    ]);
    pdfDoc.registerFontkit(fontkit);
    const [appearanceFont, appearanceBoldFont] = await Promise.all([
      pdfDoc.embedFont(fontBytes, { subset: true }),
      pdfDoc.embedFont(boldFontBytes, { subset: true }),
    ]);

    await drawCompanyDigitalSignatureAppearance(targetPage, widgetRect, {
      signerName,
      signerType,
      contract,
      font: appearanceFont,
      boldFont: appearanceBoldFont,
      signingTime,
    });

    pdflibAddPlaceholder({
      pdfDoc,
      pdfPage: targetPage,
      reason: `Picare contract ${signerType || "digital"} signature`,
      contactInfo: "",
      name: normalizeVietnameseText(signerName),
      location: "Vietnam",
      signingTime,
      signatureLength,
      byteRangePlaceholder: BYTE_RANGE_PLACEHOLDER,
      appName: "Picare Core Hub",
      widgetRect,
    });

    const placeholderBytes = await pdfDoc.save({ useObjectStreams: false });
    const { byteRange, preparedBuffer, contentsHexStart, contentsHexEnd } =
      this.buildByteRange(Buffer.from(placeholderBytes));
    const hashToSign = this.hashByteRange(preparedBuffer, byteRange);
    const fileName = buildContractArtifactFileName(
      contract,
      "byte_range",
      hashToSign.slice(0, 12),
    );
    return {
      preparedPdfBuffer: preparedBuffer,
      preparedPdfHash: hashToSign,
      fileName,
      byteRange,
      signatureLength,
      contentsHexStart,
      contentsHexEnd,
    };
  }

  static async embedByteRangeSignature({
    preparedBytes,
    signatureHex,
    contract,
  }) {
    const preparedBuffer = Buffer.isBuffer(preparedBytes)
      ? preparedBytes
      : Buffer.from(preparedBytes || []);
    const { byteRange, contentsHexStart, contentsHexEnd } =
      this.buildByteRange(preparedBuffer);
    const cleanSignatureHex = String(signatureHex || "").replace(/^0x/i, "");
    const placeholderLength = contentsHexEnd - contentsHexStart;

    if (!/^[0-9a-fA-F]+$/.test(cleanSignatureHex)) {
      throw new Error("signatureHex phải là chuỗi hex hợp lệ.");
    }

    if (cleanSignatureHex.length > placeholderLength) {
      throw new Error(
        `signatureHex dài hơn vùng placeholder (${cleanSignatureHex.length}/${placeholderLength}).`,
      );
    }

    const signedBuffer = Buffer.from(preparedBuffer);
    signedBuffer.write(
      cleanSignatureHex.padEnd(placeholderLength, "0"),
      contentsHexStart,
      "ascii",
    );

    const signedPdfHash = crypto
      .createHash("sha256")
      .update(signedBuffer)
      .digest("hex");
    return {
      signedPdfHash,
      signedPdfBuffer: signedBuffer,
      fileName: buildContractArtifactFileName(
        contract,
        "ky_so",
        signedPdfHash.slice(0, 12),
      ),
      byteRange,
    };
  }

  static async embedHandwrittenSignature({
    sourceBytes,
    contract,
    details = [],
    signerType,
    signerName,
    signatureImageBuffer,
    signatureImageMimeType,
  }) {
    const inputBytes = Buffer.isBuffer(sourceBytes)
      ? sourceBytes
      : Buffer.from(sourceBytes || []);
    const pdfDoc = await PDFLibDocument.load(inputBytes);
    const pages = pdfDoc.getPages();
    const signingTime = new Date();
    const { signatureWidgets } = await this.generateContractPdfBuffer(
      contract,
      details,
    );
    const signatureWidget = signatureWidgets?.[signerType];
    const targetPage =
      pages[signatureWidget?.pageIndex] || pages[pages.length - 1];
    const widgetRect =
      signatureWidget?.rect || getSignatureWidgetRect(signerType);
    const [fontPath, boldFontPath] = await Promise.all([
      findFontPath(),
      findBoldFontPath(),
    ]);
    const [fontBytes, boldFontBytes] = await Promise.all([
      fs.readFile(fontPath),
      fs.readFile(boldFontPath),
    ]);

    pdfDoc.registerFontkit(fontkit);
    const [appearanceFont, appearanceBoldFont, signatureImage] =
      await Promise.all([
        pdfDoc.embedFont(fontBytes, { subset: true }),
        pdfDoc.embedFont(boldFontBytes, { subset: true }),
        embedImageByMimeType(
          pdfDoc,
          signatureImageBuffer,
          signatureImageMimeType,
        ),
      ]);

    drawHandwrittenSignatureAppearance(targetPage, widgetRect, {
      image: signatureImage,
      signerName,
      signerType,
      font: appearanceFont,
      boldFont: appearanceBoldFont,
      signingTime,
    });

    const signedBytes = await pdfDoc.save({ useObjectStreams: false });
    const signedBuffer = Buffer.from(signedBytes);
    const signedPdfHash = crypto
      .createHash("sha256")
      .update(signedBuffer)
      .digest("hex");
    return {
      signedPdfHash,
      signedPdfBuffer: signedBuffer,
      fileName: buildContractArtifactFileName(
        contract,
        "ky_tay",
        signedPdfHash.slice(0, 12),
      ),
      widgetRect,
    };
  }
}

module.exports = ContractPdfService;
