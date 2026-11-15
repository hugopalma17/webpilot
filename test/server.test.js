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
    listDir: () => [],
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
    listDir: () => [],
  });

  assert.strictEqual(result.inferred, false);
  assert.deepStrictEqual(result.env, {});
  assert(result.warning.includes("No graphical session found"));
  assert(result.warning.includes("a monitor is not required"));
  assert(result.warning.includes("xvfb-run -a webpilot start -d"));
  console.log("✓ Launcher warns when no graphical session can be found");
}

function testLauncherInfersWaylandSocket() {
  const { resolveBrowserDisplayEnv } = require("../lib/launcher");
  const result = resolveBrowserDisplayEnv({
    env: { XDG_RUNTIME_DIR: "/run/user/1000" },
    platform: "linux",
    homeDir: "/home/tester",
    existsSync: () => false,
    listDir: () => ["wayland-1.lock", "wayland-1", "bus", "pipewire-0"],
    isSocket: (p) => p === "/run/user/1000/wayland-1",
  });

  assert.strictEqual(result.inferred, true);
  assert.strictEqual(result.warning, null);
  assert.strictEqual(result.env.WAYLAND_DISPLAY, "wayland-1");
  console.log("✓ Launcher finds the compositor's Wayland socket when WAYLAND_DISPLAY is unset");
}

function testLauncherAcceptsWaylandDisplay() {
  const { resolveBrowserDisplayEnv } = require("../lib/launcher");
  const result = resolveBrowserDisplayEnv({
    env: { WAYLAND_DISPLAY: "wayland-1" },
    platform: "linux",
    homeDir: "/home/tester",
    existsSync: () => false,
  });

  assert.strictEqual(result.inferred, false);
  assert.strictEqual(result.warning, null);
  assert.deepStrictEqual(result.env, { WAYLAND_DISPLAY: "wayland-1" });
  console.log("✓ Launcher accepts a Wayland display without DISPLAY");
}

function testLauncherRefreshesCachedExtensionWorker() {
  const { refreshExtensionWorkerCache } = require("../lib/launcher");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "webpilot-sw-"));
  const ext = path.join(root, "extension");
  const profile = path.join(root, "profile");
  const cache = path.join(profile, "Default", "Service Worker");
  fs.mkdirSync(ext, { recursive: true });
  fs.writeFileSync(path.join(ext, "service-worker.js"), "// v1");
  fs.writeFileSync(path.join(ext, "manifest.json"), "{}");
  fs.mkdirSync(path.join(cache, "ScriptCache"), { recursive: true });

  try {
    assert.strictEqual(
      refreshExtensionWorkerCache(profile, ext, { profileInUse: () => true }),
      false,
      "a profile still in use is left alone",
    );
    assert(fs.existsSync(cache), "cache kept while the profile is in use");
    assert.strictEqual(refreshExtensionWorkerCache(profile, ext, { profileInUse: () => false }), true, "retried on the next launch");
    fs.mkdirSync(path.join(cache, "ScriptCache"), { recursive: true });
    fs.unlinkSync(path.join(profile, "webpilot-extension.sha256"));
    assert.strictEqual(refreshExtensionWorkerCache(profile, ext, { profileInUse: () => false }), true, "first launch drops an unknown cache");
    assert(!fs.existsSync(cache));
    fs.mkdirSync(path.join(cache, "ScriptCache"), { recursive: true });
    assert.strictEqual(refreshExtensionWorkerCache(profile, ext, { profileInUse: () => false }), false, "unchanged worker keeps the cache");
    assert(fs.existsSync(cache));
    fs.writeFileSync(path.join(ext, "service-worker.js"), "// v2");
    assert.strictEqual(refreshExtensionWorkerCache(profile, ext, { profileInUse: () => false }), true, "changed worker drops the cache");
    assert(!fs.existsSync(cache));
    fs.writeFileSync(path.join(ext, "token.json"), "{\"token\":\"x\"}");
    fs.mkdirSync(cache, { recursive: true });
    assert.strictEqual(refreshExtensionWorkerCache(profile, ext, { profileInUse: () => false }), false, "per-run token.json does not count");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("✓ Launcher drops the cached extension service worker only when its files change");
}

function testCliParserReportsMissingArguments() {
  const { resolveLine } = require("../lib/cli-parser");
  const errors = [];
  const options = { onError: (label, message) => errors.push(message) };

  assert.strictEqual(resolveLine("click", options), null);
  assert(errors.pop().includes("quote the whole command"), "click hint explains shell # comments");

  assert.strictEqual(resolveLine("go", options), null);
  const goError = errors.pop();
  assert(goError.startsWith("go needs a URL"));
  assert(!goError.includes("comment"), "go does not get the selector quoting hint");

  assert.strictEqual(resolveLine("clik #submit", options), null);
  assert(errors.pop().startsWith('Unknown command "clik"'));

  assert.strictEqual(resolveLine("cookies nope", options), null);
  assert(errors.pop().includes("load <file>"));

  assert.strictEqual(resolveLine("dom.queryAllInfo {bad", options), null);
  assert(errors.pop().includes("must be JSON"));

  assert.deepStrictEqual(resolveLine("wait #results 15000", options), {
    action: "dom.waitForSelector",
    params: { selector: "#results", timeout: 15000 },
  });
  assert.deepStrictEqual(resolveLine("wait div .row", options), {
    action: "dom.waitForSelector",
    params: { selector: "div .row" },
  });
  assert.deepStrictEqual(resolveLine("clear el_4", options), {
    action: "human.clearInput",
    params: { handleId: "el_4" },
  });
  assert.strictEqual(errors.length, 0);
  console.log("✓ CLI parser reports missing arguments and typos in plain English");
}

function testCliParserValidatesGoUrls() {
  const { resolveGoUrl } = require("../lib/cli-parser");
  assert.deepStrictEqual(resolveGoUrl("example.com"), { url: "https://example.com" });
  assert.deepStrictEqual(resolveGoUrl("localhost:3456/x"), { url: "http://localhost:3456/x" });
  assert.deepStrictEqual(resolveGoUrl("example.com:8080/a"), { url: "https://example.com:8080/a" });
  assert.deepStrictEqual(resolveGoUrl("about:blank"), { url: "about:blank" });
  assert(resolveGoUrl("htp://example.com").error.includes("Did you mean https://example.com?"));
  assert(!resolveGoUrl("mailto:a@b.c").error.includes("Did you mean"));
  assert(resolveGoUrl("javascript:alert(1)").error.includes("use eval"));
  assert(resolveGoUrl("http://").error.includes("is not a valid URL"));
  assert(resolveGoUrl("exa mple.com").error.includes("cannot contain spaces"));
  console.log("✓ CLI parser validates go URLs before sending them");
}

function testCliOutputOutcomes() {
  const out = require("../lib/cli-output");

  assert.strictEqual(out.formatStatus(out.ok()), "OK");
  assert.strictEqual(out.formatStatus(out.ok("clicked #a")), "OK: clicked #a");
  assert.strictEqual(out.formatStatus(out.unconfirmed("x")), "OK (unconfirmed): x");
  assert.strictEqual(out.formatStatus(out.fail("Nope.")), "ERROR: Nope.");

  const clicked = out.outcomeFromResult("human.click", { selector: "#a" }, { clicked: true });
  assert.deepStrictEqual(clicked, { ok: true, message: "clicked #a" });

  const refused = out.outcomeFromResult("human.click", { selector: "#trap" }, { clicked: false, reason: "opacity-zero" });
  assert.strictEqual(refused.ok, false);
  assert(refused.message.includes("fully transparent"));

  const occluded = out.outcomeFromResult("human.click", { handleId: "el_2" }, { clicked: false, reason: "occluded", detail: "div.modal" });
  assert(occluded.message.includes("covering it (div.modal)"));

  const waited = out.outcomeFromResult("dom.waitForSelector", { selector: "#x", timeout: 1500 }, null);
  assert.strictEqual(waited.ok, false);
  assert(waited.message.includes("within 1.5 seconds"));

  const dns = out.outcomeFromResult("tabs.navigate", { url: "https://nope.invalid" }, { success: false, error: "net::ERR_NAME_NOT_RESOLVED" });
  assert.strictEqual(dns.ok, false);
  assert(dns.message.includes("domain name could not be found"));

  const notFound = out.outcomeFromResult("tabs.navigate", { url: "https://x.test/missing" }, { success: true, status: 404 });
  assert.strictEqual(notFound.ok, false);
  assert(notFound.message.includes("HTTP 404 (Not Found)"));
  const blocked = out.outcomeFromResult("tabs.navigate", { url: "https://x.test" }, { success: true, status: 403 });
  assert(blocked.message.includes("often bot protection"));
  assert.strictEqual(out.outcomeFromResult("tabs.navigate", { url: "https://x.test" }, { success: true, status: 200 }).ok, true);
  const silent = out.outcomeFromResult("tabs.navigate", { url: "http://10.255.255.1/" }, { success: false, error: "net::ERR_TIMED_OUT", timeout: true });
  assert(silent.message.includes("did not respond within 30 seconds"));
  const aborted = out.outcomeFromResult("tabs.navigate", { url: "https://x.test/file.zip" }, { success: false, error: "net::ERR_ABORTED" });
  assert(aborted.message.includes("did not open it as a page"));

  const slow = out.outcomeFromResult("tabs.navigate", { url: "https://slow.test" }, { success: true, timeout: true });
  assert.strictEqual(slow.ok, true);
  assert(slow.message.includes("still loading"));

  const edge = out.outcomeFromResult("human.scroll", { direction: "down" }, { scrolled: false, amount: 0 });
  assert.strictEqual(edge.ok, true);
  assert(edge.message.includes("already at the bottom"));

  const gone = out.outcomeFromResult("dom.keyPress", { key: "Enter" }, { navigatedAway: true, confirmed: false });
  assert.strictEqual(gone.ok, true);
  assert.strictEqual(gone.unconfirmed, true);

  const submitted = out.outcomeFromResult("dom.keyPress", { key: "Enter" }, { pressed: true, submitted: true });
  assert(submitted.message.startsWith("pressed Enter and submitted the form"));
  assert.strictEqual(out.outcomeFromResult("dom.keyPress", { key: "Enter" }, { pressed: true }).message, "pressed Enter");

  const setValue = out.outcomeFromResult("dom.setValue", { selector: "#q", value: "x" }, { set: true });
  assert(setValue.warning.includes("no keystrokes"));
  const domType = out.outcomeFromResult("dom.type", { selector: "#q", text: "x" }, { typed: true });
  assert(domType.warning.includes("typed instantly"));
  const humanType = out.outcomeFromResult("human.type", { selector: "#q", text: "x" }, { typed: true });
  assert.strictEqual(humanType.warning, undefined);

  const back = out.outcomeFromError(new Error("The page navigated away while dom.evaluateViaScript was running, so its result was lost."), { action: "dom.evaluate", command: "back" });
  assert.strictEqual(back.ok, true);
  assert(back.message.startsWith("went back"));

  assert(out.plainError("Element not found: #missing").includes("No element on the current page matches #missing"));
  assert(out.plainError("Extension not connected\n\n  The browser may have closed.").includes("webpilot start"));
  assert(!out.plainError("Extension not connected\n\n  hint").includes("hint"));
  assert(out.plainError("Command dom.click timed out (30s)").includes("within 30 seconds"));
  assert(out.plainError("Could not establish connection. Receiving end does not exist.").includes("could not reach this page"));
  assert(out.plainError("connect ECONNREFUSED 127.0.0.1:7331", { addr: "ws://localhost:7331" }).includes("Nothing is listening at ws://localhost:7331"));
  assert.strictEqual(out.plainError("something odd happened"), "Something odd happened.");
  assert.strictEqual(out.plainError("The script threw an error: x is not defined"), "The script threw an error: x is not defined.");
  const both = out.plainError("Evaluate failed in both MAIN and ISOLATED worlds. MAIN error: Evaluate failed: page CSP blocks both inline scripts and eval. ISOLATED error: Refused to evaluate a string");
  assert(both.includes("isolated world failed too (Refused to evaluate a string)"), both);
  console.log("✓ CLI output maps results and errors to OK/ERROR in plain English");
}

// Spawns the real CLI against a fake extension. HOME is a temp dir, so the
// user's ~/h17-webpilot (token, pid, config) is never read or written.
async function testCliStatusLinesEndToEnd() {
  const { spawn } = require("child_process");
  const crypto = require("crypto");
  const CLI_PATH = path.join(__dirname, "..", "bin", "cli.js");
  const port = nextPort();
  const server = createServer({ port, insecureNoAuth: true });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "webpilot-cli-"));
  const wpHome = path.join(home, "h17-webpilot");
  fs.mkdirSync(wpHome, { recursive: true });

  // Stand-in daemon pid: start's restart path would signal it, never this process.
  const fakeDaemon = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  fs.writeFileSync(path.join(wpHome, `server-${port}.pid`), String(fakeDaemon.pid));

  const replies = {
    "tabs.list": () => ({ result: [{ id: 1, url: "http://fixture/", title: "Fixture", active: true }] }),
    "human.click": (p) => p.selector === "#ok"
      ? { result: { clicked: true } }
      : { result: { clicked: false, reason: "opacity-zero" } },
    "dom.waitForSelector": (p) => (p.selector === "#never-answers" ? null : { result: null }),
    "tabs.navigate": () => ({ result: { success: false, error: "net::ERR_NAME_NOT_RESOLVED" } }),
    "dom.keyPress": () => ({ result: { navigatedAway: true, confirmed: false } }),
    "dom.setValue": () => ({ result: { set: true } }),
    "tabs.getCurrent": () => ({ result: { id: 1, title: "Fixture Title", url: "http://fixture/" } }),
    "dom.getHTML": () => ({ error: "Could not establish connection. Receiving end does not exist." }),
  };

  await wait(200);
  const ext = await openWebSocket(`ws://127.0.0.1:${port}`);
  ext.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "ping" || !msg.id) return;
    const reply = replies[msg.action] ? replies[msg.action](msg.params || {}) : { result: { ok: true } };
    if (reply) ext.send(JSON.stringify({ id: msg.id, ...reply }));
  });
  ext.send(JSON.stringify({ type: "handshake", extensionId: "fake", version: "test" }));
  await server.waitForConnection();

  function runCli(args, input) {
    return new Promise((resolve) => {
      const started = Date.now();
      const child = spawn(process.execPath, [CLI_PATH, "--port", String(port), ...args], {
        env: { ...process.env, HOME: home, FORCE_COLOR: "0" },
      });
      let stdout = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stdout += d));
      const killer = setTimeout(() => child.kill("SIGKILL"), 15000);
      child.on("close", (code) => {
        clearTimeout(killer);
        const lines = stdout.trim().split("\n");
        resolve({ code, stdout, last: lines[lines.length - 1], ms: Date.now() - started });
      });
      child.stdin.end(input || "");
    });
  }

  try {
    let r = await runCli(["-c", "click #ok"]);
    assert.strictEqual(r.last, "OK: clicked #ok", r.stdout);
    assert.strictEqual(r.code, 0);

    r = await runCli(["-c", "click #trap"]);
    assert(r.last.startsWith("ERROR: Did not click #trap: it is fully transparent"), r.stdout);
    assert.strictEqual(r.code, 1);

    r = await runCli(["-c", "click"]);
    assert(r.last.startsWith("ERROR: click needs a target"), r.stdout);
    assert.strictEqual(r.code, 1);
    assert(r.ms < 5000, `missing argument must fail fast, took ${r.ms}ms`);

    r = await runCli(["-c", "wait #missing 200"]);
    assert(r.last.startsWith("ERROR: #missing did not appear within 0.2 seconds"), r.stdout);
    assert.strictEqual(r.code, 1);

    r = await runCli(["-c", 'dom.waitForSelector {"selector": "#never-answers", "timeout": 100}']);
    assert(r.last.startsWith("ERROR: The browser did not answer"), r.stdout);
    assert.strictEqual(r.code, 1);
    assert(r.ms < 10000, `silent extension must time out, took ${r.ms}ms`);

    r = await runCli(["-c", "go nowhere.invalid"]);
    assert(r.last.includes("Could not load https://nowhere.invalid: the domain name could not be found"), r.stdout);
    assert.strictEqual(r.code, 1);

    r = await runCli(["-c", "key Enter"]);
    assert(r.last.startsWith("OK (unconfirmed): the page navigated away"), r.stdout);
    assert.strictEqual(r.code, 0);

    r = await runCli(["-c", 'dom.setValue {"selector": "#q", "value": "x"}']);
    assert(r.stdout.includes("[WARN] dom.setValue wrote the value"), r.stdout);
    assert.strictEqual(r.last, "OK: set the value of #q", r.stdout);

    r = await runCli(["-c", "html"]);
    assert(r.last.startsWith("ERROR: Webpilot could not reach this page"), r.stdout);

    r = await runCli(["-c", "back"]);
    assert.strictEqual(r.last, "OK: went back in history", r.stdout);

    r = await runCli(["title"]);
    assert(r.stdout.includes("Fixture Title"), r.stdout);
    assert.strictEqual(r.last, "OK", r.stdout);
    assert.strictEqual(r.code, 0);

    r = await runCli(["-c", ".bogus"]);
    assert(r.last.startsWith('ERROR: Unknown command ".bogus"'), r.stdout);

    r = await runCli([], "click #ok\nclick #trap\n");
    assert(r.stdout.includes("OK: clicked #ok"), r.stdout);
    assert(r.last.startsWith("ERROR: Did not click #trap"), r.stdout);
    assert.strictEqual(r.code, 1, "pipe mode exits 1 when any command failed");

    r = await runCli([]);
    assert(r.last.startsWith("ERROR: No command given"), r.stdout);

    r = await runCli(["title", "--config", "other.js"]);
    assert(r.last.startsWith("ERROR: Put options before the command"), r.stdout);
    assert.strictEqual(r.code, 1);

    r = await runCli(["-c", ".quit"]);
    assert.strictEqual(r.last, "OK: nothing to quit: a single command exits on its own", r.stdout);
    assert.strictEqual(r.code, 0);

    r = await runCli([], "click #ok\n.quit\nclick #trap\n");
    assert(r.last.startsWith("OK: stopped here"), r.stdout);
    assert(!r.stdout.includes("#trap"), "lines after .quit are not run");
    assert.strictEqual(r.code, 0);

    // start reuses a ready runtime whose recorded config matches.
    const configPath = path.join(wpHome, "config.js");
    fs.writeFileSync(configPath, `module.exports = { browser: "/nonexistent", profile: ${JSON.stringify(path.join(home, "profile"))}, port: ${port} };\n`);
    fs.writeFileSync(path.join(wpHome, `server-${port}.json`), JSON.stringify({
      pid: fakeDaemon.pid,
      configPath,
      configHash: crypto.createHash("sha256").update(fs.readFileSync(configPath)).digest("hex"),
      browser: null,
      sessionLog: true,
    }));
    r = await runCli(["start", "-d"]);
    assert(r.stdout.includes("nothing was restarted"), r.stdout);
    assert(r.last.startsWith("OK: webpilot is already running and ready"), r.stdout);
    assert.strictEqual(r.code, 0);
  } finally {
    ext.close();
    server.close();
    try { fakeDaemon.kill(); } catch {}
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log("✓ CLI prints one OK/ERROR status line with matching exit codes");
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
    testLauncherAcceptsWaylandDisplay,
    testLauncherInfersWaylandSocket,
    testLauncherRefreshesCachedExtensionWorker,
    testCliParserPreservesHandleForHumanType,
    testCliParserConsumesCommandArgv,
    testCliParserReportsMissingArguments,
    testCliParserValidatesGoUrls,
    testCliOutputOutcomes,
    testCliStatusLinesEndToEnd,
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
