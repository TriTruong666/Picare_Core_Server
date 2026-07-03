# License check cho phần mềm thương mại

## Kiến trúc

Một khách hàng có đúng một record `License` và một `licenseKey`. Mỗi sản phẩm khách mua là một record `LicenseSoftware` riêng, có `softwareId`, `type`, `status`, domain và cấu hình tương ứng.

Ví dụ Công ty A:

```text
License Công ty A
├── Core Server chạy ngầm (S3, mail, worker...)
├── OMS Server
└── OMS Client
```

License check chỉ phục vụ UI xác định software hiện tại đã được cấp quyền hay chưa. Nó không phải middleware bảo vệ server và không thay thế authentication/authorization của OMS.

## Luồng OMS

1. Người dùng đăng nhập OMS bằng auth hiện tại.
2. OMS Client đọc `licenseKey` và `softwareId` từ `localStorage`.
3. Nếu thiếu một trong hai giá trị, UI hiển thị form yêu cầu nhập license.
4. Client gọi endpoint có auth của OMS Server:

```http
POST /api/v1/license/check
Cookie: token=<oms-session>
Content-Type: application/json

{
  "licenseKey": "<key-của-công-ty-a>",
  "softwareId": "<id-của-oms-client-hoặc-software-oms-cần-check>"
}
```

5. OMS Server chuyển hai giá trị sang Picare Core Hub qua gRPC `CheckLicense`.
6. Hub tìm software theo `softwareId`, đồng thời kiểm tra software thuộc License có đúng `licenseKey` và `status=active`.
7. Hợp lệ: UI tiếp tục chức năng đồng bộ. Không hợp lệ: UI chặn màn hình/chức năng và yêu cầu nhập lại.

`localStorage` chỉ dùng để giữ cấu hình UX. Quyết định hợp lệ luôn đến từ Hub; client không tự coi có key là hợp lệ.

## Những thành phần không bị chặn

- Core Server chạy ngầm vẫn chạy S3, mail, worker, cron và queue bình thường.
- OMS Server vẫn chạy bình thường và tiếp tục dùng middleware `protect`/RBAC hiện có.
- Không gắn license middleware toàn cục vào `/api/v1`.
- Không gắn license middleware vào background job, socket hoặc server bootstrap.
- Chỉ UI hoặc chức năng cụ thể chủ động gọi `/api/v1/license/check` trước khi tiếp tục.

## Khi Picare Core Hub bị gián đoạn

Server thương mại không được phụ thuộc khả năng sống của Hub:

- gRPC check có deadline mặc định 3 giây (`LICENSE_GRPC_TIMEOUT_MS`).
- Nếu Hub trả response hợp lệ với `active=false`, UI vẫn chặn vì license đã được xác nhận là sai hoặc bị khoá.
- Nếu gRPC timeout, mất kết nối hoặc Hub sập, Happycare dùng chính sách fail-open và trả HTTP 200:

```json
{
  "active": true,
  "verified": false,
  "hubAvailable": false,
  "status": "verification_deferred",
  "message": "Tạm thời không thể xác minh license; hệ thống tiếp tục hoạt động."
}
```

- UI không chặn người dùng khi `status=verification_deferred`; có thể hiển thị cảnh báo nhỏ và thử check lại sau.
- Server, auth, API, worker và job không dừng hoặc crash khi Hub mất kết nối.

Đây là đánh đổi có chủ đích: trong lúc Hub offline không thể thu hồi license ngay, nhưng hệ thống khách hàng không bị downtime theo Hub.

## Hub API

### Tạo License cùng nhiều software

```http
POST /api/v1/licenses
Cookie: token=<admin-session>
```

```json
{
  "customerName": "Công ty A",
  "customerPhone": "0900000000",
  "customerEmail": "admin@company-a.vn",
  "software": [
    {
      "name": "Company A Core Server",
      "price": 10000000,
      "status": "active",
      "type": "server",
      "serverConfig": { "s3": true, "mail": true }
    },
    {
      "name": "Company A OMS Server",
      "price": 5000000,
      "status": "active",
      "type": "server",
      "serverConfig": {}
    },
    {
      "name": "Company A OMS Client",
      "price": 3000000,
      "status": "active",
      "type": "client"
    }
  ]
}
```

Hub trả một `licenseKey` và ba `software.id`. Picare cấp cho khách đúng cặp key/ID mà UI cần kiểm tra.

### Kiểm tra trực tiếp

```http
POST /api/v1/licenses/check
Content-Type: application/json

{
  "licenseKey": "<license-key>",
  "softwareId": "<software-id>"
}
```

Endpoint chấp nhận cả software `client` và `server`. Với software server, response có thể kèm `enabledFeatures` lấy từ `serverConfig`.

## Quy tắc dữ liệu

- `licenseKey` unique và được Hub tự sinh.
- `softwareId` phải thuộc đúng License của key được gửi lên.
- Software `status=error` hoặc không tồn tại bị từ chối.
- Key của Công ty A kết hợp software ID của Công ty B bị từ chối.
- Không cần field key thứ hai trong bảng `licenses`.
- Không ghi license key vào log.

## Áp dụng cho công ty khác

1. Đồng bộ cùng phiên bản protobuf với Hub.
2. Tạo endpoint server `POST /api/v1/license/check` có middleware auth sẵn có.
3. Endpoint nhận `licenseKey` và `softwareId`, không lấy cố định từ `.env`.
4. Server gọi gRPC `CheckLicense` và trả kết quả cho UI.
5. UI lưu cặp giá trị vào localStorage và gọi check sau khi đăng nhập hoặc trước chức năng cần license.
6. Không thay đổi middleware auth, worker hoặc luồng chạy của server.
