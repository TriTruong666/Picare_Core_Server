const fs = require("fs/promises");
const path = require("path");

const ContractPdfService = require("../src/services/contract_pdf.service");

async function main() {
  const preview = await ContractPdfService.generateDigitalSignaturePreview({
    contract: {
      contractId: "preview-th",
      contractNumber: "HD-TH-2026",
      ownerCompanyInfo: {
        companyCode: "TH",
        companyName: "CTY TNHH DUOC PHAM TRUNG HANH",
        address: "2/35 Chan Hung, Phuong Tan Hoa, Thanh Pho Ho Chi Minh",
        mst: "03127117755",
        ownerName: "Nguyen Thanh Trung",
      },
      partnerCompanyInfo: {},
    },
    signerType: "owner",
    signerName: "Nguyen Thanh Trung",
    signingTime: new Date("2026-05-27T10:11:59.000Z"),
    width: 470,
    height: 165,
  });

  const outputPath = path.join(__dirname, "signature-preview-th.jpg");
  await fs.writeFile(outputPath, preview.buffer);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
