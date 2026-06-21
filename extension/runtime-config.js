(function initRuntimeConfig(root) {
  function buildRuntimeConfigUrl(runtime, nonce) {
    const base = runtime.getURL("token.json");
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}v=${encodeURIComponent(String(nonce))}`;
  }

  async function loadRuntimeConfig(options = {}) {
    const runtime =
      options.runtime ||
      (root.chrome && root.chrome.runtime ? root.chrome.runtime : null);
    const fetchImpl = options.fetchImpl || root.fetch;
    const now = options.now || Date.now;

    if (!runtime || typeof runtime.getURL !== "function") {
      throw new Error("chrome.runtime.getURL unavailable");
    }
    if (typeof fetchImpl !== "function") {
      throw new Error("fetch unavailable");
    }

    const response = await fetchImpl(buildRuntimeConfigUrl(runtime, now()), {
      cache: "no-store",
    });
    return response.json();
  }

  const api = { buildRuntimeConfigUrl, loadRuntimeConfig };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  root.WebpilotRuntimeConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
