---
name: model-migration-standards
description: Tiêu chuẩn thiết kế Sequelize Model, quản lý quan hệ (Association), đăng ký bảng an toàn (protectedTables) và cơ chế Database Migration cho PostgreSQL trong hệ thống Picare.
---

# Quy Chuẩn Thiết Kế Model & Database Migration trong Hệ Thống Picare

Bộ quy chuẩn này hướng dẫn cách cấu hình Sequelize Model, quản lý Associations tập trung, đăng ký các bảng cần bảo vệ và viết hàm Database Migration an toàn trong các dịch vụ Backend Node.js / Express của Picare.

---

## 1. Cấu Trúc Model (Model Architecture)

Mỗi Model đại diện cho một bảng trong cơ sở dữ liệu PostgreSQL và phải tuân thủ các quy tắc sau:

### 1.1. Khóa Chính & Định Danh (Primary Key & Identifiers)
- **`id`**: Kiểu `INTEGER`, `primaryKey: true`, `autoIncrement: true`. Dùng làm khóa chính nội bộ (internal ID) cho các liên kết foreign key hiệu năng cao.
- **`<entity>Id` / `uuid`**: Kiểu `UUID`, `defaultValue: DataTypes.UUIDV4`, `allowNull: false`, mapping `field: '<entity>_id'`. Dùng làm public ID giao tiếp qua API.
- Bắt buộc có **Unique Index** cho cột UUID trong `indexes`:
  ```javascript
  indexes: [
    { name: "<table_name>_<entity>_id_key", unique: true, fields: ["<entity>_id"] }
  ]
  ```

### 1.2. Đặt Tên Trường (Field Mapping)
- Thuộc tính trên JavaScript code dùng **camelCase** (vd: `userId`, `loginAt`, `trustedIps`, `isOnline`).
- Tên cột thực tế trong PostgreSQL dùng **snake_case** thông qua thuộc tính `field` (vd: `field: 'user_id'`, `field: 'login_at'`, `field: 'trusted_ips'`).
- Tên bảng dùng số nhiều, chữ thường, snake_case (vd: `tableName: 'users'`).
- `timestamps: true` (tự động tạo `created_at` / `updated_at`).

### 1.3. Khai Báo Associations (`Model.associate`)
- **KHÔNG** khai báo quan hệ trực tiếp tự do ngoài model hoặc phân tán ở nhiều nơi.
- Khai báo quan hệ trong hàm tĩnh `Model.associate = (models) => { ... }`.
- Luôn kiểm tra sự tồn tại của model đối ứng (`if (models.Role) ...`) trước khi tạo liên kết.
- Ví dụ:
  ```javascript
  User.associate = (models) => {
    if (models.Role) {
      User.belongsTo(models.Role, { foreignKey: "role_id", as: "userRole" });
    }
  };
  ```

---

## 2. Quản Lý Đăng Ký Tập Trung (`src/models/index.js`)

File `src/models/index.js` chịu trách nhiệm:
1. Import đầy đủ và tường minh tất cả các Model trong hệ thống.
2. Gán vào đối tượng `db`.
3. Chạy vòng lặp kích hoạt `associate`:
   ```javascript
   Object.keys(db).forEach((modelName) => {
     if (db[modelName].associate) {
       db[modelName].associate(db);
     }
   });
   ```
4. Export đối tượng `db` chứa `sequelize`, `Sequelize` và tất cả models.

---

## 3. Bảo Vệ Dữ Liệu (`protectedTables`)

Trong `src/config/app.config.js`, danh sách `protectedTables` phải chứa toàn bộ các bảng trong hệ thống để tránh việc `sequelize.sync({ force: true })` hoặc `alter: true` vô tình làm mất dữ liệu sản xuất.

---

## 4. Quy Chuẩn Database Migration (`src/config/database_migration.js`)

### 4.1. Nguyên Tắc An Toàn
- Sử dụng các câu lệnh SQL an toàn:
  - `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`
  - `ALTER TABLE <table_name> ADD COLUMN IF NOT EXISTS <column_name> <type>;`
  - `CREATE UNIQUE INDEX IF NOT EXISTS <index_name> ON <table_name> (<column_name>);`
- Migration phải chạy độc lập được qua lệnh CLI (`npm run migrate` hoặc `node src/config/database_migration.js`) hoặc được gọi tự động khi khởi động server trước `sequelize.sync()`.
