const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const fontkit = require("@pdf-lib/fontkit");
const PDFDocument = require("pdfkit");
const { PDFDocument: PDFLibDocument, StandardFonts, rgb } = require("pdf-lib");
const { pdflibAddPlaceholder } = require("@signpdf/placeholder-pdf-lib");
const sharp = require("sharp");
const PICARE_WATERMARK_LOGO_PATH = path.join(
  __dirname,
  "..",
  "..",
  "picare_logo_light.svg",
);

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
let picareWatermarkLogoDataUriPromise;
const DEFAULT_SIGNATURE_LENGTH = Number(
  process.env.PDF_SIGNATURE_PLACEHOLDER_LENGTH || 16384,
);
const BYTE_RANGE_PLACEHOLDER = "**********";
const SIGNATURE_WIDGET_RECTS = {
  owner: [85, 120, 235, 205],
  partner: [360, 120, 510, 205],
  default: [85, 120, 235, 205],
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
  const addressLine = `Địa chỉ: ${formatOptionalText(companyInfo.address)}`;
  const timeLine = `Thời gian: ${formatVietnameseDateTime(signingTime)}`;

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

async function getPicareWatermarkLogoDataUri() {
  if (!picareWatermarkLogoDataUriPromise) {
    picareWatermarkLogoDataUriPromise = fs
      .readFile(PICARE_WATERMARK_LOGO_PATH, "utf8")
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
      });
  }

  return picareWatermarkLogoDataUriPromise;
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
  const logoDataUri = await getPicareWatermarkLogoDataUri();
  const watermarkWidth = Math.max(24, width - 6);
  const watermarkHeight = Math.max(24, height * 2.2);
  const watermarkX = (width - watermarkWidth) / 2;
  const watermarkY = (height - watermarkHeight) / 2 + 8;
  const borderInset = 1.2;
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
  <rect x="${borderInset}" y="${borderInset}" width="${width - borderInset * 2}" height="${height - borderInset * 2}" fill="none" stroke="#00995d" stroke-width="1.2"/>
  <image href="${logoDataUri}" x="${watermarkX}" y="${watermarkY}" width="${watermarkWidth}" height="${watermarkHeight}" opacity="0.2" preserveAspectRatio="none"/>
  <text x="${width / 2}" y="${height * 0.22}" text-anchor="middle" font-family="Times New Roman, serif" font-size="12.2" font-weight="700" fill="#0b5b41">${escapeXml(companyName)}</text>
  <text x="${width / 2}" y="${height * 0.45}" text-anchor="middle" font-family="Times New Roman, serif" font-size="10.2" fill="#111111">${escapeXml(identityLine)}</text>
  <text x="${width / 2}" y="${height * 0.63}" text-anchor="middle" font-family="Times New Roman, serif" font-size="8.8" fill="#111111">${escapeXml(addressLine)}</text>
  <text x="${width / 2}" y="${height * 0.81}" text-anchor="middle" font-family="Times New Roman, serif" font-size="8.4" fill="#111111">${escapeXml(timeLine)}</text>
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
    this.text(`${title}: ${asText(companyInfo.companyName).toUpperCase()}`);
    this.text(`Địa chỉ : ${formatOptionalText(companyInfo.address)}`);
    this.text(`Điện thoại : ${formatOptionalText(companyInfo.phone)}`);

    if (companyInfo.email) {
      this.text(`Email : ${companyInfo.email}`);
    }

    this.text(`Tài khoản số : ${formatOptionalText(companyInfo.bankInfo)}`);
    this.text(`Mã số thuế : ${formatOptionalText(companyInfo.mst)}`);
    this.text(
      `Đại diện là Ông/Bà : ${getOwnerName(companyInfo)}    Chức vụ: ${
        companyInfo.role
      }`,
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
        detail.productName,
        formatMoney(detail.price),
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

  render(contract, details) {
    const owner = contract.ownerCompanyInfo || {};
    const partner = contract.partnerCompanyInfo || {};
    const createdAt = contract.createdAt || new Date();

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
    this.rightBlock(`Hôm nay, ${formatLongVietnameseDate(createdAt)}`, {
      size: 10,
      bold: true,
      gap: 0.8,
    });
    this.doc.x = this.doc.page.margins.left;
    this.centered("HỢP ĐỒNG NGUYÊN TẮC", 14, 0.1, true);
    this.centered(`Số ${contract.contractNumber}`, 10, 0.1, true);
    this.centered("(Về việc: Bán hàng)", 10, 0.8);

    this.bullet(
      "Căn cứ Bộ Luật Dân sự số 33/2005/QH ngày 14/06/2005 của Quốc hội nước CHXHCN Việt Nam;",
    );
    this.bullet(
      "Căn cứ Luật Thương Mại số 36/2005/QH ngày 14/06/2005 của Quốc hội nước CHXHCN Việt Nam;",
    );
    this.bullet("Căn cứ vào khả năng và nhu cầu của hai bên.");
    this.text(
      `Hôm nay, ngày ${formatShortDate(
        createdAt,
      )} tại văn phòng công ty chúng tôi gồm có:`,
      { gap: 0.35, bold: true },
    );

    this.companyBlock("CÔNG TY BÁN ( Bên A)", owner, "Bên A");
    this.companyBlock("CÔNG TY MUA ( Bên B)", partner, "Bên B");

    this.text(
      "Hai bên cùng tiến hành thương lượng và nhất trí ký hợp đồng nguyên tắc bán hàng về việc bán các sản phẩm mà Bên A phân phối theo các điều khoản như sau:",
      { gap: 0.35 },
    );

    this.heading("ĐIỀU 1: NGUYÊN TẮC MUA BÁN");
    this.bullet(
      "Bên A đồng ý bán cho Bên B các loại sản phẩm do Bên A đăng ký, sản xuất để bên B phân phối sản phẩm ra thị trường, cụ thể như sau:",
    );
    this.table(details);
    this.bullet(
      "Số lượng sản phẩm: Được quy định chi tiết tại từng đơn đặt hàng của bên B. Số lượng hàng giao cho phép dao động ± 5% so với số lượng đặt hàng.",
    );

    this.heading("ĐIỀU 2: QUY CÁCH, CHẤT LƯỢNG HÀNG HÓA");
    this.bullet(
      "Quy cách, chất lượng hàng hóa dựa trên tiêu chuẩn đã được đăng ký tại Sở Y Tế trực thuộc Bộ Y Tế.",
    );
    this.bullet(
      "Bên B chịu trách nhiệm bảo quản, tiêu thụ đúng quy định của Sở Y Tế trực thuộc Bộ Y Tế.",
    );
    this.bullet(
      "Bên A chịu trách nhiệm về chất lượng của sản phẩm theo quy chế hiện hành của Sở Y Tế trực thuộc Bộ Y Tế.",
    );

    this.heading("ĐIỀU 3: TRÁCH NHIỆM VÀ QUYỀN LỢI CỦA CÁC BÊN");
    this.text("1. Trách nhiệm của Bên A:");
    this.bullet(
      "Cung cấp hàng theo đúng số lượng sản phẩm mà Bên B đã đặt hàng, theo đúng tiêu chuẩn đã đăng ký.",
    );
    this.bullet(
      "Thời gian giao hàng chậm nhất không quá 03 ngày làm việc tính từ thời điểm nhận được đơn hàng.",
    );
    this.bullet(
      "Giao hàng tại kho Bên B trong 1 địa điểm tại nội thành Thành Phố Hồ Chí Minh, chi phí bốc xếp đầu bên nào bên đó chịu.",
    );
    this.bullet(
      "Sản phẩm giao cho bên B bị hỏng do lỗi sản xuất thì bên A phải giao bù cho bên B số hàng lỗi.",
    );
    this.text("2. Trách nhiệm của Bên B:");
    this.bullet(
      "Có đơn đặt hàng trước ít nhất 08 ngày làm việc khi có nhu cầu về sản phẩm.",
    );
    this.bullet("Kinh doanh sản phẩm theo quy định của Pháp luật hiện hành.");
    this.bullet("Cam kết không được phép bán ra các khu vực khác.");
    this.bullet("Thanh toán theo đúng điều 5 của hợp đồng này.");
    this.bullet(
      "Mọi khiếu nại của Bên B về hàng hóa phải có chứng kiến và xác nhận của Bên A thì mới có giá trị khiếu nại.",
    );

    this.heading("ĐIỀU 4: KHIẾU NẠI VÀ GIẢI QUYẾT KHIẾU NẠI HÀNG HÓA");
    this.bullet(
      "Bên B có trách nhiệm kiểm tra kỹ số lượng, quy cách, chất lượng hàng hóa khi giao nhận. Nếu có bất cứ khiếu nại nào phải có văn bản thông báo cho Bên A.",
    );
    this.bullet(
      "Thời gian khiếu nại hàng sai lệch về số lượng không quá 5 ngày, về chất lượng không quá 30 ngày kể từ ngày nhập hàng về kho bên B.",
    );
    this.bullet(
      "Trong vòng 30 ngày kể từ khi nhận được công văn khiếu nại, bên A có trách nhiệm trả lời cho bên B.",
    );

    this.heading("ĐIỀU 5: GIÁ CẢ VÀ PHƯƠNG THỨC THANH TOÁN");
    this.text("1. Giá cả:");
    this.text(
      "Giá bán được thể hiện trực tiếp trong hợp đồng và được hai bên cùng xác nhận. Bảng giá, đơn đặt hàng là một phần không tách rời của hợp đồng này.",
    );
    this.text("2. Phương thức thanh toán:");
    this.bullet("Thanh toán bằng chuyển khoản trong vòng 30 ngày.");
    this.bullet(
      "Các trường hợp đặc biệt khác phải có sự thỏa thuận của hai bên.",
    );

    this.heading("ĐIỀU 6: ĐIỀU KHOẢN CHUNG");
    this.bullet(
      "Hai bên cùng cam kết thực hiện hợp đồng nguyên tắc này, nếu có khó khăn hai bên phải gặp nhau trao đổi tìm cách giải quyết.",
    );
    this.bullet(
      "Trường hợp hai bên không giải quyết được bằng thương lượng sẽ đưa ra Tòa án kinh tế Hà Nội. Mọi phí tổn sẽ do bên sai phạm chịu.",
    );
    this.bullet(
      "Sau khi Hợp đồng hết hiệu lực 30 ngày; nếu hai bên không có tranh chấp hoặc khiếu nại thì Hợp đồng này mặc nhiên được thanh lý.",
    );
    this.bullet(
      `Hợp đồng nguyên tắc này được lập thành 04 bản có giá trị pháp lý ngang nhau, mỗi bên giữ 02 bản. Hợp đồng có hiệu lực kể từ ngày kí đến ngày ${formatShortDate(
        contract.contractDueDate,
      )}. Sau đó hợp đồng được kí lại hoặc gia hạn nếu được cả hai bên cùng thống nhất.`,
    );

    this.signatureArea(owner, partner);
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
    const fileName = `hop-dong-picare-${contract.contractId}-${pdfHashHex.slice(
      0,
      12,
    )}.pdf`;

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
    const fileName = `hop-dong-picare-${
      contract.contractId
    }-signed-${signedPdfHash.slice(0, 12)}.pdf`;
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
      const fileName = `hop-dong-picare-${
        contract.contractId
      }-byte-range-${hashToSign.slice(0, 12)}.pdf`;
      return {
        preparedPdfBuffer: preparedBuffer,
        preparedPdfHash: hashToSign,
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
    const fileName = `hop-dong-picare-${
      contract.contractId
    }-byte-range-${hashToSign.slice(0, 12)}.pdf`;
    return {
      preparedPdfBuffer: preparedBuffer,
      preparedPdfHash: hashToSign,
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
      fileName: `hop-dong-picare-${
        contract.contractId
      }-ky-so-${signedPdfHash.slice(0, 12)}.pdf`,
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
      fileName: `hop-dong-picare-${
        contract.contractId
      }-ky-tay-${signedPdfHash.slice(0, 12)}.pdf`,
      widgetRect,
    };
  }
}

module.exports = ContractPdfService;
