const chatSecurity = require("./chat_security.service");
const { Server } = require("socket.io");
const JWTService = require("./jwt.service");
const config = require("../config/app.config");
const { subscribeToUserEvents } = require("./storage_worker_events.service");
const ConversationMember = require("../models/chat/conversation_member.model");
const {
  resolveDbConversationId,
  toPublicConversationId,
} = require("../common/chat_constants");

/**
 * SocketService quản lý việc khởi tạo và tương tác với Socket.io
 */
class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> Set of socketIds
    this.membershipVerifier = null;
  }

  /**
   * Cho phép inject hàm kiểm tra thành viên hội thoại (hoặc mặc định dùng ConversationMember)
   * @param {(conversationId: string, userId: string) => Promise<boolean>} fn
   */
  setMembershipVerifier(fn) {
    this.membershipVerifier = fn;
  }

  async verifyConversationMember(conversationId, userId) {
    if (!conversationId || !userId) return false;
    const dbConversationId = resolveDbConversationId(conversationId);
    if (typeof this.membershipVerifier === "function") {
      return Boolean(await this.membershipVerifier(dbConversationId, userId));
    }
    const membership = await ConversationMember.findOne({
      where: { conversationId: dbConversationId, userId, leftAt: null },
      attributes: ["id"],
    });
    if (membership) return true;

    // Allow Admin / System account to join conversation room
    try {
      const User = require("../models/user.model");
      const user = await User.findByPk(userId, { attributes: ["role", "email"] });
      if (user && (user.role === "admin" || user.email === "admin@picare.vn")) {
        return true;
      }
    } catch {
      // ignore
    }

    return false;
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
        credentials: true,
      },
      pingTimeout: 60000,
    });

    // Middleware xác thực JWT
    this.io.use(async (socket, next) => {
      try {
        let token =
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.split(" ")[1];

        if (!token && socket.handshake.headers?.cookie) {
          const cookieStr = socket.handshake.headers.cookie;
          const match = cookieStr.match(/(?:^|;\s*)token=([^;]+)/);
          if (match) {
            token = decodeURIComponent(match[1]);
          }
        }

        if (!token) {
          return next(new Error("Authentication error: No token provided"));
        }

        const decoded = await JWTService.verifyUserSession(token);
        if (!decoded) {
          return next(new Error("Authentication error: Invalid token"));
        }

        socket.user = decoded; // { userId, name, role, ... }
        return next();
      } catch (_error) {
        return next(new Error("Authentication error: Invalid token"));
      }
    });

    this.io.on("connection", (socket) => {
      this._handleConnection(socket);
    });

    subscribeToUserEvents(this);

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

    const wasOffline = !this.connectedUsers.has(userId);
    if (wasOffline) {
      this.connectedUsers.set(userId, new Set());
    }
    this.connectedUsers.get(userId).add(socket.id);

    // Join room cá nhân của user
    socket.join(`user:${userId}`);

    // Tự động join tất cả room conversation của user để nhận tin tức thời
    ConversationMember.findAll({
      where: { userId, leftAt: null },
      attributes: ["conversationId"],
    })
      .then((memberships) => {
        for (const m of memberships) {
          if (m.conversationId) {
            socket.join(
              `conversation:${toPublicConversationId(m.conversationId)}`,
            );
          }
        }
      })
      .catch((err) => {
        console.warn("[SOCKET]: Auto join conversations error:", err.message);
      });

    socket.on("disconnect", () => {
      console.log(
        `[SOCKET]: Client disconnected: ${socket.id} (User: ${userId})`,
      );
      const userSockets = this.connectedUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          this.connectedUsers.delete(userId);
        }
      }
    });

    // Client join vào room của một conversation (có kiểm tra tư cách thành viên C0)
    socket.on("join_conversation", async (payload = {}, ack) => {
      const { conversationId } = payload || {};
      if (!conversationId) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "conversationId is required" });
        }
        return;
      }

      try {
        const allowed = await this.verifyConversationMember(
          conversationId,
          userId,
        );
        if (!allowed) {
          socket.emit("conversation_join_denied", {
            conversationId,
            reason: "NOT_CONVERSATION_MEMBER",
          });
          if (typeof ack === "function") {
            ack({ ok: false, error: "NOT_CONVERSATION_MEMBER" });
          }
          return;
        }

        const publicConversationId = toPublicConversationId(
          resolveDbConversationId(conversationId),
        );
        socket.join(`conversation:${publicConversationId}`);
        socket.emit("conversation_joined", {
          conversationId: publicConversationId,
        });
        if (typeof ack === "function") {
          ack({ ok: true, conversationId: publicConversationId });
        }
      } catch (err) {
        console.error(
          `[SOCKET]: Error verifying membership for ${conversationId}:`,
          err.message,
        );
        if (typeof ack === "function") {
          ack({ ok: false, error: "INTERNAL_ERROR" });
        }
      }
    });

    // Client rời khỏi room của một conversation
    socket.on("leave_conversation", ({ conversationId } = {}) => {
      if (!conversationId) return;
      const publicConversationId = toPublicConversationId(
        resolveDbConversationId(conversationId),
      );
      socket.leave(`conversation:${publicConversationId}`);
    });

    // Typing indicators (C2)
    socket.on("typing_start", ({ conversationId } = {}) => {
      if (!conversationId) return;
      const publicConversationId = toPublicConversationId(
        resolveDbConversationId(conversationId),
      );
      if (!socket.rooms.has(`conversation:${publicConversationId}`)) return;
      socket.to(`conversation:${publicConversationId}`).emit("user_typing", {
        conversationId: publicConversationId,
        userId,
        name: socket.user.name || null,
        isTyping: true,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("typing_stop", ({ conversationId } = {}) => {
      if (!conversationId) return;
      const publicConversationId = toPublicConversationId(
        resolveDbConversationId(conversationId),
      );
      if (!socket.rooms.has(`conversation:${publicConversationId}`)) return;
      socket.to(`conversation:${publicConversationId}`).emit("user_typing", {
        conversationId: publicConversationId,
        userId,
        name: socket.user.name || null,
        isTyping: false,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("error", (err) => {
      console.error(`[SOCKET ERROR] Socket ${socket.id}:`, err);
    });
  }

  /**
   * Kiểm tra một user có đang kết nối Socket hay không
   * @param {string} userId
   */
  isUserOnline(userId) {
    const sockets = this.connectedUsers.get(userId);
    return Boolean(sockets && sockets.size > 0);
  }

  /**
   * Gửi event cho tất cả client
   * @param {string} event
   * @param {any} data
   */
  emitToAll(event, data) {
    data = chatSecurity.event(data);
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
    data = chatSecurity.event(data);
    if (this.io) {
      this.io.to(`user:${userId}`).emit(event, data);
    }
  }

  /**
   * Gửi event tới nhiều user cùng lúc
   * @param {string[]} userIds
   * @param {string} event
   * @param {any} data
   */
  emitToUsers(userIds, event, data) {
    data = chatSecurity.event(data);
    if (!this.io || !Array.isArray(userIds) || userIds.length === 0) return;
    const rooms = [...new Set(userIds.filter(Boolean))].map(
      (uid) => `user:${uid}`,
    );
    if (rooms.length > 0) {
      this.io.to(rooms).emit(event, data);
    }
  }

  /**
   * Gửi event tới một room
   * @param {string} room
   * @param {string} event
   * @param {any} data
   */
  emitToRoom(room, event, data) {
    data = chatSecurity.event(data);
    if (this.io) {
      this.io.to(room).emit(event, data);
    }
  }

  /**
   * Gửi event đồng thời tới room conversation và room cá nhân của các thành viên
   * (Socket.IO tự khử trùng lặp nếu 1 socket nằm trong cả 2 room, đảm bảo user đang mở tab khác vẫn nhận real-time)
   * @param {string} conversationId
   * @param {string[]} userIds
   * @param {string} event
   * @param {any} data
   */
  emitToConversationAndUsers(conversationId, userIds = [], event, data) {
    data = chatSecurity.event(data);
    if (!this.io) return;
    const rooms = [];
    if (conversationId) {
      rooms.push(
        `conversation:${toPublicConversationId(resolveDbConversationId(conversationId))}`,
      );
    }
    if (Array.isArray(userIds)) {
      for (const uid of userIds) {
        if (uid) rooms.push(`user:${uid}`);
      }
    }
    const uniqueRooms = [...new Set(rooms)];
    if (uniqueRooms.length > 0) {
      this.io.to(uniqueRooms).emit(event, data);
    }
  }

  /**
   * Cho các socket đang online của danh sách user tham gia vào room conversation mới
   * @param {string[]} userIds
   * @param {string} conversationId
   */
  addUsersToConversationRoom(userIds = [], conversationId) {
    if (!this.io || !conversationId || !Array.isArray(userIds)) return;
    const publicConversationId = toPublicConversationId(
      resolveDbConversationId(conversationId),
    );
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    for (const uid of uniqueIds) {
      this.io
        .in(`user:${uid}`)
        .socketsJoin(`conversation:${publicConversationId}`);
    }
  }

  /**
   * Đưa các socket đang online của danh sách user rời khỏi room conversation (khi rời nhóm hoặc bị kick)
   * @param {string[]} userIds
   * @param {string} conversationId
   */
  removeUsersFromConversationRoom(userIds = [], conversationId) {
    if (!this.io || !conversationId || !Array.isArray(userIds)) return;
    const publicConversationId = toPublicConversationId(
      resolveDbConversationId(conversationId),
    );
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    for (const uid of uniqueIds) {
      this.io
        .in(`user:${uid}`)
        .socketsLeave(`conversation:${publicConversationId}`);
    }
  }

  /**
   * Immediately close every active socket for a user after their session is revoked.
   */
  disconnectUser(userId, reason = "session_revoked") {
    if (!this.io || !userId) return 0;

    const socketIds = [...(this.connectedUsers.get(userId) || [])];
    for (const socketId of socketIds) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (!socket) continue;
      socket.emit("session_revoked", { reason });
      socket.disconnect(true);
    }

    return socketIds.length;
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
module.exports.SocketService = SocketService;
