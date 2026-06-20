const { normalizeContractInput } = require("../common/contract-input.normalizer");

function getInputValue(input, field) {
  return input?.[field] ?? input?.contractData?.[field];
}

module.exports = {
  type: "principle",
  aliases: ["default", "digital"],
  canonicalizeAliases: true,
  documentCode: "HDNT",
  filePrefix: "hop_dong_nguyen_tac",

  normalizeInput(input) {
    return normalizeContractInput(input, input.contractType);
  },

  validateInput(input) {
    const ownerCompanyInfo = getInputValue(input, "ownerCompanyInfo");
    const partnerCompanyInfo = getInputValue(input, "partnerCompanyInfo");

    if (!ownerCompanyInfo || typeof ownerCompanyInfo !== "object") {
      throw new Error(
        "ownerCompanyInfo là bắt buộc với hợp đồng nguyên tắc",
      );
    }

    if (!ownerCompanyInfo.companyCode) {
      throw new Error(
        "ownerCompanyInfo.companyCode là bắt buộc để tạo số hợp đồng",
      );
    }

    if (!partnerCompanyInfo || typeof partnerCompanyInfo !== "object") {
      throw new Error(
        "partnerCompanyInfo là bắt buộc với hợp đồng nguyên tắc",
      );
    }

    return true;
  },

  renderPdf(builder, contract, details) {
    builder.renderPrincipleContract(contract, details);
  },
};
