const { normalizeContractInput } = require("../common/contract-input.normalizer");

function getInputValue(input, field) {
  return input?.[field] ?? input?.contractData?.[field];
}

module.exports = {
  type: "custom_organization",
  aliases: ["custom_org", "custom_company", "hop_dong_tuy_chinh_to_chuc"],
  canonicalizeAliases: true,
  documentCode: "HDTCTC",
  filePrefix: "hop_dong_tuy_chinh_to_chuc",

  normalizeInput(input) {
    const normalized = normalizeContractInput(input, input.contractType);

    return {
      ...normalized,
      contractData: {
        ...normalized.contractData,
        title: getInputValue(input, "title") ?? null,
        subTitle: getInputValue(input, "subTitle") ?? null,
        rawContent: getInputValue(input, "rawContent") ?? null,
      },
    };
  },

  validateInput(input) {
    const ownerCompanyInfo = getInputValue(input, "ownerCompanyInfo");
    const partnerCompanyInfo = getInputValue(input, "partnerCompanyInfo");

    if (!ownerCompanyInfo || typeof ownerCompanyInfo !== "object") {
      throw new Error("ownerCompanyInfo là bắt buộc với hợp đồng tuỳ chỉnh tổ chức");
    }
    if (!ownerCompanyInfo.companyCode) {
      throw new Error("ownerCompanyInfo.companyCode là bắt buộc để tạo số hợp đồng");
    }
    if (!partnerCompanyInfo || typeof partnerCompanyInfo !== "object") {
      throw new Error("partnerCompanyInfo là bắt buộc với hợp đồng tuỳ chỉnh tổ chức");
    }

    ["title", "subTitle", "rawContent"].forEach((field) => {
      if (!getInputValue(input, field)?.trim()) {
        throw new Error(`${field} là bắt buộc với hợp đồng tuỳ chỉnh tổ chức`);
      }
    });
    return true;
  },

  renderPdf(builder, contract) {
    builder.renderCustomContract(contract, { partyType: "organization" });
  },
};
