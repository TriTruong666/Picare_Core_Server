const {
  normalizeContractInput,
} = require("../common/contract-input.normalizer");

const REQUIRED_OWNER_FIELDS = [
  "companyCode",
  "companyName",
  "address",
  "mst",
  "ownerName",
];

const SALARY_FIELDS = [
  "baseSalary",
  "mealAllowance",
  "phoneUniformAllowance",
  "performanceBonus",
  "transportationAllowance",
  "totalSalary",
];

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function getInputValue(input, field) {
  if (Object.prototype.hasOwnProperty.call(input || {}, field)) {
    return input[field];
  }

  return input?.contractData?.[field];
}

module.exports = {
  type: "employment_contract_appendix",
  aliases: [
    "labor_contract_appendix",
    "employment_appendix",
    "phu_luc_hop_dong_lao_dong",
  ],
  canonicalizeAliases: true,
  documentCode: "PLHĐLĐ",
  filePrefix: "phu_luc_hop_dong_lao_dong",

  normalizeInput(input) {
    const normalized = normalizeContractInput(input, input.contractType);
    const personalInfo =
      input.personalInfo ?? input.contractData?.personalInfo ?? null;

    return {
      ...normalized,
      partnerCompanyInfo: null,
      contractData: {
        ...normalized.contractData,
        partnerCompanyInfo: null,
        parentContractId: getInputValue(input, "parentContractId") ?? null,
        employmentContractNumber:
          getInputValue(input, "employmentContractNumber") ?? null,
        personalInfo,
        contractDate: getInputValue(input, "contractDate") ?? null,
        ...Object.fromEntries(
          SALARY_FIELDS.map((field) => [
            field,
            getInputValue(input, field) ?? null,
          ]),
        ),
      },
    };
  },

  validateInput(input) {
    const parentContractId = getInputValue(input, "parentContractId");
    const ownerCompanyInfo = getInputValue(input, "ownerCompanyInfo");
    const personalInfo =
      input.personalInfo ?? input.contractData?.personalInfo ?? null;

    if (!hasValue(parentContractId)) {
      throw new Error(
        "parentContractId là bắt buộc với phụ lục hợp đồng lao động",
      );
    }

    // Lần validate đầu diễn ra trước khi service nạp dữ liệu HĐLĐ gốc.
    if (!ownerCompanyInfo || !personalInfo) return true;

    const missingOwnerField = REQUIRED_OWNER_FIELDS.find(
      (field) => !hasValue(ownerCompanyInfo[field]),
    );
    if (missingOwnerField) {
      throw new Error(`ownerCompanyInfo.${missingOwnerField} là bắt buộc`);
    }

    for (const field of ["fullName", "email"]) {
      if (!hasValue(personalInfo[field])) {
        throw new Error(`personalInfo.${field} là bắt buộc`);
      }
    }

    return true;
  },

  renderPdf(builder, contract) {
    builder.renderEmploymentContractAppendix(contract);
  },
};
