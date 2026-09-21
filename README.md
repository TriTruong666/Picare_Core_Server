# Picare Core Hub - Shared Service Hub

## Overview
**Picare Core Hub** is a centralized service hub designed to provide shared functionalities across the Picare ecosystem. It acts as the "Source of Truth" for identity, authentication, and core configurations, allowing other microservices and applications to offload these responsibilities.

The architecture is built for high performance and scalability, utilizing **Express** for RESTful APIs and **gRPC** for efficient inter-service communication.

## Core Features
- 🔐 **Shared Authentication (Auth)**: Centralized JWT-based authentication for all Picare services.
- 👥 **User Management**: Unified user profiles and RBAC (Role-Based Access Control).
- ⚙️ **Dynamic App Configuration**: Manage application-wide settings and service credentials in real-time via Database.
- 💬 **Real-time Communication**: Integrated Chat service with Socket.io for instant messaging.
- 🚀 **Inter-Service Connectivity**: Optimized for backend-to-backend communication via gRPC (Auth, Authorize, Profile lookups).

## Technology Stack
- **Backend**: Node.js (Express)
- **Database**: PostgreSQL (Sequelize ORM)
- **Caching**: Redis (ioredis)
- **Protocols**: REST API, Socket.io, gRPC (Planned/In-progress)
- **Authentication**: JWT, Bcrypt

## Project Structure
```text
picare-core-hub/
├── src/
│   ├── config/         # Infra and Dynamic configs
│   ├── controllers/    # Request handlers
│   ├── middlewares/    # Auth, Logger, Error handlers
│   ├── models/         # Sequelize Models (User, AppConfig, Chat)
│   ├── routes/         # REST API Routes
│   ├── services/       # Business logic & Core services
│   ├── schemas/        # Data validation (express-validator)
│   ├── seeds/          # Initial data seeding
│   └── utils/          # Helper functions
├── proto/              # Protocol Definitions (gRPC)
└── server.js           # Main entry point
```

## gRPC Integration
For backend-to-backend communication, this hub provides gRPC services for:
1. **Auth Service**: Validate tokens and retrieve user permissions.
2. **User Service**: Fetch user details across services without database duplication.
3. **Config Service**: Sync dynamic configurations across the ecosystem.
4. **S3 Service**: Queue upload, stream download, metadata lookup and delete for other Picare services.

Storage RPC authentication is opt-in so existing internal clients remain
compatible. Enable it explicitly to require metadata `x-service-token` and
allowed-prefix checks:

```dotenv
# Picare Core Hub
GRPC_STORAGE_AUTH_ENABLED=true
GRPC_STORAGE_SERVICE_TOKEN=replace-with-a-long-random-local-secret
GRPC_STORAGE_ALLOWED_PREFIXES=picare-intelligent/
```

When `GRPC_STORAGE_AUTH_ENABLED` is absent or `false`, storage RPCs behave like
the legacy version and do not require a service token or enforce prefixes.

Login from a new IP requires a six-digit code sent by email. Configure the
verification policy with these environment variables:

```dotenv
# Enabled by default. Set false only for an emergency legacy-login rollback.
AUTH_LOGIN_VERIFICATION_ENABLED=true
AUTH_LOGIN_RATE_LIMIT_ENABLED=true
AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS=900
AUTH_LOGIN_RATE_LIMIT_MAX_PER_IP=50
AUTH_LOGIN_RATE_LIMIT_MAX_PER_ACCOUNT=10

# Use a dedicated long random secret in production. JWT_SECRET is only a fallback.
AUTH_OTP_SECRET=replace-with-a-long-random-secret
AUTH_LOGIN_OTP_TTL_SECONDS=300
AUTH_LOGIN_OTP_MAX_ATTEMPTS=5
AUTH_LOGIN_OTP_RESEND_COOLDOWN_SECONDS=60
AUTH_LOGIN_OTP_MAX_RESENDS=3
AUTH_TRUSTED_IP_TTL_DAYS=30
AUTH_TRUSTED_IP_MAX_RECORDS=10

# Optional: defaults to the existing E-Contract SMTP account.
AUTH_SMTP_USER=verified-sender@gmail.com
AUTH_MAIL_FROM=verified-sender@gmail.com
AUTH_MAIL_FROM_NAME=Picare Client

# Set to the exact trusted proxy hop count when deployed behind Nginx/load balancer.
TRUST_PROXY=1
```

Database reset flags default to `false`. Never enable them in production:

```dotenv
DB_RESET=false
DB_FORCE_RESET=false
```

`TRUST_PROXY` should remain disabled when clients connect directly to Express;
an incorrect value can allow a client-supplied forwarded IP to be trusted.

Picare Intelligent connects to this server with `STORAGE_GRPC_TARGET` and sends the matching `STORAGE_GRPC_SERVICE_TOKEN`. S3 credentials remain only in Core Hub.

Xem contract, dependency và cách chạy test tại [docs/grpc-storage.md](docs/grpc-storage.md).

---

## Getting Started

### Prerequisites
- Node.js (v18+)
- PostgreSQL
- Redis

### Installation
1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment:
   - Copy `.env.example` to `.env.development`
   - Fill in your DB and Redis credentials.

### Running the App
```bash
# Development mode
npm run dev

# Production mode
npm start
```

## Documentation
- **Swagger UI**: Access `/api-docs` on localhost to view REST API documentation.
- **Health Check**: Monitor service status at `/health`.
