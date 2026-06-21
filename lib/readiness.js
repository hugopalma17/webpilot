const WebSocket = require("ws");
const { authedWsUrl } = require("./auth");

function waitForReadyServer(addr, timeoutMs = 15000, options = {}) {
  const WebSocketCtor = options.WebSocket || WebSocket;
  const intervalMs = options.intervalMs || 300;
  const probeTimeoutMs = options.probeTimeoutMs || 1000;
  const authOptions = options.authOptions || {};
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    function failIfTimedOut(lastError) {
      if (Date.now() - startedAt <= timeoutMs) return false;
      const suffix = lastError ? `: ${lastError.message || lastError}` : "";
      reject(new Error(`server did not become ready in time${suffix}`));
      return true;
    }

    function scheduleRetry(lastError) {
      if (failIfTimedOut(lastError)) return;
      setTimeout(attempt, intervalMs);
    }

    function attempt() {
      if (failIfTimedOut()) return;

      let ws;
      let settled = false;
      const id = `ready_${Date.now()}_${Math.random().toString(16).slice(2)}`;

      function cleanup() {
        clearTimeout(timer);
        if (ws && typeof ws.removeAllListeners === "function") {
          ws.removeAllListeners("open");
          ws.removeAllListeners("message");
          ws.removeAllListeners("error");
          ws.removeAllListeners("close");
        }
      }

      function retry(lastError) {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          ws.close();
        } catch {}
        scheduleRetry(lastError);
      }

      const timer = setTimeout(() => {
        retry(new Error("readiness probe timed out"));
      }, probeTimeoutMs);

      try {
        ws = new WebSocketCtor(authedWsUrl(addr, authOptions));
      } catch (err) {
        clearTimeout(timer);
        scheduleRetry(err);
        return;
      }

      ws.on("open", () => {
        ws.send(JSON.stringify({ id, action: "tabs.list", params: {} }));
      });

      ws.on("message", (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch (err) {
          retry(err);
          return;
        }
        if (msg.id !== id) return;
        if (msg.error) {
          retry(new Error(msg.error));
          return;
        }
        settled = true;
        cleanup();
        try {
          ws.close();
        } catch {}
        resolve();
      });

      ws.on("error", retry);
      ws.on("close", () => {
        retry(new Error("readiness socket closed"));
      });
    }

    attempt();
  });
}

module.exports = {
  waitForReadyServer,
};
