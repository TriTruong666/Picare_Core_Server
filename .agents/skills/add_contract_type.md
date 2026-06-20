---
name: Add Contract Type
description: Quy trình thêm một loại hợp đồng mới vào contract registry mà không sửa lifecycle ký số, ký tay, S3 và document version.
---

# Thêm loại hợp đồng mới

Hệ thống hợp đồng dùng Strategy + Registry. Mỗi loại hợp đồng chịu trách nhiệm về payload và cách render của chính nó; service lõi chỉ điều phối database, S3, trạng thái và chữ ký.

## Kiến trúc

```text
src/contracts/
├── contract-type.registry.js
├── index.js
├── common/
│   ├── contract-input.normalizer.js
│   └── contract-detail.builder.js
└── types/
    ├── principle.contract-type.js
    ├── appendix.contract-type.js
    └── generic.contract-type.js
```

Luồng xử lý:

```text
Route -> Schema -> ContractTypeRegistry -> ContractService -> Model/S3
                                      -> ContractPdfService -> type.renderPdf()
```

Không thêm `if (contractType === ...)` vào `contract.service.js`, `contract_pdf.service.js`, controller hoặc model.

## Trách nhiệm của type module

Mỗi module phải khai báo:

- `type`: mã chuẩn lưu trong `contract.contract_type`.
- `aliases`: tên cũ hoặc tên thay thế dùng chung builder.
- `canonicalizeAliases`: đặt `true` nếu aliases phải được lưu về mã chuẩn `type`; mặc định giữ nguyên mã client gửi để tương thích dữ liệu cũ.
- `documentCode`: mã dùng khi sinh số hợp đồng.
- `filePrefix`: prefix tên PDF.
- `normalizeInput(input)`: chuyển request về cấu trúc contract chuẩn.
- `validateInput(input)`: validation nghiệp vụ riêng của loại hợp đồng.
- `renderPdf(builder, contract, details)`: render nội dung PDF.

Type module không được upload S3, tạo transaction, đổi status, tạo signature hoặc tạo document version.

## Tạo type mới

Ví dụ thêm `service`:

```javascript
// src/contracts/types/service.contract-type.js
const {
  normalizeContractInput,
} = require("../common/contract-input.normalizer");

module.exports = {
  type: "service",
  aliases: ["dich_vu"],
  documentCode: "HDDV",
  filePrefix: "hop_dong_dich_vu",

  normalizeInput(input) {
    const normalized = normalizeContractInput(input, this.type);

    return {
      ...normalized,
      contractData: {
        ...normalized.contractData,
        serviceScope:
          input.serviceScope ?? normalized.contractData.serviceScope ?? null,
        paymentTerm:
          input.paymentTerm ?? normalized.contractData.paymentTerm ?? null,
      },
    };
  },

  validateInput(input) {
    const serviceScope =
      input.serviceScope ?? input.contractData?.serviceScope;

    if (!serviceScope) {
      throw new Error("serviceScope là bắt buộc với hợp đồng dịch vụ");
    }

    return true;
  },

  renderPdf(builder, contract, details) {
    const data = contract.contractData || {};

    builder.centered("HỢP ĐỒNG DỊCH VỤ", 14, 0.8, true);
    builder.labelValue("Phạm vi dịch vụ", data.serviceScope);
    builder.labelValue("Điều khoản thanh toán", data.paymentTerm);
    builder.signatureArea(
      contract.ownerCompanyInfo,
      contract.partnerCompanyInfo,
    );
  },
};
```

Đăng ký type trong `src/contracts/contract-type.registry.js`:

```javascript
const serviceContractType = require("./types/service.contract-type");

register(serviceContractType);
```

Nếu chưa đăng ký, hệ thống vẫn dùng `generic.contract-type.js`. Chỉ dùng fallback để thử payload đơn giản; loại hợp đồng production có validation hoặc PDF riêng phải được đăng ký rõ ràng.

## Detail rows

Mặc định registry dùng `common/contract-detail.builder.js`. Input hỗ trợ:

```json
{
  "details": [
    {
      "detailKey": "implementation",
      "detailType": "service_fee",
      "detailData": {
        "name": "Phí triển khai",
        "fee": 5000000
      }
    }
  ]
}
```

Nếu type mới cần cách lưu detail khác, bổ sung `buildDetailRows(contractId, details)` vào definition và cập nhật registry gọi override trước common builder. Không nhét dữ liệu chỉ dùng để render vào column mới; ưu tiên `contractData` JSONB hoặc `ContractDetail`.

## Swagger

Khi payload mới có field riêng:

1. Thêm field và example vào `POST /api/v1/contracts`.
2. Dùng `oneOf` và `discriminator.propertyName: contractType` khi có từ hai payload riêng trở lên.
3. Ghi rõ field bắt buộc trong `required`.
4. Không dùng JSON string cho object lồng nhau trong `application/json`.

Mẫu OpenAPI:

```yaml
schema:
  oneOf:
    - $ref: '#/components/schemas/PrincipleContractInput'
    - $ref: '#/components/schemas/ServiceContractInput'
  discriminator:
    propertyName: contractType
```

## Kiểm tra bắt buộc

```powershell
node --check src\contracts\types\service.contract-type.js
node --check src\contracts\contract-type.registry.js
node --check src\services\contract.service.js
node --check src\services\contract_pdf.service.js
node -e "const { ContractTypeRegistry:r } = require('./src/contracts'); console.log(r.get('service'))"
```

Ngoài kiểm tra cú pháp, phải smoke test:

- Create draft.
- Update draft.
- Generate draft PDF.
- Publish unsigned.
- Ký owner và partner nếu type đó dùng flow digital.
- Kiểm tra tên file, document code và Swagger example.

## Nguyên tắc tương thích

- Không đổi `contractMode`, status hoặc document version trong type module.
- Không xoá aliases đang có dữ liệu production.
- Không đổi key trong `contractData` nếu chưa có migration dữ liệu.
- Renderer mới phải dùng `builder.signatureArea()` để signing widget tiếp tục hoạt động.
- PDF upload-only không đi qua renderer; nó vẫn dùng API `/contracts/upload`.
