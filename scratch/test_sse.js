const ssePublisher = require("../src/services/sse_publisher.service");

async function testPublish() {
  console.log("Starting SSE Publish Test...");
  
  try {
    // 1. Test User Publish
    await ssePublisher.publishToUser("test-user-123", "TEST_EVENT", {
      hello: "world",
      foo: "bar"
    });
    
    // 2. Test Global Publish
    await ssePublisher.publishGlobal("GLOBAL_ANNOUNCEMENT", {
      message: "System will restart in 5 minutes"
    });
    
    console.log("Test execution finished.");
    process.exit(0);
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
}

testPublish();
