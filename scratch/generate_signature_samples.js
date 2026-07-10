const fs = require("fs/promises");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const sharp = require("sharp");

const OUTPUT_PATH = path.join(__dirname, "signature-samples.pdf");

function drawFrame(page, x, y, width, height) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.45, 0.45, 0.45),
    borderWidth: 0.8,
  });
}

function drawTitle(page, boldFont, title, subtitle) {
  page.drawText(title, {
    x: 56,
    y: 760,
    size: 20,
    font: boldFont,
    color: rgb(0.06, 0.17, 0.29),
  });
  page.drawText(subtitle, {
    x: 56,
    y: 735,
    size: 10,
    color: rgb(0.28, 0.32, 0.36),
  });
}

function drawDigitalSignature(page, font, boldFont) {
  drawTitle(
    page,
    boldFont,
    "Digital Signature Sample",
    "Visual representation of a certificate-backed contract signature",
  );
  page.drawText("CONTRACT APPROVAL", {
    x: 56,
    y: 650,
    size: 16,
    font: boldFont,
  });
  page.drawText("This page demonstrates the appearance used for a digital signature.", {
    x: 56,
    y: 625,
    size: 10,
    font,
  });

  const x = 330;
  const y = 210;
  const width = 210;
  const height = 120;
  drawFrame(page, x, y, width, height);
  page.drawText("DIGITALLY SIGNED", {
    x: x + 43,
    y: y + 91,
    size: 14,
    font: boldFont,
    color: rgb(0.0, 0.31, 0.18),
  });
  page.drawText("Signer: Nguyen Van A", { x: x + 14, y: y + 67, size: 9, font });
  page.drawText("Certificate: Example CA", { x: x + 14, y: y + 51, size: 9, font });
  page.drawText("Time: 2026-07-10 10:30 ICT", {
    x: x + 14,
    y: y + 35,
    size: 9,
    font,
  });
  page.drawText("Integrity verified", {
    x: x + 14,
    y: y + 17,
    size: 8,
    font: boldFont,
    color: rgb(0.0, 0.31, 0.18),
  });
}

async function drawHandwrittenSignature(page, font, boldFont, pdfDoc) {
  drawTitle(
    page,
    boldFont,
    "Handwritten Signature Sample",
    "Signature image is cropped and centered inside the contract signing box",
  );
  page.drawText("PARTNER CONFIRMATION", {
    x: 56,
    y: 650,
    size: 16,
    font: boldFont,
  });
  page.drawText("This page demonstrates the handwritten signature placement.", {
    x: 56,
    y: 625,
    size: 10,
    font,
  });

  const x = 330;
  const y = 210;
  const width = 210;
  const height = 120;
  drawFrame(page, x, y, width, height);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="180">
    <path d="M40 120 C95 30 115 150 170 85 S255 135 300 75 S375 135 455 60 S540 130 650 78" fill="none" stroke="#172554" stroke-width="12" stroke-linecap="round"/>
    <path d="M505 115 C555 150 600 142 660 118" fill="none" stroke="#172554" stroke-width="7" stroke-linecap="round"/>
  </svg>`;
  const signature = await pdfDoc.embedPng(
    await sharp(Buffer.from(svg)).png().toBuffer(),
  );
  page.drawImage(signature, {
    x: x + 16,
    y: y + 30,
    width: width - 32,
    height: 54,
  });
  page.drawText("Handwritten at: 2026-07-10 10:30 ICT", {
    x: x + 23,
    y: y + 13,
    size: 8,
    font,
    color: rgb(0.25, 0.25, 0.25),
  });
}

async function main() {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const digitalPage = pdfDoc.addPage([595, 842]);
  const handwrittenPage = pdfDoc.addPage([595, 842]);

  drawDigitalSignature(digitalPage, font, boldFont);
  await drawHandwrittenSignature(handwrittenPage, font, boldFont, pdfDoc);

  await fs.writeFile(OUTPUT_PATH, await pdfDoc.save());
  console.log(OUTPUT_PATH);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
