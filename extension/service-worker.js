// Runtime half of a local automation tool. Talks only to the paired process on
// 127.0.0.1, authenticated with the per-run token. Cookie and DOM reads are
// user-initiated commands and go to that local socket only; there is no remote
// endpoint and no telemetry. See SECURITY.md.

// WS endpoint (port + per-run auth token) is read from token.json in connect().
importScripts("runtime-config.js");

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

async function connect() {
  // Read the per-run token the launcher wrote into the extension package.
  // chrome.runtime.getURL resolves a packaged file; pages cannot fetch it
  // (not a web_accessible_resource), so the token stays out of page reach.
  let token = "";
  let port = 7331;
  try {
    const cfg = await WebpilotRuntimeConfig.loadRuntimeConfig({
      runtime: chrome.runtime,
      fetchImpl: (...args) => fetch(...args),
    });
    token = cfg.token || "";
    if (cfg.port) port = cfg.port;
  } catch (e) {
    console.log("[bridge] token.json unavailable — cannot authenticate to server");
  }
  ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);

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
  if (action === "framework.reload") {
    // Force-reload the extension (restarts service worker with fresh code)
    setTimeout(() => chrome.runtime.reload(), 100);
    return { reloading: true };
  }

  const tabId = await resolveTabId(msg.tabId);

  // Tab-level commands handled directly
  switch (action) {
    case "tabs.getCurrent": {
      const tab = await chrome.tabs.get(tabId);
      return {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        windowId: tab.windowId,
        index: tab.index,
      };
    }
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
    case "tabs.navigate":
      return waitForTabLoad(tabId, () => chrome.tabs.update(tabId, { url: params.url }), 30000);
    case "tabs.reload":
      return waitForTabLoad(tabId, () => chrome.tabs.reload(tabId), 30000);
    // history.back()/forward() injected as a function (no eval, so page CSP does not
    // apply). chrome.tabs.goBack is unusable here: Chrome skips history entries made
    // without user activation, which is every entry under automation.
    case "tabs.goBack":
    case "tabs.goForward": {
      const back = action === "tabs.goBack";
      return waitForHistoryNavigation(tabId, async () => {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: (goBack) => (goBack ? history.back() : history.forward()),
            args: [back],
          });
        } catch {
          await (back ? chrome.tabs.goBack(tabId) : chrome.tabs.goForward(tabId));
        }
      }, params.timeout || 30000);
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
    case "tabs.waitForNavigation":
      return waitForTabLoad(tabId, null, params.timeout || 30000);
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
      let mainErr = null;
      // Try MAIN world first if not explicitly requesting ISOLATED
      if (params.world !== "isolated") {
        try {
          return await executeInPage(tabId, params.fn, params.args || []);
        } catch (err) {
          // The script already ran (or its page unloaded); re-running it elsewhere would repeat side effects.
          if (err.navigatedAway || err.scriptRan) throw err;
          mainErr = err;
          // MAIN world failed (likely CSP) — fall back to ISOLATED
          console.log("[bridge] MAIN world evaluate failed, falling back to ISOLATED:", mainErr.message);
        }
      }
      
      // ISOLATED world fallback — CSP-safe but limited to DOM access
      try {
        const isolatedResult = await forwardToContentScript(tabId, "dom.evaluateIsolated", params);
        return { result: isolatedResult, warning: "Ran in isolated world (CSP restriction). Cannot access page JS globals." };
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
      } catch (err) {
        if (err.navigatedAway) throw err;
        if (!SCRIPT_NOT_RUN.test(err.message)) throw scriptRanError(err.message);
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
    case "frames.list": {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      return (frames || []).map(f => ({
        frameId: f.frameId,
        parentFrameId: f.parentFrameId,
        url: f.url,
      }));
    }
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

// Waits for the tab's main frame to finish loading. Listeners attach before
// start() runs so a fast load is not missed. Resolves { success: true },
// { success: true, timeout: true } while still loading, or
// { success: false, error: "net::ERR_..." } when the page failed to load.
// With start (navigate/reload): a load that never commits within the timeout is
// { success: false, error: "net::ERR_TIMED_OUT" }, an abort not followed by another
// navigation within 2 s (download, OS-handled scheme) is net::ERR_ABORTED, and the
// main-frame HTTP status is reported as `status`.
function waitForTabLoad(tabId, start, timeoutMs) {
  return new Promise((resolve, reject) => {
    let navError = null;
    let committed = false;
    let status = null;
    let timer = null;
    let abortTimer = null;

    const isMain = (d) => d.tabId === tabId && d.frameId === 0;
    const loaded = () => (status ? { success: true, status } : { success: true });
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.webNavigation.onErrorOccurred.removeListener(onError);
      chrome.webNavigation.onBeforeNavigate.removeListener(onBefore);
      chrome.webNavigation.onCommitted.removeListener(onCommitted);
      chrome.webRequest.onHeadersReceived.removeListener(onHeaders);
      clearTimeout(timer);
      clearTimeout(abortTimer);
    };
    const finish = (result) => {
      cleanup();
      resolve(result);
    };
    const onBefore = (details) => {
      if (isMain(details)) clearTimeout(abortTimer);
    };
    const onCommitted = (details) => {
      if (!isMain(details)) return;
      committed = true;
      clearTimeout(abortTimer);
    };
    const onHeaders = (details) => {
      if (details.tabId === tabId && details.type === "main_frame") status = details.statusCode;
    };
    const onError = (details) => {
      if (!isMain(details)) return;
      if (details.error === "net::ERR_ABORTED") {
        // Superseded navigations start again at once; downloads and OS-handled schemes do not.
        if (start) {
          clearTimeout(abortTimer);
          abortTimer = setTimeout(() => {
            if (!committed) finish({ success: false, error: details.error });
          }, 2000);
        }
        return;
      }
      navError = details.error;
    };
    const onUpdated = (id, info) => {
      if (id !== tabId || info.status !== "complete") return;
      finish(navError ? { success: false, error: navError } : loaded());
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.webNavigation.onErrorOccurred.addListener(onError);
    chrome.webNavigation.onBeforeNavigate.addListener(onBefore);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    chrome.webRequest.onHeadersReceived.addListener(onHeaders, { urls: ["<all_urls>"], types: ["main_frame"], tabId });
    timer = setTimeout(() => {
      if (navError) finish({ success: false, error: navError });
      else if (start && !committed) finish({ success: false, error: "net::ERR_TIMED_OUT", timeout: true });
      else finish({ ...loaded(), timeout: true });
    }, timeoutMs);

    if (start) {
      Promise.resolve()
        .then(start)
        .catch((err) => {
          cleanup();
          reject(err);
        });
    }
  });
}

// Waits for a history move in the main frame. Same-document entries (hash, pushState)
// finish at once; cross-document ones wait for the load. No navigation starting within
// 1.5 s means there was no entry to move to.
function waitForHistoryNavigation(tabId, start, timeoutMs) {
  return new Promise((resolve, reject) => {
    let started = false;
    let navError = null;
    const timers = [];
    const isMain = (d) => d.tabId === tabId && d.frameId === 0;
    const onStart = (d) => { if (isMain(d)) started = true; };
    const onSameDocument = (d) => { if (isMain(d)) finish({ success: true }); };
    const onCompleted = (d) => { if (isMain(d)) finish(navError ? { success: false, error: navError } : { success: true }); };
    const onError = (d) => {
      if (!isMain(d) || d.error === "net::ERR_ABORTED") return;
      navError = d.error;
    };
    const onUpdated = (id, info) => {
      if (id === tabId && started && info.status === "complete") {
        finish(navError ? { success: false, error: navError } : { success: true });
      }
    };
    const events = [
      [chrome.webNavigation.onBeforeNavigate, onStart],
      [chrome.webNavigation.onCommitted, onStart],
      [chrome.webNavigation.onReferenceFragmentUpdated, onSameDocument],
      [chrome.webNavigation.onHistoryStateUpdated, onSameDocument],
      [chrome.webNavigation.onCompleted, onCompleted],
      [chrome.webNavigation.onErrorOccurred, onError],
      [chrome.tabs.onUpdated, onUpdated],
    ];
    function cleanup() {
      for (const [event, fn] of events) event.removeListener(fn);
      timers.forEach(clearTimeout);
    }
    function finish(result) {
      cleanup();
      resolve(result);
    }
    for (const [event, fn] of events) event.addListener(fn);
    timers.push(setTimeout(() => { if (!started) finish({ success: false, error: "no-history" }); }, 1500));
    timers.push(setTimeout(() => finish(navError ? { success: false, error: navError } : { success: true, timeout: true }), timeoutMs));
    Promise.resolve()
      .then(start)
      .catch((err) => {
        cleanup();
        reject(err);
      });
  });
}

// executeScript never settles when its page is replaced mid-script; settle as
// navigated away once the tab's main frame commits a new document.
function untilNavigation(tabId, promise, action) {
  return new Promise((resolve, reject) => {
    const onCommitted = (details) => {
      if (details.tabId !== tabId || details.frameId !== 0) return;
      cleanup();
      reject(navigatedAwayError(action));
    };
    const cleanup = () => chrome.webNavigation.onCommitted.removeListener(onCommitted);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (err) => { cleanup(); reject(err); },
    );
  });
}

// Errors that prove the script never started, so another strategy may run it.
const SCRIPT_NOT_RUN = /Inline script did not run|Receiving end does not exist|Could not establish connection|No response from content script|Cannot access|Frame with ID|No tab with id|extensions gallery|Missing host permission/i;
const SCRIPT_CSP_BLOCKED = /unsafe-eval|EvalError|Refused to evaluate|Content Security Policy/i;

// The user's script started in the page; falling back would run it a second time.
function scriptRanError(message) {
  const err = new Error(/timed out/i.test(message) ? message : `The script threw an error: ${message}`);
  err.scriptRan = true;
  return err;
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
    if (scriptErr.navigatedAway) throw scriptErr;
    if (!SCRIPT_NOT_RUN.test(scriptErr.message)) throw scriptRanError(scriptErr.message);
    // Inline script blocked or content script unreachable — try direct executeScript
  }

  // Strategy 2: chrome.scripting.executeScript in MAIN world (needs 'unsafe-eval' in page CSP)
  try {
    const results = await untilNavigation(tabId, chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      // executeScript swallows exceptions (result null), so report outcomes in an envelope.
      func: (fnStr, args, markerId) => {
        const message = (e) => String((e && e.message) || e);
        let fn;
        try {
          fn = new Function("return (" + fnStr + ")")();
        } catch (e) {
          return { __wp: e instanceof EvalError ? "blocked" : "error", message: message(e) };
        }
        let el;
        if (markerId) {
          el = document.querySelector(`[data-bridge-eval="${markerId}"]`);
          if (!el) return { __wp: "error", message: "Marked element not found" };
          el.removeAttribute("data-bridge-eval");
        }
        try {
          const value = markerId ? fn(el, ...(args || [])) : fn(...(args || []));
          if (value && typeof value.then === "function") {
            return Promise.resolve(value).then(
              (v) => ({ __wp: "ok", value: v }),
              (e) => ({ __wp: "error", message: message(e) }),
            );
          }
          return { __wp: "ok", value };
        } catch (e) {
          return { __wp: "error", message: message(e) };
        }
      },
      args: [fnString, args || [], markerId || null],
    }), "dom.evaluate");
    if (results && results.length) {
      if (results[0].error) throw new Error(results[0].error.message);
      const envelope = results[0].result;
      if (envelope && envelope.__wp === "ok") return envelope.value;
      if (envelope && envelope.__wp === "error") throw scriptRanError(envelope.message);
      if (envelope && envelope.__wp === "blocked") throw new Error(`EvalError: ${envelope.message}`);
      return envelope;
    }
  } catch (err) {
    if (err && (err.navigatedAway || err.scriptRan)) throw err;
    const message = (err && err.message) || String(err);
    if (!SCRIPT_CSP_BLOCKED.test(message) && !SCRIPT_NOT_RUN.test(message)) {
      throw scriptRanError(message);
    }
  }

  throw new Error(
    "Evaluate failed: page CSP blocks both inline scripts and eval",
  );
}

// Execute JS in MAIN world, detect and mark DOM element results for handle registration
async function executeHandleInPage(tabId, fnString, args, elementMarkers = []) {
  const results = await untilNavigation(tabId, chrome.scripting.executeScript({
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
  }), "dom.evaluateHandle");
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

// Actions that change the page. If the page unloads mid-command they already ran,
// so they must not be replayed on the next document.
const PAGE_CHANGING_ACTIONS = new Set([
  "human.click", "human.type", "human.scroll", "human.clearInput",
  "dom.click", "dom.type", "dom.keyPress", "dom.keyDown", "dom.keyUp",
  "dom.scroll", "dom.setValue", "dom.focus", "dom.mouseMoveTo", "dom.uploadFile",
]);
// Scripts can have side effects too; their return value is lost on unload.
const SCRIPT_ACTIONS = new Set([
  "dom.evaluateViaScript", "dom.evaluateIsolated", "dom.elementEvaluate",
]);

// The message reached the page, then the document unloaded before it answered.
function isChannelClosed(message) {
  return /closed before a response was received|message channel is closed|back\/forward cache/i.test(message || "");
}

function navigatedAwayError(action) {
  const err = new Error(`The page navigated away while ${action} was running, so its result was lost.`);
  err.navigatedAway = true;
  return err;
}

function forwardToContentScript(tabId, action, params) {
  // Default to main frame (frameId: 0), but allow targeting iframes via params.frameId
  const opts = { frameId: (params && params.frameId != null) ? params.frameId : 0 };
  const providedFrameworkConfig = params && params.__frameworkConfig;
  const payload = {
    action,
    params: {
      ...(params || {}),
      __frameworkConfig: providedFrameworkConfig || frameworkConfig,
    },
  };

  // Returns true when the lastError was settled here (no retry allowed).
  function settleClosedChannel(message, resolve, reject) {
    if (!isChannelClosed(message)) return false;
    if (SCRIPT_ACTIONS.has(action)) {
      reject(navigatedAwayError(action));
      return true;
    }
    if (PAGE_CHANGING_ACTIONS.has(action)) {
      resolve({ navigatedAway: true, confirmed: false });
      return true;
    }
    return false;
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, opts, async (response) => {
      if (chrome.runtime.lastError) {
        const firstError = chrome.runtime.lastError.message;
        if (settleClosedChannel(firstError, resolve, reject)) return;
        // Content script not loaded (or a read-only action lost its page) — inject and retry once
        await ensureContentScript(tabId);
        await new Promise((r) => setTimeout(r, 100));
        chrome.tabs.sendMessage(tabId, payload, opts, (retryResponse) => {
          if (chrome.runtime.lastError) {
            const retryError = chrome.runtime.lastError.message;
            if (settleClosedChannel(retryError, resolve, reject)) return;
            reject(new Error(retryError));
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

// Cookie persistence — debounce changes, flush full jar to server
let cookieFlushTimer = null;
chrome.cookies.onChanged.addListener(() => {
  clearTimeout(cookieFlushTimer);
  cookieFlushTimer = setTimeout(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        const cookies = await chrome.cookies.getAll({});
        ws.send(JSON.stringify({
          type: 'event',
          event: 'cookiesChanged',
          data: { cookies, count: cookies.length },
        }));
      } catch {}
    }
  }, 2000);
});

connect();
