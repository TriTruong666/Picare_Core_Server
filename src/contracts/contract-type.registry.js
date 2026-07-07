const principleContractType = require("./types/principle.contract-type");
const appendixContractType = require("./types/appendix.contract-type");
const livestreamResponsibilityCommitmentContractType = require("./types/livestream-responsibility-commitment.contract-type");
const livestreamResponsibilityCommitmentAppendixContractType = require("./types/livestream-responsibility-commitment-appendix.contract-type");
const { createGenericContractType } = require("./types/generic.contract-type");
const {
  normalizeContractDataForResponse,
} = require("./common/contract-input.normalizer");
const {
  buildContractDetailRows,
} = require("./common/contract-detail.builder");

const DEFAULT_CONTRACT_TYPE = principleContractType.type;
const definitions = new Map();
const aliases = new Map();

function normalizeRawType(contractType) {
  return String(contractType || DEFAULT_CONTRACT_TYPE).trim().toLowerCase();
}

function register(definition) {
  const requiredMethods = ["normalizeInput", "validateInput", "renderPdf"];
  const hasRequiredMethods = requiredMethods.every(
    (method) => typeof definition?.[method] === "function",
  );

  if (
    !definition?.type ||
    !definition.documentCode ||
    !definition.filePrefix ||
    !hasRequiredMethods
  ) {
    throw new Error("Contract type definition không hợp lệ");
  }

  const type = normalizeRawType(definition.type);
  definitions.set(type, definition);
  aliases.set(type, type);

  for (const alias of definition.aliases || []) {
    aliases.set(normalizeRawType(alias), type);
  }
}

register(principleContractType);
register(appendixContractType);
register(livestreamResponsibilityCommitmentContractType);
register(livestreamResponsibilityCommitmentAppendixContractType);

function normalizeType(contractType) {
  const rawType = normalizeRawType(contractType);
  const canonicalType = aliases.get(rawType);
  const definition = canonicalType ? definitions.get(canonicalType) : null;

  if (definition?.canonicalizeAliases) {
    return canonicalType;
  }

  return rawType || DEFAULT_CONTRACT_TYPE;
}

function get(contractType) {
  const rawType = normalizeRawType(contractType);
  const normalizedType = aliases.get(rawType) || rawType;
  return (
    definitions.get(normalizedType) || createGenericContractType(normalizedType)
  );
}

function normalizeInput(input = {}) {
  const definition = get(input.contractType);
  const contractType = normalizeType(input.contractType);

  return definition.normalizeInput({
    ...input,
    contractType,
  });
}

function buildDetailRows(contractId, details = [], contractType) {
  const definition = get(contractType);

  if (typeof definition.buildDetailRows === "function") {
    return definition.buildDetailRows(contractId, details);
  }

  return buildContractDetailRows(contractId, details);
}

function validateInput(input = {}) {
  return get(input.contractType).validateInput(input);
}

function renderPdf(builder, contract, details = []) {
  return get(contract?.contractType).renderPdf(builder, contract, details);
}

function getFilePrefix(contractType) {
  return get(contractType).filePrefix;
}

function getDocumentCode(contractType) {
  return get(contractType).documentCode;
}

module.exports = {
  DEFAULT_CONTRACT_TYPE,
  register,
  get,
  normalizeType,
  normalizeInput,
  validateInput,
  normalizeResponse: normalizeContractDataForResponse,
  buildDetailRows,
  renderPdf,
  getFilePrefix,
  getDocumentCode,
};
