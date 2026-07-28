const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");
const grpcAuthHandler = require("./grpc_auth.handler");
const grpcLicenseHandler = require("./grpc_license.handler");
const grpcS3Handler = require("./grpc_s3.handler");
const { maxGrpcMessageBytes } = require("../config/upload.config");

// Đường dẫn file proto
const PROTO_PATH = path.join(__dirname, "../../proto/auth.proto");

// Load proto file
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const authProto = grpc.loadPackageDefinition(packageDefinition).auth;

/**
 * Khởi tạo và khởi chạy gRPC Server
 */
function startGrpcServer(port = 50051) {
  const server = new grpc.Server({
    "grpc.max_receive_message_length": maxGrpcMessageBytes,
    "grpc.max_send_message_length": maxGrpcMessageBytes,
  });

  // Đăng ký service Auth
  server.addService(authProto.AuthService.service, {
    VerifyToken: grpcAuthHandler.verifyToken,
    CheckPermission: grpcAuthHandler.checkPermission,
    ListUsers: grpcAuthHandler.listUsers,
    GetUser: grpcAuthHandler.getUser,
  });

  // Đăng ký service License
  server.addService(authProto.LicenseService.service, {
    GetLicenseConfig: grpcLicenseHandler.getLicenseConfig,
    CheckLicense: grpcLicenseHandler.checkLicense,
    CreateTicket: grpcLicenseHandler.createTicket,
    ListTickets: grpcLicenseHandler.listTickets,
    GetTicket: grpcLicenseHandler.getTicket,
  });

  server.addService(authProto.S3Service.service, {
    QueueUpload: grpcS3Handler.queueUpload,
    GetUploadJob: grpcS3Handler.getUploadJob,
  });


  server.bindAsync(
    `0.0.0.0:${port}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error(`[gRPC]: Khởi động thất bại: ${err.message}`);
        return;
      }
      console.log(`[gRPC]: Service Hub đang chạy tại port: ${port}`);
    }
  );

  return server;
}

module.exports = { startGrpcServer };
