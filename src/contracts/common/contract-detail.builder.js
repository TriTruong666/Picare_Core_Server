function buildContractDetailRows(contractId, details = []) {
  return details.map((detail, index) => {
    const detailData =
      detail.detailData && typeof detail.detailData === "object"
        ? detail.detailData
        : detail;

    return {
      contractId,
      detailKey:
        detail.detailKey ||
        detail.key ||
        detail.productName ||
        `detail_${index + 1}`,
      detailType: detail.detailType || detail.type || "item",
      detailData,
      productName: detail.productName ?? detailData.productName ?? null,
      price: detail.price ?? detailData.price ?? null,
    };
  });
}

module.exports = { buildContractDetailRows };
