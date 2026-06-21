"use strict";

const assert = require("assert");
const { createServer, sleep, randomDelay, setLogLevel, initDebugLog, debugLog, log } = require("../lib/server");
const { connectToServer } = require("../index");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Test utilities
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let testPort = 17600;
function nextPort() {
  return testPort++;
}

function openWebSocket(url, options = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket open timeout"));
    }, 1000);
    ws.on("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function expectWebSocketRejected(url, options = {}) {
  await assert.rejects(
    () => openWebSocket(url, options),
    /Unexpected server response: 401/,
  );
}

async function connectFakeExtension(port, token, options = {}) {
  const ws = await openWebSocket(
    `ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`,
    options,
  );
  ws.send(
    JSON.stringify({
      type: "handshake",
      extensionId: "test-extension-id",
      version: "1.0.0",
    }),
  );
  return ws;
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

function testLauncherPreservesExistingDisplay() {
  const { resolveBrowserDisplayEnv } = require("../lib/launcher");
  const result = resolveBrowserDisplayEnv({
    env: { DISPLAY: ":7", XAUTHORITY: "/tmp/existing.Xauthority" },
    platform: "linux",
  });

  assert.strictEqual(result.inferred, false);
  assert.deepStrictEqual(result.env, {
    DISPLAY: ":7",
    XAUTHORITY: "/tmp/existing.Xauthority",
  });
  console.log("✓ Launcher preserves existing DISPLAY");
}

function testLauncherInfersXauthorityDisplay() {
  const { resolveBrowserDisplayEnv } = require("../lib/launcher");
  const result = resolveBrowserDisplayEnv({
    env: {},
    platform: "linux",
    homeDir: "/home/tester",
    existsSync: (p) => p === "/home/tester/.Xauthority",
    listXauthority: () => ["tester-host/unix:0  MIT-MAGIC-COOKIE-1  abcdef"],
  });

  assert.strictEqual(result.inferred, true);
  assert.strictEqual(result.env.DISPLAY, ":0");
  assert.strictEqual(result.env.XAUTHORITY, "/home/tester/.Xauthority");
  assert(result.warning.includes("DISPLAY=:0"));
  console.log("✓ Launcher infers DISPLAY from Xauthority");
}

function testLauncherLeavesMissingDisplayUnset() {
  const { resolveBrowserDisplayEnv } = require("../lib/launcher");
  const result = resolveBrowserDisplayEnv({
    env: {},
    platform: "linux",
    homeDir: "/home/tester",
    existsSync: () => false,
  });

  assert.strictEqual(result.inferred, false);
  assert.deepStrictEqual(result.env, {});
  assert(result.warning.includes("No DISPLAY"));
  console.log("✓ Launcher warns when no DISPLAY can be inferred");
}

function testCliParserPreservesHandleForHumanType() {
  const { resolveLine } = require("../lib/cli-parser");

  assert.deepStrictEqual(
    resolveLine("type el_21 webpilot browser automation"),
    {
      action: "human.type",
      params: { handleId: "el_21", text: "webpilot browser automation" },
    },
  );

  assert.deepStrictEqual(
    resolveLine("type #APjFqb webpilot browser automation"),
    {
      action: "human.type",
      params: { selector: "#APjFqb", text: "webpilot browser automation" },
    },
  );

  assert.deepStrictEqual(
    resolveLine("type webpilot browser automation"),
    {
      action: "human.type",
      params: { text: "webpilot browser automation" },
    },
  );

  console.log("✓ CLI parser preserves human type targets");
}

function testCliParserConsumesCommandArgv() {
  const { parseCommandArgv } = require("../lib/cli-parser");

  assert.deepStrictEqual(
    parseCommandArgv(["type", "el_3", "quote"]),
    { command: "type el_3 quote", showHttp: false },
  );

  assert.deepStrictEqual(
    parseCommandArgv([".http", "type", "el_3", "quote"]),
    { command: "type el_3 quote", showHttp: true },
  );

  assert.deepStrictEqual(
    parseCommandArgv([".http"]),
    { command: ".http", showHttp: false },
  );

  console.log("✓ CLI parser consumes unquoted -c argv");
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
  const token = "custom-port-token";
  const port = nextPort();
  const server = createServer({ port, authToken: token });

  // Wait for server to start listening
  await wait(500);

  return new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);

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
  const server = createServer({ port: nextPort(), connectionTimeout: 100 });

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
    const token = "handshake-token";
    const port = nextPort();
    const server = createServer({ port, authToken: token, connectionTimeout: 3000 });

    await wait(500);

    const ext = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);

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
    const token = "send-command-token";
    const port = nextPort();
    const server = createServer({ port, authToken: token, connectionTimeout: 3000 });

    await wait(500);

    const ext = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);

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
    const token = "send-timeout-token";
    const port = nextPort();
    const server = createServer({ port, authToken: token, connectionTimeout: 3000 });

    await wait(500);

    const ext = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);

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

// Test: authenticated server rejects missing token
async function testServerRejectsMissingToken() {
  const token = "required-token";
  const port = nextPort();
  const server = createServer({ port, authToken: token, connectionTimeout: 200 });
  try {
    await wait(100);
    await expectWebSocketRejected(`ws://127.0.0.1:${port}/`);
  } finally {
    server.close();
    await wait(50);
  }
  console.log("✓ Server rejects missing auth token");
}

// Test: authenticated server rejects wrong token
async function testServerRejectsWrongToken() {
  const port = nextPort();
  const server = createServer({ port, authToken: "right-token", connectionTimeout: 200 });
  try {
    await wait(100);
    await expectWebSocketRejected(`ws://127.0.0.1:${port}/?token=wrong-token`);
  } finally {
    server.close();
    await wait(50);
  }
  console.log("✓ Server rejects wrong auth token");
}

// Test: authenticated server rejects web-page origins even with token
async function testServerRejectsHttpOrigin() {
  const token = "origin-token";
  const port = nextPort();
  const server = createServer({ port, authToken: token, connectionTimeout: 200 });
  try {
    await wait(100);
    await expectWebSocketRejected(`ws://127.0.0.1:${port}/?token=${token}`, {
      headers: { Origin: "https://evil.example" },
    });
  } finally {
    server.close();
    await wait(50);
  }
  console.log("✓ Server rejects browser page Origin headers");
}

// Test: authenticated server accepts runtime extension origins with rotating IDs
async function testServerAcceptsChromeExtensionOrigin() {
  const token = "extension-origin-token";
  const port = nextPort();
  const server = createServer({ port, authToken: token, connectionTimeout: 1000 });
  let ext = null;
  try {
    const waiting = server.waitForConnection();
    await wait(100);
    ext = await connectFakeExtension(port, token, {
      headers: { Origin: "chrome-extension://rotatingextensionidexampleabcd" },
    });
    const transport = await waiting;
    assert(transport, "Transport should be returned after extension handshake");
    assert.strictEqual(server.connected, true, "Server should mark extension connected");
  } finally {
    if (ext) ext.close();
    server.close();
    await wait(50);
  }
  console.log("✓ Server accepts tokened chrome-extension Origins");
}

// Test: Node API connect reads the same token file as the CLI
async function testConnectToServerUsesTokenFile() {
  const token = "node-api-token";
  const port = nextPort();
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "webpilot-home-"));
  const tokenDir = path.join(tempHome, "h17-webpilot");
  fs.mkdirSync(tokenDir, { recursive: true });
  fs.writeFileSync(path.join(tokenDir, "token"), token);

  const originalHomedir = os.homedir;
  os.homedir = () => tempHome;

  const server = createServer({ port, authToken: token, connectionTimeout: 1000 });
  let ext = null;
  let page = null;
  try {
    await wait(100);
    ext = await connectFakeExtension(port, token);
    ext.on("message", (data) => {
      const msg = JSON.parse(data);
      if (msg.action === "tabs.list") {
        ext.send(
          JSON.stringify({
            id: msg.id,
            result: [
              {
                id: 1,
                url: "https://example.com/",
                title: "Example Domain",
                active: true,
                windowId: 1,
                index: 0,
              },
            ],
          }),
        );
      }
    });
    await server.waitForConnection();

    page = await connectToServer({ port });
    assert.strictEqual(page.url(), "https://example.com/");
  } finally {
    os.homedir = originalHomedir;
    if (page) page._transport.close();
    if (ext) ext.close();
    server.close();
    fs.rmSync(tempHome, { recursive: true, force: true });
    await wait(50);
  }
  console.log("✓ Node API connects with token from runtime token file");
}

// Test: start readiness waits for an extension-backed command, not just socket open
async function testReadinessWaitsForExtensionCommand() {
  const { waitForReadyServer } = require("../lib/readiness");
  const token = "readiness-token";
  const port = nextPort();
  const server = createServer({ port, authToken: token, connectionTimeout: 1000 });
  let ext = null;
  let ready = false;

  try {
    const pending = waitForReadyServer(`ws://127.0.0.1:${port}`, 1500, {
      authOptions: { token },
      intervalMs: 50,
    }).then(() => {
      ready = true;
    });

    await wait(200);
    assert.strictEqual(ready, false, "Readiness should not resolve before extension handshake");

    ext = await connectFakeExtension(port, token);
    ext.on("message", (data) => {
      const msg = JSON.parse(data);
      if (msg.action === "tabs.list") {
        ext.send(JSON.stringify({ id: msg.id, result: [] }));
      }
    });

    await pending;
    assert.strictEqual(ready, true, "Readiness should resolve after tabs.list succeeds");
  } finally {
    if (ext) ext.close();
    server.close();
    await wait(50);
  }
  console.log("✓ Start readiness waits for extension command success");
}

// Test: start readiness times out if server accepts auth but extension is absent
async function testReadinessRejectsWhenExtensionAbsent() {
  const { waitForReadyServer } = require("../lib/readiness");
  const token = "absent-extension-token";
  const port = nextPort();
  const server = createServer({ port, authToken: token, connectionTimeout: 1000 });

  try {
    await assert.rejects(
      () =>
        waitForReadyServer(`ws://127.0.0.1:${port}`, 350, {
          authOptions: { token },
          intervalMs: 50,
        }),
      /server did not become ready in time/,
    );
  } finally {
    server.close();
    await wait(50);
  }
  console.log("✓ Start readiness rejects when extension is absent");
}

// Test: shared auth URL helper normalizes localhost and preserves missing-token failures
async function testAuthUrlHelper() {
  const { authedWsUrl } = require("../lib/auth");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "webpilot-auth-"));
  const tokenPath = path.join(tempHome, "token");
  fs.writeFileSync(tokenPath, "helper-token");

  try {
    assert.strictEqual(
      authedWsUrl("ws://localhost:7331/path?x=1", { tokenPath }),
      "ws://127.0.0.1:7331/path?x=1&token=helper-token",
    );
    assert.strictEqual(
      authedWsUrl("ws://localhost:7331/path", { tokenPath: path.join(tempHome, "missing") }),
      "ws://127.0.0.1:7331/path",
    );
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
  console.log("✓ Auth URL helper appends token and normalizes localhost");
}

// Test: extension runtime config fetch avoids stale token.json from extension caches
async function testExtensionRuntimeConfigCacheBustsTokenFetch() {
  const { loadRuntimeConfig } = require("../extension/runtime-config");
  const seen = {};
  const cfg = await loadRuntimeConfig({
    runtime: {
      getURL(file) {
        assert.strictEqual(file, "token.json");
        return "chrome-extension://runtime-id/token.json";
      },
    },
    now: () => 12345,
    fetchImpl: async (url, options) => {
      seen.url = url;
      seen.options = options;
      return {
        async json() {
          return { token: "fresh-token", port: 8123 };
        },
      };
    },
  });

  assert.strictEqual(seen.url, "chrome-extension://runtime-id/token.json?v=12345");
  assert.deepStrictEqual(seen.options, { cache: "no-store" });
  assert.deepStrictEqual(cfg, { token: "fresh-token", port: 8123 });
  console.log("✓ Extension runtime config fetch cache-busts token.json");
}

// Test: createServer returns expected properties
async function testServerProperties() {
  const server = createServer({ port: nextPort(), connectionTimeout: 5000 });

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
    testLauncherPreservesExistingDisplay,
    testLauncherInfersXauthorityDisplay,
    testLauncherLeavesMissingDisplayUnset,
    testCliParserPreservesHandleForHumanType,
    testCliParserConsumesCommandArgv,
    testCreateServerBasic,
    testServerRejectsMissingToken,
    testServerRejectsWrongToken,
    testServerRejectsHttpOrigin,
    testServerAcceptsChromeExtensionOrigin,
    testAuthUrlHelper,
    testExtensionRuntimeConfigCacheBustsTokenFetch,
    testCreateServerCustomPort,
    testConnectionTimeout,
    testExtensionHandshake,
    testSendCommand,
    testSendCommandTimeout,
    testConnectToServerUsesTokenFile,
    testReadinessWaitsForExtensionCommand,
    testReadinessRejectsWhenExtensionAbsent,
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
