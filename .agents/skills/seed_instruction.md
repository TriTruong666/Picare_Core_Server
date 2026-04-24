# Hướng dẫn tạo Seed File và Hàm Seed trong Picare Hub

Hệ thống seeding (gieo hạt dữ liệu) giúp tự động hóa việc khởi tạo dữ liệu mẫu hoặc dữ liệu cấu hình bắt buộc khi khởi động server.

## 1. Cấu trúc thư mục Seed
Toàn bộ logic seeding được đặt trong `src/seeds/`:
- `src/seeds/*.js`: Các file chứa logic thực thi seeding (ví dụ: `user_seed.js`, `hub_client_seed.js`).
- `src/seeds/local_data/*.json`: Các file chứa dữ liệu thô (raw data) dạng JSON.

## 2. Các bước tạo Seed mới

### Bước 1: Tạo file dữ liệu JSON
Tạo file `.json` trong `src/seeds/local_data/`.
Ví dụ: `src/seeds/local_data/example_seed.json`
```json
[
  {
    "name": "Example 1",
    "value": "Value 1"
  }
]
```

### Bước 2: Tạo file thực thi Seed
Tạo file `.js` trong `src/seeds/`. File này nên export một hàm `async`.

**Mẫu code (`example_seed.js`):**
```javascript
const fs = require("fs");
const path = require("path");
const Model = require("../models/example.model");

async function seedingExample() {
  try {
    const filePath = path.join(__dirname, "/local_data/example_seed.json");
    const rawData = fs.readFileSync(filePath, "utf-8");
    const dataList = JSON.parse(rawData);

    for (const item of dataList) {
      // Kiểm tra sự tồn tại (thường dựa trên 1 field unique như email, name, code)
      const isExisted = await Model.findOne({ where: { name: item.name } });

      if (!isExisted) {
        await Model.create(item);
        console.log(`[SEED]: Created "${item.name}"`);
      } else {
        // Cập nhật nếu muốn đồng bộ dữ liệu mới nhất từ file JSON
        await isExisted.update(item);
        console.log(`[SEED]: Updated "${item.name}"`);
      }
    }
  } catch (error) {
    console.error("[SEED ERROR]:", error.message);
  }
}

module.exports = seedingExample;
```

### Bước 3: Đăng ký hàm Seed vào server
Mở file `server.js` (hoặc nơi khởi động ứng dụng) để import và gọi hàm.

```javascript
// 1. Import
const seedingExample = require("./src/seeds/example_seed");

// 2. Chạy trong hàm startServer (sau khi db sync)
const startServer = async () => {
  // ... db sync ...
  await seedingExample();
  // ...
}
```

## 3. Quy tắc vàng khi viết Seed
- **Idempotency (Tính bất biến):** Hàm seed phải chạy được nhiều lần mà không gây ra lỗi hay trùng lặp dữ liệu (luôn kiểm tra `findOne` trước khi `create`).
- **Error Handling:** Luôn dùng `try...catch` để tránh làm crash server nếu file JSON lỗi hoặc DB lỗi.
- **Logging:** In log ra console để biết quá trình seed đang diễn ra như thế nào.
- **Hooks:** Lưu ý các Hooks trong Model (như `beforeCreate`) sẽ vẫn chạy khi dùng `create` trong seed.
