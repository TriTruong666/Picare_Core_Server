const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const fontkit = require("@pdf-lib/fontkit");
const PDFDocument = require("pdfkit");
const { PDFDocument: PDFLibDocument, StandardFonts, rgb } = require("pdf-lib");
const { pdflibAddPlaceholder } = require("@signpdf/placeholder-pdf-lib");
const sharp = require("sharp");
const { ContractTypeRegistry } = require("../contracts");
const ErrorCodes = require("../common/exceptions/error_codes");
const {
  normalizeProduct: normalizeContractProduct,
} = require("../contracts/common/contract-input.normalizer");

const DEFAULT_FONT_PATHS = [
  process.env.CONTRACT_FONT_PATH,
  path.resolve(__dirname, "../assets/fonts/times.ttf"),
  "C:/Windows/Fonts/times.ttf",
  "C:/Windows/Fonts/arial.ttf",
  "/usr/share/fonts/truetype/msttcorefonts/times.ttf",
  "/usr/share/fonts/TTF/LiberationSerif-Regular.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
].filter(Boolean);
const DEFAULT_BOLD_FONT_PATHS = [
  process.env.CONTRACT_BOLD_FONT_PATH,
  path.resolve(__dirname, "../assets/fonts/timesbd.ttf"),
  "C:/Windows/Fonts/timesbd.ttf",
  "C:/Windows/Fonts/arialbd.ttf",
  "/usr/share/fonts/truetype/msttcorefonts/timesbd.ttf",
  "/usr/share/fonts/TTF/LiberationSerif-Bold.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/LiberationSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
].filter(Boolean);
const FONT_SEARCH_DIRS = [
  path.resolve(__dirname, "../assets/fonts"),
  "/usr/share/fonts",
  "/usr/local/share/fonts",
  "C:/Windows/Fonts",
];
const REGULAR_FONT_FILE_NAMES = [
  "times.ttf",
  "Times.ttf",
  "LiberationSerif-Regular.ttf",
  "DejaVuSans.ttf",
  "LiberationSans-Regular.ttf",
  "Arial.ttf",
  "arial.ttf",
];
const BOLD_FONT_FILE_NAMES = [
  "timesbd.ttf",
  "Timesbd.ttf",
  "LiberationSerif-Bold.ttf",
  "DejaVuSans-Bold.ttf",
  "LiberationSans-Bold.ttf",
  "Arial Bold.ttf",
  "arialbd.ttf",
];
const DEFAULT_SIGNATURE_LENGTH = Number(
  process.env.PDF_SIGNATURE_PLACEHOLDER_LENGTH || 16384,
);
const BYTE_RANGE_PLACEHOLDER = "**********";
const DEFAULT_TEXT_LINE_GAP = 2.5;
const SIGNATURE_WIDGET_RECTS = {
  owner: [75, 141, 255, 215],
  partner: [340, 141, 520, 215],
  default: [75, 141, 255, 215],
};

function asText(value, fallback = "") {
  return value === null || value === undefined ? fallback : String(value);
}

function decodeHtmlEntities(value) {
  const entities = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return asText(value).replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, entity) => {
      if (entity[0] !== "#") return entities[entity.toLowerCase()] || match;
      const isHex = entity[1].toLowerCase() === "x";
      const codePoint = Number.parseInt(
        entity.slice(isHex ? 2 : 1),
        isHex ? 16 : 10,
      );
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    },
  );
}

function htmlToPdfBlocks(rawContent) {
  const content = asText(rawContent)
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n");

  return content
    .split(/\n+/)
    .map((line) => {
      const heading = /<\s*h[1-6][^>]*>/i.test(line);
      const listItem = /<\s*li[^>]*>/i.test(line);
      let bold = heading;
      const parts = [];
      for (const token of line.split(/(<\s*\/?\s*(?:strong|b)\b[^>]*>)/gi)) {
        if (/^<\s*(strong|b)\b/i.test(token)) {
          bold = true;
        } else if (/^<\s*\/\s*(strong|b)\s*>/i.test(token)) {
          bold = heading;
        } else {
          const text = decodeHtmlEntities(
            token.replace(/<[^>]+>/g, ""),
          ).replace(/\s+/g, " ");
          if (text) parts.push({ text, bold });
        }
      }
      return { parts, heading, listItem };
    })
    .filter((block) => block.parts.length);
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

function formatTemplateDate(value, long = false) {
  const rawValue = asText(value).trim();
  if (!rawValue) return "";

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(rawValue);

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return long
      ? `ngày ${day} tháng ${month} năm ${year}`
      : `${day}/${month}/${year}`;
  }

  const parsedDate = new Date(rawValue);
  const safeDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
  return long ? formatLongVietnameseDate(safeDate) : formatShortDate(safeDate);
}

function formatTemplateMoney(value) {
  const rawValue = asText(value).trim();
  if (!rawValue) return "";

  const numberValue = Number(rawValue.replace(/[.,\s]/g, ""));

  if (!Number.isFinite(numberValue)) {
    return rawValue;
  }

  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 0,
  }).format(numberValue);
}

function buildContractFilePrefix(contract) {
  return ContractTypeRegistry.getFilePrefix(contract?.contractType);
}

function buildContractArtifactFileName(contract, variant, token) {
  const parts = [
    buildContractFilePrefix(contract),
    contract?.contractId,
    token,
    variant,
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
  return {
    companyName,
    identityLine,
    addressLine,
    timeLine,
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
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
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

async function prepareHandwrittenSignatureImage(signatureImageBuffer) {
  // Uploaded signature canvases commonly keep a large transparent/white margin.
  // Crop it before scaling so the ink, rather than the original canvas, is centred.
  return sharp(signatureImageBuffer)
    .ensureAlpha()
    .trim({ background: "#ffffff", threshold: 10 })
    .png()
    .toBuffer();
}

async function createHandwrittenSignatureAppearanceImage({
  width,
  height,
  signatureImageBuffer,
  signingTime,
}) {
  const trimmedSignatureBuffer =
    await prepareHandwrittenSignatureImage(signatureImageBuffer);
  const signaturePngBuffer = await sharp(trimmedSignatureBuffer)
    .resize({
      width: Math.round((width - 16) * 3),
      height: Math.round((height - 20) * 3),
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  const signatureMeta = await sharp(signaturePngBuffer).metadata();
  const signatureDataUri = `data:image/png;base64,${signaturePngBuffer.toString("base64")}`;
  const scale = 3;
  const imageWidth = Math.round(width * scale);
  const imageHeight = Math.round(height * scale);
  const timeLine = `Ký tay lúc: ${formatVietnameseDateTime(signingTime)}`;
  const maxImageWidth = width - 16;
  const maxImageHeight = height - 20;
  const rawSignatureWidth = signatureMeta.width || maxImageWidth;
  const rawSignatureHeight = signatureMeta.height || maxImageHeight;
  const imageScale = Math.min(
    maxImageWidth / rawSignatureWidth,
    maxImageHeight / rawSignatureHeight,
    1,
  );
  const signatureWidth = rawSignatureWidth * imageScale;
  const signatureHeight = rawSignatureHeight * imageScale;
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" stroke="#737373" stroke-width="0.6"/>
  <image href="${signatureDataUri}" x="${(width - signatureWidth) / 2}" y="8" width="${signatureWidth}" height="${signatureHeight}" preserveAspectRatio="xMidYMid meet"/>
  <text x="${width / 2}" y="${height - 6}" text-anchor="middle" font-family="Times New Roman, serif" font-size="5.8" fill="#404040">${escapeXml(timeLine)}</text>
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
  { image, font, signingTime = new Date() },
) {
  const [x1, y1, x2, y2] = widgetRect;
  const width = x2 - x1;
  const height = y2 - y1;
  const paddingX = 8;
  const maxImageWidth = width - paddingX * 2;
  const maxImageHeight = height - 20;
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
    y: y1 + 16,
    width: imageWidth,
    height: imageHeight,
  });

  drawCenteredText(
    pdfPage,
    `Ký tay lúc: ${formatVietnameseDateTime(signingTime)}`,
    x1 + paddingX,
    y1 + 5,
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

  throw new Error(ErrorCodes.PDF_UNICODE_FONT_NOT_FOUND.message);
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
        Author: contract.ownerCompanyInfo?.companyName || "Contract Hub",
      },
    });
    this.fontPath = fontPath;
    this.boldFontPath = boldFontPath;
    this.signatureWidgets = {};
    this.doc.font(fontPath).fontSize(10).lineGap(DEFAULT_TEXT_LINE_GAP);
  }

  get bufferPromise() {
    return collectPdfBuffer(this.doc);
  }

  text(value, options = {}) {
    const lineGap =
      options.lineGap !== undefined ? options.lineGap : DEFAULT_TEXT_LINE_GAP;

    this.doc
      .font(options.bold ? this.boldFontPath : this.fontPath)
      .fontSize(options.size || 10)
      .text(asText(value), {
        align: options.align || "left",
        width: options.width,
        continued: options.continued,
        indent: options.indent || 0,
        lineGap,
      });

    if (options.gap) {
      this.doc.moveDown(options.gap);
    }
  }

  richText(parts = [], options = {}) {
    const lineGap =
      options.lineGap !== undefined ? options.lineGap : DEFAULT_TEXT_LINE_GAP;
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
          lineGap,
        });
    });

    if (options.gap) {
      this.doc.moveDown(options.gap);
    }
  }

  richHtml(rawContent, options = {}) {
    htmlToPdfBlocks(rawContent).forEach((block) => {
      const parts = block.listItem
        ? [{ text: "• " }, ...block.parts]
        : block.parts;

      this.richText(parts, {
        size: block.heading ? 11 : 10,
        lineGap: DEFAULT_TEXT_LINE_GAP,
        gap: block.heading ? 0.2 : 0.12,
        ...options,
      });
    });
  }

  labelValue(label, value, options = {}) {
    this.richText(
      [{ text: label, bold: true }, { text: formatOptionalText(value) }],
      options,
    );
  }

  boldLabelValue(label, value, options = {}) {
    this.richText(
      [{ text: label, bold: true }, { text: formatOptionalText(value) }],
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
    this.text(value, {
      size: 11,
      bold: true,
      gap: 0.25,
      lineGap: DEFAULT_TEXT_LINE_GAP,
    });
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
    return this.customCompanyBlock(title, companyInfo, shortName);
  }

  customCompanyBlock(title, companyInfo, shortName) {
    this.boldLabelValue(
      `${title}: `,
      asText(companyInfo.companyName).toUpperCase(),
    );
    this.boldLabelValue("Địa chỉ: ", companyInfo.address);
    this.boldLabelValue("Điện thoại: ", companyInfo.phone);
    if (companyInfo.email) {
      this.boldLabelValue("Email: ", companyInfo.email);
    }
    this.boldLabelValue("Tài khoản số: ", companyInfo.bankInfo);
    this.boldLabelValue("Mã số thuế: ", companyInfo.mst);
    this.richText([
      { text: "Đại diện là Ông/Bà: ", bold: true },
      { text: getOwnerName(companyInfo) },
      ...(companyInfo.role
        ? [{ text: "    Chức vụ: ", bold: true }, { text: companyInfo.role }]
        : []),
    ]);
    this.text(`Sau đây gọi tắt là ${shortName}`, { gap: 0.35 });
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
          .fontSize(10)
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

  collectAppendixProducts(contract, details = []) {
    const contractData = contract.contractData || {};
    const sourceProducts = [
      ...(Array.isArray(contractData.products) ? contractData.products : []),
      ...(Array.isArray(contractData.productRichTexts)
        ? contractData.productRichTexts
        : []),
    ];
    const products = sourceProducts.length ? sourceProducts : details;

    return products.map((product) => normalizeContractProduct(product));
  }

  appendixProductTable(products = []) {
    const doc = this.doc;
    const startX = doc.page.margins.left;
    const widths = [22, 72, 105, 58, 54, 56, 60, 56];
    const headers = [
      "STT",
      "Tên sản phẩm",
      "Thành phần",
      "Quy cách đóng gói",
      "Số đăng ký",
      "Nước sản xuất",
      "Đơn giá(+VAT)",
      "Phân loại",
    ];
    const keys = [
      null,
      "productName",
      "ingredients",
      "packageSpecification",
      "registrationNumber",
      "origin",
      "unitPriceVat",
      "classification",
    ];
    const padding = 4;
    const minRowHeight = 30;
    const lineGap = DEFAULT_TEXT_LINE_GAP;

    const cellHeight = (text, width, bold = false) => {
      doc.font(bold ? this.boldFontPath : this.fontPath).fontSize(10);
      return (
        doc.heightOfString(formatOptionalText(text, ""), {
          width: width - padding * 2,
          lineGap,
        }) +
        padding * 2
      );
    };

    const drawRow = (cells, rowHeight, y, bold = false) => {
      let x = startX;

      cells.forEach((cell, cellIndex) => {
        doc.rect(x, y, widths[cellIndex], rowHeight).stroke();
        doc
          .font(bold ? this.boldFontPath : this.fontPath)
          .fontSize(10)
          .text(formatOptionalText(cell, ""), x + padding, y + padding, {
            width: widths[cellIndex] - padding * 2,
            height: rowHeight - padding * 2,
            lineGap,
            align: cellIndex === 0 ? "center" : "left",
          });
        x += widths[cellIndex];
      });
    };

    let y = doc.y + 4;
    const headerHeight = Math.max(
      minRowHeight,
      ...headers.map((header, index) =>
        cellHeight(header, widths[index], true),
      ),
    );

    if (y + headerHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    drawRow(headers, headerHeight, y, true);
    y += headerHeight;

    products.forEach((product, index) => {
      const cells = keys.map((key) => {
        if (!key) return String(index + 1);
        if (key === "unitPriceVat") return formatMoney(product[key]);
        return product[key];
      });
      const rowHeight = Math.max(
        minRowHeight,
        ...cells.map((cell, cellIndex) =>
          cellHeight(cell, widths[cellIndex], false),
        ),
      );

      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawRow(headers, headerHeight, y, true);
        y += headerHeight;
      }

      drawRow(cells, rowHeight, y, false);
      y += rowHeight;
    });

    doc.y = y + 14;
    doc.x = doc.page.margins.left;
  }

  signatureArea(ownerCompanyInfo = {}, partnerCompanyInfo = {}, options = {}) {
    const doc = this.doc;

    if (doc.y > doc.page.height - 210) {
      doc.addPage();
    }

    doc.moveDown(1);
    const y = doc.y;
    const leftX = doc.page.margins.left + 35;
    const rightX = doc.page.width - doc.page.margins.right - 170;

    doc.font(this.boldFontPath).fontSize(10);
    const ownerOnRight = options.ownerSide === "right";
    const leftInfo = ownerOnRight ? partnerCompanyInfo : ownerCompanyInfo;
    const rightInfo = ownerOnRight ? ownerCompanyInfo : partnerCompanyInfo;
    const leftSignerType = ownerOnRight ? "partner" : "owner";
    const rightSignerType = ownerOnRight ? "owner" : "partner";
    doc.text(options.leftTitle || "ĐẠI DIỆN BÊN A", leftX, y, {
      width: 160,
      align: "center",
    });
    doc.text(options.rightTitle || "ĐẠI DIỆN BÊN B", rightX, y, {
      width: 160,
      align: "center",
    });
    doc.font(this.fontPath).fontSize(10);
    doc.text(
      options.leftHint || "(Ký, đóng dấu, ghi rõ họ và tên)",
      leftX - 8,
      y + 18,
      {
        width: 180,
        align: "center",
      },
    );
    doc.text(
      options.rightHint || "(Ký, đóng dấu, ghi rõ họ và tên)",
      rightX - 8,
      y + 18,
      {
        width: 180,
        align: "center",
      },
    );

    const signatureBoxY = y + 44;
    const signatureBoxWidth = 180;
    const signatureBoxHeight = 74;
    this.drawSignatureBox(
      leftSignerType,
      leftX - 10,
      signatureBoxY,
      signatureBoxWidth,
      signatureBoxHeight,
    );
    this.drawSignatureBox(
      rightSignerType,
      rightX - 10,
      signatureBoxY,
      signatureBoxWidth,
      signatureBoxHeight,
    );

    doc.font(this.boldFontPath).fontSize(10);
    doc.text(
      normalizeVietnameseText(getOwnerName(leftInfo)).toLocaleUpperCase(
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
      normalizeVietnameseText(getOwnerName(rightInfo)).toLocaleUpperCase(
        "vi-VN",
      ),
      rightX,
      y + 128,
      {
        width: 160,
        align: "center",
      },
    );
    doc.y = y + 150;
  }

  renderCustomContract(contract, { partyType }) {
    const owner = contract.ownerCompanyInfo || {};
    const data = contract.contractData || {};
    const isPersonal = partyType === "personal";
    const partner = isPersonal
      ? data.personalInfo || {}
      : contract.partnerCompanyInfo || {};
    const renderedAt = new Date();

    this.centered("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", 14, 0.1, true);
    this.centered("Độc lập - Tự do - Hạnh phúc", 12, 1.2, true);

    this.centered(data.title, 14, 0.1, true);
    this.centered(data.subTitle, 10, 0.8);

    if (data.legalRegulation) {
      this.richHtml(data.legalRegulation, { gap: 0.2 });
      this.doc.moveDown(0.25);
    }

    // this.text(
    //   `Hôm nay, ngày ${formatShortDate(renderedAt)} tại văn phòng công ty, chúng tôi gồm có:`,
    //   { gap: 0.35 },
    // );
    this.customCompanyBlock("BÊN A", owner, "Bên A");

    if (isPersonal) {
      this.boldLabelValue("BÊN B: ", partner.fullName);
      this.boldLabelValue("Sinh ngày: ", partner.dateOfBirth);
      this.boldLabelValue("Chức vụ: ", partner.position);
      this.boldLabelValue("Phòng ban: ", partner.department);
      this.boldLabelValue("Thường trú: ", partner.permanentAddress);
      this.boldLabelValue("Số CCCD: ", partner.citizenId);
      this.boldLabelValue(
        "Cấp ngày: ",
        `${partner.citizenIdIssuedDate} tại ${partner.citizenIdIssuedPlace}`,
        { gap: 0.35 },
      );
    } else {
      this.customCompanyBlock("BÊN B", partner, "Bên B");
    }

    this.richHtml(data.rawContent);

    this.signatureArea(
      owner,
      isPersonal ? { ownerName: partner.fullName } : partner,
      isPersonal
        ? {
            ownerSide: "right",
            leftTitle: "NGƯỜI KÝ",
            rightTitle: "ĐẠI DIỆN BÊN A",
            leftHint: "(Ký, ghi rõ họ và tên)",
            rightHint: "(Ký, đóng dấu, ghi rõ họ và tên)",
          }
        : {},
    );
  }

  renderEmploymentContract(contract) {
    const doc = this.doc;
    const owner = contract.ownerCompanyInfo || {};
    const data = contract.contractData || {};
    const person = contract.contractData?.personalInfo || {};
    const blank = (value, fallback = "................") =>
      formatOptionalText(value, fallback);
    const contractDate = data.contractDate || contract.createdAt || new Date();
    const longDate = formatTemplateDate(contractDate, true);
    const shortDate = (value) => formatTemplateDate(value) || ".../.../....";
    const money = (value) => {
      const formatted = formatTemplateMoney(value);
      return formatted || "................";
    };
    const companyName = blank(owner.companyName).toLocaleUpperCase("vi-VN");
    const employeeName = blank(person.fullName).toLocaleUpperCase("vi-VN");
    const ownerName = blank(getOwnerName(owner));
    const paragraphs = (items) =>
      items.forEach((item) => this.text(item, { gap: 0.12 }));
    const bullets = (items) => items.forEach((item) => this.bullet(item));
    const numbered = (items) =>
      items.forEach((item, index) =>
        this.text(`${index + 1}. ${item}`, { gap: 0.12 }),
      );
    const subheading = (value) => this.text(value, { bold: true, gap: 0.18 });
    const header = (title) => {
      const top = doc.page.margins.top;
      const leftWidth = 225;
      const rightX = doc.page.width / 2 + 10;
      const rightWidth = doc.page.width - doc.page.margins.right - rightX;

      doc.font(this.boldFontPath).fontSize(10);
      doc.text(companyName, doc.page.margins.left, top, {
        width: leftWidth,
        align: "center",
      });
      doc.font(this.fontPath).fontSize(9.5);
      doc.text(
        `Số: ${blank(contract.contractNumber)}`,
        doc.page.margins.left,
        top + 28,
        {
          width: leftWidth,
          align: "center",
        },
      );
      doc.font(this.boldFontPath).fontSize(10);
      doc.text("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", rightX, top, {
        width: rightWidth,
        align: "center",
      });
      doc.text("Độc lập - Tự do - Hạnh phúc", rightX, top + 17, {
        width: rightWidth,
        align: "center",
      });
      doc.font(this.fontPath).fontSize(9.5);
      doc.text("----------- oOo ----------", rightX, top + 34, {
        width: rightWidth,
        align: "center",
      });
      doc.text(`TP. Hồ Chí Minh, ${longDate}`, rightX, top + 51, {
        width: rightWidth,
        align: "center",
      });
      doc.x = doc.page.margins.left;
      doc.y = top + 84;
      this.centered(title, 15, 0.7, true);
    };
    const partyInformation = () => {
      subheading(`BÊN A (NGƯỜI SỬ DỤNG LAO ĐỘNG): ${companyName}`);
      this.labelValue("Trụ sở chính: ", owner.address);
      this.labelValue("Mã số thuế: ", owner.mst);
      this.labelValue("Đại diện bởi: ", ownerName);
      this.labelValue("Chức vụ: ", owner.role);
      this.labelValue("Điện thoại: ", owner.phone);
      subheading(`BÊN B (NGƯỜI LAO ĐỘNG): ${employeeName}`);
      this.richText([
        { text: "Sinh ngày: ", bold: true },
        { text: shortDate(person.dateOfBirth) },
        { text: "    Giới tính: ", bold: true },
        { text: blank(person.gender) },
      ]);
      this.richText([
        { text: "CCCD/CMTND số: ", bold: true },
        { text: blank(person.citizenId) },
        { text: "    Ngày cấp: ", bold: true },
        { text: shortDate(person.citizenIdIssuedDate) },
      ]);
      this.labelValue("Nơi cấp: ", person.citizenIdIssuedPlace);
      this.labelValue("Nơi thường trú (theo CCCD): ", person.permanentAddress);
      this.labelValue("Địa chỉ hiện đang sinh sống: ", person.currentAddress);
      this.labelValue("Mã số thuế (nếu có): ", person.taxCode);
      this.labelValue("Mã số BHXH (nếu có): ", person.socialInsuranceNumber);
      this.labelValue(
        "Người liên lạc trường hợp khẩn cấp: ",
        person.emergencyContact,
        { gap: 0.3 },
      );
    };

    header("HỢP ĐỒNG LAO ĐỘNG");
    bullets([
      "Căn cứ Bộ luật Dân sự số 91/2015/QH13 ban hành ngày 24 tháng 11 năm 2015;",
      "Căn cứ Bộ luật Lao động số 45/2019/QH14 ban hành ngày 20 tháng 11 năm 2019;",
      `Căn cứ quy định của ${companyName};`,
      "Căn cứ khả năng và nhu cầu của hai bên.",
    ]);
    this.text(
      `Hôm nay, ${longDate}, tại văn phòng ${companyName}, chúng tôi gồm các bên sau đây:`,
      { gap: 0.3 },
    );
    partyInformation();
    this.text(
      "Hai bên đã thỏa thuận ký kết Hợp đồng lao động (HĐLĐ) và cam kết thực hiện nghiêm túc những điều khoản sau đây:",
      { gap: 0.3 },
    );

    this.heading("ĐIỀU 1: THỜI HẠN VÀ CÔNG VIỆC");
    bullets([
      `Thời hạn của hợp đồng: Hợp đồng lao động ${blank(data.contractTerm)}.`,
      `Bắt đầu từ ngày: ${shortDate(data.startDate)}.`,
      `Địa điểm làm việc: ${blank(data.workLocation)} (và/hoặc các địa điểm khác thuộc mạng lưới của Công ty theo Quyết định của Công ty từng thời kỳ).`,
      `Chức danh chuyên môn/vị trí công việc: ${blank(person.position)}.`,
      `Phòng ban/Bộ phận: ${blank(person.department)}.`,
      "Công việc phải thực hiện: theo bảng mô tả công việc và/hoặc sự phân công của Ban Giám đốc/Người được ủy quyền.",
    ]);

    this.heading("ĐIỀU 2: THỜI GIAN LÀM VIỆC VÀ BẢO HỘ LAO ĐỘNG");
    subheading("1. Thời gian làm việc:");
    bullets([
      "Buổi sáng: 8h00 – 12h00 từ thứ 2 đến sáng thứ 7.",
      "Buổi chiều: 13h30 – 17h00 từ thứ 2 đến thứ 7 (Thứ 7: nếu có công việc, người lao động đến Công ty hoặc làm việc tại nhà theo sự sắp xếp của quản lý và bảo đảm tiến độ công việc).",
    ]);
    paragraphs([
      "2. Được cấp phát những thiết bị, dụng cụ làm cần thiết phục vụ cho công việc để nhân viên có thể hoàn thành công việc một cách có hiệu quả nhất. Nhân viên có trách nhiệm bảo quản, giữ gìn trang thiết bị ở điều kiện tốt nhất.",
      "3. Phương tiện đi lại: Tự túc.",
      "4. Điều kiện an toàn và vệ sinh lao động tại nơi làm việc theo quy định của pháp luật hiện hành.",
    ]);

    this.heading("ĐIỀU 3: MỨC LƯƠNG VÀ CÁC KHOẢN LIÊN QUAN");
    bullets([
      "Phương tiện đi lại làm việc: Cá nhân tự túc.",
      `Mức lương chính hoặc tiền công: ${money(data.baseSalary)} VND/tháng (Bằng chữ: ${blank(data.salaryInWords)}).`,
      "Hình thức trả lương: Tiền mặt hoặc chuyển khoản.",
      "Các khoản phụ cấp: Không.",
      "Các khoản phúc lợi: Theo quy định của Công ty.",
      "Chế độ nâng lương: Theo quy định của Công ty.",
      "Chế độ nghỉ ngơi (nghỉ hàng tuần, phép năm, lễ tết...): Theo quy định pháp luật hiện hành.",
      "Chế độ đào tạo: Theo quy định của Công ty.",
      "Thuế TNCN, BHYT, BHXH, BHTN (nếu có): Theo quy định của pháp luật hiện hành.",
      "Những thỏa thuận khác: Theo Phụ lục Hợp đồng (nếu có).",
    ]);
    subheading("Các khoản bổ sung: Không.");
    bullets([
      "Tiền tạm ứng hàng tháng: 0 VND/tháng. Mức tiền cụ thể hàng tháng phụ thuộc vào tỷ lệ % hoàn thành kế hoạch và quy định về tiền thưởng hiệu quả công việc của Công ty từng thời điểm.",
      "Tiền thưởng sáng kiến: Mức tiền cụ thể hàng tháng phụ thuộc vào số lượng sáng kiến mỗi tháng và quy định về tiền thưởng sáng kiến của Công ty từng thời điểm.",
      "Tiền thưởng doanh thu: Mức tiền cụ thể hàng tháng phụ thuộc vào doanh số đảm nhận và quy định về thưởng doanh số của Công ty từng thời điểm.",
    ]);

    this.heading("ĐIỀU 4: HÌNH THỨC VÀ THỜI HẠN TRẢ LƯƠNG");
    subheading("1. Thời hạn trả lương:");
    bullets([
      "Được trả lương vào các ngày 05 đến ngày 10 của tháng kế tiếp dựa theo mức lương, các khoản phụ cấp, các chế độ phúc lợi và các khoản bổ sung khác (như: thưởng cải tiến, thưởng hoàn thành công việc, thưởng doanh thu) hàng tháng, sau khi trừ thuế thu nhập cá nhân (TNCN), tiền bảo hiểm xã hội/bảo hiểm y tế/bảo hiểm thất nghiệp (BHXH/BHYT/BHTN) người lao động chịu.",
      "Trường hợp tổng thu nhập trong năm lớn hơn tổng tiền lương hàng tháng đã nhận thì phần chênh lệch sẽ được quyết toán lại sau khi hoàn thành quyết toán thuế cho khách hàng và được chi trả trong vòng 15 ngày sau khi hoàn thành quyết toán thuế.",
      "Trường hợp kết thúc hợp đồng lao động giữa năm tài chính, sau khi hoàn tất thủ tục bàn giao thì phần chênh lệch sẽ được quyết toán trong vòng 30 ngày.",
    ]);

    this.heading("ĐIỀU 5: QUYỀN LỢI VÀ NGHĨA VỤ CỦA NGƯỜI LAO ĐỘNG");
    subheading("A. QUYỀN LỢI");
    numbered([
      "Phương tiện đi lại: Cá nhân tự túc.",
      "Cấp phát những dụng cụ làm việc gồm: Theo tính chất và phân công công việc.",
      "Chế độ nghỉ ngơi: Nghỉ hàng tuần và các ngày phép, ngày lễ, ngày tết theo quy định của Công ty và Bộ luật Lao động. Nghỉ phép năm: 12 ngày phép một năm, với mỗi tháng có 01 ngày nghỉ phép có hưởng lương khi được ký hợp đồng lao động có thời hạn từ 01 năm trở lên. Vì yêu cầu công việc mà người lao động chưa nghỉ hết phép năm thì Công ty không thanh toán số tiền lương các ngày phép tồn của năm trước mà chỉ xem xét giải quyết cho người lao động nghỉ bù phép tồn của năm trước đến hết Quý 1 năm sau.",
      "Chế độ bảo hiểm: Bảo hiểm xã hội, bảo hiểm y tế, bảo hiểm thất nghiệp theo quy định của pháp luật Việt Nam.",
      "Chế độ đào tạo: Được Công ty đào tạo nâng cao năng lực chuyên môn và kỹ năng công việc trong trường hợp cần thiết. Ngoài ra, do yêu cầu của công việc người lao động phải hoàn thành các khóa học theo sự điều động của cấp trên.",
      "Chế độ nâng lương: Lương sẽ được xem xét lại hàng năm và có hiệu lực kể từ tháng điều chỉnh, được thể hiện bằng Quyết định điều chỉnh lương của Ban Giám đốc Công ty hoặc Phụ lục kèm theo HĐLĐ.",
      "Chế độ thưởng: Ngoài lương và phụ cấp, người lao động sẽ được thưởng theo quy định của pháp luật lao động và Nội quy Công ty.",
      "Nghỉ việc: Người lao động có quyền đơn phương chấm dứt hợp đồng và được coi là không vi phạm hợp đồng lao động khi thuộc một trong những trường hợp được quy định theo Luật Lao động hiện hành; có đơn xin thôi việc trước ít nhất 30 ngày làm việc kể từ ngày nộp đơn gửi cấp trên để Công ty có kế hoạch tìm nhân sự thay thế; đồng thời thanh quyết toán các khoản tài chính liên quan, bàn giao trang thiết bị, dụng cụ và công việc được giao trước khi chấm dứt hợp đồng.",
    ]);
    subheading("B. NGHĨA VỤ");
    numbered([
      "Thực hiện công việc với sự tận tâm, tận lực và trung thực, đảm bảo hoàn thành công việc với hiệu quả cao nhất theo sự phân công, điều hành của Ban Giám đốc Công ty và các cá nhân được Ban Giám đốc bổ nhiệm hoặc ủy quyền phụ trách.",
      "Chấp hành mọi sự điều động của Lãnh đạo Công ty khi có yêu cầu.",
      "Thực hiện ký cam kết bảo mật đầy đủ theo quy định của Công ty. Tuyệt đối trung thành với Công ty, tuyệt đối giữ bí mật và không được để lộ thông tin của Công ty, đối tác giao dịch và khách hàng cho đơn vị hay cá nhân khác trong suốt thời gian làm việc theo hợp đồng lao động này và sau khi thôi việc tại Công ty.",
      "Nắm rõ và chấp hành nghiêm túc kỷ luật lao động, an toàn lao động, vệ sinh lao động, PCCC (phòng cháy chữa cháy), văn hóa Công ty, nội quy lao động và các chủ trương, chính sách của Công ty.",
      "Bồi thường vi phạm và vật chất khi có hành vi tiết lộ thông tin của Công ty, gây tổn hại nghiêm trọng đến Công ty theo mức độ vi phạm; gây thiệt hại nghiêm trọng đến thiết bị, tài sản của Công ty. Công ty có quyền chấm dứt hợp đồng này trước thời hạn.",
      "Đóng các loại bảo hiểm bắt buộc, thuế thu nhập cá nhân đầy đủ theo quy định của pháp luật.",
      "Cam kết tham gia đầy đủ các chương trình đào tạo tập trung tại Công ty hoặc được cử đi đào tạo. Trường hợp được cử đi đào tạo, người lao động phải hoàn thành khóa học đúng thời hạn.",
      "Người lao động có chứng chỉ hành nghề (kiểm toán viên, kế toán viên, đại lý thuế, thẩm định giá, luật sư) phải hoàn tất đầy đủ số giờ cập nhật kiến thức tối thiểu để đảm bảo hành nghề cho các năm sau.",
      "Kịp thời thông báo cho Công ty những thay đổi về cá nhân như nhân thân, địa chỉ thường trú/tạm trú dài hạn, trình độ học vấn, sức khỏe và các thông tin cá nhân có liên quan khác được đề cập trong HĐLĐ và các phụ lục HĐLĐ.",
      "Trước khi chấm dứt hợp đồng, quyết toán các khoản tài chính, thanh toán các khoản nợ còn tồn đọng, bàn giao trang thiết bị, dụng cụ và công việc được giao cho người tiếp nhận do lãnh đạo đơn vị chỉ định trong thời hạn quy định của Công ty.",
      "Hoàn thành số liệu cho khách hàng đến tháng nghỉ việc.",
    ]);
    this.text(
      `Người lao động buộc phải đọc toàn bộ Nội quy Công ty và tuân thủ Nội quy đó. Mọi hành vi vi phạm nội quy sẽ được xử lý theo quy định và không được lấy lý do không biết đến quy định trong Nội quy lao động của ${companyName}.`,
      { gap: 0.2 },
    );

    this.heading("ĐIỀU 6: NGHĨA VỤ VÀ QUYỀN HẠN CỦA NGƯỜI SỬ DỤNG LAO ĐỘNG");
    subheading("A. NGHĨA VỤ");
    numbered([
      "Bảo đảm việc làm và thực hiện đầy đủ những điều khoản trong hợp đồng.",
      "Thanh toán đầy đủ, đúng thời hạn các chế độ và quyền lợi cho người lao động theo hợp đồng này.",
      "Trường hợp chậm thanh toán các chế độ và quyền lợi thì người sử dụng lao động phải trả lãi của khoản tiền chậm thanh toán theo lãi suất Ngân hàng Nhà nước Việt Nam.",
      "Hướng dẫn, đào tạo người lao động về quy chế và quy định của Công ty.",
    ]);
    subheading("B. QUYỀN HẠN");
    numbered([
      "Điều hành người lao động hoàn thành công việc theo hợp đồng; bố trí, điều chuyển công việc theo đúng chức năng chuyên môn, cử đi công tác hoặc điều chuyển nơi công tác.",
      "Chuyển tạm thời lao động, ngừng việc, thay đổi, tạm thời chấm dứt HĐLĐ và áp dụng các biện pháp kỷ luật theo pháp luật hiện hành và nội quy Công ty trong thời gian hợp đồng còn giá trị.",
      "Tạm hoãn, chấm dứt hợp đồng, kỷ luật người lao động theo đúng quy định của pháp luật và nội quy lao động của Công ty.",
      "Yêu cầu bồi thường, khiếu nại với cơ quan nhà nước để bảo vệ quyền lợi nếu người lao động vi phạm pháp luật hoặc các điều khoản của hợp đồng này.",
      "Trích thuế thu nhập cá nhân, các khoản bảo hiểm bắt buộc theo quy định pháp luật và bất kỳ nghĩa vụ pháp lý nào khác của người lao động từ tiền lương, tiền công để nộp cho cơ quan nhà nước có thẩm quyền.",
    ]);

    this.heading("ĐIỀU 7: ĐƠN PHƯƠNG CHẤM DỨT HĐLĐ");
    subheading("1. Người sử dụng lao động");
    this.text(
      "Người sử dụng lao động có quyền đơn phương chấm dứt HĐLĐ trong những trường hợp sau:",
    );
    bullets([
      "Người lao động thường xuyên không hoàn thành công việc theo sự phân công của Công ty. Mức độ hoàn thành và cách thức đánh giá áp dụng theo Nội quy lao động, bản Phân công công việc và các quy định nội bộ khác của Công ty.",
      "Người lao động ốm đau đã điều trị 12 tháng liền, không đủ sức khỏe để thực hiện công việc.",
      "Do thiên tai, hỏa hoạn, dịch bệnh nguy hiểm, địch họa hoặc di dời, thu hẹp sản xuất, kinh doanh theo yêu cầu của cơ quan nhà nước có thẩm quyền mà Công ty đã tìm mọi biện pháp khắc phục nhưng vẫn buộc phải giảm chỗ làm việc.",
      "Người lao động có hành vi gây thiệt hại nghiêm trọng về tài sản, lợi ích của Công ty và các cam kết bảo mật với Công ty.",
      "Người lao động tự ý bỏ việc không có lý do chính đáng từ 05 ngày làm việc liên tục trở lên hoặc tổng cộng 20 ngày trong một năm.",
      "Người lao động cung cấp không trung thực thông tin theo khoản 2 Điều 16 Bộ luật Lao động 2019 khi giao kết HĐLĐ, làm ảnh hưởng đến việc tuyển dụng.",
      "Người lao động vi phạm pháp luật hình sự hoặc bị cấm làm công việc ghi trong HĐLĐ theo bản án, quyết định của Tòa án đã có hiệu lực pháp luật.",
    ]);
    subheading("2. Người lao động");
    this.text(
      "Người lao động được đơn phương chấm dứt HĐLĐ trước thời hạn trong những trường hợp sau:",
    );
    bullets([
      "Không được bố trí theo đúng công việc hoặc không được bảo đảm các điều kiện làm việc đã thỏa thuận trong hợp đồng.",
      "Không được trả công đầy đủ hoặc trả công không đúng thời hạn đã thỏa thuận trong hợp đồng.",
      "Bị ngược đãi, đánh đập, nhục mạ, bị hành vi làm ảnh hưởng đến sức khỏe, nhân phẩm, danh dự; bị cưỡng bức lao động hoặc quấy rối tình dục tại nơi làm việc.",
      "Được bầu làm nhiệm vụ chuyên trách ở các cơ quan dân cử hoặc được bổ nhiệm giữ chức vụ trong bộ máy Nhà nước.",
      "Người lao động nữ có thai phải nghỉ việc theo chỉ định của bác sĩ.",
      "Người lao động bị ốm đau, tai nạn đã điều trị 03 tháng liền mà khả năng lao động chưa được hồi phục.",
      "Người lao động phải đảm bảo thời hạn báo trước ít nhất 30 ngày đối với HĐLĐ xác định thời hạn 01 năm.",
    ]);

    this.heading("ĐIỀU 8: THỎA THUẬN KHÔNG CẠNH TRANH");
    numbered([
      "Trong suốt thời gian làm việc tại Công ty và 12 tháng sau khi nghỉ việc, người lao động không được làm việc cho các công ty đối thủ hoặc cung cấp dịch vụ cho khách hàng của Công ty; không được tiết lộ bất kỳ thông tin nào liên quan đến hoạt động kinh doanh, tài chính hoặc khách hàng của Công ty.",
      "Nếu vi phạm điều khoản này, Công ty có quyền yêu cầu bồi thường thiệt hại bằng 05 (năm) tháng lương quy định tại Điều 3 của hợp đồng này mà người lao động nhận gần nhất tính đến khi nghỉ việc.",
    ]);

    this.heading(
      "ĐIỀU 9: SỬ DỤNG HÌNH ẢNH VÀ THÔNG TIN CÁ NHÂN CỦA NGƯỜI LAO ĐỘNG",
    );
    subheading("1. Mục đích và thời gian sử dụng hình ảnh, thông tin cá nhân");
    this.bullet(
      "Người lao động đồng ý rằng trong thời gian làm việc và sau khi chấm dứt hợp đồng lao động, Công ty có quyền tiếp tục sử dụng hình ảnh, video và thông tin cá nhân được thu thập trong quá trình làm việc để phục vụ truyền thông nội bộ, quảng bá và tiếp thị sản phẩm, dịch vụ của Công ty, bao gồm đăng tải trên các kênh truyền thông, website, mạng xã hội và các ấn phẩm của Công ty.",
    );
    subheading("2. Quyền yêu cầu ngừng sử dụng");
    bullets([
      "Người lao động có quyền yêu cầu Công ty ngừng sử dụng hình ảnh và thông tin cá nhân sau khi chấm dứt hợp đồng bằng thông báo văn bản. Công ty sẽ ngừng sử dụng trong các hoạt động tương lai kể từ ngày chấm dứt hợp đồng, nhưng không có nghĩa vụ gỡ bỏ hoặc thu hồi tài liệu, hình ảnh, video đã phát hành hoặc đăng tải trước đó, đặc biệt khi nội dung đã lan truyền rộng rãi hoặc được bên thứ ba sử dụng lại.",
      "Người lao động hiểu và chấp nhận việc kiểm soát toàn bộ sự lan truyền thông tin, hình ảnh trên mạng xã hội và các kênh bên ngoài là rất khó khăn; Công ty không chịu trách nhiệm về hình ảnh đã được bên thứ ba phát hành lại.",
    ]);
    subheading("3. Cam kết của Công ty");
    this.bullet(
      "Công ty chỉ sử dụng hình ảnh và thông tin cá nhân của người lao động vào mục đích hợp pháp và không chuyển giao cho bên thứ ba ngoài mục đích nêu trên nếu không có sự đồng ý của người lao động.",
    );
    subheading("4. Trách nhiệm của Công ty đối với yêu cầu gỡ bỏ");
    this.bullet(
      "Người lao động đồng ý rằng Công ty không chịu trách nhiệm đối với việc sử dụng lại hình ảnh bởi các bên thứ ba mà Công ty không kiểm soát và không chịu trách nhiệm gỡ bỏ các nội dung hình ảnh, video đã phát hành trước đó.",
    );

    this.heading("ĐIỀU 10: NHỮNG THỎA THUẬN KHÁC");
    numbered([
      "Thông tin về tiền lương, tiền công phải được bảo mật.",
      "Người lao động đồng ý và chấp thuận các nội dung dưới đây.",
      "Khi Công ty cơ cấu, thành lập mới, sắp xếp lại tổ chức, đổi mới công nghệ hoặc thay đổi chiến lược kinh doanh phù hợp thực tiễn, Công ty có quyền điều chuyển người lao động sang vị trí hoặc công việc khác phù hợp với khả năng, trình độ và có trách nhiệm đào tạo theo pháp luật hiện hành.",
      "Sẵn sàng đi công tác hoặc thay đổi địa điểm làm việc đến địa phương khác, Chi nhánh/Văn phòng đại diện khác trong hệ thống theo sự điều hành của Công ty.",
      "Những sáng kiến, sáng tạo của người lao động được thẩm định và áp dụng trong công việc thuộc tài sản và quyền khai thác của Công ty.",
      "Tham gia đầy đủ các khóa đào tạo định kỳ online và đào tạo tập trung theo lịch của Công ty. Trường hợp vắng mặt từ 02 buổi/tháng và 05 buổi/năm cộng dồn không có lý do chính đáng thì chấp thuận mọi hình thức xử lý từ Công ty.",
      "Nếu một bên có nhu cầu thay đổi nội dung HĐLĐ phải báo cho bên kia trước ít nhất 05 ngày và ký Phụ lục theo pháp luật. Trong thời gian thỏa thuận, hai bên vẫn tuân theo HĐLĐ đã ký.",
      "Người lao động đồng ý cho Công ty, với tư cách người sử dụng lao động, tiết lộ thông tin cá nhân bao gồm nhưng không giới hạn họ tên, địa chỉ, quá trình làm việc, lương thưởng và các thông tin liên quan đến công việc cho các tổ chức quy định dưới đây.",
      "Các đơn vị liên kết, đơn vị trực thuộc Công ty (bao gồm Chi nhánh, Văn phòng đại diện) và các bên tư vấn về pháp luật, quản trị của Công ty.",
      "Các đối tác, nhà cung cấp dịch vụ hoặc các bên khác với điều kiện Công ty yêu cầu các đối tượng này tuân thủ bảo mật.",
    ]);

    this.heading("ĐIỀU 11: GIẢI QUYẾT TRANH CHẤP");
    numbered([
      "Những vấn đề lao động khác không ghi trong hợp đồng này áp dụng theo quy chế, nội quy lao động của Công ty và pháp luật lao động Việt Nam có hiệu lực tại thời điểm ký hợp đồng.",
      "Trong quá trình thực hiện hợp đồng nếu có tình huống phát sinh, các bên giải quyết trên cơ sở thương lượng và hòa giải.",
      "Nếu không thể hòa giải, vụ việc được giải quyết tại Tòa án nhân dân có thẩm quyền tại Thành phố Hồ Chí Minh.",
    ]);

    this.heading("ĐIỀU 12: ĐIỀU KHOẢN THI HÀNH");
    numbered([
      "Những vấn đề về lao động không ghi trong HĐLĐ này áp dụng theo Thỏa ước lao động tập thể, nội quy lao động và pháp luật lao động.",
      "Mọi thỏa thuận trong các HĐLĐ khác hoặc văn bản trước đây trái với thỏa thuận trong HĐLĐ này đương nhiên hết hiệu lực.",
      "Hợp đồng này được các bên hoàn toàn tự nguyện thỏa thuận và cùng ký kết trong trạng thái tinh thần tỉnh táo, không bị lừa dối hay ép buộc, nhằm đảm bảo lợi ích của mỗi bên.",
      "Khi hai bên ký Phụ lục HĐLĐ thì nội dung của Phụ lục có giá trị như các nội dung của hợp đồng này.",
      "Hợp đồng được lập thành 02 (hai) bản có giá trị như nhau, Công ty giữ 01 (một) bản, người lao động giữ 01 (một) bản để thực hiện và có hiệu lực kể từ ngày ký.",
      `Hợp đồng được lập tại Văn phòng Công ty vào ${longDate}.`,
    ]);
    this.signatureArea(
      owner,
      { ownerName: person.fullName },
      {
        leftTitle: "NGƯỜI SỬ DỤNG LAO ĐỘNG",
        rightTitle: "NGƯỜI LAO ĐỘNG",
        rightHint: "(Ký, ghi rõ họ và tên)",
      },
    );

    doc.addPage();
    header("PHỤ LỤC HỢP ĐỒNG LAO ĐỘNG");
    this.text(
      `Hôm nay, ${longDate}, tại văn phòng ${companyName}, chúng tôi gồm các bên sau đây:`,
      { gap: 0.3 },
    );
    partyInformation();
    this.text(
      `Căn cứ Hợp đồng lao động số ${blank(contract.contractNumber)} ký ${longDate} và nhu cầu sử dụng lao động, hai bên cùng nhau thỏa thuận thay đổi một số nội dung của hợp đồng đã ký như sau:`,
      { gap: 0.3 },
    );
    this.heading("ĐIỀU 1: NỘI DUNG THAY ĐỔI");
    subheading("1.1. Tiền lương, chế độ, phúc lợi, thưởng:");
    bullets([
      `Mức lương cơ bản: ${money(data.baseSalary)} đồng.`,
      `Tiền ăn giữa ca: ${money(data.mealAllowance)} đồng.`,
      `Hỗ trợ điện thoại + đồng phục: ${money(data.phoneUniformAllowance)} đồng.`,
      `Thưởng hiệu quả công việc: ${money(data.performanceBonus)} đồng.`,
      `Hỗ trợ xăng xe: ${money(data.transportationAllowance)} đồng.`,
      `Tổng cộng: ${money(data.totalSalary)} đồng.`,
      "Lương làm thêm giờ: Được tính theo quy định của pháp luật lao động và quy định của Công ty.",
      "Lương tháng 13: Người lao động được hưởng tháng lương 13 và các khoản tương đương lương khác (nếu có) tùy theo hiệu quả công việc và kết quả kinh doanh của Công ty trong năm.",
      "BHXH, BHYT, BHTN: Theo quy định của Luật BHXH hiện hành về mức tham gia đóng và tỷ lệ đóng BHXH, BHYT, BHTN cho người lao động.",
      "Thuế TNCN phát sinh dựa trên tổng thu nhập hàng tháng của người lao động (nếu có) sẽ do người lao động chi trả và Công ty khấu trừ vào lương để trích nộp theo quy định.",
    ]);
    this.heading("ĐIỀU 2: THỜI GIAN THỰC HIỆN");
    bullets([
      "Phụ lục hợp đồng có hiệu lực kể từ ngày ký cho đến khi Hợp đồng lao động đã ký kết hết hạn.",
      `Phụ lục này là bộ phận không thể tách rời của Hợp đồng lao động số ${blank(contract.contractNumber)}, được làm thành hai bản có giá trị như nhau, mỗi bên giữ một bản và là cơ sở giải quyết khi có tranh chấp lao động.`,
      `Phụ lục Hợp đồng này được lập tại ${companyName}, ${longDate}.`,
    ]);
    this.signatureArea(
      owner,
      { ownerName: person.fullName },
      {
        leftTitle: "NGƯỜI SỬ DỤNG LAO ĐỘNG",
        rightTitle: "NGƯỜI LAO ĐỘNG",
        rightHint: "(Ký, ghi rõ họ và tên)",
      },
    );
  }

  renderProbationContract(contract) {
    const doc = this.doc;
    const owner = contract.ownerCompanyInfo || {};
    const data = contract.contractData || {};
    const person = data.personalInfo || {};
    const blank = (value, fallback = "................") =>
      formatOptionalText(value, fallback);
    const contractDate = data.contractDate || contract.createdAt || new Date();
    const longDate = formatTemplateDate(contractDate, true);
    const shortDate = (value) => formatTemplateDate(value) || ".../.../....";
    const money = (value) => formatTemplateMoney(value) || "................";
    const companyName = blank(owner.companyName).toLocaleUpperCase("vi-VN");
    const employeeName = blank(person.fullName).toLocaleUpperCase("vi-VN");
    const ownerName = blank(getOwnerName(owner));
    const paragraphs = (items) =>
      items.forEach((item) => this.text(item, { gap: 0.12 }));
    const bullets = (items) => items.forEach((item) => this.bullet(item));
    const numbered = (items) =>
      items.forEach((item, index) =>
        this.text(`${index + 1}. ${item}`, { gap: 0.12 }),
      );
    const subheading = (value) => this.text(value, { bold: true, gap: 0.18 });
    const header = () => {
      const top = doc.page.margins.top;
      const leftWidth = 225;
      const rightX = doc.page.width / 2 + 10;
      const rightWidth = doc.page.width - doc.page.margins.right - rightX;

      doc.font(this.boldFontPath).fontSize(10);
      doc.text(companyName, doc.page.margins.left, top, {
        width: leftWidth,
        align: "center",
      });
      doc.font(this.fontPath).fontSize(9.5);
      doc.text(
        `Số: ${blank(contract.contractNumber)}`,
        doc.page.margins.left,
        top + 28,
        { width: leftWidth, align: "center" },
      );
      doc.font(this.boldFontPath).fontSize(10);
      doc.text("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", rightX, top, {
        width: rightWidth,
        align: "center",
      });
      doc.text("Độc lập - Tự do - Hạnh phúc", rightX, top + 17, {
        width: rightWidth,
        align: "center",
      });
      doc.font(this.fontPath).fontSize(9.5);
      doc.text("----------- oOo ----------", rightX, top + 34, {
        width: rightWidth,
        align: "center",
      });
      doc.text(`TP. Hồ Chí Minh, ${longDate}`, rightX, top + 51, {
        width: rightWidth,
        align: "center",
      });
      doc.x = doc.page.margins.left;
      doc.y = top + 84;
      this.centered("HỢP ĐỒNG THỬ VIỆC", 15, 0.7, true);
    };
    const partyInformation = () => {
      subheading(`BÊN A (NGƯỜI SỬ DỤNG LAO ĐỘNG): ${companyName}`);
      this.labelValue("Trụ sở chính: ", owner.address);
      this.labelValue("Mã số thuế: ", owner.mst);
      this.labelValue("Đại diện bởi: ", ownerName);
      this.labelValue("Chức vụ: ", owner.role);
      this.labelValue("Điện thoại: ", owner.phone);
      this.text("Và:", { gap: 0.12 });
      subheading(`BÊN B (NGƯỜI LAO ĐỘNG): ${employeeName}`);
      this.richText([
        { text: "Sinh ngày: ", bold: true },
        { text: shortDate(person.dateOfBirth) },
        { text: "    Giới tính: ", bold: true },
        { text: blank(person.gender) },
      ]);
      this.richText([
        { text: "CCCD/CMTND số: ", bold: true },
        { text: blank(person.citizenId) },
        { text: "    Cấp ngày: ", bold: true },
        { text: shortDate(person.citizenIdIssuedDate) },
      ]);
      this.labelValue("Nơi cấp: ", person.citizenIdIssuedPlace);
      this.labelValue("Nơi thường trú (theo CCCD): ", person.permanentAddress);
      this.labelValue("Địa chỉ hiện đang sinh sống: ", person.currentAddress);
      this.labelValue("Mã số thuế (nếu có): ", person.taxCode);
      this.labelValue(
        "Số sổ lao động/sổ BHXH (nếu có): ",
        person.socialInsuranceNumber,
      );
      this.labelValue(
        "Người liên lạc trường hợp khẩn cấp: ",
        person.emergencyContact,
        { gap: 0.3 },
      );
    };

    header();
    bullets([
      "Căn cứ Bộ luật Dân sự số 91/2015/QH13 ban hành ngày 24 tháng 11 năm 2015;",
      "Căn cứ vào Bộ luật Lao động số 45/2019/QH14 ban hành ngày 20 tháng 11 năm 2019;",
      `Căn cứ vào quy định của ${companyName};`,
      "Căn cứ vào khả năng và nhu cầu của hai bên.",
    ]);
    this.text(
      `Hôm nay, ${longDate}, tại văn phòng ${companyName}, chúng tôi gồm các bên sau đây:`,
      { gap: 0.3 },
    );
    partyInformation();
    this.text(
      "Hai bên đã thỏa thuận ký kết Hợp đồng thử việc và cam kết thực hiện nghiêm túc những điều khoản sau đây:",
      { gap: 0.3 },
    );

    this.heading("ĐIỀU 1: THỜI HẠN VÀ CÔNG VIỆC");
    paragraphs([
      `1. Thời hạn hợp đồng: Hợp đồng có hiệu lực từ ngày ${shortDate(data.probationStartDate)} đến ngày ${shortDate(data.probationEndDate)} và kéo dài tối đa 60 ngày.`,
      `2. Vị trí công việc: ${blank(person.position)}.`,
      `3. Phòng ban/Bộ phận: ${blank(person.department)}.`,
      "4. Công việc: Thực hiện theo phân công của Trưởng dự án/Ban Giám đốc.",
      `5. Địa điểm làm việc: ${blank(data.workLocation, "Tại văn phòng chính hoặc các địa điểm khác theo quyết định của Công ty")}.`,
    ]);

    this.heading("ĐIỀU 2: THỜI GIAN LÀM VIỆC");
    subheading("1. Thời gian làm việc:");
    bullets([
      "Buổi sáng: 8h00 – 12h00 từ thứ 2 đến thứ 7.",
      "Buổi chiều: 13h30 – 17h00 từ thứ 2 đến thứ 7.",
    ]);
    paragraphs([
      "2. Được cấp phát những thiết bị, dụng cụ làm cần thiết phục vụ cho công việc để nhân viên có thể hoàn thành công việc một cách có hiệu quả nhất. Nhân viên có trách nhiệm bảo quản, giữ gìn trang thiết bị ở điều kiện tốt nhất.",
      "3. Phương tiện đi lại: Tự túc.",
      "4. Điều kiện an toàn và vệ sinh lao động tại nơi làm việc theo quy định của pháp luật hiện hành.",
    ]);

    this.heading("ĐIỀU 3: MỨC LƯƠNG VÀ CÁC KHOẢN LIÊN QUAN");
    paragraphs([
      `1. Mức lương thử việc: ${money(data.probationSalary)} VND/tháng.`,
      "2. Các khoản phụ cấp: Không.",
      "3. Các khoản bổ sung: Không.",
    ]);
    bullets([
      `Tiền thưởng hiệu quả công việc: ${money(data.performanceBonus)} VND/tháng.`,
      "Mức tiền cụ thể hàng tháng phụ thuộc vào tỷ lệ % hoàn thành kế hoạch và quy định về tiền thưởng hiệu quả công việc của Công ty từng thời điểm.",
      "Tiền thưởng sáng kiến: Mức tiền cụ thể hàng tháng phụ thuộc vào số lượng sáng kiến mỗi tháng và quy định về tiền thưởng sáng kiến của Công ty từng thời điểm.",
      "Tiền thưởng doanh thu: Mức tiền cụ thể hàng tháng phụ thuộc vào doanh số đảm nhận và quy định về thưởng doanh số của Công ty từng thời điểm.",
    ]);
    subheading("4. Thuế thu nhập cá nhân (TNCN):");
    bullets([
      "Người lao động tự chịu trách nhiệm kê khai và nộp thuế thu nhập cá nhân. Công ty sẽ khấu trừ thuế TNCN tại nguồn trước khi thanh toán lương cho nhân viên.",
      "Công ty sẽ cung cấp chứng từ khấu trừ thuế thu nhập cá nhân để người lao động thực hiện quyết toán với cơ quan thuế.",
    ]);
    this.text(
      "5. Thời hạn trả lương: Lương được thanh toán vào ngày 05 của tháng kế tiếp.",
      { gap: 0.12 },
    );

    this.heading("ĐIỀU 4: THỎA THUẬN KHÔNG CẠNH TRANH");
    this.text(
      "1. Trong thời gian thử việc và 6 tháng sau khi kết thúc hợp đồng, Người lao động không được phép:",
      { gap: 0.12 },
    );
    bullets([
      "Làm việc hoặc hợp tác với bất kỳ công ty nào khác có xung đột về lợi ích tương tự với Công ty.",
      "Tiếp cận hoặc cung cấp dịch vụ cho các khách hàng của Công ty.",
    ]);
    this.text(
      "Vi phạm điều khoản không cạnh tranh sẽ bị xử lý theo quy định của pháp luật và Công ty có quyền yêu cầu bồi thường thiệt hại.",
      { gap: 0.12 },
    );

    this.heading("ĐIỀU 5: QUYỀN LỢI VÀ NGHĨA VỤ CỦA NGƯỜI LAO ĐỘNG");
    subheading("A. QUYỀN LỢI");
    numbered([
      "Phương tiện đi lại: Cá nhân tự túc.",
      "Cấp phát những dụng cụ làm việc gồm: Theo tính chất và phân công công việc.",
      "Chế độ nghỉ ngơi: Nghỉ ngơi theo lịch làm việc tại Văn phòng.",
      "Chế độ đào tạo: Được Công ty đào tạo nâng cao năng lực chuyên môn và kỹ năng công việc. Ngoài ra, do yêu cầu của công việc người lao động phải hoàn thành các khóa học theo sự điều động của cấp trên.",
      "Chế độ thưởng: Ngoài lương và phụ cấp, người lao động sẽ được thưởng theo quy định của pháp luật lao động và Nội quy Công ty.",
    ]);
    subheading("6. Nghỉ việc:");
    this.text(
      "Người lao động có quyền đơn phương chấm dứt hợp đồng và được coi là không vi phạm hợp đồng thử việc khi:",
      { gap: 0.12 },
    );
    paragraphs([
      "6.1. Người lao động nghỉ việc thuộc một trong những trường hợp được quy định theo Luật Lao động hiện hành.",
      "6.2. Có đơn xin thôi việc trước ít nhất 03 - 05 ngày làm việc kể từ ngày nộp đơn gửi lên cấp trên để Công ty có kế hoạch tìm nhân sự thay thế.",
      "6.3. Người lao động có trách nhiệm thanh quyết toán các khoản tài chính có liên quan, bàn giao trang thiết bị, dụng cụ, công việc được giao cho Công ty trước khi chấm dứt hợp đồng.",
    ]);
    subheading("B. NGHĨA VỤ");
    numbered([
      "Thực hiện công việc với trách nhiệm và đảm bảo hiệu quả.",
      "Tuân thủ các quy định bảo mật thông tin, kỷ luật lao động và văn hóa Công ty.",
      "Chấp hành mọi điều động công việc của Công ty.",
    ]);
    this.text(
      "Trong vòng 7 ngày làm việc, kể từ ngày ký kết Hợp đồng này, người lao động phải nộp đầy đủ Hồ sơ Nhân sự, gồm:",
      { gap: 0.12 },
    );
    bullets([
      "Sơ yếu lý lịch (có công chứng);",
      "Chứng minh thư nhân dân/căn cước công dân/Hộ chiếu hoặc các giấy tờ chứng minh nhân thân có giá trị tương đương (có công chứng);",
      "Bằng cấp (có công chứng);",
      "Giấy khám sức khỏe (bản chính).",
    ]);
    this.text(
      `Người lao động buộc phải đọc toàn bộ Nội quy Công ty và tuân thủ theo Nội quy đó. Mọi hành vi vi phạm nội quy sẽ được xử lý theo quy định và không được lấy lý do là không biết đến quy định trong Nội quy lao động của ${companyName}.`,
      { gap: 0.12 },
    );

    this.heading("ĐIỀU 6: NGHĨA VỤ VÀ QUYỀN HẠN CỦA NGƯỜI SỬ DỤNG LAO ĐỘNG");
    subheading("A. NGHĨA VỤ");
    numbered([
      "Bảo đảm việc làm và thực hiện đầy đủ những điều khoản trong hợp đồng.",
      "Thanh toán đầy đủ, đúng thời hạn các chế độ và quyền lợi cho người lao động theo hợp đồng này.",
      "Trong trường hợp chậm thanh toán các chế độ và quyền lợi cho người lao động theo hợp đồng này thì người sử dụng lao động phải có nghĩa vụ trả lãi của khoản tiền chậm thanh toán. Lãi suất chi trả theo lãi suất Ngân hàng Nhà nước Việt Nam.",
      "Thực hiện hướng dẫn, đào tạo cho người lao động về quy chế, quy định của Công ty.",
    ]);
    subheading("B. QUYỀN HẠN");
    numbered([
      "Điều hành người lao động hoàn thành công việc theo Hợp đồng (bố trí, điều chuyển, tạm ngừng việc).",
      "Tạm hoãn, chấm dứt hợp đồng thử việc, kỷ luật người lao động theo quy định của pháp luật lao động hiện hành và nội quy lao động, thỏa ước lao động tập thể (nếu có) của Công ty.",
      "Có quyền khiếu nại và đòi người lao động bồi thường khi người lao động vi phạm các điều đã cam kết trong hợp đồng này.",
      "Có quyền được đơn phương chấm dứt hợp đồng thử việc nếu người lao động vi phạm nghiêm trọng các nội quy, quy định của Công ty và làm ảnh hưởng đến tài sản, uy tín của Công ty.",
    ]);

    this.heading("ĐIỀU 7: CHẤM DỨT HỢP ĐỒNG");
    this.text("Các Bên thỏa thuận các trường hợp chấm dứt Hợp đồng như sau:", {
      gap: 0.12,
    });
    numbered([
      "Một bên có hành vi vi phạm các điều khoản cơ bản của Hợp đồng và không khắc phục vi phạm trong thời hạn kể từ ngày nhận được thông báo yêu cầu khắc phục bằng văn bản của Bên bị vi phạm. Thời hạn quy định do các bên thỏa thuận, nếu không thỏa thuận được thì thời hạn quy định là 03 ngày.",
      "Theo thỏa thuận giữa các Bên.",
      "Các Bên hoàn thành trách nhiệm của mình và không có thỏa thuận khác.",
      "Một bên đơn phương chấm dứt Hợp đồng trước thời hạn quy định tại Điều 5 của Hợp đồng.",
    ]);

    this.heading("ĐIỀU 8: GIẢI QUYẾT TRANH CHẤP");
    numbered([
      "Những vấn đề lao động khác không ghi trong hợp đồng này thì áp dụng theo quy định của quy chế và nội quy lao động của Công ty, cũng như pháp luật Lao động Việt Nam và có hiệu lực thi hành tại thời điểm ký hợp đồng lao động này.",
      "Trong quá trình thực hiện hợp đồng nếu có tình huống phát sinh, các bên giải quyết trên cơ sở thương lượng và hòa giải.",
      "Trong trường hợp không thể hòa giải được thì vụ việc sẽ tiến hành giải quyết tại Tòa án nhân dân có thẩm quyền tại Thành phố Hồ Chí Minh.",
    ]);

    this.heading("ĐIỀU 9: ĐIỀU KHOẢN THI HÀNH");
    numbered([
      "Những vấn đề về lao động không ghi trong hợp đồng này thì áp dụng quy định của nội quy, quy chế quản lý nội bộ của Công ty và Bộ luật Lao động.",
      "Khi hợp đồng này được ký kết sẽ chấm dứt toàn bộ hiệu lực của các Hợp đồng và Phụ lục Hợp đồng đã được hai bên ký trước đó.",
      "Hợp đồng này gồm 04 trang, được lập thành 02 (hai) bản có giá trị pháp lý như nhau, mỗi bên giữ 01 (một) bản để thực hiện và có hiệu lực kể từ ngày ký.",
      "Khi hết thời hạn hợp đồng, nếu Công ty không có nhu cầu tiếp tục sử dụng người lao động thì hợp đồng thử việc này tự động hết hiệu lực và được thanh lý.",
    ]);
    this.signatureArea(
      owner,
      { ownerName: person.fullName },
      {
        leftTitle: "NGƯỜI SỬ DỤNG LAO ĐỘNG",
        rightTitle: "NGƯỜI LAO ĐỘNG",
        leftHint: "(Ký, ghi rõ họ tên, đóng dấu)",
        rightHint: "(Ký, ghi rõ họ và tên)",
      },
    );
  }

  renderLivestreamResponsibilityCommitment(contract) {
    const owner = contract.ownerCompanyInfo || {};
    const person = contract.contractData?.personalInfo || {};
    const renderedAt = new Date();

    this.centered("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", 14, 0.1, true);
    this.centered("Độc lập – Tự do – Hạnh phúc", 12, 0.8, true);

    this.centered(
      "BẢN CAM KẾT TRÁCH NHIỆM VÀ XÁC NHẬN TUÂN THỦ",
      14,
      0.1,
      true,
    );
    this.centered("QUY ĐỊNH HOẠT ĐỘNG LIVESTREAM", 14, 0.7, true);

    [
      "Căn cứ Bộ luật Lao động số 45/2019/QH14 và các văn bản hướng dẫn thi hành;",
      "Căn cứ Luật Thương mại điện tử có hiệu lực từ ngày 01/07/2026;",
      "Căn cứ Luật Quảng cáo và các văn bản hướng dẫn thi hành;",
      "Căn cứ quy định của pháp luật về quản lý mỹ phẩm;",
      "Căn cứ Nội quy lao động và các quy định nội bộ của Công ty TNHH PICARE VIỆT NAM.",
    ].forEach((line) => this.bullet(line));

    // this.text(
    //   `Hôm nay, ${formatLongVietnameseDate(renderedAt)}, tại văn phòng Công ty, chúng tôi gồm:`,
    //   { gap: 0.3 },
    // );
    this.text(
      `BÊN A: ${(owner.companyName || "CTY TNHH PICARE VIỆT NAM").toUpperCase()} (Sau đây gọi là “Công ty”)`,
      { bold: true },
    );
    this.labelValue("Tên công ty: ", owner.companyName);
    this.labelValue("Mã số thuế: ", owner.mst);
    this.labelValue("Địa chỉ: ", owner.address);
    this.labelValue(
      "Người đại diện: ",
      `${getOwnerName(owner)}${owner.role ? ` – ${owner.role}` : ""}`,
    );
    this.text("BÊN B: NGƯỜI LAO ĐỘNG/NHÂN VIÊN LIVESTREAM (Người cam kết)", {
      bold: true,
    });
    this.labelValue("Họ tên: ", person.fullName);
    this.labelValue("Sinh ngày: ", person.dateOfBirth);
    this.labelValue(
      "Chức vụ: ",
      `${person.position}    Phòng ban: ${person.department}`,
    );
    this.labelValue("Thường trú: ", person.permanentAddress);
    this.labelValue(
      "Số CCCD: ",
      `${person.citizenId}    cấp ngày: ${person.citizenIdIssuedDate}    tại: ${person.citizenIdIssuedPlace}`,
      { gap: 0.3 },
    );
    this.text(
      "Bên B tự nguyện lập và ký bản cam kết này với Bên A nhằm đảm bảo tính tuân thủ pháp luật và bảo vệ hình ảnh thương hiệu của Công ty TNHH Picare Việt Nam trong quá trình thực hiện Livestream bán hàng, cụ thể như sau:",
      { gap: 0.25 },
    );

    const sections = [
      [
        "ĐIỀU 1: PHẠM VI VÀ NỘI DUNG PHÁT NGÔN VỀ SẢN PHẨM",
        [
          "Tuân thủ đúng hồ sơ công bố: Bên B cam kết chỉ giới thiệu, tư vấn và mô tả công dụng của mỹ phẩm đúng 100% theo tài liệu, kịch bản, và phiếu công bố sản phẩm do Bên A cung cấp.",
          'Không sử dụng ngôn từ cấm: Tuyệt đối KHÔNG sử dụng bất kỳ từ ngữ, hình ảnh, âm thanh, ký hiệu hoặc cách diễn đạt nào có thể làm cho khách hàng hiểu hoặc có khả năng hiểu mỹ phẩm là thuốc hoặc có tác dụng điều trị bệnh. Cụ thể, không dùng các từ: "Đặc trị", "Trị dứt điểm", "Cam kết khỏi bệnh 100%", "Thuốc", "Chữa bệnh", "Thần dược" hoặc các từ ngữ có tính chất thổi phồng công dụng thực tế của sản phẩm.',
          "Không tự ý sáng tạo công dụng: Không tự ý thêm thắt các công dụng, thành phần, hoặc tính năng của sản phẩm mà chưa được sự phê duyệt bằng văn bản từ Bộ phận Chuyên môn/Quản lý của Bên A.",
        ],
      ],
      [
        "ĐIỀU 2: CHUẨN MỰC NGÔN TỪ VÀ HÀNH VI TRÊN NỀN TẢNG",
        [
          "Văn hóa ứng xử: Sử dụng ngôn từ lịch sự, văn minh. Tuyệt đối không chửi thề, nói bậy, dùng từ ngữ thô tục, mang tính nhục mạ, phân biệt vùng miền, giới tính, tôn giáo hoặc vi phạm thuần phong mỹ tục của Việt Nam.",
          "Tuân thủ tiêu chuẩn cộng đồng: Đảm bảo tuân thủ tuyệt đối các chính sách, quy định của các nền tảng Livestream (TikTok, Shopee, Facebook...). Không có các hành vi hở hang, bạo lực, hoặc xúi giục vi phạm pháp luật.",
          "Cạnh tranh lành mạnh: Không nhắc tên, không bôi nhọ, chê bai, hoặc so sánh trực tiếp mang tính dìm hàng các thương hiệu, sản phẩm, và công ty đối thủ cạnh tranh dưới mọi hình thức. Không tự ý thay đổi giá bán, voucher, chương trình khuyến mại, xuất xứ, nguồn gốc, chính sách đổi trả, chính sách bảo hành khi chưa được Công ty phê duyệt.",
        ],
      ],
      [
        "ĐIỀU 3: XỬ LÝ VI PHẠM VÀ TRÁCH NHIỆM BỒI THƯỜNG",
        [
          "Bên B hiểu rõ và đồng ý rằng, mọi phát ngôn của Bên B trên Livestream đều đại diện cho hình ảnh của Bên A. Nếu Bên B vi phạm các cam kết tại Điều 1 và Điều 2 dẫn đến hậu quả, Bên B sẽ phải chịu các hình thức xử lý sau:",
          "Chịu trách nhiệm trước Pháp luật và Nền tảng: Bên B phải chịu trách nhiệm cá nhân đối với các án phạt hành chính từ Cơ quan quản lý Nhà nước (Quản lý thị trường, Sở Y tế, Bộ TT&TT) hoặc các hình phạt từ Nền tảng.",
          "Đền bù thiệt hại cho Bên A: Nếu sự vi phạm của Bên B dẫn đến việc Kênh Livestream/Tài khoản mạng xã hội của Bên A bị khóa, bóp tương tác, đánh gậy vi phạm hoặc khóa vĩnh viễn, Bên B có trách nhiệm bồi thường toàn bộ thiệt hại về doanh thu và chi phí xây dựng kênh (Mức bồi thường sẽ được tính toán thực tế tại thời điểm xảy ra sự việc).",
          "Bồi thường 100% các khoản tiền phạt mà Bên A phải nộp cho Cơ quan nhà nước do lỗi phát ngôn sai sự thật của Bên B gây ra.",
          "Trong trường hợp vi phạm, dù Công ty có xác định được thiệt hại hay vì lý do khách quan Công ty chưa đánh giá được mức độ thiệt hại và sự ảnh hưởng đến quyền lợi hợp pháp của Công ty thì tùy theo mức độ vi phạm, Nhân viên sẽ bị xử lý kỷ luật lao động đến mức cao nhất là sa thải theo quy định của Bộ luật Lao động và Nội quy lao động của Công ty và phải có trách nhiệm bồi thường toàn bộ thiệt hại do mình gây ra cho công ty theo quy định của pháp luật.",
        ],
      ],
      [
        "ĐIỀU 4: ĐIỀU KHOẢN CHUNG",
        [
          "Bên B đã đọc và hiểu rõ những nội dung trong cam kết này, sẽ không thắc mắc, khiếu nại về sau.",
          "Cam kết này thay thế cho tất cả những trao đổi, đồng ý bằng miệng và những thông báo bằng văn bản trước đây liên quan đến chủ đề này.",
          "Cam kết này có hiệu lực kể từ ngày ký và trong suốt quá trình làm việc của Nhân viên tại Công ty. Các nghĩa vụ về bảo mật thông tin, bí mật kinh doanh, bí mật công nghệ và trách nhiệm bồi thường thiệt hại (nếu có) vẫn được thực hiện theo quy định của pháp luật và các thỏa thuận giữa hai bên sau khi chấm dứt hợp đồng lao động.",
          "Cam kết được lập thành 2 (hai) bản có giá trị pháp lý như nhau. Mỗi bên giữ 1 (một) bản.",
        ],
      ],
    ];
    sections.forEach(([title, paragraphs]) => {
      this.heading(title);
      paragraphs.forEach((paragraph) => this.bullet(paragraph));
    });

    this.signatureArea(
      owner,
      { ownerName: person.fullName },
      {
        ownerSide: "right",
        leftTitle: "NGƯỜI CAM KẾT",
        rightTitle: "ĐẠI DIỆN CÔNG TY",
        leftHint: "(Ký, ghi rõ họ và tên)",
        rightHint: "(Ký, đóng dấu, ghi rõ họ và tên)",
      },
    );
  }

  renderLivestreamResponsibilityCommitmentAppendix(contract) {
    const owner = contract.ownerCompanyInfo || {};
    const parentContractCode =
      contract.contractData?.parentContractCode || "N/A";
    const renderedAt = new Date();
    const items = (values) =>
      values.forEach((value) => this.text(`• ${value}`, { indent: 12 }));
    const paragraphs = (values) =>
      values.forEach((value) => this.text(value, { gap: 0.15 }));

    this.centered("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", 14, 0.1, true);
    this.centered("Độc lập – Tự do – Hạnh phúc", 12, 0.8, true);

    this.centered("PHỤ LỤC BẢN CAM KẾT TRÁCH NHIỆM VÀ XÁC NHẬN", 14, 0.1, true);
    this.centered("TUÂN THỦ QUY ĐỊNH HOẠT ĐỘNG LIVESTREAM", 14, 0.2, true);
    this.centered(
      `(Phụ lục này là văn bản không thể tách rời của Bản cam kết trách nhiệm (${parentContractCode}) và xác nhận tuân thủ quy định hoạt động Livestream)`,
      9,
      0.6,
    );

    this.heading("I. Nguyên tắc áp dụng");
    paragraphs([
      "Danh mục này quy định các từ khóa, cụm từ và nội dung không được sử dụng khi Livestream, quay video, đăng bài viết, trả lời bình luận, nhắn tin với khách hàng hoặc thực hiện bất kỳ hoạt động truyền thông nào dưới danh nghĩa Công ty.",
      "Danh mục này được xây dựng trên cơ sở quy định của pháp luật Việt Nam, các quy định chuyên ngành về quảng cáo, mỹ phẩm, thương mại điện tử, chính sách của các nền tảng mạng xã hội và quy định nội bộ của Công ty.",
      "Danh mục này mang tính chất hướng dẫn tuân thủ và không giới hạn trách nhiệm của Nhân viên đối với các hành vi vi phạm pháp luật hoặc vi phạm quy định nội bộ chưa được liệt kê trong Phụ lục này.",
      "Danh mục dưới đây bao gồm nhưng không giới hạn các từ khóa được liệt kê. Mọi cách diễn đạt khác có ý nghĩa tương tự hoặc làm khách hàng hiểu theo nội dung bị cấm đều được xem là hành vi vi phạm.",
    ]);

    this.heading("II. Nhóm từ cấm về điều trị bệnh");
    this.text("Không được sử dụng các từ sau:");
    items([
      "Đặc trị",
      "Điều trị",
      "Trị tận gốc",
      "Trị dứt điểm",
      "Chữa bệnh",
      "Chữa khỏi",
      "Khỏi hoàn toàn",
      "Khỏi 100%",
      "Cam kết khỏi",
      "Điều trị tận gốc",
      "Hết bệnh",
      "Hết hoàn toàn",
      "Tiêu diệt bệnh",
      "Thuốc",
      "Thần dược",
      "Thần kỳ",
      "Điều trị y khoa",
      "Điều trị chuyên sâu",
      "Hiệu quả tức thì",
      "Hiệu quả vĩnh viễn",
    ]);

    this.heading("III. Nhóm từ cấm về cam kết hiệu quả");
    this.text("Không được phát ngôn:");
    items([
      "Cam kết 100%",
      "Hiệu quả 100%",
      "Đảm bảo khỏi",
      "Đảm bảo hết",
      "Chắc chắn khỏi",
      "Bao khỏi",
      "Bao đẹp",
      "Không hiệu quả hoàn tiền",
      "Không đẹp hoàn tiền",
      "Cam kết tuyệt đối",
      "Bảo đảm tuyệt đối",
      "Tốt nhất Việt Nam",
      "Số 1 Việt Nam",
      "Số 1 thế giới",
      "Duy nhất",
      "Không có đối thủ",
    ]);

    this.heading("IV. Nhóm từ cấm về công dụng mỹ phẩm");
    this.text("Không được phát biểu:");
    items([
      "Thay thế thuốc",
      "Thay thế điều trị",
      "Chữa nám",
      "Trị nám",
      "Trị mụn",
      "Trị viêm",
      "Trị sẹo",
      "Trị dị ứng",
      "Trị chàm",
      "Trị vảy nến",
      "Trị nấm",
      "Trị thâm vĩnh viễn",
      "Xóa nám hoàn toàn",
      "Xóa sẹo hoàn toàn",
      "Kích thích mọc tóc",
      "Điều trị rụng tóc",
    ]);

    this.heading("V. Nhóm từ cấm về thời gian");
    this.text("Không được nói:");
    items([
      "Sau 1 lần",
      "Sau 1 ngày",
      "Sau 3 ngày",
      "Sau 7 ngày khỏi",
      "Sau 14 ngày hết",
      "Sau 30 ngày hết hoàn toàn",
      "Nhanh nhất",
      "Nhanh thần tốc",
      "Tức thì",
      "Ngay lập tức",
      "Hiệu quả ngay",
    ]);

    this.heading("VI. Nhóm từ cấm về nguồn gốc");
    this.text("Không được:");
    items([
      "Hàng xách tay",
      "Hàng nội bộ",
      "Hàng độc quyền (khi chưa có căn cứ chứng minh)",
      "Nhập khẩu chính ngạch (khi chưa được xác nhận)",
      "Chuẩn Châu Âu",
      "Được Bộ Y tế cấp phép (nếu không có tài liệu chứng minh)",
      "Được Bộ Y tế chứng nhận (nếu không đúng)",
      "Được bác sĩ khuyên dùng (nếu không có tài liệu chứng minh)",
    ]);

    this.heading("VII. Nhóm từ cấm về giá bán");
    this.text(
      "Không được tự ý công bố, thay đổi hoặc cam kết với khách hàng các nội dung sau khi chưa được Công ty phê duyệt:",
    );
    items([
      "Giá rẻ nhất",
      "Rẻ nhất thị trường",
      "Rẻ nhất Việt Nam",
      "Không nơi nào rẻ hơn",
      "Giá gốc",
      "Giá vốn",
      "Giá nội bộ",
      "Giá nhân viên",
      "Xả kho",
      "Thanh lý",
      "Lỗ vốn",
    ]);

    this.heading("VIII. Nhóm từ cấm về đối thủ cạnh tranh");
    this.text("Không được tự ý nói:");
    items([
      "Nhắc tên đối thủ",
      "So sánh trực tiếp",
      "Chê bai thương hiệu khác",
      "Chê bai sản phẩm khác",
      "Đưa thông tin chưa được kiểm chứng",
      "Gây hiểu lầm về đối thủ",
    ]);

    this.heading("IX. Nhóm nội dung cấm khác");
    this.text("Không được:");
    items([
      "Tiết lộ doanh thu",
      "Tiết lộ KPI",
      "Tiết lộ giá vốn",
      "Tiết lộ chính sách chiết khấu",
      "Tiết lộ dữ liệu khách hàng",
      "Tiết lộ dữ liệu Affiliate",
      "Tiết lộ dữ liệu KOC",
      "Tiết lộ kế hoạch Marketing",
      "Tiết lộ thông tin nội bộ",
      "Công bố thông tin chưa được phép",
    ]);

    this.heading("X. Quy định áp dụng");
    paragraphs([
      "Nhân viên xác nhận đã được Công ty phổ biến và hướng dẫn đầy đủ Danh mục từ khóa cấm (Blacklist Keywords) này.",
      "Nhân viên cam kết tuân thủ tuyệt đối trong toàn bộ quá trình thực hiện Livestream, quay video, đăng bài, trả lời bình luận, tin nhắn và các hoạt động truyền thông khác dưới danh nghĩa Công ty.",
      "Danh mục này là Phụ lục không tách rời của Bản cam kết trách nhiệm và có giá trị áp dụng như Bản cam kết.",
      "Trong trường hợp pháp luật, chính sách của nền tảng thương mại điện tử, mạng xã hội hoặc quy định nội bộ của Công ty có sự thay đổi, Công ty có quyền sửa đổi, bổ sung Danh mục Blacklist Keywords mà không phải ký lại Bản cam kết này. Việc cập nhật sẽ được thông báo cho Nhân viên bằng văn bản, email, hệ thống quản lý nội bộ hoặc hình thức phù hợp khác. Kể từ thời điểm thông báo, Nhân viên có trách nhiệm nghiên cứu và tuân thủ đầy đủ các nội dung được cập nhật.",
    ]);

    this.signatureArea(
      owner,
      {},
      {
        ownerSide: "right",
        leftTitle: "NGƯỜI CAM KẾT",
        rightTitle: "ĐẠI DIỆN CÔNG TY",
        leftHint: " ",
        rightHint: " ",
      },
    );
  }

  renderPrincipleContract(contract, details) {
    const owner = contract.ownerCompanyInfo || {};
    const partner = contract.partnerCompanyInfo || {};
    const renderedAt = new Date();

    this.centered("CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM", 14, 0.1, true);
    this.centered("Độc lập - Tự do - Hạnh phúc", 12, 1.2, true);

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
    // this.text(
    //   `Hôm nay, ngày ${formatShortDate(
    //     renderedAt,
    //   )} tại văn phòng công ty chúng tôi gồm có:`,
    //   { gap: 0.35, bold: true },
    // );

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

  renderAppendixContract(contract, details = []) {
    const owner = contract.ownerCompanyInfo || {};
    const partner = contract.partnerCompanyInfo || {};
    const contractData = contract.contractData || {};
    const renderedAt = new Date();
    const principleContractNumber =
      contractData.principleContractNumber || "08/2026/HĐNT/MOCELUX-PICARE";
    const products = this.collectAppendixProducts(contract, details);

    this.centered("CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM", 14, 0.1, true);
    this.centered("Độc lập - Tự do - Hạnh phúc", 12, 1.2, true);

    this.centered("PHỤ LỤC HỢP ĐỒNG", 14, 0.25, true);
    this.centered(
      `Đính kèm Hợp đồng nguyên tắc số: ${principleContractNumber}`,
      10,
      0.8,
      true,
    );

    // this.text(
    //   `Hôm nay, ngày ${formatShortDate(
    //     renderedAt,
    //   )} tại văn phòng công ty chúng tôi gồm có:`,
    //   { gap: 0.35, bold: true },
    // );

    this.companyBlock("CÔNG TY BÁN ( Bên A)", owner, "Bên A");
    this.companyBlock("CÔNG TY MUA ( Bên B)", partner, "Bên B");

    this.text("Hai bên đồng ý ký kết Phụ lục với các điều khoản sau:", {
      gap: 0.25,
    });
    this.text(
      "Bảng giá: Bên B được hưởng các chính sách, chương trình hợp tác theo bảng liệt kê chi tiết (Giá và các chính sách, chương trình hợp tác đã bao gồm thuế GTGT). Mức chiết khấu này sẽ là căn cứ để Bên A xuất hóa đơn GTGT cho Bên B khi xuất bán hàng hóa. Khi bảng giá thay đổi đã được hai Bên thống nhất qua thư điện tử (email). Bên A cung cấp cho Bên B bảng giá mới trước 30 (ba mươi) ngày trước khi áp dụng.",
      { gap: 0.25 },
    );
    this.text(
      "Lưu ý: Thuế suất thuế GTGT của sản phẩm sẽ thay đổi tùy từng thời điểm. phù hợp theo quy định của pháp luật hiện hành.",
      { gap: 0.35 },
    );

    this.appendixProductTable(products);

    this.signatureArea(owner, partner);
  }

  renderGenericContract(contract, details = []) {
    const owner = contract.ownerCompanyInfo || {};
    const partner = contract.partnerCompanyInfo || {};
    const contractData = contract.contractData || {};
    const title =
      contractData.title ||
      contractData.contractTitle ||
      `HOP DONG ${asText(contract.contractType).toUpperCase()}`;

    this.centered("CONG HOA XA HOI CHU NGHIA VIET NAM", 14, 0.1, true);
    this.centered("Doc lap - Tu do - Hanh phuc", 12, 1.2, true);
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
    ContractTypeRegistry.renderPdf(this, contract, details);
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

    page.drawText("DIGITAL SIGNATURE CONFIRMATION", {
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
      "ky_so",
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
      throw new Error(ErrorCodes.PDF_BYTE_RANGE_MISSING.message);
    }

    const byteRangeEnd = buffer.indexOf("]", byteRangeStart);
    const placeholder = buffer
      .slice(byteRangeStart, byteRangeEnd + 1)
      .toString();
    const contentsTag = "/Contents ";
    const contentsStart = buffer.indexOf(contentsTag, byteRangeEnd);

    if (contentsStart < 0) {
      throw new Error(ErrorCodes.PDF_CONTENTS_MISSING.message);
    }

    const hexStart = buffer.indexOf("<", contentsStart);
    const hexEnd = buffer.indexOf(">", hexStart);

    if (hexStart < 0 || hexEnd < 0) {
      throw new Error(ErrorCodes.PDF_CONTENTS_HEX_INVALID.message);
    }

    const byteRange = [0, hexStart, hexEnd + 1, buffer.length - hexEnd - 1];
    const replacement = `/ByteRange [${byteRange.join(" ")}]`;

    if (replacement.length > placeholder.length) {
      throw new Error(ErrorCodes.PDF_BYTE_RANGE_TOO_LONG.message);
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
      `(?:^|\\r?\\n)${objectNumber}\\s+0\\s+obj\\s*([\\s\\S]*?)\\s*endobj`,
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

  static getPageObjectNumberAtIndex(sourceBytes, objectMatches, pageIndex) {
    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      return null;
    }

    const objectNumbers = [
      ...new Set(objectMatches.map((match) => Number(match[1]))),
    ];
    const pageObjectNumbers = objectNumbers.filter((objectNumber) => {
      const body = this.getPdfObjectBody(sourceBytes, objectNumber);
      return /\/Type\s*\/Page\b/.test(body || "");
    });

    return pageObjectNumbers[pageIndex] || null;
  }

  static async appendIncrementalSignaturePlaceholder({
    sourceBytes,
    contract,
    signerName,
    signerType,
    widgetRect,
    pageIndex,
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
      throw new Error(ErrorCodes.PDF_INCREMENTAL_STRUCTURE_UNSUPPORTED.message);
    }

    if (!widgetMatches.length || !acroFormMatch) {
      throw new Error(ErrorCodes.PDF_SIGNATURE_FORM_MISSING.message);
    }

    const maxObjectNumber = Math.max(
      ...objectMatches.map((match) => Number(match[1])),
    );
    const rootObjectNumber = Number(rootMatch[1]);
    const prevStartXref = Number(startXrefMatch[1]);
    const acroFormObjectNumber = Number(acroFormMatch[1]);
    const pageObjectNumber =
      this.getPageObjectNumberAtIndex(sourceBytes, objectMatches, pageIndex) ||
      Number(widgetMatches[widgetMatches.length - 1][2]);
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
      throw new Error(ErrorCodes.PDF_PAGE_OR_ACROFORM_MISSING.message);
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
/Reason (Contract ${escapePdfString(signerType || "digital")} signature)
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
          pageIndex: signatureWidget?.pageIndex,
          signatureLength,
          signingTime,
        },
      );
      const { byteRange, preparedBuffer, contentsHexStart, contentsHexEnd } =
        this.buildByteRange(Buffer.from(placeholderBytes));
      const hashToSign = this.hashByteRange(preparedBuffer, byteRange);
      const fileName = buildContractArtifactFileName(
        contract,
        null,
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
      reason: `Contract ${signerType || "digital"} signature`,
      contactInfo: "",
      name: normalizeVietnameseText(signerName),
      location: "Vietnam",
      signingTime,
      signatureLength,
      byteRangePlaceholder: BYTE_RANGE_PLACEHOLDER,
      appName: "Contract Hub",
      widgetRect,
    });

    const placeholderBytes = await pdfDoc.save({ useObjectStreams: false });
    const { byteRange, preparedBuffer, contentsHexStart, contentsHexEnd } =
      this.buildByteRange(Buffer.from(placeholderBytes));
    const hashToSign = this.hashByteRange(preparedBuffer, byteRange);
    const fileName = buildContractArtifactFileName(
      contract,
      null,
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
      throw new Error(ErrorCodes.PDF_SIGNATURE_HEX_INVALID.message);
    }

    if (cleanSignatureHex.length > placeholderLength) {
      throw new Error(
        ErrorCodes.PDF_SIGNATURE_HEX_TOO_LONG(
          cleanSignatureHex.length,
          placeholderLength,
        ).message,
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

  static async appendIncrementalHandwrittenSignature({
    sourceBytes,
    signerName,
    signerType,
    widgetRect,
    pageIndex,
    signatureImageBuffer,
    signingTime,
  }) {
    const sourceBuffer = Buffer.isBuffer(sourceBytes)
      ? sourceBytes
      : Buffer.from(sourceBytes || []);
    const sourceText = sourceBuffer.toString("latin1");
    const rootMatch = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(sourceText);
    const startXrefMatch = /startxref\s+(\d+)\s+%%EOF\s*$/s.exec(sourceText);
    const objectMatches = [...sourceText.matchAll(/(\d+)\s+0\s+obj/g)];
    const widgetMatches = [
      ...sourceText.matchAll(
        /(\d+)\s+0\s+obj\s*<<[\s\S]*?\/Subtype\s*\/Widget[\s\S]*?\/FT\s*\/Sig[\s\S]*?\/P\s+(\d+)\s+0\s+R[\s\S]*?endobj/g,
      ),
    ];

    if (!rootMatch || !startXrefMatch || objectMatches.length === 0) {
      throw new Error(ErrorCodes.PDF_HANDWRITTEN_STRUCTURE_UNSUPPORTED.message);
    }

    if (!widgetMatches.length) {
      throw new Error(ErrorCodes.PDF_SIGNATURE_PAGE_MISSING.message);
    }

    const maxObjectNumber = Math.max(
      ...objectMatches.map((match) => Number(match[1])),
    );
    const rootObjectNumber = Number(rootMatch[1]);
    const prevStartXref = Number(startXrefMatch[1]);
    const pageObjectNumber =
      this.getPageObjectNumberAtIndex(sourceBuffer, objectMatches, pageIndex) ||
      Number(widgetMatches[widgetMatches.length - 1][2]);
    const annotationObjectNumber = maxObjectNumber + 1;
    const appearanceObjectNumber = maxObjectNumber + 2;
    const imageObjectNumber = maxObjectNumber + 3;
    const pageBody = this.getPdfObjectBody(sourceBuffer, pageObjectNumber);

    if (!pageBody) {
      throw new Error(ErrorCodes.PDF_PAGE_OBJECT_MISSING.message);
    }

    const resolvedWidgetRect = widgetRect || getSignatureWidgetRect(signerType);
    const widgetWidth = resolvedWidgetRect[2] - resolvedWidgetRect[0];
    const widgetHeight = resolvedWidgetRect[3] - resolvedWidgetRect[1];
    const appearanceImage = await createHandwrittenSignatureAppearanceImage({
      width: widgetWidth,
      height: widgetHeight,
      signatureImageBuffer,
      signingTime,
    });
    const updatedPageBody = this.replaceOrAppendArrayItem(
      pageBody,
      "Annots",
      `${annotationObjectNumber} 0 R`,
    );
    const annotationObject = `<<
/Type /Annot
/Subtype /Stamp
/Rect [${resolvedWidgetRect.join(" ")}]
/Name /Approved
/F 4
/P ${pageObjectNumber} 0 R
/AP << /N ${appearanceObjectNumber} 0 R >>
/T (${escapePdfString(signerName || signerType || "handwritten")})
/M (${formatPdfDate(signingTime)})
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
      [annotationObjectNumber, annotationObject],
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
      offsets.push([objectNumber, sourceBuffer.length + currentLength]);
      chunks.push(Buffer.from(`${objectNumber} 0 obj\n`, "latin1"));
      chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"));
      chunks.push(Buffer.from("\nendobj\n", "latin1"));
    }

    const incrementalBody = Buffer.concat(chunks);
    const xrefOffset = sourceBuffer.length + incrementalBody.length;
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
      sourceBuffer,
      incrementalBody,
      Buffer.from(trailer, "latin1"),
    ]);
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
    const isIncrementalAppend = inputBytes.includes(
      Buffer.from("/ByteRange ["),
    );
    const signingTime = new Date();

    if (isIncrementalAppend) {
      const { signatureWidgets } = await this.generateContractPdfBuffer(
        contract,
        details,
      );
      const signatureWidget = signatureWidgets?.[signerType];
      const signedBuffer = await this.appendIncrementalHandwrittenSignature({
        sourceBytes: inputBytes,
        signerName,
        signerType,
        widgetRect: signatureWidget?.rect,
        pageIndex: signatureWidget?.pageIndex,
        signatureImageBuffer,
        signingTime,
      });
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
        widgetRect: signatureWidget?.rect || getSignatureWidgetRect(signerType),
      };
    }

    const pdfDoc = await PDFLibDocument.load(inputBytes);
    const pages = pdfDoc.getPages();
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
        prepareHandwrittenSignatureImage(signatureImageBuffer).then((image) =>
          embedImageByMimeType(pdfDoc, image, "image/png"),
        ),
      ]);

    drawHandwrittenSignatureAppearance(targetPage, widgetRect, {
      image: signatureImage,
      font: appearanceFont,
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
