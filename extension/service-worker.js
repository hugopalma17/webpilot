const WS_URL = "ws://localhost:7331";
let ws = null;
let reconnectDelay = 1000;
let reconnectAttempts = 0;
let wasConnected = false;

// Persist cursor position across page reloads
let lastCursorX = 0;
let lastCursorY = 0;
let frameworkConfig = {
  handles: { ttlMs: 15 * 60 * 1000, cleanupIntervalMs: 60 * 1000 },
  debug: { enabled: true },
};

function deepMerge(target, ...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const [key, val] of Object.entries(source)) {
      if (
        val &&
        typeof val === "object" &&
        !Array.isArray(val) &&
        target[key] &&
        typeof target[key] === "object" &&
        !Array.isArray(target[key])
      ) {
        target[key] = deepMerge({ ...target[key] }, val);
      } else if (val !== undefined) {
        target[key] = val;
      }
    }
  }
  return target;
}

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("[bridge] connected");
    reconnectDelay = 1000;
    reconnectAttempts = 0;
    wasConnected = true;
    const manifest = chrome.runtime.getManifest();
    ws.send(
      JSON.stringify({
        type: "handshake",
        extensionId: chrome.runtime.id,
        version: manifest.version,
      }),
    );
  };

  ws.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }

    try {
      const result = await handleCommand(msg);
      ws.send(JSON.stringify({ id: msg.id, result }));
    } catch (err) {
      ws.send(JSON.stringify({ id: msg.id, error: err.message }));
    }
  };

  ws.onclose = () => {
    reconnectAttempts++;
    // Only log first disconnect and every 20th retry to reduce console spam
    if (reconnectAttempts === 1) {
      console.log(
        `[bridge] ${wasConnected ? "disconnected" : "server not running"}, will retry silently`,
      );
    } else if (reconnectAttempts % 20 === 0) {
      console.log(`[bridge] still trying... (attempt ${reconnectAttempts})`);
    }
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60000);
  };

  ws.onerror = () => {}; // onclose fires after this
}

// Keep service worker alive
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "pong" }));
  }
}, 20000);

async function resolveTabId(tabId) {
  if (tabId) return tabId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    const all = await chrome.tabs.query({});
    if (all.length) return all[0].id;
    throw new Error("No tabs available");
  }
  return tab.id;
}

async function handleCommand(msg) {
  const { action, params = {} } = msg;

  if (action === "framework.setConfig") {
    frameworkConfig = deepMerge({}, frameworkConfig, params.config || {});
    return { ok: true, framework: frameworkConfig };
  }
  if (action === "framework.getConfig") {
    return {
      framework: frameworkConfig,
      version: chrome.runtime.getManifest().version,
    };
  }

  const tabId = await resolveTabId(msg.tabId);

  // Tab-level commands handled directly
  switch (action) {
    case "tabs.list": {
      const tabs = await chrome.tabs.query({});
      return tabs.map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        active: t.active,
        windowId: t.windowId,
        index: t.index,
      }));
    }
    case "tabs.navigate": {
      await chrome.tabs.update(tabId, { url: params.url });
      // Wait for page load
      return new Promise((resolve) => {
        const listener = (id, info) => {
          if (id === tabId && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve({ success: true });
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        // Timeout after 30s
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve({ success: true, timeout: true });
        }, 30000);
      });
    }
    case "tabs.reload": {
      await chrome.tabs.reload(tabId);
      return new Promise((resolve) => {
        const listener = (id, info) => {
          if (id === tabId && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve({ success: true });
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve({ success: true, timeout: true });
        }, 30000);
      });
    }
    case "tabs.create": {
      const tab = await chrome.tabs.create({
        url: params.url || "about:blank",
      });
      return { id: tab.id, url: tab.url, title: tab.title };
    }
    case "tabs.close": {
      await chrome.tabs.remove(tabId);
      return { success: true };
    }
    case "tabs.activate": {
      await chrome.tabs.update(tabId, { active: true });
      return { success: true };
    }
    case "tabs.waitForNavigation": {
      const timeout = params.timeout || 30000;
      return new Promise((resolve) => {
        const listener = (id, info) => {
          if (id === tabId && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            clearTimeout(timer);
            resolve({ success: true });
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        const timer = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve({ success: true, timeout: true });
        }, timeout);
      });
    }
    case "tabs.reload": {
      await chrome.tabs.reload(tabId);
      return new Promise((resolve) => {
        const listener = (id, info) => {
          if (id === tabId && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            clearTimeout(timer);
            resolve({ success: true });
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        const timer = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve({ success: true, timeout: true });
        }, 30000);
      });
    }
    case "tabs.setViewport": {
      const tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId, {
        width: params.width,
        height: params.height,
      });
      return { success: true };
    }
    case "cookies.getAll": {
      const url = params.url || (await chrome.tabs.get(tabId)).url;
      const cookies = await chrome.cookies.getAll({ url });
      return cookies;
    }
    case "cookies.set": {
      const cookie = params.cookie;
      const protocol = cookie.secure !== false ? "https" : "http";
      const domain = (cookie.domain || "").replace(/^\./, "");
      const url = cookie.url || `${protocol}://${domain}${cookie.path || "/"}`;
      await chrome.cookies.set({
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || "/",
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite || "lax",
        expirationDate: cookie.expires || cookie.expirationDate,
      });
      return { success: true };
    }
    case "tabs.screenshot": {
      const windowId = (await chrome.tabs.get(tabId)).windowId;
      await chrome.tabs.update(tabId, { active: true });

      if (!params.fullPage) {
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
          format: "png",
        });
        return { dataUrl };
      }

      // Full page: scroll-capture-stitch (like GoFullPage/FireShot)
      return await captureFullPage(tabId, windowId);
    }
    // Evaluate commands — try MAIN world first (for page JS globals), fall back to ISOLATED
    case "dom.evaluate": {
      // Try MAIN world first if not explicitly requesting ISOLATED
      if (params.world !== "isolated") {
        try {
          return await executeInPage(tabId, params.fn, params.args || []);
        } catch (mainErr) {
          // MAIN world failed (likely CSP) — fall back to ISOLATED
          console.log("[bridge] MAIN world evaluate failed, falling back to ISOLATED:", mainErr.message);
        }
      }
      
      // ISOLATED world fallback — CSP-safe but limited to DOM access
      try {
        return await forwardToContentScript(tabId, "dom.evaluateIsolated", params);
      } catch (isolatedErr) {
        throw new Error(
          `Evaluate failed in both MAIN and ISOLATED worlds. ` +
          `MAIN error: ${mainErr?.message || "N/A"}. ` +
          `ISOLATED error: ${isolatedErr.message}`
        );
      }
    }
    case "dom.evaluateHandle": {
      // Execute function, detect DOM element results, register them as handles
      const ehResult = await executeHandleInPage(
        tabId,
        params.fn,
        params.args || [],
        params.elementMarkers || [],
      );
      if (!ehResult) return { type: "null" };
      // For any elements found, register them in content script's handle registry
      if (ehResult.__type === "element" && ehResult.marker) {
        const handleId = await forwardToContentScript(
          tabId,
          "dom.registerMarkedElement",
          { marker: ehResult.marker },
        );
        return { type: "element", handleId };
      }
      if (ehResult.__type === "object" && ehResult.properties) {
        const props = {};
        for (const [key, prop] of Object.entries(ehResult.properties)) {
          if (prop.__type === "element" && prop.marker) {
            const handleId = await forwardToContentScript(
              tabId,
              "dom.registerMarkedElement",
              { marker: prop.marker },
            );
            props[key] = { type: "element", handleId };
          } else {
            props[key] = { type: "value", value: prop.value };
          }
        }
        return { type: "object", properties: props };
      }
      if (ehResult.__type === "null") return { type: "null" };
      return { type: "value", value: ehResult.value };
    }
    case "dom.elementEvaluate": {
      // Try content script first (CSP-safe) — element handle is already there
      try {
        return await forwardToContentScript(
          tabId,
          "dom.elementEvaluate",
          params,
        );
      } catch {
        // Fall back to MAIN world via marker
        const markerId =
          "be_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
        await forwardToContentScript(tabId, "dom.markElement", {
          handleId: params.handleId,
          markerId,
        });
        try {
          return await executeInPage(
            tabId,
            params.fn,
            params.args || [],
            markerId,
          );
        } catch (err) {
          forwardToContentScript(tabId, "dom.unmarkElement", {
            markerId,
          }).catch(() => {});
          throw err;
        }
      }
    }
    // Cursor position persistence across page reloads
    case "cursor.getPosition":
      return { x: lastCursorX, y: lastCursorY };
    case "cursor.reportPosition":
      lastCursorX = params.x;
      lastCursorY = params.y;
      return { saved: true };
    // Human commands — forward to content script (it handles all timing + detection)
    case "human.click":
    case "human.type":
    case "human.scroll":
    case "human.clearInput":
      return forwardToContentScript(tabId, action, params);
    default:
      // DOM commands — forward to content script
      return forwardToContentScript(tabId, action, params);
  }
}

// Execute JS in the page via inline <script> injection.
// Works on CSP sites that allow 'unsafe-inline' (most do) without needing eval/new Function.
// Falls back to chrome.scripting.executeScript MAIN world for sites without inline restriction.
async function executeInPage(tabId, fnString, args, markerId) {
  // Strategy 1: Inject inline <script> tag (works with 'unsafe-inline' CSP, which most sites have)
  // The content script injects a <script> into the page DOM, which runs in MAIN world
  // with the page's JS context. Result passed back via a DOM element.
  try {
    const result = await forwardToContentScript(
      tabId,
      "dom.evaluateViaScript",
      {
        fn: fnString,
        args: args || [],
        markerId: markerId || null,
      },
    );
    return result;
  } catch (scriptErr) {
    // Inline script blocked or failed — try direct executeScript
  }

  // Strategy 2: chrome.scripting.executeScript in MAIN world (needs 'unsafe-eval' in page CSP)
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (fnStr, args, markerId) => {
        let el;
        if (markerId) {
          el = document.querySelector(`[data-bridge-eval="${markerId}"]`);
          if (!el) throw new Error("Marked element not found");
          el.removeAttribute("data-bridge-eval");
        }
        const fn = new Function("return (" + fnStr + ")")();
        return markerId ? fn(el, ...(args || [])) : fn(...(args || []));
      },
      args: [fnString, args || [], markerId || null],
    });
    if (results && results.length) {
      if (results[0].error) throw new Error(results[0].error.message);
      return results[0].result;
    }
  } catch {}

  throw new Error(
    "Evaluate failed: page CSP blocks both inline scripts and eval",
  );
}

// Execute JS in MAIN world, detect and mark DOM element results for handle registration
async function executeHandleInPage(tabId, fnString, args, elementMarkers = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (fnStr, args, elementMarkers) => {
      // Resolve any BridgeElement markers in args back to DOM elements
      for (const { index, markerId } of elementMarkers) {
        const el = document.querySelector(`[data-bridge-eval="${markerId}"]`);
        if (el) {
          el.removeAttribute("data-bridge-eval");
          args[index] = el;
        }
      }

      const fn = new Function("return (" + fnStr + ")")();
      const result = fn(...(args || []));

      if (result === null || result === undefined) {
        return { __type: "null" };
      }

      // Check if result is a DOM element
      if (result instanceof Element || result instanceof HTMLElement) {
        const marker =
          "__bh_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
        result.setAttribute("data-bridge-handle", marker);
        return { __type: "element", marker };
      }

      // Check if result is an object with possible element properties
      if (typeof result === "object" && !Array.isArray(result)) {
        const props = {};
        let hasElements = false;
        for (const [key, val] of Object.entries(result)) {
          if (val instanceof Element || val instanceof HTMLElement) {
            const marker =
              "__bh_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
            val.setAttribute("data-bridge-handle", marker);
            props[key] = { __type: "element", marker };
            hasElements = true;
          } else {
            props[key] = { __type: "value", value: val };
          }
        }
        if (hasElements) {
          return { __type: "object", properties: props };
        }
        // Plain object, no elements
        return { __type: "value", value: result };
      }

      return { __type: "value", value: result };
    },
    args: [fnString, args, elementMarkers],
  });
  if (!results || !results.length)
    throw new Error("executeScript returned no results");
  if (results[0].error)
    throw new Error(results[0].error.message || "executeScript error");
  return results[0].result;
}

// Full page screenshot: scroll, capture each viewport, stitch with OffscreenCanvas
async function captureFullPage(tabId, windowId) {
  // 1. Get page dimensions and save scroll position
  const [dims] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      scrollHeight: Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      ),
      clientHeight: document.documentElement.clientHeight,
      clientWidth: document.documentElement.clientWidth,
      scrollY: window.scrollY,
      dpr: window.devicePixelRatio || 1,
    }),
  });
  const {
    scrollHeight,
    clientHeight,
    clientWidth,
    scrollY: origScroll,
    dpr,
  } = dims.result;

  // If page fits in viewport, just capture
  if (scrollHeight <= clientHeight) {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "png",
    });
    return { dataUrl };
  }

  // 2. Scroll and capture each viewport
  const captures = [];
  let y = 0;

  while (y < scrollHeight) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (scrollTo) => window.scrollTo(0, scrollTo),
      args: [y],
    });
    await new Promise((r) => setTimeout(r, 150)); // wait for render

    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "png",
    });
    captures.push({ dataUrl, y });
    y += clientHeight;
  }

  // 3. Restore original scroll position
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (scrollTo) => window.scrollTo(0, scrollTo),
    args: [origScroll],
  });

  // 4. Stitch using OffscreenCanvas
  const pixelW = Math.round(clientWidth * dpr);
  const pixelH = Math.round(scrollHeight * dpr);
  const canvas = new OffscreenCanvas(pixelW, pixelH);
  const ctx = canvas.getContext("2d");

  for (const cap of captures) {
    const resp = await fetch(cap.dataUrl);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    ctx.drawImage(bitmap, 0, Math.round(cap.y * dpr));
    bitmap.close();
  }

  const blob = await canvas.convertToBlob({ type: "image/png" });
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // base64 encode in chunks to avoid stack overflow
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
  }
  const dataUrl = "data:image/png;base64," + btoa(chunks.join(""));
  return { dataUrl };
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-script.js"],
    });
  } catch {
    // Already injected or chrome:// page — ignore
  }
}

function forwardToContentScript(tabId, action, params) {
  // Always target main frame (frameId: 0) to avoid iframe content scripts
  // responding with a different handle registry
  const opts = { frameId: 0 };
  const providedFrameworkConfig = params && params.__frameworkConfig;
  const payload = {
    action,
    params: {
      ...(params || {}),
      __frameworkConfig: providedFrameworkConfig || frameworkConfig,
    },
  };
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, opts, async (response) => {
      if (chrome.runtime.lastError) {
        // Content script not loaded — inject and retry once
        await ensureContentScript(tabId);
        await new Promise((r) => setTimeout(r, 100));
        chrome.tabs.sendMessage(tabId, payload, opts, (retryResponse) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!retryResponse) {
            reject(new Error("No response from content script"));
            return;
          }
          if (retryResponse.error) {
            reject(new Error(retryResponse.error));
            return;
          }
          resolve(retryResponse.result);
        });
        return;
      }
      if (!response) {
        reject(new Error("No response from content script"));
        return;
      }
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response.result);
    });
  });
}

// Forward HTTP response events to bridge
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (ws && ws.readyState === WebSocket.OPEN && details.tabId > 0) {
      ws.send(
        JSON.stringify({
          type: "event",
          event: "response",
          data: {
            url: details.url,
            status: details.statusCode,
            tabId: details.tabId,
            method: details.method,
          },
        }),
      );
    }
  },
  { urls: ["<all_urls>"] },
);

// Forward tab URL changes (pushState, replaceState, navigation) to bridge
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "event",
        event: "urlChanged",
        data: { tabId, url: changeInfo.url },
      }),
    );
  }
});

// Handle internal messages from content script (cursor position persistence)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, params = {} } = message;
  if (action === "cursor.getPosition") {
    sendResponse({ result: { x: lastCursorX, y: lastCursorY } });
    return;
  }
  if (action === "cursor.reportPosition") {
    lastCursorX = params.x;
    lastCursorY = params.y;
    sendResponse({ result: { saved: true } });
    return;
  }
});

connect();
