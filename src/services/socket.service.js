const { Server } = require("socket.io");
const JWTService = require("./jwt.service");
const config = require("../config/app.config");

/**
 * SocketService quản lý việc khởi tạo và tương tác với Socket.io
 */
class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> Set of socketIds
  }

  /**
   * Khởi tạo Socket.io với server HTTP
   * @param {Object} httpServer 
   */
  init(httpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: config.cors,
        methods: ["GET", "POST"],
        credentials: true
      },
      pingTimeout: 60000,
    });

    // Middleware xác thực JWT
    this.io.use((socket, next) => {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(" ")[1];
      
      if (!token) {
        return next(new Error("Authentication error: No token provided"));
      }

      const decoded = JWTService.verify(token);
      if (!decoded) {
        return next(new Error("Authentication error: Invalid token"));
      }

      socket.user = decoded; // { userId, name, role, ... }
      next();
    });

    this.io.on("connection", (socket) => {
      this._handleConnection(socket);
    });

    console.log("[SOCKET]: Socket.io đã được khởi tạo.");
    return this.io;
  }

  /**
   * Xử lý sự kiện khi có client kết nối
   * @param {Socket} socket 
   */
  _handleConnection(socket) {
    const userId = socket.user.userId;
    console.log(`[SOCKET]: Client connected: ${socket.id} (User: ${userId})`);

    // Lưu socketId vào danh sách người dùng đang kết nối
    if (!this.connectedUsers.has(userId)) {
      this.connectedUsers.set(userId, new Set());
    }
    this.connectedUsers.get(userId).add(socket.id);

    // Join room cá nhân của user
    socket.join(`user:${userId}`);

    socket.on("disconnect", () => {
      console.log(`[SOCKET]: Client disconnected: ${socket.id} (User: ${userId})`);
      const userSockets = this.connectedUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          this.connectedUsers.delete(userId);
        }
      }
    });

    // Client join vào room của một conversation để nhận events
    socket.on("join_conversation", ({ conversationId }) => {
      if (!conversationId) return;
      socket.join(`conversation:${conversationId}`);
      console.log(`[SOCKET]: ${socket.id} joined conversation:${conversationId}`);
    });

    // Client rời khỏi room của một conversation
    socket.on("leave_conversation", ({ conversationId }) => {
      if (!conversationId) return;
      socket.leave(`conversation:${conversationId}`);
      console.log(`[SOCKET]: ${socket.id} left conversation:${conversationId}`);
    });

    // Các event chung khác có thể thêm ở đây
    socket.on("error", (err) => {
      console.error(`[SOCKET ERROR] Socket ${socket.id}:`, err);
    });
  }

  /**
   * Gửi event cho tất cả client
   * @param {string} event 
   * @param {any} data 
   */
  emitToAll(event, data) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  /**
   * Gửi event cho một user cụ thể (tất cả các socket của user đó)
   * @param {string} userId 
   * @param {string} event 
   * @param {any} data 
   */
  emitToUser(userId, event, data) {
    if (this.io) {
      this.io.to(`user:${userId}`).emit(event, data);
    }
  }

  /**
   * Gửi event tới một room
   * @param {string} room 
   * @param {string} event 
   * @param {any} data 
   */
  emitToRoom(room, event, data) {
    if (this.io) {
      this.io.to(room).emit(event, data);
    }
  }

  /**
   * Lấy instance của io
   */
  getIO() {
    return this.io;
  }
}

// Export singleton instance
const socketService = new SocketService();
module.exports = socketService;
