"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const HOME_CONFIG_DIR = path.join(os.homedir(), "h17-webpilot");

function expandHome(inputPath) {
  return inputPath.replace(/^~/, os.homedir());
}

function configCandidates() {
  return [
    path.join(HOME_CONFIG_DIR, "config.js"),
    path.join(HOME_CONFIG_DIR, "config.json"),
  ];
}

function findExistingConfig() {
  return configCandidates().find((candidate) => fs.existsSync(candidate)) || null;
}

function commandPath(binary) {
  try {
    return execFileSync("which", [binary], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function pushCandidate(results, seen, label, candidatePath) {
  if (!candidatePath || !fs.existsSync(candidatePath)) return;
  let resolved = candidatePath;
  try {
    resolved = fs.realpathSync(candidatePath);
  } catch {}
  if (seen.has(resolved)) return;
  seen.add(resolved);
  results.push({ label, path: resolved });
}

function detectMacBrowsers(results, seen) {
  const appRoots = ["/Applications", path.join(os.homedir(), "Applications")];
  const apps = [
    ["Google Chrome", "Google Chrome.app/Contents/MacOS/Google Chrome"],
    ["Chromium", "Chromium.app/Contents/MacOS/Chromium"],
    ["Brave", "Brave Browser.app/Contents/MacOS/Brave Browser"],
    ["Microsoft Edge", "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
    ["Vivaldi", "Vivaldi.app/Contents/MacOS/Vivaldi"],
    ["Opera", "Opera.app/Contents/MacOS/Opera"],
    ["Arc", "Arc.app/Contents/MacOS/Arc"],
    ["Helium", "Helium.app/Contents/MacOS/Helium"],
  ];

  for (const root of appRoots) {
    for (const [label, rel] of apps) {
      pushCandidate(results, seen, label, path.join(root, rel));
    }
  }
}

function detectLinuxBrowsers(results, seen) {
  const binaries = [
    ["Google Chrome", "google-chrome"],
    ["Google Chrome Stable", "google-chrome-stable"],
    ["Chromium", "chromium"],
    ["Chromium Browser", "chromium-browser"],
    ["Brave", "brave-browser"],
    ["Microsoft Edge", "microsoft-edge"],
    ["Microsoft Edge Stable", "microsoft-edge-stable"],
    ["Vivaldi", "vivaldi"],
    ["Opera", "opera"],
  ];

  for (const [label, binary] of binaries) {
    const found = commandPath(binary);
    if (found) pushCandidate(results, seen, label, found);
  }
}

function detectWindowsBrowsers(results, seen) {
  const roots = [
    process.env["PROGRAMFILES"],
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ].filter(Boolean);

  const rels = [
    ["Google Chrome", "Google/Chrome/Application/chrome.exe"],
    ["Chromium", "Chromium/Application/chrome.exe"],
    ["Brave", "BraveSoftware/Brave-Browser/Application/brave.exe"],
    ["Microsoft Edge", "Microsoft/Edge/Application/msedge.exe"],
    ["Vivaldi", "Vivaldi/Application/vivaldi.exe"],
    ["Opera", "Programs/Opera/opera.exe"],
  ];

  for (const root of roots) {
    for (const [label, rel] of rels) {
      pushCandidate(results, seen, label, path.join(root, rel));
    }
  }
}

function detectBrowsers() {
  const results = [];
  const seen = new Set();
  switch (process.platform) {
    case "darwin":
      detectMacBrowsers(results, seen);
      break;
    case "win32":
      detectWindowsBrowsers(results, seen);
      break;
    default:
      detectLinuxBrowsers(results, seen);
      break;
  }
  return results;
}

function writeDefaultConfig(browserPath, targetPath = path.join(HOME_CONFIG_DIR, "config.js")) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const contents = `module.exports = {
  // Path to any Chromium-based binary (Chrome, Chromium, Brave, Edge, etc.)
  browser: ${JSON.stringify(browserPath || "")},

  // Where to store the browser profile used by this framework
  profile: "~/h17-webpilot/profile",

  // Local WebSocket bridge port
  port: 7331,

  // First page to open on launch
  startUrl: "https://hugopalma.work",

  // Browser window size
  viewport: { width: 1920, height: 1080 },

  // Extra Chromium flags
  browserArgs: [],

  // How long to wait for the extension handshake
  connectionTimeout: 120000,

  // Logging: silent | error | info | debug
  logLevel: "info",

  framework: {
    handles: {
      ttlMs: 15 * 60 * 1000,
      cleanupIntervalMs: 60 * 1000,
    },
    profileSeed: {
      name: "Webpilot",
      pinExtension: true,
    },
    debug: {
      // Visible on purpose so users can see the cursor path they are configuring
      cursor: true,
    },
  },

  human: {
    // Public defaults are intentionally generic. Tune your own profile.
    calibrated: false,
    profileName: "public-default",
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
    avoid: {
      selectors: [],
      classes: [],
      ids: [],
      attributes: {},
    },
    click: {
      thinkDelayMin: 35,
      thinkDelayMax: 90,
      maxShiftPx: 50,
      minVisibleRatio: 0.75,
      comfortTopRatio: 0.18,
      comfortBottomRatio: 0.82,
      comfortLeftRatio: 0.06,
      comfortRightRatio: 0.94,
      shiftCorrectionMax: 1,
      stableRectSamples: 3,
      stableRectIntervalMs: 80,
      stableRectTolerancePx: 2,
      stableRectTimeoutMs: 900,
    },
    type: {
      baseDelayMin: 8,
      baseDelayMax: 20,
      variance: 4,
      pauseChance: 0,
      pauseMin: 0,
      pauseMax: 0,
    },
    scroll: {
      amountMin: 180,
      amountMax: 320,
      backScrollChance: 0.03,
      backScrollMin: 8,
      backScrollMax: 24,
    },
  },
};
`;
  fs.writeFileSync(targetPath, contents);
  return targetPath;
}

module.exports = {
  HOME_CONFIG_DIR,
  configCandidates,
  findExistingConfig,
  detectBrowsers,
  writeDefaultConfig,
  expandHome,
};
