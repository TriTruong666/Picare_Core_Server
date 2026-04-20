# About Picare Core Hub

Picare Core Hub is the **central nervous system** of the Picare microservice architecture. It provides a set of shared services that other backend systems can consume via high-speed gRPC calls or standard REST APIs.

## Key Developer Context
- **Role**: Shared Service Provider.
- **Communication Protocol**: 
  - **REST**: Frontend integration and general API access.
  - **gRPC**: Backend-to-backend communication (Identity verification, Access control, Profile sync).
- **Core Entities**: 
  - `User`: Centralized user database.
  - `AppConfig`: Real-time system configuration management.
  - `Chat`: Real-time messaging infrastructure.
- **Microservice Ready**: The project is designed to be the single source of truth for Auth and Config, allowing other services to remain stateless regarding user identity.
