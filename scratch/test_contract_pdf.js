const ContractService = require("../src/services/contract.service");
const { sequelize } = require("../src/models");

const payload = {
  ownerCompanyInfo: {
    companyCode: "TH",
    companyName: "CTY TNHH DƯỢC PHẨM TRUNG HẠNH",
    address: "2/35 Chấn Hưng, Phường Tân Hòa, Thành Phố Hồ Chí Minh",
    phone: "0983139320",
    email: "cskh@trunghanh.com",
    bankInfo: "204550429 Ngân hàng Á Châu – Chi Nhánh Bắc Hải TP HCM",
    mst: "0319999999",
    ownerName: "Bà Lê Thị Bích Hạnh",
    role: "Giám Đốc",
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
  contractType: "digital",
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
  const result = await ContractService.createContractTemplate(payload);

  console.log("Contract record created:");
  console.log({
    contractId: result.contract.contractId,
    contractNumber: result.contract.contractNumber,
    contractChecksum: result.contract.contractChecksum,
    contractType: result.contract.contractType,
    contractUrl: result.contract.contractUrl,
    previewUrl: result.previewUrl,
    detailsCount: result.contract.details.length,
  });
  console.log("pdfHashHex:");
  console.log(result.pdfHashHex);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
