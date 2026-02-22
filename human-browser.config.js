module.exports = {
  // Path to any Chromium-based binary (Chrome, Chromium, Brave, Helium, etc.)
  browser: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",

  // Spoof user agent — match your real browser to avoid fingerprint mismatches
  // userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",

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
      // Show cursor trail + bezier path on screen (toggle at runtime via dom.setDebug)
      // cursor: true,

      // Open Chrome DevTools Protocol port for chrome://inspect
      // Lets you watch DOM, network, console while commands flow through WebSocket
      // Off by default — adds the CDP fingerprint that automation detectors look for
       //devtools: true,

      // Log raw WebSocket traffic to debug_session.log in project root
       sessionLog: true,
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
      thinkDelayMin: 150, // ms pause after cursor arrives, before clicking
      thinkDelayMax: 400,
      maxShiftPx: 50, // abort click if element moves more than this during think time
    },

    type: {
      baseDelayMin: 80, // ms per character
      baseDelayMax: 180,
      variance: 25, // +/- ms jitter per character
      pauseChance: 0.12, // probability of a thinking pause between characters
      pauseMin: 150, // thinking pause range
      pauseMax: 400,
    },

    scroll: {
      amountMin: 250, // px per scroll action
      amountMax: 550,
      backScrollChance: 0.1, // probability of a small scroll-back for realism
      backScrollMin: 15,
      backScrollMax: 60,
    },
  },
};
