const Redis = require("ioredis");
const config = require("../config/app.config");

/**
 * SSEPublisherService handles sending real-time events to the shared Redis Event Bus.
 * Other services (like OMS) will subscribe to these channels and forward messages to clients.
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
      retryStrategy: (times) => Math.min(times * 50, 2000),
      connectTimeout: 10000,
    });

    this.redis.on("error", (err) => {
      console.error("[SSE-PUBLISHER] Redis Error:", err.message);
    });

    this.redis.on("connect", () => {
      console.log(`[SSE-PUBLISHER] Connected to Event Bus at ${host}:${port}`);
    });
  }

  /**
   * Publish an event to a specific user
   * @param {string} userId - Target user ID
   * @param {string} eventType - Type of event (e.g., 'NEW_NOTIFICATION')
   * @param {any} data - Payload to send
   */
  async publishToUser(userId, eventType, data) {
    const channel = `user:${userId}`;
    const message = {
      type: eventType,
      userId,
      payload: data,
      timestamp: new Date().toISOString(),
      source: config.app.name,
    };

    try {
      await this.redis.publish(channel, JSON.stringify(message));
      console.log(`[SSE-PUBLISHER] Published ${eventType} to user ${userId}`);
    } catch (err) {
      console.error(`[SSE-PUBLISHER] Failed to publish message:`, err);
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
      console.log(`[SSE-PUBLISHER] Published global event: ${eventType}`);
    } catch (err) {
      console.error(`[SSE-PUBLISHER] Failed to publish global message:`, err);
    }
  }
}

module.exports = new SSEPublisherService();
