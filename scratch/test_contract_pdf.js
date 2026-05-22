const crypto = require("crypto");
const ContractPdfService = require("../src/services/contract_pdf.service");

const payload = {
  contractNumber: "88/05/2026/TEST",
  ownerCompanyInfo: {
    companyCode: "TEST",
    companyName: "CÔNG TY TNHH KIỂM THỬ API PICARE",
    address: "99 Đường Số 7, Phường An Phú, Thành Phố Thủ Đức, TP Hồ Chí Minh",
    phone: "0909000111",
    email: "legal@test-picare.vn",
    bankInfo: "123456789 Ngân hàng TestBank - Chi nhánh Thủ Đức",
    mst: "0319999999",
    ownerName: "Ông Nguyễn Văn Kiểm",
    role: "Tổng giám đốc",
  },
  partnerCompanyInfo: {
    companyName: "CÔNG TY CỔ PHẦN NHÀ THUỐC MINH AN",
    address: "15 Nguyễn Trãi, Phường Bến Thành, Quận 1, TP Hồ Chí Minh",
    phone: "02839998888",
    email: "purchase@minhan-pharma.vn",
    bankInfo: "987654321 Ngân hàng VietTest - Chi nhánh Sài Gòn",
    mst: "0308888888",
    ownerName: "Bà Trần Thị Minh An",
    role: "Giám đốc mua hàng",
  },
  contractDueDate: "2028-06-30",
  details: [
    {
      productName: "Gel rửa tay khô Picare SafeClean 500ml",
      price: 125000,
    },
    {
      productName: "Dung dịch sát khuẩn bề mặt MediShield 1L",
      price: 189000,
    },
    {
      productName: "Khẩu trang y tế 4 lớp HealthMask Pro hộp 50 cái",
      price: 72000,
    },
    {
      productName: "Viên bổ sung vitamin C Zinc Plus lọ 60 viên",
      price: 145500,
    },
  ],
};

async function main() {
  const contract = {
    contractId: crypto.randomUUID(),
    contractNumber: payload.contractNumber,
    createdAt: new Date("2026-05-22T09:15:00+07:00"),
    contractDueDate: new Date(payload.contractDueDate),
    ownerCompanyInfo: payload.ownerCompanyInfo,
    partnerCompanyInfo: payload.partnerCompanyInfo,
  };

  const result = await ContractPdfService.generateContractPdf(
    contract,
    payload.details
  );

  console.log("PDF generated:");
  console.log(result.filePath);
  console.log("pdfHashHex:");
  console.log(result.pdfHashHex);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
