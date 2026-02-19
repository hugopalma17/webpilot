const { BridgeElement, BridgeJSHandle } = require("./element");
const { BridgeKeyboard } = require("./keyboard");

// BridgePage — Puppeteer-compatible Page + human.* convenience methods

class BridgePage {
  constructor(transport) {
    this._transport = transport;
    this._tabId = null;
    this._currentUrl = "";
    this.keyboard = new BridgeKeyboard(this);
    this._frameworkConfig = {};

    // Forward events from transport
    transport.on("urlChanged", (data) => {
      if (data.tabId === this._tabId && data.url) {
        this._currentUrl = data.url;
      }
    });
  }

  _send(action, params = {}) {
    return this._transport.send(action, params, this._tabId);
  }

  setTabId(tabId) {
    this._tabId = tabId;
  }

  // --- Navigation ---

  async goto(url, options = {}) {
    await this._send("tabs.navigate", { url });
    const tabs = await this._send("tabs.list");
    const tab = tabs.find((t) => t.id === this._tabId);
    this._currentUrl = tab ? tab.url : url;
  }

  async reload() {
    await this._send("tabs.reload");
  }

  url() {
    return this._currentUrl;
  }

  async title() {
    // Try evaluate first, fall back to content script query
    const result = await this.evaluate(() => document.title);
    if (result !== null) return result;
    // Fallback: query via DOM command
    const handle = await this.$("title");
    if (handle) {
      const text = await this._send("dom.getProperty", {
        handleId: handle._handleId,
        property: "textContent",
      });
      return text;
    }
    return "";
  }

  async content() {
    return this.evaluate(() => document.documentElement.outerHTML);
  }

  // Discover all interactive elements on the page (CSP-safe, no evaluate needed)
  async discoverElements() {
    return this._send("dom.discoverElements");
  }

  async batchQuery(selectors) {
    if (!Array.isArray(selectors))
      throw new Error("selectors must be an array");
    return this._send("dom.batchQuery", { selectors });
  }

  // --- Screenshots ---

  async screenshot(options = {}) {
    const { path: filePath, fullPage = false } = options;
    const { dataUrl } = await this._send("tabs.screenshot", { fullPage });
    if (filePath) {
      const fs = require("fs");
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
      fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
    }
    return dataUrl;
  }

  // --- JavaScript Evaluation ---

  async evaluate(fn, ...args) {
    const fnString = typeof fn === "function" ? fn.toString() : fn;
    return this._send("dom.evaluate", { fn: fnString, args });
  }

  async evaluateHandle(fn, ...args) {
    const fnString = typeof fn === "function" ? fn.toString() : fn;

    const elementMarkers = [];
    const cleanArgs = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] instanceof BridgeElement) {
        const markerId =
          "ea_" + Date.now() + "_" + i + "_" + Math.floor(Math.random() * 1e6);
        await this._send("dom.markElement", {
          handleId: args[i]._handleId,
          markerId,
        });
        elementMarkers.push({ index: i, markerId });
        cleanArgs.push(null);
      } else {
        cleanArgs.push(args[i]);
      }
    }

    const descriptor = await this._send("dom.evaluateHandle", {
      fn: fnString,
      args: cleanArgs,
      elementMarkers,
    });
    return new BridgeJSHandle(this, descriptor);
  }

  async setConfig(config) {
    const result = await this._send("framework.setConfig", { config });
    if (result && result.framework) {
      this._frameworkConfig = result.framework;
    }
    return result;
  }

  async getConfig() {
    const result = await this._send("framework.getConfig");
    if (result && result.framework) {
      this._frameworkConfig = result.framework;
    }
    return result;
  }

  async waitForFunction(fn, options = {}, ...args) {
    const { timeout = 30000 } = options;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const result = await this.evaluate(fn, ...args);
        if (result) return result;
      } catch {}
      // Performance optimization: configurable or minimal polling for passive checks
      const jitter =
        this._frameworkConfig.pollInterval ||
        (options.fast ? 50 : 150 + Math.floor(Math.random() * 200));
      await new Promise((r) => setTimeout(r, jitter));
    }
    throw new Error(`waitForFunction timed out (${timeout}ms)`);
  }

  // --- DOM Queries ---

  async $(selector) {
    const handleId = await this._send("dom.querySelector", { selector });
    if (!handleId) return null;
    return new BridgeElement(this, handleId, selector);
  }

  async $$(selector) {
    const handleIds = await this._send("dom.querySelectorAll", { selector });
    return handleIds.map((id) => new BridgeElement(this, id, selector));
  }

  async waitForSelector(selector, options = {}) {
    const { timeout = 120000 } = options;
    const handleId = await this._send("dom.waitForSelector", {
      selector,
      timeout,
    });
    if (!handleId) return null;
    return new BridgeElement(this, handleId, selector);
  }

  // --- Tab Management ---

  async tabs() {
    return this._send("tabs.list");
  }

  async close() {
    return this._send("tabs.close");
  }

  async reload(options = {}) {
    await this._send("tabs.reload");
    const tabs = await this._send("tabs.list");
    const tab = tabs.find((t) => t.id === this._tabId);
    this._currentUrl = tab ? tab.url : this._currentUrl;
  }

  async waitForNavigation(options = {}) {
    const result = await this._send("tabs.waitForNavigation", {
      timeout: options.timeout || 30000,
    });
    const tabs = await this._send("tabs.list");
    const tab = tabs.find((t) => t.id === this._tabId);
    if (tab) this._currentUrl = tab.url;
    return result;
  }

  async setViewport(viewport) {
    // No-op: viewport is set via --window-size launch args
  }

  // --- Cookies ---

  async cookies() {
    return this._send("cookies.getAll", {});
  }

  async setCookie(...cookies) {
    for (const cookie of cookies) {
      await this._send("cookies.set", { cookie });
    }
  }

  // --- Events ---

  on(event, fn) {
    if (event === "response") {
      this._transport.on("response", (data) => {
        if (this._tabId && data.tabId !== this._tabId) return;
        fn({
          url: () => data.url,
          status: () => data.status,
          method: () => data.method,
        });
      });
    } else {
      this._transport.on(event, fn);
    }
  }

  // --- Human Commands (safe, human-like) ---

  async humanClick(selectorOrElement, options = {}) {
    const params =
      selectorOrElement instanceof BridgeElement
        ? { handleId: selectorOrElement._handleId }
        : { selector: selectorOrElement };
    return this._send("human.click", { ...params, ...options });
  }

  async humanType(text, options = {}) {
    return this._send("human.type", { text, ...options });
  }

  async humanScroll(selector, options = {}) {
    return this._send("human.scroll", { selector, ...options });
  }

  async humanClearInput(selectorOrElement, options = {}) {
    const params =
      selectorOrElement instanceof BridgeElement
        ? { handleId: selectorOrElement._handleId }
        : { selector: selectorOrElement };
    return this._send("human.clearInput", { ...params, ...options });
  }
}

module.exports = { BridgePage };
