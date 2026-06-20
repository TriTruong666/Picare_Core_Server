const { normalizeContractInput } = require("../common/contract-input.normalizer");

module.exports = {
  type: "appendix",
  aliases: ["phu_luc", "phuluc", "plhd", "plhp"],
  documentCode: "PLHP",
  filePrefix: "phu_luc_hop_dong",

  normalizeInput(input) {
    return normalizeContractInput(input, input.contractType);
  },

  validateInput() {
    return true;
  },

  renderPdf(builder, contract, details) {
    builder.renderAppendixContract(contract, details);
  },
};
