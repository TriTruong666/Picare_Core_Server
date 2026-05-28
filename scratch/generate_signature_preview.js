const fs = require("fs/promises");
const path = require("path");

const ContractPdfService = require("../src/services/contract_pdf.service");

const contract = {
  contractId: "preview",
  contractNumber: "HD-PREVIEW-2026",
  ownerCompanyInfo: {
    companyName: "CTY TNHH DUOC PHAM TRUNG HANH",
    address: "2/35 Chan Hung, Phuong Tan Hoa, Thanh Pho Ho Chi Minh",
    mst: "03127117755",
    ownerName: "Le Thi Bich Hanh",
  },
  partnerCompanyInfo: {},
};

async function main() {
  const preview = await ContractPdfService.generateDigitalSignaturePreview({
    contract,
    signerType: "owner",
    signerName: contract.ownerCompanyInfo.ownerName,
    signingTime: new Date("2026-05-27T10:11:59.000Z"),
    width: 370,
    height: 165,
  });

  const outputPath = path.join(__dirname, "signature-preview.jpg");
  await fs.writeFile(outputPath, preview.buffer);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
