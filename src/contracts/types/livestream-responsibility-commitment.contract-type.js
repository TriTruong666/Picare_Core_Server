const { normalizeContractInput } = require("../common/contract-input.normalizer");

const REQUIRED_PERSONAL_FIELDS = [
  ["fullName", "Tên"],
  ["dateOfBirth", "Sinh ngày"],
  ["position", "Chức vụ"],
  ["department", "Phòng ban"],
  ["permanentAddress", "Thường trú"],
  ["citizenId", "Số CCCD"],
  ["citizenIdIssuedDate", "Ngày cấp CCCD"],
  ["citizenIdIssuedPlace", "Nơi cấp CCCD"],
];

function getPersonalInfo(input = {}) {
  return input.personalInfo ?? input.contractData?.personalInfo;
}

module.exports = {
  type: "livestream_responsibility_commitment",
  aliases: ["cam_ket_trach_nhiem_livestream", "livestream_commitment"],
  canonicalizeAliases: true,
  documentCode: "CKTNLIVESTREAM",
  filePrefix: "cam_ket_trach_nhiem_livestream",

  normalizeInput(input) {
    const normalized = normalizeContractInput(input, input.contractType);

    return {
      ...normalized,
      partnerCompanyInfo: null,
      contractData: {
        ...normalized.contractData,
        partnerCompanyInfo: null,
        personalInfo: getPersonalInfo(input) ?? null,
      },
    };
  },

  validateInput(input) {
    const ownerCompanyInfo = input.ownerCompanyInfo ?? input.contractData?.ownerCompanyInfo;
    if (!ownerCompanyInfo || typeof ownerCompanyInfo !== "object") {
      throw new Error("ownerCompanyInfo là bắt buộc với cam kết trách nhiệm livestream");
    }
    if (!ownerCompanyInfo.companyCode) {
      throw new Error("ownerCompanyInfo.companyCode là bắt buộc để tạo số cam kết");
    }

    const personalInfo = getPersonalInfo(input);
    if (!personalInfo || typeof personalInfo !== "object" || Array.isArray(personalInfo)) {
      throw new Error("personalInfo là bắt buộc với cam kết trách nhiệm livestream");
    }

    const missingField = REQUIRED_PERSONAL_FIELDS.find(([key]) => !personalInfo[key]);
    if (missingField) {
      throw new Error(`personalInfo.${missingField[0]} (${missingField[1]}) là bắt buộc`);
    }

    return true;
  },

  renderPdf(builder, contract) {
    builder.renderLivestreamResponsibilityCommitment(contract);
  },
};
