const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const RUNTIME_DIR = path.join(os.homedir(), 'h17-webpilot');
const BROWSER_STATE_FILE = path.join(RUNTIME_DIR, 'browser-process.json');

function normalizeProfilePath(profilePath) {
  return profilePath ? String(profilePath).replace(/^~/, os.homedir()) : profilePath;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// Kill only browser instances that are using this framework's profile.
// Never kill by browser name alone: that can terminate the user's normal session.
function killBrowserForProfile(profilePath) {
  if (!profilePath || process.platform === 'win32') return;
  profilePath = normalizeProfilePath(profilePath);
  try {
    execSync(`pkill -f -- "--user-data-dir=${profilePath}" 2>/dev/null || true`, {
      stdio: 'ignore',
    });
    execSync('sleep 2', { stdio: 'ignore' });
  } catch {}
}

function killBrowserByBinary(browserPath) {
  if (!browserPath || process.platform === 'win32') return;
  const normalized = String(browserPath);
  const binaryName = path.basename(normalized);
  try {
    execSync(`pkill -x -- ${shellQuote(binaryName)} 2>/dev/null || true`, {
      stdio: 'ignore',
    });
  } catch {}
  try {
    execSync(`pkill -f -- ${shellQuote(normalized)} 2>/dev/null || true`, {
      stdio: 'ignore',
    });
  } catch {}
  sleepSeconds(2);
}

function sleepSeconds(sec) {
  try {
    execSync(`sleep ${sec}`, { stdio: 'ignore' });
  } catch {}
}

function readBrowserState() {
  try {
    return JSON.parse(fs.readFileSync(BROWSER_STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeBrowserState(state) {
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(BROWSER_STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

function clearBrowserState() {
  try { fs.unlinkSync(BROWSER_STATE_FILE); } catch {}
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getProcessCommandLine(pid) {
  try {
    if (process.platform === 'win32') {
      return execSync(
        `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId=${pid}\\").CommandLine"`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
    }
    return execSync(`ps -p ${pid} -o command=`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function pidMatchesProfile(pid, profilePath) {
  profilePath = normalizeProfilePath(profilePath);
  if (!pid || !profilePath || !processExists(pid)) return false;
  const cmd = getProcessCommandLine(pid);
  return !!cmd && cmd.includes(`--user-data-dir=${profilePath}`);
}

function terminateManagedPid(pid) {
  if (!pid || !processExists(pid)) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      return;
    }
    process.kill(-pid, 'SIGTERM');
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
  sleepSeconds(2);
  if (!processExists(pid)) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  sleepSeconds(1);
}

function stopManagedBrowser(profilePath, options = {}) {
  profilePath = normalizeProfilePath(profilePath);
  const fallbackToProfileMatch = options.fallbackToProfileMatch !== false;
  const state = readBrowserState();

  if (state?.pid && state.profile === profilePath && pidMatchesProfile(state.pid, profilePath)) {
    terminateManagedPid(state.pid);
  }

  clearBrowserState();

  if (fallbackToProfileMatch) {
    killBrowserForProfile(profilePath);
  }
}

function maybeKillManagedBrowser(profilePath, config = {}) {
  const cleanupConfig = config.framework?.processCleanup || {};
  const fallbackToProfileMatch = cleanupConfig.fallbackToProfileMatch === true;
  stopManagedBrowser(profilePath, {
    fallbackToProfileMatch,
  });
}

// Chrome derives unpacked extension IDs from the absolute path:
// SHA-256 hash → first 32 hex chars → each hex digit mapped to a-p
function computeExtensionId(extensionAbsPath) {
  const hash = crypto.createHash('sha256').update(extensionAbsPath).digest('hex');
  return hash.slice(0, 32).split('').map(c =>
    String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))
  ).join('');
}

function getProfileSeed(config = {}) {
  return config.framework?.profileSeed || {};
}

function writeLocalState(profilePath, seed = {}) {
  const localStatePath = path.join(profilePath, 'Local State');
  let state = {};
  try {
    if (fs.existsSync(localStatePath)) {
      state = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    }
  } catch {}

  if (!state.profile) state.profile = {};
  if (!state.profile.info_cache) state.profile.info_cache = {};
  if (!state.profile.info_cache.Default) state.profile.info_cache.Default = {};
  const info = state.profile.info_cache.Default;
  info.name = seed.name || 'Webpilot';
  info.is_using_default_name = false;
  if (!Array.isArray(state.profile.last_active_profiles)) {
    state.profile.last_active_profiles = ['Default'];
  }
  if (!Array.isArray(state.profile.profiles_order)) {
    state.profile.profiles_order = ['Default'];
  }

  fs.writeFileSync(localStatePath, JSON.stringify(state));
}

function applyPreferenceSeed(prefs, extensionId, seed = {}) {
  if (!prefs.extensions) prefs.extensions = {};
  if (!prefs.profile) prefs.profile = {};
  if (!prefs.session) prefs.session = {};
  if (!prefs.extensions.ui) prefs.extensions.ui = {};

  if (seed.pinExtension !== false) {
    const pinned = Array.isArray(prefs.extensions.pinned_extensions)
      ? prefs.extensions.pinned_extensions
      : [];
    if (!pinned.includes(extensionId)) pinned.push(extensionId);
    prefs.extensions.pinned_extensions = pinned;
  }

  prefs.extensions.ui.developer_mode = seed.developerMode !== false;
  prefs.profile.name = seed.name || prefs.profile.name || 'Webpilot';
  prefs.profile.exited_cleanly = true;
  prefs.profile.exit_type = 'Normal';
  prefs.exited_cleanly = true;
  prefs.exit_type = 'Normal';
  prefs.session.restore_on_startup =
    Number.isInteger(seed.restoreOnStartup) ? seed.restoreOnStartup : 0;
  prefs.session.startup_urls = Array.isArray(seed.startupUrls) ? seed.startupUrls : [];
  return prefs;
}

// First run: seed Default/Preferences with pinned extension + clean exit flags
function seedProfile(profilePath, extensionPath, config = {}) {
  const defaultDir = path.join(profilePath, 'Default');
  fs.mkdirSync(defaultDir, { recursive: true });

  const extId = computeExtensionId(path.resolve(extensionPath));
  const prefs = applyPreferenceSeed({}, extId, getProfileSeed(config));
  fs.writeFileSync(path.join(defaultDir, 'Preferences'), JSON.stringify(prefs));
  writeLocalState(profilePath, getProfileSeed(config));
}

// Subsequent runs: delete session files so Chrome doesn't restore old tabs,
// mark profile as cleanly exited to suppress the "restore" bar
function cleanSession(profilePath, extensionPath, config = {}) {
  const defaultDir = path.join(profilePath, 'Default');
  for (const f of ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs']) {
    try { fs.unlinkSync(path.join(defaultDir, f)); } catch {}
  }
  try {
    const sessionsDir = path.join(defaultDir, 'Sessions');
    if (fs.existsSync(sessionsDir)) {
      for (const name of fs.readdirSync(sessionsDir)) {
        if (/^(Session|Tabs)_/.test(name)) {
          try { fs.unlinkSync(path.join(sessionsDir, name)); } catch {}
        }
      }
    }
  } catch {}

  const prefsPath = path.join(defaultDir, 'Preferences');
  try {
    if (fs.existsSync(prefsPath)) {
      const extId = computeExtensionId(path.resolve(extensionPath));
      const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
      applyPreferenceSeed(prefs, extId, getProfileSeed(config));
      fs.writeFileSync(prefsPath, JSON.stringify(prefs));
    }
  } catch {}
  try {
    writeLocalState(profilePath, getProfileSeed(config));
  } catch {}
}

function launchBrowser(config, extensionPath) {
  const browser = config.browser;
  if (!browser) {
    throw new Error('No browser path configured. Set "browser" in ~/h17-webpilot/config.js or human-browser.config.js');
  }

  // Expand ~ to home directory
  const profile = normalizeProfilePath(config.profile || '~/h17-webpilot/profile');

  // Kill only a previously managed process for this exact automation profile.
  // Profile matching is an optional fallback, not the default strategy.
  maybeKillManagedBrowser(profile, config);

  // Remove stale lock left by a previously force-killed browser instance.
  // Without this, Chromium shows a crash recovery dialog on next launch.
  try { fs.unlinkSync(path.join(profile, 'SingletonLock')); } catch {}

  if (fs.existsSync(path.join(profile, 'Default'))) {
    cleanSession(profile, extensionPath, config);
  } else {
    seedProfile(profile, extensionPath, config);
  }

  const viewport = config.viewport || { width: 1280, height: 900 };
  const startUrl = config.startUrl || 'about:blank';

  const fwDebug = config.framework?.debug || {};
  const debugPort = fwDebug.devtools ? 9222 : null;

  const args = [
    `--user-data-dir=${profile}`,
    `--load-extension=${extensionPath}`,
    '--disable-fre',
    '--no-default-browser-check',
    '--no-first-run',
    `--window-size=${viewport.width},${viewport.height}`,
    ...(debugPort ? [`--remote-debugging-port=${debugPort}`] : []),
    ...(config.userAgent ? [`--user-agent=${config.userAgent}`] : []),
    ...(config.browserArgs || []),
    startUrl,
  ];

  const child = spawn(browser, args, { stdio: 'ignore', detached: true });
  writeBrowserState({ pid: child.pid, profile, browser });
  child.unref();
  return child;
}

module.exports = {
  launchBrowser,
  clearBrowserState,
  killBrowserForProfile,
  killBrowserByBinary,
  stopManagedBrowser,
  normalizeProfilePath,
};
