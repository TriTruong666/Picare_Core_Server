const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");
const grpcAuthHandler = require("./grpc_auth.handler");

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
  const server = new grpc.Server();

  // Đăng ký service
  server.addService(authProto.AuthService.service, {
    VerifyToken: grpcAuthHandler.verifyToken,
    CheckPermission: grpcAuthHandler.checkPermission,
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
