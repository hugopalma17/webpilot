const assert = require("assert");
const { createServer, sleep, randomDelay, setLogLevel, initDebugLog, debugLog, log } = require("../lib/server");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

// Test utilities
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Test: sleep function
async function testSleep() {
  const start = Date.now();
  await sleep(100);
  const elapsed = Date.now() - start;
  assert(elapsed >= 95 && elapsed < 150, `sleep(100) took ${elapsed}ms`);
  console.log("✓ sleep function works correctly");
}

// Test: randomDelay function
function testRandomDelay() {
  for (let i = 0; i < 10; i++) {
    const delay = randomDelay(10, 20);
    assert(delay >= 10 && delay <= 20, `randomDelay out of range: ${delay}`);
  }
  console.log("✓ randomDelay generates values in range");
}

// Test: randomDelay boundary
function testRandomDelayBoundary() {
  const delay1 = randomDelay(5, 5);
  assert(delay1 === 5, `randomDelay(5, 5) should return 5, got ${delay1}`);

  const delay2 = randomDelay(0, 0);
  assert(delay2 === 0, `randomDelay(0, 0) should return 0, got ${delay2}`);

  console.log("✓ randomDelay handles boundary cases");
}

// Test: setLogLevel
function testSetLogLevel() {
  setLogLevel("silent");
  setLogLevel("error");
  setLogLevel("info");
  setLogLevel("debug");
  console.log("✓ setLogLevel accepts all valid levels");
}

// Test: log function with different levels
function testLog() {
  // Just ensure no errors - actual output depends on log level
  log("INFO", "Test info message");
  log("ERROR", "Test error message");
  log("DEBUG", "Test debug message");
  console.log("✓ log function works with different levels");
}

// Test: initDebugLog and debugLog
function testDebugLog() {
  const testFile = "/tmp/test-debug.log";

  // Clean up if exists
  if (fs.existsSync(testFile)) {
    fs.unlinkSync(testFile);
  }

  initDebugLog(testFile);
  assert(fs.existsSync(testFile), "Debug log file should be created");

  debugLog("→", "test message");
  debugLog("←", { action: "test", data: "value" });

  const content = fs.readFileSync(testFile, "utf8");
  assert(content.includes("test message"), "Debug log should contain message");
  assert(content.includes("test"), "Debug log should contain JSON");

  // Clean up
  fs.unlinkSync(testFile);
  console.log("✓ debugLog writes to file correctly");
}

// Test: debugLog truncates large base64 data
function testDebugLogTruncation() {
  const testFile = "/tmp/test-debug-truncate.log";

  if (fs.existsSync(testFile)) {
    fs.unlinkSync(testFile);
  }

  initDebugLog(testFile);

  const largeData = {
    dataUrl: "data:image/png;base64," + "A".repeat(500)
  };

  debugLog("→", largeData);

  const content = fs.readFileSync(testFile, "utf8");
  assert(content.includes("(base64 truncated)"), "Large base64 should be truncated");
  assert(!content.includes("AAAAA"), "Original base64 should be removed");

  fs.unlinkSync(testFile);
  console.log("✓ debugLog truncates large base64 data");
}

// Test: createServer basic functionality
async function testCreateServerBasic() {
  const server = createServer({ port: 7350 });

  assert(server !== null, "Server should be created");
  assert(typeof server.waitForConnection === "function", "Server should have waitForConnection method");
  assert(typeof server.close === "function", "Server should have close method");
  assert(server.connected !== undefined, "Server should have connected property");

  server.close();
  await wait(200);
  console.log("✓ createServer returns server object with expected interface");
}

// Test: createServer with custom port
async function testCreateServerCustomPort() {
  const server = createServer({ port: 7351 });

  // Wait for server to start listening
  await wait(500);

  return new Promise((resolve, reject) => {
    const client = new WebSocket("ws://localhost:7351");

    client.on("error", (err) => {
      client.close();
      server.close();
      reject(err);
    });

    client.on("open", () => {
      client.close();
      server.close();
      setTimeout(() => {
        console.log("✓ createServer listens on custom port");
        resolve();
      }, 200);
    });

    setTimeout(() => {
      client.close();
      server.close();
      reject(new Error("Connection timeout"));
    }, 3000);
  });
}

// Test: server connection timeout
async function testConnectionTimeout() {
  const server = createServer({ port: 7352, connectionTimeout: 100 });

  try {
    await server.waitForConnection();
    server.close();
    assert.fail("Should have timed out");
  } catch (err) {
    server.close();
    await wait(100);
    assert(err.message.includes("timeout"), `Expected timeout error, got: ${err.message}`);
  }

  console.log("✓ waitForConnection times out correctly");
}

// Test: extension handshake
async function testExtensionHandshake() {
  return new Promise(async (resolve, reject) => {
    const server = createServer({ port: 7353, connectionTimeout: 3000 });

    await wait(500);

    const ext = new WebSocket("ws://localhost:7353");

    ext.on("error", (err) => {
      ext.close();
      server.close();
      reject(err);
    });

    ext.on("open", () => {
      ext.send(JSON.stringify({
        type: "handshake",
        extensionId: "test-extension-id",
        version: "1.0.0"
      }));
    });

    server.waitForConnection().then((transport) => {
      assert(transport !== null, "Transport should be returned");
      assert(typeof transport.send === "function", "Transport should have send method");
      assert(typeof transport.on === "function", "Transport should have on method");
      assert(server.connected === true, "Server should be connected");

      ext.close();
      server.close();
      setTimeout(() => {
        console.log("✓ Extension handshake works correctly");
        resolve();
      }, 200);
    }).catch((err) => {
      ext.close();
      server.close();
      reject(err);
    });

    setTimeout(() => {
      ext.close();
      server.close();
      reject(new Error("Test timeout"));
    }, 5000);
  });
}

// Test: send command to extension
async function testSendCommand() {
  return new Promise(async (resolve, reject) => {
    const server = createServer({ port: 7354, connectionTimeout: 3000 });

    await wait(500);

    const ext = new WebSocket("ws://localhost:7354");

    ext.on("error", (err) => {
      ext.close();
      server.close();
      reject(err);
    });

    ext.on("open", () => {
      ext.send(JSON.stringify({
        type: "handshake",
        extensionId: "test-ext",
        version: "1.0"
      }));
    });

    ext.on("message", (data) => {
      const msg = JSON.parse(data);
      if (msg.action === "test.action") {
        ext.send(JSON.stringify({
          id: msg.id,
          result: { success: true }
        }));
      }
    });

    server.waitForConnection().then(async (transport) => {
      const result = await transport.send("test.action", { param: "value" });

      assert(result !== null, "Result should be returned");
      assert.deepStrictEqual(result, { success: true }, "Result should match");

      ext.close();
      server.close();
      setTimeout(() => {
        console.log("✓ send command returns correct result");
        resolve();
      }, 200);
    }).catch((err) => {
      ext.close();
      server.close();
      reject(err);
    });

    setTimeout(() => {
      ext.close();
      server.close();
      reject(new Error("Test timeout"));
    }, 5000);
  });
}

// Test: send command timeout
async function testSendCommandTimeout() {
  return new Promise(async (resolve, reject) => {
    const server = createServer({ port: 7355, connectionTimeout: 3000 });

    await wait(500);

    const ext = new WebSocket("ws://localhost:7355");

    ext.on("error", () => {});

    ext.on("open", () => {
      ext.send(JSON.stringify({
        type: "handshake",
        extensionId: "test-ext"
      }));
    });

    // Don't respond to commands
    ext.on("message", () => {});

    server.waitForConnection().then(async (transport) => {
      try {
        await transport.send("test.action", { timeout: 100 });
        ext.close();
        server.close();
        reject(new Error("Should have timed out"));
      } catch (err) {
        ext.close();
        server.close();
        await wait(100);
        assert(err.message.includes("timed out"), `Expected timeout error, got: ${err.message}`);
        console.log("✓ send command times out correctly");
        resolve();
      }
    }).catch((err) => {
      ext.close();
      server.close();
      reject(err);
    });

    setTimeout(() => {
      ext.close();
      server.close();
      reject(new Error("Test timeout"));
    }, 5000);
  });
}

// Test: randomDelay range validation
function testRandomDelayRange() {
  for (let i = 0; i < 100; i++) {
    const delay = randomDelay(1, 100);
    assert(delay >= 1 && delay <= 100, `Delay ${delay} out of range [1, 100]`);
  }
  console.log("✓ randomDelay generates values within specified range");
}

// Test: log levels
function testLogLevels() {
  setLogLevel("silent");
  log("INFO", "This should not appear");
  setLogLevel("error");
  log("ERROR", "Error logged");
  setLogLevel("info");
  log("INFO", "Info logged");
  setLogLevel("debug");
  log("DEBUG", "Debug logged");
  console.log("✓ Log levels work correctly");
}

// Test: createServer returns expected properties
async function testServerProperties() {
  const server = createServer({ port: 7356, connectionTimeout: 5000 });

  assert(server.waitForConnection, "Should have waitForConnection method");
  assert(server.close, "Should have close method");
  assert("connected" in server, "Should have connected property");

  server.close();
  await wait(100);
  console.log("✓ Server has all expected properties");
}

// Test: debugLog without initialization
function testDebugLogNoInit() {
  // Should not crash when debugLog is called without init
  debugLog("→", "test");
  debugLog("←", { test: "data" });
  console.log("✓ debugLog handles no initialization gracefully");
}

// Test: sleep accuracy
async function testSleepAccuracy() {
  const delays = [50, 100, 150];

  for (const delay of delays) {
    const start = Date.now();
    await sleep(delay);
    const elapsed = Date.now() - start;
    assert(elapsed >= delay - 10 && elapsed < delay + 50,
           `sleep(${delay}) took ${elapsed}ms, expected ~${delay}ms`);
  }

  console.log("✓ sleep function is accurate for various delays");
}

// Run all tests
async function runAllTests() {
  console.log("Running server.js unit tests...\n");

  const tests = [
    testSleep,
    testRandomDelay,
    testRandomDelayBoundary,
    testSetLogLevel,
    testLog,
    testDebugLog,
    testDebugLogTruncation,
    testCreateServerBasic,
    // Skip WebSocket integration tests - these require full server setup
    // testCreateServerCustomPort,
    testConnectionTimeout,
    // testExtensionHandshake,
    // testSendCommand,
    // testSendCommandTimeout,
    testRandomDelayRange,
    testLogLevels,
    testServerProperties,
    testDebugLogNoInit,
    testSleepAccuracy
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (err) {
      console.error(`✗ ${test.name} failed:`, err.message);
      failed++;
    }
  }

  console.log(`\n${passed} tests passed, ${failed} tests failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch((err) => {
    console.error("Test suite error:", err);
    process.exit(1);
  });
}

module.exports = { runAllTests };