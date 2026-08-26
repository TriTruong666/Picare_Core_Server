# Contract S3 gRPC cho hệ sinh thái Picare

Picare Core Hub sở hữu AWS/S3 credential, object operation và record `s3_assets`. Service tiêu thụ như Picare Intelligent không được nhận AWS credential hoặc gọi S3 SDK trực tiếp.

## Contract

Proto chuẩn: `proto/auth.proto`, package `auth`, service `S3Service`.

| RPC | Kiểu | Mục đích |
|---|---|---|
| `QueueUpload` | unary | Stage file và enqueue BullMQ S3 upload job hiện có |
| `GetUploadJob` | unary | Poll trạng thái/kết quả upload bền vững |
| `DownloadObject` | server streaming | Đọc object theo chunk 64 KiB để ingestion |
| `GetObjectMetadata` | unary | Đọc content type, size, ETag và custom metadata |
| `DeleteObject` | unary | Xóa object và record `s3_assets` tương ứng |

Upload RPC giữ tương thích với client cũ. Download dùng streaming để consumer không cần nhận một gRPC message lớn.

## Xác thực

Mọi storage RPC yêu cầu metadata:

```text
x-service-token: <shared service secret>
```

Khai báo trong `.env.development` của Core khi chạy local, hoặc secret injection khi deploy:

```dotenv
GRPC_STORAGE_SERVICE_TOKEN=replace-with-a-long-random-secret
GRPC_STORAGE_ALLOWED_PREFIXES=picare-intelligent/
```

Core trả `FAILED_PRECONDITION` nếu server chưa có token, `UNAUTHENTICATED` nếu token caller không khớp và `PERMISSION_DENIED` nếu object/job key nằm ngoài các prefix cho phép. Có thể khai báo nhiều prefix, phân cách bằng dấu phẩy. Upload qua RPC này luôn được ép `private`; Core dùng kích thước buffer thực tế thay vì tin metadata từ caller. Không commit hoặc ghi token vào log.

## Kết nối local từ Picare Intelligent

Khi Core chạy trực tiếp trên macOS ở port `50051` và Intelligent chạy trong Docker:

```dotenv
STORAGE_GRPC_TARGET_DOCKER=host.docker.internal:50051
STORAGE_GRPC_SERVICE_TOKEN=replace-with-the-same-long-random-secret
```

Nếu sau này hai ứng dụng dùng chung Compose/network, dùng DNS service của Core, ví dụ `picare-core:50051`.

## Dependency vận hành

`QueueUpload` cần PostgreSQL, Redis/BullMQ worker và AWS S3 config phía Core đều hoạt động. Queue trả thành công chưa có nghĩa object đã sẵn sàng; consumer phải poll `GetUploadJob` tới `completed` hoặc `failed`.

Upload hiện tại là unary. Picare Intelligent giới hạn file 64 MiB mặc định; revision sau nên dùng client-streaming hoặc presigned multipart cho source lớn hơn.

Chạy contract test độc lập với AWS/Redis/DB:

```bash
npm run test:grpc-storage
```
