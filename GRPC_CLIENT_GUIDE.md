# gRPC Client Connection Guide

Hướng dẫn này dành cho các dịch vụ backend khác (Microservices) cần kết nối tới **Picare Core Hub** để xác thực người dùng và phân quyền.

## 1. Chuẩn bị
Bạn cần file định nghĩa service (`auth.proto`). Hãy copy file này từ repo `picare-core-hub/proto/auth.proto` vào dự án của bạn (thường để trong thư mục `proto/`).

## 2. Cài đặt thư viện (Node.js)
Nếu sử dụng Node.js, hãy cài đặt các dependencies sau:
```bash
npm install @grpc/grpc-js @grpc/proto-loader
```

## 3. Khởi tạo gRPC Client
Dưới đây là ví dụ cách tạo một client để gọi service:

```javascript
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");

const PROTO_PATH = path.join(__dirname, "./proto/auth.proto"); // Đường dẫn tới file proto bạn đã copy

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const authProto = grpc.loadPackageDefinition(packageDefinition).auth;

// Khởi tạo client kết nối tới Hub (Port mặc định: 50051)
const client = new authProto.AuthService(
  "localhost:50051", 
  grpc.credentials.createInsecure()
);

module.exports = client;
```

## 4. Sử dụng

### 4.1. Xác thực Token (VerifyToken)
Sử dụng khi bạn nhận được Header `Authorization: Bearer <token>` từ Frontend và cần biết User đó là ai.

```javascript
const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."; // Token từ header client

client.VerifyToken({ token }, (err, response) => {
  if (err) {
    console.error("Lỗi kết nối gRPC:", err);
    return;
  }

  if (response.valid) {
    console.log("User hợp lệ:", response.userId);
    console.log("Tên:", response.name);
    console.log("Quyền (Role):", response.role);
  } else {
    console.log("Token không hợp lệ hoặc đã hết hạn.");
  }
});
```

### 4.2. Kiểm tra quyền hạn (CheckPermission)
Sử dụng để kiểm tra User có được phép thực hiện một hành động cụ thể hay không.

```javascript
client.CheckPermission({ 
  userId: "user-uuid-123", 
  permission: "create_order" 
}, (err, response) => {
  if (response.allowed) {
    console.log("Cho phép truy cập.");
  } else {
    console.log("Bị từ chối.");
  }
});
```

## 5. Lưu ý
- **Production**: Thay đổi `localhost:50051` thành địa chỉ IP/Domain nội bộ của Hub server.
- **Error Handling**: Luôn kiểm tra biến `err` trước khi xử lý `response` để tránh crash app nếu Hub server bị mất kết nối.
- **Port**: Cổng gRPC mặc định của Hub là `50051`, có thể cấu hình qua biến môi trường `GRPC_PORT`.
