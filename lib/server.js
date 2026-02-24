const WebSocket = require("ws");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Minimal utilities (framework-internal, no conflict with user's utils.js)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// Logger

const LEVELS = { silent: 0, error: 1, info: 2, debug: 3 };
let logLevel = "info";

function setLogLevel(level) {
  logLevel = level;
}

function log(tag, msg) {
  const tagLevel = tag === "ERROR" ? 1 : tag === "DEBUG" ? 3 : 2;
  if (LEVELS[logLevel] >= tagLevel) {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`${ts} [${tag}] ${msg}`);
  }
}

// Debug session log — raw WS traffic to file

let debugLogPath = null;

function initDebugLog(filePath) {
  debugLogPath = filePath;
  fs.writeFileSync(debugLogPath, `--- session ${new Date().toISOString()} ---\n`);
}

function debugLog(dir, data) {
  if (!debugLogPath) return;
  const ts = new Date().toISOString();
  let line = typeof data === "string" ? data : JSON.stringify(data);
  // Truncate base64 screenshots to avoid megabyte log entries
  line = line.replace(
    /"dataUrl":"data:[^"]{200,}"/g,
    '"dataUrl":"(base64 truncated)"',
  );
  fs.appendFileSync(debugLogPath, `${ts} ${dir} ${line}\n`);
}

// createServer — WS server that bridges external clients to the extension

function createServer(config = {}) {
  const port = config.port || 7331;
  const timeout = config.connectionTimeout || 60000;
  const humanConfig = config.human || {};

  const wss = new WebSocket.Server({ port });
  let extensionWs = null;
  const pendingRequests = new Map();

  // Keepalive ping every 20s
  const keepalive = setInterval(() => {
    if (extensionWs && extensionWs.readyState === WebSocket.OPEN) {
      extensionWs.send(JSON.stringify({ type: "ping" }));
    }
  }, 20000);

  // Event listeners registered by clients
  const eventListeners = {};

  function on(event, fn) {
    if (!eventListeners[event]) eventListeners[event] = [];
    eventListeners[event].push(fn);
  }

  function _handleEvent(event, data) {
    for (const fn of eventListeners[event] || []) {
      try {
        fn(data);
      } catch {}
    }
  }

  // Send a command to the extension, return a promise for the result
  function send(action, params = {}, tabId = null) {
    return new Promise((resolve, reject) => {
      if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
        reject(new Error("Extension not connected"));
        return;
      }
      params = { ...(params || {}) };

      const id = crypto.randomUUID();
      // Clamp user-provided timeout to a safe range to avoid resource exhaustion
      const rawTimeout = Number(params.timeout);
      const DEFAULT_TIMEOUT_MS = 30000;
      const MIN_TIMEOUT_MS = 100;
      const MAX_TIMEOUT_MS = 60000;
      const effectiveTimeout =
        Number.isFinite(rawTimeout) && rawTimeout > 0
          ? Math.min(Math.max(rawTimeout, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
          : DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(
          new Error(
            `Command ${action} timed out (${effectiveTimeout / 1000}s)`,
          ),
        );
      }, effectiveTimeout + 2000); // 2s buffer to allow internal timeouts to resolve

      pendingRequests.set(id, { resolve, reject, timer });

      // For human.* commands, inject config defaults into params
      if (action.startsWith("human.")) {
        const section = action.split(".")[1]; // click, type, scroll, clearInput
        const sectionConfig = humanConfig[section] || {};

        // Merge config into params.config (per-request overrides take priority)
        params.config = { ...sectionConfig, ...(params.config || {}) };

        // Merge global avoid with per-request avoid
        if (humanConfig.avoid) {
          const globalAvoid = humanConfig.avoid;
          const reqAvoid = params.avoid || {};
          params.avoid = {
            selectors: [
              ...(globalAvoid.selectors || []),
              ...(reqAvoid.selectors || []),
            ],
            classes: [
              ...(globalAvoid.classes || []),
              ...(reqAvoid.classes || []),
            ],
            ids: [...(globalAvoid.ids || []), ...(reqAvoid.ids || [])],
            attributes: {
              ...(globalAvoid.attributes || {}),
              ...(reqAvoid.attributes || {}),
            },
          };
        }
      }

      // Push framework runtime config into content-script bound commands.
      if (
        config.framework &&
        (action.startsWith("dom.") || action.startsWith("human."))
      ) {
        params.__frameworkConfig = config.framework;
      }

      const outMsg = JSON.stringify({ id, tabId, action, params });
      debugLog("→ext", outMsg);
      extensionWs.send(outMsg);
    }).catch((err) => {
      // Detect stale extension errors
      if (
        err.message.includes("Unknown action") ||
        err.message.includes("No response from content script") ||
        err.message.includes("Extension disconnected")
      ) {
        const staleErr = new Error(
          `${err.message}\n\n` +
            `  Your browser might not have closed correctly or it might not have the up-to-date extension.\n` +
            `  Kill the browser and restart with: node index.js`,
        );
        staleErr.staleExtension = true;
        throw staleErr;
      }
      throw err;
    });
  }

  // Track connection promise for waitForConnection
  let connectionResolve = null;
  let connectionReject = null;

  // Handle ALL incoming WS connections — distinguish extension vs external client
  wss.on("connection", (ws) => {
    let isExtension = false;

    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      // Log raw incoming (skip pongs — noise)
      if (msg.type !== "pong") {
        const dir = isExtension || msg.type === "handshake" ? "←ext" : "←cli";
        debugLog(dir, data.toString());
      }

      // Extension identifies itself with a handshake
      if (msg.type === "handshake") {
        isExtension = true;
        extensionWs = ws;
        log(
          "INFO",
          `Extension connected (id: ${msg.extensionId}, v${msg.version || "?"})`,
        );

        // Auto-pin extension in toolbar for future launches
        if (msg.extensionId && config.profile) {
          try {
            const os = require("os");
            const fs = require("fs");
            const path = require("path");
            const profileDir = (config.profile || "").replace(
              /^~/,
              os.homedir(),
            );
            const prefsPath = path.join(profileDir, "Default", "Preferences");
            if (fs.existsSync(prefsPath)) {
              const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
              const pinned = prefs.extensions?.pinned_extensions || [];
              if (!pinned.includes(msg.extensionId)) {
                pinned.push(msg.extensionId);
                if (!prefs.extensions) prefs.extensions = {};
                prefs.extensions.pinned_extensions = pinned;
                fs.writeFileSync(prefsPath, JSON.stringify(prefs));
                log("DEBUG", `Pinned extension ${msg.extensionId} in toolbar`);
              }
            }
          } catch {}
        }

        if (connectionResolve) {
          connectionResolve({ send, on, _handleEvent });
          connectionResolve = null;
          connectionReject = null;
        }
        return;
      }

      if (msg.type === "pong") return;

      if (msg.type === "event") {
        // Cookie persistence: write full jar to cookies.json
        // Skip if incoming set is smaller than existing file (avoids overwriting on startup)
        if (msg.event === "cookiesChanged" && msg.data?.cookies) {
          try {
            const cookiePath = path.join(process.cwd(), "cookies.json");
            const incoming = msg.data.cookies;
            let shouldWrite = true;
            if (fs.existsSync(cookiePath)) {
              try {
                const existing = JSON.parse(fs.readFileSync(cookiePath, "utf8"));
                if (Array.isArray(existing) && existing.length > incoming.length) {
                  shouldWrite = false;
                }
              } catch {}
            }
            if (shouldWrite) {
              fs.writeFileSync(cookiePath, JSON.stringify(incoming, null, 2));
              log("DEBUG", `Saved ${incoming.length} cookies`);
            }
          } catch (err) {
            log("ERROR", `Cookie save failed: ${err.message}`);
          }
        }

        // Forward events to all external clients
        const fwdMsg =
          msg.event === "cookiesChanged"
            ? { type: "event", event: "cookiesChanged", data: { count: msg.data.cookies?.length } }
            : msg;
        const fwdStr = JSON.stringify(fwdMsg);
        let fwdCount = 0;
        wss.clients.forEach((client) => {
          if (client !== extensionWs && client.readyState === WebSocket.OPEN) {
            client.send(fwdStr);
            fwdCount++;
          }
        });
        if (fwdCount) debugLog("→cli", fwdStr);

        _handleEvent(msg.event, msg.data);
        return;
      }

      if (isExtension) {
        // Response from extension to a pending command
        const pending = pendingRequests.get(msg.id);
        if (pending) {
          pendingRequests.delete(msg.id);
          clearTimeout(pending.timer);
          if (msg.error) pending.reject(new Error(msg.error));
          else pending.resolve(msg.result);
        }
      } else if (msg.action) {
        // Command from external client — relay to extension
        log("DEBUG", `Relaying ${msg.action} from external client`);
        send(msg.action, msg.params || {}, msg.tabId || null)
          .then((result) => {
            const resp = JSON.stringify({ id: msg.id, result });
            debugLog("→cli", resp);
            ws.send(resp);
          })
          .catch((err) => {
            const resp = JSON.stringify({ id: msg.id, error: err.message });
            debugLog("→cli", resp);
            ws.send(resp);
          });
      }
    });

    ws.on("close", () => {
      if (isExtension) {
        extensionWs = null;
        for (const [id, p] of pendingRequests) {
          clearTimeout(p.timer);
          p.reject(new Error("Extension disconnected"));
        }
        pendingRequests.clear();
      }
    });
  });

  return {
    waitForConnection() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("Extension connection timeout"));
        }, timeout);

        // If extension already connected, resolve immediately
        if (extensionWs && extensionWs.readyState === WebSocket.OPEN) {
          clearTimeout(timer);
          resolve({ send, on, _handleEvent });
          return;
        }

        connectionResolve = (transport) => {
          clearTimeout(timer);
          resolve(transport);
        };
        connectionReject = reject;
      });
    },

    close() {
      clearInterval(keepalive);
      extensionWs?.close();
      wss.close();
    },

    get connected() {
      return extensionWs && extensionWs.readyState === WebSocket.OPEN;
    },
  };
}

module.exports = { createServer, sleep, randomDelay, log, setLogLevel, initDebugLog, debugLog };
