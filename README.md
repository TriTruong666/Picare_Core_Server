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
