const { normalizeContractInput } = require("../common/contract-input.normalizer");

function toIdentifier(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function createGenericContractType(type) {
  const identifier = toIdentifier(type) || "contract";

  return {
    type,
    aliases: [],
    documentCode: identifier.toUpperCase() || "HD",
    filePrefix: `hop_dong_${identifier}`,

    normalizeInput(input) {
      return normalizeContractInput(input, type);
    },

    validateInput() {
      return true;
    },

    renderPdf(builder, contract, details) {
      builder.renderGenericContract(contract, details);
    },
  };
}

module.exports = { createGenericContractType };
