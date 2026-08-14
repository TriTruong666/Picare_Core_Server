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
  type: "probation_contract",
  aliases: ["probation", "probationary_contract", "hop_dong_thu_viec"],
  canonicalizeAliases: true,
  documentCode: "HĐTV",
  filePrefix: "hop_dong_thu_viec",

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
              socialInsuranceNumber: personalInfo.socialInsuranceNumber ?? null,
              emergencyContact: personalInfo.emergencyContact ?? null,
            }
          : null,
        contractDate: getInputValue(input, "contractDate") ?? null,
        probationStartDate: getInputValue(input, "probationStartDate") ?? null,
        probationEndDate: getInputValue(input, "probationEndDate") ?? null,
        workLocation: getInputValue(input, "workLocation") ?? null,
        probationSalary: getInputValue(input, "probationSalary") ?? null,
        performanceBonus: getInputValue(input, "performanceBonus") ?? null,
      },
    };
  },

  validateInput(input) {
    const ownerCompanyInfo = getInputValue(input, "ownerCompanyInfo");
    const personalInfo = getPersonalInfo(input);

    if (!ownerCompanyInfo || typeof ownerCompanyInfo !== "object") {
      throw new Error("ownerCompanyInfo là bắt buộc với hợp đồng thử việc");
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
      throw new Error("personalInfo là bắt buộc với hợp đồng thử việc");
    }

    for (const field of ["fullName", "email"]) {
      if (!hasValue(personalInfo[field])) {
        throw new Error(`personalInfo.${field} là bắt buộc`);
      }
    }

    const startDateValue = getInputValue(input, "probationStartDate");
    const endDateValue = getInputValue(input, "probationEndDate");
    if (hasValue(startDateValue) && hasValue(endDateValue)) {
      const startDate = new Date(`${String(startDateValue).slice(0, 10)}T00:00:00Z`);
      const endDate = new Date(`${String(endDateValue).slice(0, 10)}T00:00:00Z`);
      const durationInDays =
        (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);

      if (Number.isFinite(durationInDays) && durationInDays < 0) {
        throw new Error("probationEndDate không được trước probationStartDate");
      }
      if (Number.isFinite(durationInDays) && durationInDays > 60) {
        throw new Error("Thời hạn thử việc không được vượt quá 60 ngày");
      }
    }

    return true;
  },

  renderPdf(builder, contract) {
    builder.renderProbationContract(contract);
  },
};
