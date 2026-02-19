module.exports = {
  // Path to Any Chromium based Binary, Tested with Chrome, Chromium and Helium
  browser: "/Applications/Helium.app/Contents/MacOS/Helium",

  // Where to store the browser profile (bookmarks, cookies, extensions state)
  // ~ expands to home directory
  profile: "~/.human-browser/profile",

  // WebSocket port — must match extension/service-worker.js WS_URL
  port: 7331,

  // URL to open on launch
  startUrl: "https://hugopalma.work",

  // Browser window size
  viewport: { width: 1920, height: 1080 },

  // Additional Chrome flags (array of strings)
  browserArgs: [],

  // Connection timeout (ms) — how long to wait for extension handshake
  connectionTimeout: 120000,

  // Logging: 'silent' | 'error' | 'info' | 'debug'
  logLevel: "info",

  // Framework runtime tuning pushed into the extension/content script
  framework: {
    handles: {
      // Keep handle refs alive longer for long-running flows (e.g. scraper card loops)
      ttlMs: 15 * 60 * 1000,
      // Frequency for stale handle cleanup sweeps
      cleanupIntervalMs: 60 * 1000,
    },
    debug: {
      // Default cursor trail mode on each page load; can still be changed via dom.setDebug
      enabled: true,
    },
  },

  // Human behavior tuning
  human: {
    // Global avoid rules — elements matching these are never interacted with
    avoid: {
      selectors: [], // CSS selectors: ['.cookie-banner', '.ad-overlay']
      classes: [], // Class names: ['honeypot', 'trap', 'sponsored']
      ids: [], // Element IDs: ['popup-cta']
      attributes: {}, // Attribute checks: { 'data-ad': '*', 'data-honeypot': '*' }
    },

    click: {
      thinkDelayMin: 200, // ms pause after cursor arrives, before clicking
      thinkDelayMax: 500,
      maxShiftPx: 50, // abort click if element moves more than this during think time
    },

    type: {
      baseDelayMin: 100, // ms per character
      baseDelayMax: 250,
      variance: 30, // +/- ms jitter per character
      pauseChance: 0.15, // probability of a thinking pause between characters
      pauseMin: 200, // thinking pause range
      pauseMax: 400,
    },

    scroll: {
      amountMin: 200, // px per scroll action
      amountMax: 500,
      backScrollChance: 0.1, // probability of a small scroll-back for realism
      backScrollMin: 10,
      backScrollMax: 50,
    },
  },
};
