const chatSecurity = require("./chat_security.service");
const Redis = require("ioredis");
const config = require("../config/app.config");

/**
 * SSEPublisherService handles sending real-time events to the shared Redis Event Bus.
 * Other services (Office, OMS, WMS, SFA) subscribe to these channels and forward messages to clients.
 */
class SSEPublisherService {
  constructor() {
    this.redis = null;
    this._init();
  }

  _init() {
    const { host, port, password } = config.redis_event_bus;

    this.redis = new Redis({
      host,
      port,
      password,
      lazyConnect: process.env.NODE_ENV === "test",
      retryStrategy: (times) => Math.min(times * 50, 2000),
      connectTimeout: 10000,
    });

    this.redis.on("error", (err) => {
      if (process.env.NODE_ENV !== "test") {
        console.error("[SSE-PUBLISHER] Redis Error:", err.message);
      }
    });

    this.redis.on("connect", () => {
      console.log(`[SSE-PUBLISHER] Connected to Event Bus at ${host}:${port}`);
    });
  }

  /**
   * Publish an event to a specific user
   * @param {string} userId - Target user ID
   * @param {string} eventType - Type of event (e.g., 'NEW_MESSAGE')
   * @param {any} data - Payload to send
   */
  async publishToUser(userId, eventType, data) {
    if (!userId) return;
    return this.publishToUsers([userId], eventType, data);
  }

  /**
   * Publish an event to multiple users in a single Redis Pipeline round-trip.
   * Simultaneously publishes to:
   * - `user:{userId}` (per-user direct channel)
   * - `sse:chat` (unified SSE channel with `targetUserIds` filter for Office/OMS/WMS/SFA)
   *
   * @param {string[]} userIds
   * @param {string} eventType
   * @param {any} data
   */
  async publishToUsers(userIds, eventType, data) {
    data = chatSecurity.event(data);
    const uniqueUserIds = [
      ...new Set((userIds || []).filter((uid) => Boolean(uid))),
    ];
    if (uniqueUserIds.length === 0 || !this.redis) return;

    const timestamp = new Date().toISOString();
    const source = config.app.name;

    try {
      if (typeof this.redis.pipeline === "function") {
        const pipeline = this.redis.pipeline();

        for (const userId of uniqueUserIds) {
          const userChannel = `user:${userId}`;
          const message = {
            type: eventType,
            userId,
            payload: data,
            timestamp,
            source,
          };
          pipeline.publish(userChannel, JSON.stringify(message));
        }

        // Unified SSE channel compatible with Office/OMS/WMS/SFA sseConfig
        const sseEnvelope = {
          event: eventType,
          data,
          targetClientId: uniqueUserIds,
          targetUserIds: uniqueUserIds,
          timestamp,
          source,
        };
        pipeline.publish("sse:chat", JSON.stringify(sseEnvelope));

        await pipeline.exec();
      } else {
        for (const userId of uniqueUserIds) {
          await this.redis.publish(
            `user:${userId}`,
            JSON.stringify({
              type: eventType,
              userId,
              payload: data,
              timestamp,
              source,
            }),
          );
        }
      }
    } catch (err) {
      console.error(`[SSE-PUBLISHER] Failed to publish batch ${eventType}:`, err);
    }
  }

  /**
   * Publish a global event to all connected clients across all servers
   * @param {string} eventType
   * @param {any} data
   */
  async publishGlobal(eventType, data) {
    const channel = "global:events";
    const message = {
      type: eventType,
      payload: data,
      timestamp: new Date().toISOString(),
      source: config.app.name,
    };

    try {
      await this.redis.publish(channel, JSON.stringify(message));
    } catch (err) {
      console.error(`[SSE-PUBLISHER] Failed to publish global message:`, err);
    }
  }
}

module.exports = new SSEPublisherService();
module.exports.SSEPublisherService = SSEPublisherService;
