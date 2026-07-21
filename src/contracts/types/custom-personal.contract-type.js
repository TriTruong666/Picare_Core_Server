const { normalizeContractInput } = require("../common/contract-input.normalizer");

const REQUIRED_PERSONAL_FIELDS = [
  "fullName",
  "dateOfBirth",
  "position",
  "department",
  "permanentAddress",
  "citizenId",
  "citizenIdIssuedDate",
  "citizenIdIssuedPlace",
];

function getInputValue(input, field) {
  return input?.[field] ?? input?.contractData?.[field];
}

module.exports = {
  type: "custom_personal",
  aliases: ["custom_individual", "custom_employee", "hop_dong_tuy_chinh_ca_nhan"],
  canonicalizeAliases: true,
  documentCode: "HDTCCN",
  filePrefix: "hop_dong_tuy_chinh_ca_nhan",

  normalizeInput(input) {
    const normalized = normalizeContractInput(input, input.contractType);
    const personalInfo = getInputValue(input, "personalInfo");

    return {
      ...normalized,
      partnerCompanyInfo: null,
      contractData: {
        ...normalized.contractData,
        partnerCompanyInfo: null,
        personalInfo: personalInfo ?? null,
        title: getInputValue(input, "title") ?? null,
        subTitle: getInputValue(input, "subTitle") ?? null,
        rawContent: getInputValue(input, "rawContent") ?? null,
      },
    };
  },

  validateInput(input) {
    const ownerCompanyInfo = getInputValue(input, "ownerCompanyInfo");
    const personalInfo = getInputValue(input, "personalInfo");

    if (!ownerCompanyInfo || typeof ownerCompanyInfo !== "object") {
      throw new Error("ownerCompanyInfo là bắt buộc với hợp đồng tuỳ chỉnh cá nhân");
    }
    if (!ownerCompanyInfo.companyCode) {
      throw new Error("ownerCompanyInfo.companyCode là bắt buộc để tạo số hợp đồng");
    }
    if (!personalInfo || typeof personalInfo !== "object" || Array.isArray(personalInfo)) {
      throw new Error("personalInfo là bắt buộc với hợp đồng tuỳ chỉnh cá nhân");
    }
    const missingField = REQUIRED_PERSONAL_FIELDS.find((field) => !personalInfo[field]);
    if (missingField) {
      throw new Error(`personalInfo.${missingField} là bắt buộc`);
    }
    ["title", "subTitle", "rawContent"].forEach((field) => {
      if (!getInputValue(input, field)?.trim()) {
        throw new Error(`${field} là bắt buộc với hợp đồng tuỳ chỉnh cá nhân`);
      }
    });
    return true;
  },

  renderPdf(builder, contract) {
    builder.renderCustomContract(contract, { partyType: "personal" });
  },
};
