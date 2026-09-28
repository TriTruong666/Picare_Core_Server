const redis = require("../config/redis.config");

const CHANNEL = "core-storage-worker-events";

async function publishToUser(userId, event, data) {
  await redis.publish(CHANNEL, JSON.stringify({ userId, event, data }));
}

function subscribeToUserEvents(socketService) {
  const subscriber = redis.duplicate();
  subscriber.on("error", (error) => {
    console.error("[S3]: storage event subscriber error:", error);
  });
  subscriber.on("message", (channel, message) => {
    if (channel !== CHANNEL || !socketService.getIO()) return;
    try {
      const { userId, event, data } = JSON.parse(message);
      if (userId && event) socketService.emitToUser(userId, event, data);
    } catch (error) {
      console.error("[S3]: invalid storage worker event:", error);
    }
  });
  subscriber.subscribe(CHANNEL).catch((error) => {
    console.error("[S3]: cannot subscribe storage worker events:", error);
  });
  return subscriber;
}

module.exports = { publishToUser, subscribeToUserEvents };
