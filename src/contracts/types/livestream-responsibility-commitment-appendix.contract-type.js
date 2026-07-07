const { normalizeContractInput } = require("../common/contract-input.normalizer");

module.exports = {
  type: "livestream_responsibility_commitment_appendix",
  aliases: [
    "phu_luc_cam_ket_trach_nhiem_livestream",
    "livestream_commitment_appendix",
  ],
  canonicalizeAliases: true,
  documentCode: "PLCKTNLIVESTREAM",
  filePrefix: "phu_luc_cam_ket_trach_nhiem_livestream",

  normalizeInput(input) {
    const normalized = normalizeContractInput(input, input.contractType);
    const sourceData = input.contractData || {};

    return {
      ...normalized,
      partnerCompanyInfo: null,
      contractData: {
        ...normalized.contractData,
        partnerCompanyInfo: null,
        personalInfo: input.personalInfo ?? sourceData.personalInfo ?? null,
      },
    };
  },

  validateInput(input) {
    const ownerCompanyInfo =
      input.ownerCompanyInfo ?? input.contractData?.ownerCompanyInfo;
    const personalInfo = input.personalInfo ?? input.contractData?.personalInfo;

    if (!ownerCompanyInfo || typeof ownerCompanyInfo !== "object") {
      throw new Error(
        "ownerCompanyInfo là bắt buộc với phụ lục cam kết trách nhiệm livestream",
      );
    }
    if (!ownerCompanyInfo.companyCode) {
      throw new Error("ownerCompanyInfo.companyCode là bắt buộc để tạo số phụ lục");
    }
    if (!personalInfo || typeof personalInfo !== "object") {
      throw new Error(
        "personalInfo là bắt buộc để lưu record phụ lục cam kết trách nhiệm livestream",
      );
    }

    return true;
  },

  renderPdf(builder, contract) {
    builder.renderLivestreamResponsibilityCommitmentAppendix(contract);
  },
};
