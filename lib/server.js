const WebSocket = require("ws");
const crypto = require("crypto");

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
      const requestedTimeout = params.timeout || 30000;
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(
          new Error(
            `Command ${action} timed out (${requestedTimeout / 1000}s)`,
          ),
        );
      }, requestedTimeout + 2000); // 2s buffer to allow internal timeouts to resolve

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

      extensionWs.send(JSON.stringify({ id, tabId, action, params }));
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
          .then((result) => ws.send(JSON.stringify({ id: msg.id, result })))
          .catch((err) =>
            ws.send(JSON.stringify({ id: msg.id, error: err.message })),
          );
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

module.exports = { createServer, sleep, randomDelay, log, setLogLevel };
