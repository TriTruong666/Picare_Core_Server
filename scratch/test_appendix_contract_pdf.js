const fs = require("fs/promises");
const path = require("path");
const ContractPdfService = require("../src/services/contract_pdf.service");

const products = [
  {
    productName: "Mocelux Collagen 10.000mg",
    ingredients: "Collagen peptide, Vitamin C, chiết xuất lựu đỏ",
    packageSpecification: "Hộp 30 gói x 10ml",
    registrationNumber: "1234/2026/ĐKSP",
    origin: "Việt Nam",
    unitPriceVat: 350000,
    classification: "Thực phẩm bảo vệ sức khỏe",
  },
  {
    productName: "Mocelux Omega Plus",
    ingredients: "Dầu cá tinh luyện, DHA, EPA, Vitamin E",
    packageSpecification: "Hộp 3 vỉ x 10 viên",
    registrationNumber: "5678/2026/ĐKSP",
    origin: "Hàn Quốc",
    unitPriceVat: 420000,
    classification: "Thực phẩm bổ sung",
  },
  {
    productName: "Mocelux Beauty Drink",
    ingredients: "Glutathione, L-Cystine, Vitamin nhóm B, kẽm gluconate",
    packageSpecification: "Thùng 24 chai x 50ml",
    registrationNumber: "9012/2026/ĐKSP",
    origin: "Nhật Bản",
    unitPriceVat: 580000,
    classification: "Đồ uống dinh dưỡng",
  },
];

const productRichTexts = products.map(
  (product) => `
    <p>Tên sản phẩm: ${product.productName}</p>
    <p>Thành phần: ${product.ingredients}</p>
    <p>Quy cách đóng gói: ${product.packageSpecification}</p>
    <p>Số đăng ký: ${product.registrationNumber}</p>
    <p>Nước sản xuất: ${product.origin}</p>
    <p>Đơn giá(+VAT): ${product.unitPriceVat}</p>
    <p>Phân loại: ${product.classification}</p>
  `,
);

const mockContract = {
  contractId: "mock-appendix-contract",
  contractNumber: "001/06/2026/PLHP/PIC",
  contractType: "appendix",
  ownerCompanyInfo: {
    companyCode: "PIC",
    companyName: "CÔNG TY CỔ PHẦN PICARE VIỆT NAM",
    address: "123 Nguyễn Trãi, Phường Bến Thành, TP. Hồ Chí Minh",
    phone: "0900000000",
    email: "contract@picare.vn",
    bankInfo: "0123456789 - Vietcombank Chi nhánh Sài Gòn",
    mst: "0312345678",
    ownerName: "Nguyễn Văn A",
    role: "Giám đốc",
  },
  partnerCompanyInfo: {
    companyName: "CÔNG TY TNHH MOCELUX",
    address: "456 Lê Lợi, Phường Bến Nghé, TP. Hồ Chí Minh",
    phone: "0911111111",
    email: "purchase@mocelux.vn",
    bankInfo: "9876543210 - ACB Chi nhánh TP.HCM",
    mst: "0398765432",
    ownerName: "Trần Văn B",
    role: "Giám đốc",
  },
  contractData: {
    principleContractNumber: "08/2026/HĐNT/MOCELUX-PICARE",
    products: productRichTexts,
  },
};

async function main() {
  const { pdfBuffer, pdfHashHex, fileName } =
    await ContractPdfService.generateContractPdfBuffer(mockContract, []);
  const outputPath = path.resolve(
    __dirname,
    "..",
    "preview-phu-luc-hop-dong-mock-v2.pdf",
  );

  await fs.writeFile(outputPath, pdfBuffer);

  console.table(products);
  console.log({
    outputPath,
    fileName,
    pdfHashHex,
    productCount: products.length,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
