const APPENDIX_PRODUCT_FIELDS = [
  { key: "productName", labels: ["Tên sản phẩm"] },
  { key: "ingredients", labels: ["Thành phần", "Thành phần chính"] },
  {
    key: "packageSpecification",
    labels: ["Quy cách đóng gói", "Quy cách"],
  },
  {
    key: "registrationNumber",
    labels: [
      "Số đăng ký",
      "Số công bố",
      "Số đăng ký(số công bố)",
      "Số đăng ký (số công bố)",
    ],
  },
  { key: "origin", labels: ["Nước sản xuất", "Xuất xứ"] },
  {
    key: "unitPriceVat",
    labels: [
      "Đơn giá(+VAT)",
      "Đơn giá (+VAT)",
      "Đơn giá",
      "Giá sản phẩm",
      "Giá",
    ],
  },
  { key: "classification", labels: ["Phân loại", "Phân loại sản phẩm"] },
];

const decodeHtmlEntities = (value) => {
  const entities = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return String(value || "").replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, entity) => {
      if (entity[0] === "#") {
        const isHex = entity[1].toLowerCase() === "x";
        const codePoint = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
      }

      return entities[entity.toLowerCase()] || match;
    },
  );
};

function richTextToPlainText(rawContent) {
  return decodeHtmlEntities(
    String(rawContent || "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
      .replace(/<\s*li(?:\s[^>]*)?>/gi, "")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/-\s+(?=[^\n:]{1,80}:)/g, "\n- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isHtmlContent(value) {
  return typeof value === "string" && /<[^>]+>/.test(value);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plainTextToRichHtml(rawContent) {
  const items = [];
  let currentItem = null;

  for (const rawLine of richTextToPlainText(rawContent).split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const separatorIndex = line.indexOf(":");
    if (separatorIndex >= 0) {
      currentItem = {
        label: line.slice(0, separatorIndex).trim().replace(/^[\s\-–—•*]+/, ""),
        value: line.slice(separatorIndex + 1).trim(),
      };
      items.push(currentItem);
    } else if (currentItem) {
      currentItem.value = [currentItem.value, line].filter(Boolean).join("\n");
    } else {
      items.push({ label: null, value: line });
    }
  }

  if (!items.length) return null;

  return `<ol>${items
    .map((item) => {
      const value = escapeHtml(item.value).replace(/\n/g, "<br>");
      if (!item.label) return `<li><p>${value}</p></li>`;
      return `<li><p><strong>${escapeHtml(item.label)}: </strong>${value}</p></li>`;
    })
    .join("")}</ol>`;
}

function normalizeLabel(value) {
  return String(value || "")
    .replace(/^[\s\-–—•*]+/, "")
    .replace(/^\d+[\).\s-]+/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const productLabelLookup = new Map(
  APPENDIX_PRODUCT_FIELDS.flatMap(({ key, labels }) =>
    labels.map((label) => [normalizeLabel(label), key]),
  ),
);

function parseProductRichText(rawContent) {
  const result = Object.fromEntries(
    APPENDIX_PRODUCT_FIELDS.map(({ key }) => [key, null]),
  );
  let currentKey = null;

  for (const rawLine of richTextToPlainText(rawContent).split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const separatorIndex = line.indexOf(":");
    const label =
      separatorIndex >= 0 ? normalizeLabel(line.slice(0, separatorIndex)) : "";
    const key = productLabelLookup.get(label);

    if (key) {
      currentKey = key;
      result[key] = line.slice(separatorIndex + 1).trim() || null;
    } else if (separatorIndex >= 0) {
      currentKey = null;
    } else if (currentKey) {
      result[currentKey] = [result[currentKey], line]
        .filter(Boolean)
        .join("\n");
    }
  }

  return result;
}

function resolveProductData(product) {
  if (!product || typeof product !== "object") return {};

  return {
    ...(product.jsonContent && typeof product.jsonContent === "object"
      ? product.jsonContent
      : {}),
    ...product,
    ...(product.detailData && typeof product.detailData === "object"
      ? product.detailData
      : {}),
  };
}

function getProductRawContent(product) {
  if (typeof product === "string") return product;

  const data = resolveProductData(product);
  const htmlContent =
    data.rawHtml ||
    data.html ||
    data.richText ||
    data.productRichText ||
    (isHtmlContent(data.content) ? data.content : null);

  if (isHtmlContent(data.rawContent)) return data.rawContent;
  return htmlContent || data.rawContent || data.content || null;
}

function normalizeProduct(product) {
  const rawContent = getProductRawContent(product);
  const parsed = rawContent ? parseProductRichText(rawContent) : {};
  const data = resolveProductData(product);

  return {
    rawContent:
      (isHtmlContent(rawContent) ? rawContent : plainTextToRichHtml(rawContent)) ||
      rawContent,
    productName: data.productName ?? parsed.productName,
    ingredients: data.ingredients ?? parsed.ingredients,
    packageSpecification:
      data.packageSpecification ?? data.packageSpec ?? parsed.packageSpecification,
    registrationNumber:
      data.registrationNumber ?? data.registrationNo ?? parsed.registrationNumber,
    origin: data.origin ?? data.countryOfOrigin ?? parsed.origin,
    unitPriceVat:
      data.unitPriceVat ??
      data.unitPriceWithVat ??
      data.priceVat ??
      data.price ??
      parsed.unitPriceVat,
    classification: data.classification ?? data.category ?? parsed.classification,
  };
}

function normalizeProducts(products) {
  if (!Array.isArray(products)) return undefined;
  return products.map(normalizeProduct);
}

function normalizeContractInput(input = {}, contractType) {
  const sourceData =
    input.contractData && typeof input.contractData === "object"
      ? input.contractData
      : {};
  const details = Array.isArray(input.details)
    ? input.details
    : Array.isArray(sourceData.details)
      ? sourceData.details
      : [];
  const ownerCompanyInfo =
    input.ownerCompanyInfo || sourceData.ownerCompanyInfo || null;
  const partnerCompanyInfo =
    input.partnerCompanyInfo || sourceData.partnerCompanyInfo || null;
  const contractDueDate =
    input.contractDueDate || sourceData.contractDueDate || null;
  const products = normalizeProducts(
    input.products ??
      input.productRichTexts ??
      sourceData.products ??
      sourceData.productRichTexts,
  );

  return {
    contractType,
    ownerCompanyInfo,
    partnerCompanyInfo,
    contractDueDate,
    details,
    contractData: {
      ...sourceData,
      principleContractNumber:
        input.principleContractNumber ?? sourceData.principleContractNumber,
      principleContractSignedDate:
        input.principleContractSignedDate ??
        sourceData.principleContractSignedDate,
      products,
      ownerCompanyInfo,
      partnerCompanyInfo,
      contractDueDate,
      details,
    },
  };
}

function normalizeContractDataForResponse(contractData = {}) {
  if (!contractData || typeof contractData !== "object") return contractData;

  const products = normalizeProducts(contractData.products);
  return products ? { ...contractData, products } : contractData;
}

module.exports = {
  normalizeContractInput,
  normalizeContractDataForResponse,
  normalizeProduct,
  normalizeProducts,
};
