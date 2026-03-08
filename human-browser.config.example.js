module.exports = {
  // Path to a tested Chromium-based binary
  // macOS:   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  // macOS:   "/Applications/Chromium.app/Contents/MacOS/Chromium"
  // macOS:   "/Applications/Helium.app/Contents/MacOS/Helium"
  // Linux:   "/usr/bin/google-chrome" or "/usr/bin/chromium-browser"
  // Windows: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  browser: "",

  // Where to store the browser profile
  // Default home location is "~/h17-webpilot/profile"
  // Relative paths still resolve from your project root
  profile: "~/h17-webpilot/profile",

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
      ttlMs: 15 * 60 * 1000,
      cleanupIntervalMs: 60 * 1000,
    },
    profileSeed: {
      name: "Webpilot",
      developerMode: true,
      pinExtension: true,
      restoreOnStartup: 0,
      startupUrls: [],
    },
    debug: {
      // Show cursor trail + bezier path on screen (toggle at runtime via dom.setDebug)
      cursor: true,

      // Open Chrome DevTools Protocol port for chrome://inspect
      // Off by default — exposes a DevTools port and changes the runtime surface
      // devtools: true,

      // Log raw WebSocket traffic to ~/h17-webpilot/webpilot.log by default
      // Override with sessionLogPath if you want a different file
      // sessionLog: true,
      // sessionLogPath: "~/h17-webpilot/webpilot.log",
    },
  },

  // Human behavior tuning
  human: {
    // Public defaults are examples only.
    // Set this to true only after you have tuned your own profile.
    calibrated: false,

    // Optional label shown in your own logs/docs. Not used by the runtime.
    profileName: "public-default",

    // Cursor path generation. These values are examples, not a human profile.
    cursor: {
      targetInsetRatio: 0.2,
      spreadRatio: 0.16,
      spreadMax: 48,
      cp1MinRatio: 0.2,
      cp1MaxRatio: 0.28,
      cp2MinRatio: 0.66,
      cp2MaxRatio: 0.74,
      cp2SpreadRatio: 0.3,
      minSteps: 10,
      maxSteps: 56,
      stepDivisor: 6,
      jitterRatio: 0,
      jitterMaxPx: 0,
      stutterChance: 0,
      driftThresholdPx: 0,
      driftMinPx: 0,
      driftMaxPx: 0,
      overshootRatio: 0,
      overshootThresholdPx: 240,
      overshootMinDistancePx: 120,
      overshootMaxPx: 0,
      overshootDistanceRatio: 0.04,
      overshootPerpRatio: 0,
      overshootBackSteps: 0,
    },

    // Global avoid rules — elements matching these are never interacted with
    avoid: {
      selectors: [], // CSS selectors: ['.cookie-banner', '.ad-overlay']
      classes: [], // Class names: ['honeypot', 'trap', 'sponsored']
      ids: [], // Element IDs: ['popup-cta']
      attributes: {}, // Attribute checks: { 'data-ad': '*', 'data-honeypot': '*' }
    },

    click: {
      thinkDelayMin: 35, // example defaults
      thinkDelayMax: 90,
      maxShiftPx: 50, // abort click if element moves more than this during think time
      minVisibleRatio: 0.75, // "in view" means most of the element is actually visible
      comfortTopRatio: 0.18,
      comfortBottomRatio: 0.82,
      comfortLeftRatio: 0.06,
      comfortRightRatio: 0.94,
      shiftCorrectionMax: 1, // re-evaluate once if post-scroll layout still drifts
      stableRectSamples: 3,
      stableRectIntervalMs: 80,
      stableRectTolerancePx: 2,
      stableRectTimeoutMs: 900,
    },

    type: {
      baseDelayMin: 8, // does not represent a human profile
      baseDelayMax: 20,
      variance: 4,
      pauseChance: 0,
      pauseMin: 0,
      pauseMax: 0,
    },

    scroll: {
      amountMin: 180, // px per scroll action
      amountMax: 320,
      backScrollChance: 0.03,
      backScrollMin: 8,
      backScrollMax: 24,
    },
  },
};
