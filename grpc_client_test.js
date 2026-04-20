/**
 * gRPC Client Simulator (Test Script)
 * Dùng để test tính năng Shared Service Hub từ vị trí của một backend khác.
 */

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");

// 1. Cấu hình đường dẫn tới file proto (giả sử repo khác copy proto này về)
const PROTO_PATH = path.join(__dirname, "./proto/auth.proto");

// 2. Load file proto
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const authProto = grpc.loadPackageDefinition(packageDefinition).auth;

// 3. Khởi tạo Client kết nối tới Hub
// Lưu ý: Đảm bảo server Hub đang chạy tại port 50051
const client = new authProto.AuthService(
  "localhost:50051",
  grpc.credentials.createInsecure()
);

/**
 * Hàm test VerifyToken
 */
function testVerifyToken(token) {
  console.log("\n[TEST]: Đang gọi VerifyToken...");
  client.VerifyToken({ token }, (err, response) => {
    if (err) {
      console.error("[FAILED]: Lỗi kết nối gRPC:", err.message);
      return;
    }

    if (response.valid) {
      console.log("[SUCCESS]: Token hợp lệ!");
      console.log(" >> User ID:", response.userId);
      console.log(" >> Role:", response.role);
    } else {
      console.log("[FAILED]: Token không hợp lệ hoặc hết hạn.");
    }
  });
}

/**
 * Hàm test CheckPermission
 */
function testCheckPermission(userId, permission) {
  console.log(`\n[TEST]: Đang kiểm tra quyền '${permission}' cho user '${userId}'...`);
  client.CheckPermission({ userId, permission }, (err, response) => {
    if (err) {
      console.error("[FAILED]: Lỗi kết nối gRPC:", err.message);
      return;
    }

    if (response.allowed) {
      console.log("[SUCCESS]: User CÓ QUYỀN thực hiện hành động này.");
    } else {
      console.log("[DENIED]: User KHÔNG CÓ QUYỀN.");
    }
  });
}

// --- THỰC THI TEST ---

// 1. Test với token rác (mong đợi: valid: false)
testVerifyToken("invalid-token-123");

// 2. Test CheckPermission với Admin (Mong đợi: ALLOWED)
// User: afa34492-8287-42eb-a6e7-919d048612d9 (admin@picare.vn)
testCheckPermission("afa34492-8287-42eb-a6e7-919d048612d9", "access_admin_panel");

// 3. Test CheckPermission với Staff (Mong đợi: DENIED cho admin_panel)
// User: 86798bc4-58e7-421a-85b3-da8840ec8d8d (tien.haithao@gmail.com - ecom_staff)
testCheckPermission("86798bc4-58e7-421a-85b3-da8840ec8d8d", "access_admin_panel");

// 4. Test CheckPermission với Staff (Mong đợi: ALLOWED cho manage_orders)
testCheckPermission("86798bc4-58e7-421a-85b3-da8840ec8d8d", "manage_orders");

// 5. Test với User không tồn tại (Mong đợi: DENIED)
testCheckPermission("user-uuid-999-not-found", "any_permission");

// 6. Để test VerifyToken thành công, bạn cần lấy một token thật từ API Login (/api/auth/login)
// Sau đó paste token đó vào đây:
// testVerifyToken("PASTE_REAL_TOKEN_HERE");

console.log("--------------------------------------------------");
console.log("Đã gửi yêu cầu test tới Hub Server. Đang chờ phản hồi...");
console.log("--------------------------------------------------");

