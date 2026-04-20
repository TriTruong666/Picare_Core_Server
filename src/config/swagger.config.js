const swaggerJSDoc = require("swagger-jsdoc");
const config = require("./app.config");

const swaggerDefinition = {
  openapi: "3.0.0",
  info: {
    title: config.app.name || "Picare Centralized Server API",
    version: config.app.version || "1.0.0",
    description: "Tài liệu API OMS - Picare",
  },
  servers: [
    {
      url: `http://localhost:${config.app.port}`,
      description: "Local server",
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      HaravanOrder: {
        type: "object",
        properties: {
          id: { type: "integer" },
          orderId: { type: "string" },
          haravanId: { type: "string" },
          saleDate: { type: "string", format: "date-time" },
          financialStatus: { type: "string" },
          carrierStatus: { type: "string" },
          totalPrice: { type: "number" },
          status: { type: "string" },
          companyName: { type: "string" },
        },
      },
      User: {
        type: "object",
        properties: {
          userId: { type: "string" },
          username: { type: "string" },
          fullName: { type: "string" },
          email: { type: "string" },
          role: { type: "string", enum: ["admin", "ecom", "warehouse", "viewer"] },
          companyId: { type: "string" },
        },
      },
      AuthResponse: {
        type: "object",
        properties: {
          token: { type: "string" },
          user: { $ref: "#/components/schemas/User" },
        },
      },
      Company: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          companyName: { type: "string" },
          address: { type: "string" },
          phone: { type: "string" },
          isActive: { type: "boolean" },
        },
      },
      Integration: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["HARAVAN", "MISA", "SHOPEE", "TIKTOK"] },
          configData: { type: "object" },
          isActive: { type: "boolean" },
          companyId: { type: "string" },
        },
      },
      ActivityLog: {
        type: "object",
        properties: {
          logId: { type: "integer" },
          userId: { type: "string" },
          action: { type: "string" },
          target: { type: "string" },
          oldValue: { type: "object" },
          newValue: { type: "object" },
          ipAddress: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      CommonResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          message: { type: "string" },
          data: { type: "object" },
        },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          message: { type: "string" },
          errorCode: { type: "string" },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", example: "admin@picare.vn" },
          password: { type: "string", example: "123456" },
        },
      },
      RegisterRequest: {
        type: "object",
        required: ["name", "email", "password"],
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          password: { type: "string" },
          phone: { type: "string" },
        },
      },
      CreateCompanyRequest: {
        type: "object",
        required: ["companyName"],
        properties: {
          companyName: { type: "string", example: "Picare Việt Nam" },
        },
      },
      UpsertIntegrationRequest: {
        type: "object",
        required: ["platform", "configData"],
        properties: {
          platform: {
            type: "string",
            enum: ["HARAVAN", "MISA", "SHOPEE", "TIKTOK"],
            description: "Tên nền tảng cần kết nối",
          },
          configData: {
            type: "object",
            description: "Dữ liệu cấu hình (Token, AppId, Secret...)",
            example: {
              secretValue: "your_api_token_here",
            },
          },
          isActive: { type: "boolean", example: true },
        },
      },
      UpdateUserRequest: {
        type: "object",
        properties: {
          fullName: { type: "string" },
          role: { type: "string", enum: ["admin", "ecom", "warehouse", "viewer"] },
        },
      },
      Pagination: {
        type: "object",
        properties: {
          totalRecords: { type: "integer" },
          totalPages: { type: "integer" },
          currentPage: { type: "integer" },
          pageSize: { type: "integer" },
        },
      },
      Shop: {
        type: "object",
        properties: {
          id: { type: "integer" },
          shopId: { type: "string" },
          shopName: { type: "string" },
          platform: { type: "string", enum: ["SHOPEE", "TIKTOK"] },
          companyId: { type: "string" },
          companyName: { type: "string" },
          isActive: { type: "boolean" },
          configData: { type: "object" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          company: { $ref: "#/components/schemas/Company" },
        },
      },
      CreateShopRequest: {
        type: "object",
        required: ["platform", "companyId", "companyName"],
        properties: {
          shopId: { type: "string", description: "ID shop từ platform (ví dụ: SHOPEE ID)" },
          shopName: { type: "string", description: "Tên shop hiển thị" },
          platform: { type: "string", enum: ["shopee", "tiktok"], description: "Nền tảng (shopee/tiktok)" },
          companyId: { type: "string", description: "Mã công ty liên kết" },
          companyName: { type: "string", description: "Tên công ty" },
          isActive: { type: "boolean", default: true },
          configData: {
            type: "object",
            description: "Dữ liệu cấu hình cho shop",
            example: {
              partner_id: "12345",
              partner_key: "abcde...",
              platform_shop_id: "67890",
            },
          },
        },
      },
    },
  },
  security: [
    {
      bearerAuth: [],
    },
  ],
};

const options = {
  swaggerDefinition,
  // Thư mục chứa các API routes đính kèm JSDoc (VD: src/routes/*.js)
  apis: ["./src/routes/*.js"],
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;
