# Hướng dẫn Triển khai Picare Core Hub (Backend & Infrastructure)

Tài liệu này hướng dẫn cách thiết lập và triển khai hệ thống theo mô hình tách biệt giữa **Hạ tầng (Infrastructure)** và **Ứng dụng (Backend)** bằng Docker và GitHub Actions.

---

## 1. Kiến trúc Tổng quan
- **Mạng chung (Docker Network):** `picare-network` (giúp các container giao tiếp nội bộ bằng tên service).
- **Hạ tầng (Infra):** Postgres, Redis (Ít thay đổi, cần tính ổn định cao).
- **Backend (App):** Node.js App (Thay đổi liên tục qua CI/CD).

---

## 2. Phần 1: Thiết lập Hạ tầng (Infra) trên VPS
Thực hiện việc này **một lần duy nhất** hoặc khi cần thay đổi cấu hình DB/Redis.

### Bước 1: Tạo mạng nội bộ Docker
```bash
docker network create picare-network
```

### Bước 2: Tạo file `docker-compose.infra.yml` trên VPS
Lưu tại: `~/projects/picare-hub/infra/docker-compose.yml`

```yaml
version: '3.8'
services:
  picare-core-postgres:
    image: postgres:15-alpine
    container_name: picare-core-postgres
    restart: always
    environment:
      POSTGRES_DB: picare_core_db
      POSTGRES_USER: picare_dev
      POSTGRES_PASSWORD: M@tkhau123
    ports:
      - "5441:5432" # 5441 dùng để kết nối từ bên ngoài (pgAdmin)
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - picare-network

  picare-core-redis:
    image: redis:alpine
    container_name: picare-core-redis
    restart: always
    command: redis-server --requirepass M@tkhau123
    ports:
      - "6380:6379" # 6380 dùng cho kết nối từ bên ngoài
    networks:
      - picare-network

networks:
  picare-network:
    external: true

volumes:
  pgdata:
```

### Bước 3: Chạy Infra
```bash
docker compose -f docker-compose.infra.yml up -d
```

---

## 3. Phần 2: Cấu hình Backend (App)
Đây là phần sẽ được cập nhật tự động mỗi khi bạn push code.

### Bước 1: File `.env.production` (Dùng cho App trong Docker)
**Quan trọng:** App chạy trong Docker phải dùng Port nội bộ (5432, 6379) và tên service của Infra.

```env
NODE_ENV=production
# Kết nối nội bộ qua picare-network
DB_HOST=picare-core-postgres
DB_PORT=5432 
DB_NAME=picare_core_db
DB_USER=picare_dev
DB_PASSWORD=M@tkhau123

REDIS_HOST=picare-core-redis
REDIS_PORT=6379
REDIS_PASSWORD=M@tkhau123

SERVER_PORT=1905
GRPC_PORT=50051
```

### Bước 2: File `docker-compose.prod.yml` (Trong source code)
```yaml
services:
  picare-hub-server:
    image: ghcr.io/tritruong666/picare-hub-server:latest
    container_name: picare-hub-server
    restart: always
    env_file:
      - .env
    volumes:
      - ./src/seeds/local_data:/app/src/seeds/local_data # Mount file seed từ VPS vào Docker
    networks:
      - picare-network
      - web_network # Dùng cho Nginx Reverse Proxy nếu có

networks:
  picare-network:
    external: true
  web_network:
    external: true
```

---

## 4. Phần 3: Quy trình CI/CD qua GitHub Actions

### Các bí mật cần cấu hình (GitHub Secrets):
1. `SERVER_HOST`: IP của VPS.
2. `SERVER_USER`: User đăng nhập (ví dụ: `tritruong`).
3. `SERVER_SSH_KEY`: Private Key để SSH vào VPS.
4. `PICARE_HUB_PRODUCTION_ENV`: Toàn bộ nội dung file `.env` sản xuất.
5. `PICARE_USER_SEED_JSON`: Nội dung file json để seed dữ liệu.

### Quy trình tự động trong `deploy.yml`:
1. **Build & Push:** Build Docker image và đẩy lên GitHub Container Registry (GHCR).
2. **Deploy via SSH:**
   - SSH vào VPS.
   - Tạo thư mục dự án và thư mục seed dữ liệu.
   - Ghi nội dung từ Secrets vào file `.env` và `user_seed_data.json` trên VPS.
   - Copy `docker-compose.prod.yml` mới nhất lên.
   - Chạy `docker compose pull` và `up -d`.

---

## 5. Các lưu ý "Sống còn" (Troubleshooting)

1. **Internal vs External Port:**
   - Kết nối từ máy cá nhân (pgAdmin, Redis Insight): Dùng cổng **5441** và **6380**.
   - App kết nối Database (trong Docker): Phải dùng cổng **5432** và **6379**.

2. **File `.gitignore`:**
   - Tuyệt đối KHÔNG ignore `Dockerfile`, `docker-compose.prod.yml`. GitHub Actions cần chúng để build và deploy.

3. **Lỗi Seed dữ liệu (ENOENT):**
   - Luôn sử dụng `volumes` trong `docker-compose` để gắn file từ bên ngoài VPS vào bên trong container thì App mới thấy file đó.

4. **Nginx Config:**
   - Nếu dùng Nginx làm Proxy, hãy dùng `grpc_pass` cho các luồng nghiệp vụ và `proxy_pass` cho `/health`. Yêu cầu Nginx phải bật `http2`.
