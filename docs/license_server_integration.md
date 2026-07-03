# Tích hợp License Control cho server khách hàng

## 1. Nguyên tắc

- Hub sinh duy nhất một `licenseKey` cho mỗi khách hàng.
- Mỗi server là một record `LicenseSoftware` có `id`, `type=server`, `status` và `serverConfig` riêng.
- Server khách hàng giữ `LICENSE_SOFTWARE_ID`; key khách nhập được lưu trong `app_configs.app_config.license.key` phía server.
- Không lưu license key trong `localStorage`; browser không phải trusted environment và không có quyền quyết định server API được mở hay khoá.
- Mỗi lần đồng bộ, server gửi key đã nhập và `softwareId`. Hub đối chiếu trực tiếp với `licenseKey`, đồng thời kiểm tra software thuộc đúng license, là loại `server` và đang `active`.
- License middleware chỉ bảo vệ HTTP API. Nó không dừng Node.js process, worker, cron job, queue consumer hoặc socket server đang chạy ngầm.

## 2. Luồng cấp và kích hoạt

1. Admin tạo license cùng danh sách software qua `POST /api/v1/licenses`.
2. Hub tự sinh `licenseKey`; mỗi software tự có `id`.
3. Picare cấu hình `LICENSE_SOFTWARE_ID` cho đúng server và giao `licenseKey` cho khách hàng.
4. Khách nhập key vào `POST /api/v1/license/activate` trên server thương mại.
5. Server gọi `ActivateLicense` qua gRPC. Hub đối chiếu key với `licenseKey` và xác nhận software thuộc đúng license.
6. Server chỉ lưu key vào `app_configs` khi Hub kích hoạt thành công.
7. Middleware gọi `GetLicenseConfig`; Hub chỉ mở quyền khi key lưu phía Happycare khớp `licenseKey` trên Hub.
8. Hub trả danh sách feature có giá trị `true` trong `serverConfig`.

## 3. Tạo license

```http
POST /api/v1/licenses
Cookie: token=<admin-session>
Content-Type: application/json
```

```json
{
  "customerName": "Happycare",
  "customerPhone": "0900000000",
  "customerEmail": "admin@happycare.vn",
  "software": [
    {
      "name": "Happycare Core API",
      "price": 10000000,
      "status": "active",
      "domain": "https://core.happycare.vn",
      "type": "server",
      "serverConfig": {
        "chat": true,
        "s3": true,
        "s3-folders": true,
        "contracts": false,
        "mail": true,
        "product-qrs": true
      }
    },
    {
      "name": "Happycare Worker API",
      "price": 5000000,
      "status": "active",
      "type": "server",
      "serverConfig": { "jobs": true }
    },
    {
      "name": "Happycare Web",
      "price": 0,
      "status": "active",
      "domain": "https://hub.happycare.vn",
      "type": "client"
    }
  ]
}
```

Chỉ hai record `server` được dùng để kiểm soát API. Record `client` chỉ phục vụ quản lý thương mại.

### Trường hợp 2 server và 1 client

- `client`: chỉ hiển thị form nhập key và gọi API activation; không tự quyết định quyền truy cập.
- `main server`: lưu key trong `app_configs`, dùng software ID của main server và chặn toàn bộ `/api/v1/*` khi chưa kích hoạt.
- `background server`: tiếp tục chạy worker/job bình thường. Nếu không public HTTP API thì không gắn middleware license. Nếu nó có API riêng cần bảo vệ, cấu hình software ID riêng và gắn middleware trên API của server đó.
- Nếu hai server dùng chung database, background server có thể đọc cùng key trong `app_configs`; không cần khách nhập key lần thứ hai.

## 4. Kiểm tra qua HTTP

```http
POST /api/v1/licenses/check
Content-Type: application/json
```

```json
{
  "licenseKey": "<LICENSE_KEY>",
  "softwareId": "<LICENSE_SOFTWARE_ID>"
}
```

Endpoint HTTP phù hợp cho kiểm tra cài đặt hoặc activation UI nội bộ. Server-to-server runtime dùng gRPC.

## 5. Contract gRPC

```protobuf
message LicenseConfigRequest {
  string licenseKey = 1;
  string softwareId = 2;
}
```

Server khách hàng cấu hình:

```env
HUB_GRPC_HOST=picare-core-hub:50051
LICENSE_SOFTWARE_ID=<id-cua-record-server>
LICENSE_CACHE_TTL_MS=60000
LICENSE_OFFLINE_GRACE_MS=300000
```

Trong Docker/Kubernetes, `HUB_GRPC_HOST` phải là DNS nội bộ/service name, không dùng `localhost` nếu Hub chạy ở container/pod khác.

## 6. Chính sách lỗi

- Key sai, software không thuộc license, `type!=server`, hoặc `status=error`: chặn API (`403`).
- Feature không có hoặc bằng `false`: chặn route tương ứng (`403`).
- Hub tạm mất kết nối: dùng bản cache hợp lệ gần nhất tối đa `LICENSE_OFFLINE_GRACE_MS`.
- Chưa từng lấy được license hợp lệ hoặc cache quá grace period: chặn API (`503`).
- Không dùng fallback `active=true`; cách đó làm chức năng thu hồi license mất tác dụng.

Các endpoint health check và activation nội bộ có thể được miễn middleware để hỗ trợ chẩn đoán, nhưng phải được bảo vệ riêng.

Trong Happycare, `/health` và `/api/v1/license/activate` nằm ngoài license guard. Tất cả HTTP route còn lại dưới `/api/v1` đi qua `requireLicense`. Middleware này không được đặt trong bootstrap worker hoặc queue.

## 7. Checklist áp dụng cho công ty mới

1. Copy cùng phiên bản protobuf từ Hub.
2. Thêm gRPC client đọc bốn biến môi trường ở trên.
3. Gắn `checkFeature("feature-name")` trước từng route module cần kiểm soát.
4. Tên feature trên route phải trùng chính xác key trong `serverConfig`.
5. Không log key khách nhập và không trả lại key trong response.
6. Bảo vệ kết nối production bằng private network và TLS/mTLS; không expose port gRPC trực tiếp ra Internet.
7. Test đủ: key sai, software sai license, client software, status error, feature false, Hub offline và cache hết hạn.
