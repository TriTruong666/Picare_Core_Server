---
name: API Architecture and Design Pattern
description: Hướng dẫn cấu trúc thiết kế một API hoàn chỉnh từ Model, Service (core logic), Controller, Route (Schemas) dựa trên Auth API.
---

# Kiến trúc thiết kế API hoàn chỉnh trong project

Toàn bộ repository được thiết kế theo mô hình kiến trúc phân lớp (Layered Architecture). Luồng đi của một request sẽ từ ngoài vào trong và quay ngược lại theo thứ tự:

**Route -> Schema (Middleware) -> Controller -> Service -> Model -> Database**

---

## 1. Model Layer (`src/models/`) - Định nghĩa cấu trúc dữ liệu cơ sở
Đây là nơi giao tiếp trực tiếp với Database (sử dụng ORM Sequelize kết nối Postgres).
- Định nghĩa các thuộc tính, kiểu dữ liệu, ràng buộc (constraints).
- Sử dụng các `hooks` (beforeCreate, beforeUpdate) lưu trữ các logic mức độ Data như tự động hash password.
- Thêm các instance methods (ví dụ: `comparePassword`).

**Ví dụ (`user.model.js`):**
```javascript
const { DataTypes } = require("sequelize");
const sequelize = require("../config/postgres.config");
const bcrypt = require("bcrypt");

const User = sequelize.define("User", {
  userId: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    allowNull: false,
    unique: true
  },
  email: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
  }
  // ...
}, {
  tableName: "users",
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        const salt = await bcrypt.genSalt(12);
        user.password = await bcrypt.hash(user.password, salt);
      }
    }
  }
});
```

---

## 2. Schema Layer (`src/schemas/`) - Xác thực dữ liệu đầu vào & DTOs
Được dùng như một Middleware trước khi request tới Controller.
- Sử dụng `express-validator` để kiểm tra validation và sanitization (vd: `.isEmail()`, `.notEmpty()`).
- Định nghĩa Data Transfer Object (DTO) để format gọn lại dữ liệu trả về cho client (loại bỏ các trường nhạy cảm như password).

**Ví dụ (`auth.schema.js`):**
```javascript
const { body } = require("express-validator");

class UserDTO {
  constructor(user) {
    this.userId = user.userId;
    this.name = user.name;
    this.email = user.email;
  }
  static fromUser(user) { return new UserDTO(user); }
}

const loginSchema = [
  body("email").isEmail().withMessage("Email không hợp lệ").normalizeEmail(),
  body("password").isLength({ min: 6 }).withMessage("Mật khẩu phải có ít nhất 6 ký tự"),
];

module.exports = { UserDTO, loginSchema };
```

---

## 3. Route Layer (`src/routes/`) - Định hướng API & Swagger Documentation
Là nơi đấu nối endpoint, gắn HTTP method (GET, POST...) với Schema xác thực và Controller tương ứng. 
**QUAN TRỌNG:** Tất cả các Route mới đều phải được viết tài liệu bằng `Swagger (OpenAPI 3.0)` ngay trên đầu mỗi endpoint để Frontend có thể tra cứu.

**Ví dụ (`auth.routes.js`):**
```javascript
const express = require("express");
const router = express.Router();
const AuthController = require("../controllers/auth.controller");
const { loginSchema } = require("../schemas/auth.schema");

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Đăng nhập vào hệ thống
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Đăng nhập thành công
 */
router.post("/login", loginSchema, AuthController.login);

module.exports = router;
```


---

## 4. Controller Layer (`src/controllers/`) - Xử lý HTTP Request / Response
Lớp này **trung gian** đứng giữa Request của User và Service (System Logic). Nó KHÔNG NÊN chứa logic nghiệp vụ phức tạp.
- Hứng request.
- Kiểm tra tính hợp lệ của schema bằng `validationResult(req)`.
- Trích xuất dữ liệu (`req.body`, `req.params`, v.v.).
- Gọi đến `Service` và chờ nhận kết quả.
- Trả về response thông qua class `ResponseHandler` hoăc set Cookie. Nếu lỗi xảy ra, đẩy sang `next(error)`.

**Ví dụ (`auth.controller.js`):**
```javascript
const AuthService = require("../services/auth.service");
const ResponseHandler = require("../common/response.handler");
const { validationResult } = require("express-validator");
const { BadRequestException } = require("../common/exceptions/BaseException");

class AuthController {
  static async login(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new BadRequestException("Báo lỗi validation", errors.array());
      }

      const { email, password } = req.body;
      const result = await AuthService.login({ email, password });

      // Gọi logic trả về cookie hoặc API Response.
      return ResponseHandler.success(res, null, result.message);
    } catch (error) {
      next(error); // Chuyển lỗi tới Error Handler Middleware chung của hệ thống
    }
  }
}
```

---

## 5. Service Layer (`src/services/`) - Trái tim logic nghiệp vụ
Logic nghiệp vụ thực tế nằm hoàn toàn ở đây.
- KHÔNG biết tới `req`, `res`. Chỉ nhận tham số truyền vào từ Controller.
- Làm việc với Database (thông qua Model).
- Nếu có lỗi logic nghiệp vụ rẽ nhánh, trực tiếp `throw` các `Custom Exception` (như `UnauthorizedException`, `BadRequestException`) để Controller và Error Handler xử lý.
- Có thể kết nối các dịch vụ bên thứ ba ở lớp này.
- Trả về dữ liệu sạch cho Controller.

**Ví dụ (`auth.service.js`):**
```javascript
const User = require("../models/user.model");
const JWTService = require("./jwt.service");
const { UnauthorizedException } = require("../common/exceptions/BaseException");

class AuthService {
  static async login({ email, password }) {
    const user = await User.findOne({ where: { email } });

    if (!user) {
      throw new UnauthorizedException("Tài khoản hoặc Mật khẩu sai!");
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new UnauthorizedException("Tài khoản hoặc Mật khẩu sai!");
    }

    const token = JWTService.signUser(user.name, user.role, user.userId);

    return {
      message: "Đăng nhập thành công",
      token,
    };
  }
}
```

## Tổng kết quy trình hoàn hảo
1. **Thiết kế Model:** Cấu trúc bảng và các hooks/hàm cơ bản liên quan trực tiếp tới dữ liệu.
2. **Setup Schema & DTO:** Dùng package `express-validator` để dựng khiên kiểm tra đầu vào trước khi đụng vào code. Định hình DTO cấu trúc để giấu data thừa.
3. **Viết Service logic:** Tập trung xử lý tính năng nghiệp vụ. Test logic độc lập. `throw custom Error` kịp lúc nếu logic fail.
4. **Kết nối Controller:** Gọi service trong try..catch, xử lý nhận/trả Data + response HTTP Formats chuẩn của dự án thông qua `ResponseHandler`.
5. **Gắn Route & Viết Swagger:** Liên kết URL -> Middleware (Schema) -> Controller. **Phải viết kèm JSDoc Swagger** ngay lúc này để hoàn tất thiết kế API.
6. **Kiểm tra:** Truy cập `http://localhost:<PORT>/api-docs` để kiểm tra doc vừa viết.

