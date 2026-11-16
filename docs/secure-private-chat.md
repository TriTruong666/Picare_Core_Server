# Phòng chat riêng bảo mật — triển khai tháng 11/2026

## Phạm vi và mô hình tin cậy

Có hai loại chat riêng song song giữa cùng hai người:

- Thông thường: giữ nguyên envelope encryption bằng DEK và CHAT_MASTER_KEK; Core có thể tự giải mã.
- Bảo mật: chỉ CEO được khởi tạo; thành viên cần biết mã phòng mới đọc/gửi được. DEK được bọc thêm bằng khoá dẫn xuất từ mã. Chỉ có DB và CHAT_MASTER_KEK chưa đủ giải mã.

Đây **không phải E2EE**: Core nhận mã qua HTTPS, giải mã nội dung trong bộ nhớ khi phục vụ request. Người kiểm soát process, frontend, proxy có thể thu mã hoặc bản rõ lúc sử dụng. Mã không được ghi vào log, telemetry hoặc body dump; cần bảo đảm các tầng vận hành cũng loại bỏ header X-Chat-Security-Code. Mã ngắn 10 ký tự có giới hạn entropy; scrypt làm chậm việc dò mã, không thay thế khoá ngẫu nhiên 256 bit. Bcrypt dùng để kiểm tra mật khẩu, không dùng làm khoá AES.

## Trải nghiệm người dùng

Mọi thao tác nhắn riêng từ sidebar, danh bạ, thẻ hồ sơ và màn hình trống đều đi qua modal xác nhận chung ở ChatPage. Chỉ role `ceo` thấy switch “Chế độ bảo mật”; Core kiểm tra lại role từ phiên đăng nhập đã xác thực. Chat nhóm chưa hỗ trợ chế độ này.

Khi tạo phòng bảo mật mới:

1. Server dùng CSPRNG tạo mã 10 ký tự, bảo đảm chữ hoa, chữ thường, số và ký tự đặc biệt; xáo trộn bằng crypto.randomInt.
2. Response tạo mới trả mã đúng một lần cho người tạo, cùng mốc hết thời gian hiển thị 5 phút. Mã không được lưu rõ trong DB, phát qua socket, trả qua API list/detail hay trả lại khi mở phòng đã tồn tại.
3. Modal cho copy và yêu cầu xác nhận đã lưu. Nếu clipboard không khả dụng có thể copy thủ công rồi xác nhận. Đến hạn modal đóng và xoá state. Hạn 5 phút áp dụng cho việc hiển thị, không làm mã phòng hết hiệu lực. Không thể ngăn người dùng chụp/lưu response một lần đó.
4. Phòng vẫn khoá sau khi tạo, kể cả với người tạo. Khung chat hiển thị “Vui lòng nhập mã bảo mật để bắt đầu” và nút “Nhập mã”.
5. Người tạo đưa mã cho đối phương qua kênh riêng. Biết mã không thay thế điều kiện là thành viên đang hoạt động của phòng.
6. Sau khi nhập đúng mã, mặc định chỉ giữ mã trong bộ nhớ tab. Tuỳ chọn “Ghi nhớ trên thiết bị này” lưu mã trong localStorage, phân vùng theo userId và conversationId. Máy/trình duyệt khác vẫn phải nhập mã.

LocalStorage không phải kho bí mật: XSS, extension có quyền hoặc người kiểm soát browser profile có thể lấy mã. Chỉ bật ghi nhớ trên thiết bị tin cậy. Clipboard do trình duyệt/OS quản lý, ứng dụng không bảo đảm xoá được lịch sử clipboard.

## Mật mã và dữ liệu

Core bổ sung `conversations.is_secure BOOLEAN NOT NULL DEFAULT FALSE` và `security_code_hash VARCHAR(100)`. Migration idempotent chạy theo cơ chế hiện có; không thay đổi dữ liệu phòng thường.

Định dạng `encrypted_dek` của phòng bảo mật:

```
secure1:base64(salt16):base64(iv12):base64(tag16):base64(ciphertext)
```

Payload bên trong là DEK đã được CHAT_MASTER_KEK bọc theo định dạng cũ. Lớp thêm dùng AES-256-GCM, AAD `secure-chat:{conversationId}:v1`; khoá 32 byte dẫn xuất bằng scrypt N=32768, r=8, p=1, salt riêng. Verifier dùng bcrypt cost 12. Tin nhắn tiếp tục dùng AES-256-GCM và AAD riêng của Core.

DEK phòng bảo mật không được giữ trong cache DEK toàn process. Request dùng AsyncLocalStorage riêng, không chia sẻ trạng thái mở khoá giữa tài khoản/phiên. Trong request có thể tái sử dụng kết quả mở bọc để tránh tính bcrypt/scrypt lặp lại. Không có cờ “đã mở khoá” chung theo userId.

## API và các đường dữ liệu

- `POST /api/v1/chat/conversations`, thêm boolean `isSecure`; chỉ private + CEO được dùng. Response tạo mới có `securityCode`, `securityCodeExpiresAt`.
- `POST /api/v1/chat/conversations/:id/unlock`, gửi mã qua header `X-Chat-Security-Code`; kiểm tra membership và mã; response không trả khoá.
- Những request nội dung tiếp theo gửi cùng header. Đây là xác thực bằng mã mỗi request, không cấp token mở khoá dài hạn.
- `POST /api/v1/chat/conversations/:id/security/destroy`: người tạo, còn là thành viên và có mã đúng mới được huỷ khoá.
- List/detail chỉ trả thông tin phòng, `isSecure`, người tạo và số chưa đọc; preview tin cuối của phòng bảo mật luôn bị loại bỏ. Verifier và encrypted DEK không ra ngoài response.
- Các service đọc/gửi/sửa tin, ghim, reaction và attachment kiểm tra lớp mã trước khi xử lý. Caller gRPC không mang context mở khoá không thể đọc/gửi nội dung phòng bảo mật.
- Socket và Redis/SSE chỉ phát tín hiệu `{id, conversationId, isSecure, requiresUnlock}`; client tải lại nội dung bằng REST đã kiểm tra mã. Không phát bản rõ tới room user vì room đó bao gồm cả thiết bị chưa mở khoá.
- Request có mã bị giới hạn 120 lần/phút/user qua Redis. Header quá dài/sai độ dài bị từ chối trước bcrypt/scrypt; response chat dùng Cache-Control: no-store.

## Huỷ khoá và giới hạn khẩn cấp

“Khoá và quên mã trên thiết bị này” xoá mã local và nội dung trong state tab hiện tại; không ảnh hưởng các máy khác hoặc localStorage của thiết bị khác.

“Huỷ khoá phòng” dành cho người tạo: modal yêu cầu nhập HUY, server xoá encrypted_dek và verifier, giữ is_secure=true để không rơi vào fallback sinh lại DEK. Thành viên được báo tải lại phòng. Mã cũ không mở lại dữ liệu hiện tại trên server được, kể cả đối phương vẫn giữ mã.

Không tuyên bố đây là xoá tuyệt đối: nội dung đã sao chép/chụp/lưu, request đang xử lý, process bị theo dõi hoặc backup còn wrapped DEK và mã vẫn có thể giữ khả năng đọc. Chưa có quy trình huỷ toàn bộ key material trong backup, snapshot, replica hay trình duyệt offline. Cần quy trình vận hành riêng nếu muốn crypto-erasure bao phủ các bản sao đó.

## Giới hạn tính năng hiện tại

Phòng bảo mật chỉ hỗ trợ văn bản, đọc lịch sử/tìm kiếm, trả lời và ghim. Chặn file/ảnh/ghi âm, Entity Card, upload-ticket và rotation bằng đường cũ; không tự fetch link preview cho phòng bảo mật. Các đường S3 và tích hợp chứng từ hiện tại chưa có mức bảo vệ tương ứng. Phòng thường giữ các tính năng hiện tại.

Không có chức năng xem lại/reset mã, escrow hoặc khôi phục mã. Không lưu được mã trước khi đóng/hết hạn modal có thể khiến phòng không sử dụng được. Bản đầu chưa có quy trình tạo lại phòng thay cho một phòng bảo mật cùng cặp người đã mất mã.

## Kiểm tra và triển khai

- Core: `NODE_ENV=test node --test --test-force-exit tests/chat_security.test.js tests/chat_hub.c0_c4.test.js`.
- Client: eslint các file chat thay đổi; production build; kiểm tra TypeScript và phân biệt lỗi hiện có ngoài chat.
- Triển khai Core và migration trước, sau đó Office Client. Office Server tiếp tục BFF danh sách và enrich danh bạ, không giữ mã hoặc bản rõ. Không cần thay schema Office hay proto cho tính năng này.
- Trước nghiệm thu production: hai tài khoản thật, CEO và người thường; máy/trình duyệt thứ hai; copy/hết hạn modal; mã sai; gửi/đọc/tìm kiếm/ghim; kiểm tra payload Socket/Redis không có bản rõ; huỷ khoá; thử backup restore theo chính sách vận hành.
