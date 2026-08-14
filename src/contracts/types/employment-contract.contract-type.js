const { normalizeContractInput } = require("../common/contract-input.normalizer");

const REQUIRED_OWNER_FIELDS = [
  "companyCode",
  "companyName",
  "address",
  "mst",
  "ownerName",
];

const REQUIRED_PERSONAL_FIELDS = [
  "fullName",
  "email",
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

function getPersonalInfo(input) {
  return input.personalInfo ?? input.contractData?.personalInfo;
}

module.exports = {
  type: "employment_contract",
  aliases: ["labor_contract", "employment", "hop_dong_lao_dong"],
  canonicalizeAliases: true,
  documentCode: "HĐLĐ",
  filePrefix: "hop_dong_lao_dong",
  normalizeInput(input) {
    const normalized = normalizeContractInput(input, input.contractType);
    const personalInfo = getPersonalInfo(input);

    return {
      ...normalized,
      partnerCompanyInfo: null,
      contractData: {
        ...normalized.contractData,
        partnerCompanyInfo: null,
        personalInfo: personalInfo
          ? {
              ...personalInfo,
              taxCode: personalInfo.taxCode ?? null,
              socialInsuranceNumber:
                personalInfo.socialInsuranceNumber ?? null,
              emergencyContact: personalInfo.emergencyContact ?? null,
            }
          : null,
        contractDate: getInputValue(input, "contractDate") ?? null,
        contractTerm: getInputValue(input, "contractTerm") ?? null,
        startDate: getInputValue(input, "startDate") ?? null,
        workLocation: getInputValue(input, "workLocation") ?? null,
        baseSalary: getInputValue(input, "baseSalary") ?? null,
        salaryInWords: getInputValue(input, "salaryInWords") ?? null,
        mealAllowance: getInputValue(input, "mealAllowance") ?? null,
        phoneUniformAllowance:
          getInputValue(input, "phoneUniformAllowance") ?? null,
        performanceBonus: getInputValue(input, "performanceBonus") ?? null,
        transportationAllowance:
          getInputValue(input, "transportationAllowance") ?? null,
        totalSalary: getInputValue(input, "totalSalary") ?? null,
      },
    };
  },

  validateInput(input) {
    const ownerCompanyInfo = getInputValue(input, "ownerCompanyInfo");
    const personalInfo = getPersonalInfo(input);

    if (!ownerCompanyInfo || typeof ownerCompanyInfo !== "object") {
      throw new Error(
        "ownerCompanyInfo là bắt buộc với hợp đồng lao động",
      );
    }

    const missingOwnerField = REQUIRED_OWNER_FIELDS.find(
      (field) => !hasValue(ownerCompanyInfo[field]),
    );
    if (missingOwnerField) {
      throw new Error(`ownerCompanyInfo.${missingOwnerField} là bắt buộc`);
    }
    if (
      !personalInfo ||
      typeof personalInfo !== "object" ||
      Array.isArray(personalInfo)
    ) {
      throw new Error(
        "personalInfo là bắt buộc với hợp đồng lao động",
      );
    }

    const missingPersonalField = REQUIRED_PERSONAL_FIELDS.find(
      (field) => !hasValue(personalInfo[field]),
    );
    if (missingPersonalField) {
      throw new Error(`personalInfo.${missingPersonalField} là bắt buộc`);
    }

    return true;
  },

  renderPdf(builder, contract) {
    builder.renderEmploymentContract(contract);
  },
};
