# Core S3 workers (VPS 16 CPU, 32 GB RAM)

## Luồng triển khai

`QueueUpload` ghi object tạm vào S3 dưới `_upload_staging/`, sau đó thêm job vào Redis. Worker copy object trên S3 sang key cuối và ghi `s3_assets`. API và worker không cần chia sẻ file tạm mới; queue `s3-upload-queue` vẫn đọc được job cũ dùng `tempFilePath` từ volume `picare-s3-upload-staging`.

Production Compose chạy API và ba worker riêng: upload nhỏ (concurrency 4), upload video (2), ghép video bằng FFmpeg (1). `GetUploadJob` tra cả hai queue upload; response gRPC không đổi. Event hoàn tất ghép video được worker phát qua Redis đến Socket.io trên API.

## Rollout

1. Build/push image Core có `worker.js`, rồi cập nhật `docker-compose.prod.yml` cùng image tag cho API và cả ba worker. Không chạy Compose mới với image cũ.
2. Chạy `docker compose -f docker-compose.prod.yml up -d` tại thư mục triển khai. Kiểm tra bốn container đều chạy; worker nhỏ phải thấy volume `picare-s3-upload-staging` cũ.
3. Kiểm tra log từng worker, một upload tài liệu, một upload video và một job ghép video. Kiểm tra `GetUploadJob` trả `completed` và asset có thể đọc được. Theo dõi CPU/RAM, Redis queue depth, số job failed/stalled và thời gian hoàn thành.
4. Tạo S3 lifecycle rule chỉ cho prefix `_upload_staging/`: xoá object sau 7 ngày và abort incomplete multipart upload sau 7 ngày. Rule này dọn file tạm của job lỗi; không áp dụng cho `sfa_invoice/` hay các prefix dữ liệu nghiệp vụ.

Giữ volume `picare-s3-upload-staging` cho đến khi queue cũ hết job đang chờ, chạy hoặc retry. Sau đó có thể kiểm tra và dọn volume cũ thủ công.

`S3_UPLOAD_CONCURRENCY`, `S3_VIDEO_UPLOAD_CONCURRENCY`, `S3_MERGE_CONCURRENCY` có thể chỉnh khi theo dõi tải. Giữ mặc định 4/2/1 lúc đầu. WMS và Salesforce tăng deadline gRPC `QueueUpload` lên 11 phút (`S3_QUEUE_UPLOAD_TIMEOUT_MS`) để bao trùm timeout ghi staging 10 phút của Core; OMS hiện không đặt deadline riêng.

Upload qua gRPC vẫn truyền toàn bộ file qua Core và chờ Core ghi staging trước khi nhận job ID. Đây là giới hạn còn lại của bước 1–2; upload lớn sẽ hưởng lợi từ direct-to-S3 ở bước tiếp theo.
