# Picare Distributed SSE Integration Guide

This guide explains how to connect any backend service (like OMS) to the shared Real-time Event Bus (Redis) provided by **Picare Core**.

## 1. Connection Requirements

All services must connect to the same Redis instance used as the **Event Bus**.

**Environment Variables:**
```bash
# Must match Core settings
REDIS_EVENT_BUS_HOST=picare-core-redis
REDIS_EVENT_BUS_PORT=6379
REDIS_EVENT_BUS_PASSWORD=M@tkhau123
```

---

## 2. Channel Strategy

Core publishes messages to specific channels in Redis:
- **User-Specific Events**: `user:{userId}` (e.g., `user:123`)
- **Global Events**: `global:events`

---

## 3. Message Format (JSON)

Every message received from Redis follows this standard structure:

```json
{
  "type": "NEW_MESSAGE",       // Event Type (Uppercase)
  "userId": "user-uuid",       // Target User (optional for global)
  "payload": { ... },          // The actual data
  "timestamp": "2024-04-28...",
  "source": "Picare Core Hub"
}
```

---

## 4. Implementation Example (Node.js/Express)

Here is how you should implement the **SSE Subscriber** in your service (e.g., OMS):

### A. Setup Redis Subscriber
```javascript
const Redis = require("ioredis");

const subscriber = new Redis({
  host: process.env.REDIS_EVENT_BUS_HOST,
  port: process.env.REDIS_EVENT_BUS_PORT,
  password: process.env.REDIS_EVENT_BUS_PASSWORD
});

// Map to store active SSE connections: userId -> Response Object
const activeConnections = new Map();

subscriber.on("message", (channel, message) => {
  const data = JSON.parse(message);
  
  if (channel.startsWith("user:")) {
    const userId = data.userId;
    const clientRes = activeConnections.get(userId);
    
    if (clientRes) {
      clientRes.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  } else if (channel === "global:events") {
    // Broadcast to ALL active connections
    activeConnections.forEach(res => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
  }
});

// Subscribe to channels
subscriber.subscribe("global:events");
// Note: In addition to global, you should subscribe to specific user channels 
// as they connect, or use psubscribe("user:*") for simplicity.
subscriber.psubscribe("user:*"); 
```

### B. Setup SSE Endpoint
```javascript
app.get('/api/v1/sse', (req, res) => {
  const userId = req.user.id; // Get from JWT/Auth middleware

  // Headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Store connection
  activeConnections.set(userId, res);
  console.log(`User ${userId} connected to SSE`);

  // Send initial keep-alive
  res.write(':ok\n\n');

  // Cleanup on disconnect
  req.on('close', () => {
    activeConnections.delete(userId);
    console.log(`User ${userId} disconnected from SSE`);
  });
});
```

---

## 5. Security Checklist
1. **Authentication**: Always protect the SSE endpoint with JWT.
2. **Authorization**: OMS must ensure that it only forwards `user:123` messages to the client which is actually authenticated as `user:123`.
3. **Heartbeat**: Send a comment line (e.g., `:heartbeat\n\n`) every 30 seconds to keep the connection alive through proxies/load balancers.
