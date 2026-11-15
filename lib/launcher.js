const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const RUNTIME_DIR = path.join(os.homedir(), 'h17-webpilot');
const BROWSER_STATE_FILE = path.join(RUNTIME_DIR, 'browser-process.json');

function browserLogPath(port) {
  return path.join(RUNTIME_DIR, !port || port === 7331 ? 'browser.log' : `browser-${port}.log`);
}

// Chromium defaults to X11; with only a Wayland display it exits unless told otherwise.
function waylandPlatformArgs(env, browserArgs = [], platform = process.platform) {
  if (platform !== 'linux' || !env || !env.WAYLAND_DISPLAY || env.DISPLAY) return [];
  if ((browserArgs || []).some((arg) => /^--ozone-platform(-hint)?=/.test(String(arg)))) return [];
  return ['--ozone-platform=wayland'];
}

// Chrome caches an extension's service worker in the profile and keeps running the
// cached copy across restarts and version bumps. Fingerprint the worker files and drop
// the cache when they change, so an upgrade or local edit actually takes effect.
const WORKER_FILES = ['service-worker.js', 'runtime-config.js', 'manifest.json'];

function extensionWorkerFingerprint(extensionPath) {
  const hash = crypto.createHash('sha256');
  for (const name of WORKER_FILES) {
    hash.update(name);
    try { hash.update(fs.readFileSync(path.join(extensionPath, name))); } catch {}
  }
  return hash.digest('hex');
}

// True while any process still runs with this profile (e.g. a browser shutting down,
// or one webpilot does not track). Unknown on Windows: assume free.
function defaultProfileInUse(profile) {
  if (process.platform === 'win32') return false;
  try {
    const out = execSync(`pgrep -f -- ${shellQuote(`--user-data-dir=${profile}`)}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Returns true when a cache was dropped. Skipped (and retried next launch) while the
// profile is in use, and the fingerprint is recorded only after a successful drop.
function refreshExtensionWorkerCache(profile, extensionPath, options = {}) {
  const profileInUse = options.profileInUse || defaultProfileInUse;
  const marker = path.join(profile, 'webpilot-extension.sha256');
  const current = extensionWorkerFingerprint(extensionPath);
  let previous = null;
  try { previous = fs.readFileSync(marker, 'utf8').trim(); } catch {}
  if (previous === current) return false;

  const cacheDir = path.join(profile, 'Default', 'Service Worker');
  let cleared = false;
  if (fs.existsSync(cacheDir)) {
    // A browser that was just stopped can take a moment to exit.
    for (let i = 0; i < 15 && profileInUse(profile); i++) sleepSync(200);
    if (profileInUse(profile)) return false;
    try {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      cleared = true;
    } catch {
      return false;
    }
  }
  try {
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(marker, current);
  } catch {}
  return cleared;
}

// First error lines of a browser log, without Chromium's [pid:tid:time:LEVEL:file] prefix.
function browserLogSummary(logPath, maxLines = 2) {
  let text = '';
  try { text = fs.readFileSync(logPath, 'utf8'); } catch { return ''; }
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const errors = lines.filter((l) => /ERROR|FATAL|error:/i.test(l));
  return (errors.length ? errors : lines.slice(-maxLines))
    .slice(0, maxLines)
    .map((l) => l.replace(/^\[[^\]]*\]\s*/, ''))
    .join('; ');
}

function normalizeProfilePath(profilePath) {
  return profilePath ? String(profilePath).replace(/^~/, os.homedir()) : profilePath;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function formatWarn(message) {
  return `\x1b[33m[WARN]\x1b[0m ${message}`;
}

function displayFromXauthLine(line) {
  const match = String(line || "").match(/\S+(?:\/unix)?:(\d+)\s+/);
  return match ? `:${match[1]}` : null;
}

function defaultListXauthority(authPath) {
  try {
    return execSync(`xauth -f ${shellQuote(authPath)} list`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function resolveBrowserDisplayEnv(options = {}) {
  const env = { ...(options.env || process.env) };
  const platform = options.platform || process.platform;
  const homeDir = options.homeDir || os.homedir();
  const existsSync = options.existsSync || fs.existsSync;
  const listXauthority = options.listXauthority || defaultListXauthority;

  if (platform !== 'linux') {
    return { env, inferred: false, warning: null };
  }

  if (env.DISPLAY || env.WAYLAND_DISPLAY) {
    return { env, inferred: false, warning: null };
  }

  // Agent shells often lack WAYLAND_DISPLAY while a compositor is running (with or
  // without a monitor). libwayland only falls back to wayland-0, so name the socket.
  const runtimeDir = options.runtimeDir || env.XDG_RUNTIME_DIR ||
    (typeof process.getuid === 'function' ? `/run/user/${process.getuid()}` : null);
  const listDir = options.listDir || ((dir) => fs.readdirSync(dir));
  const isSocket = options.isSocket || ((p) => {
    try { return fs.statSync(p).isSocket(); } catch { return false; }
  });
  if (runtimeDir) {
    let names = [];
    try { names = listDir(runtimeDir); } catch {}
    const sockets = names
      .filter((name) => /^wayland-\d+$/.test(name) && isSocket(path.join(runtimeDir, name)))
      .sort();
    if (sockets.length) {
      env.WAYLAND_DISPLAY = sockets.includes('wayland-0') ? 'wayland-0' : sockets[0];
      if (!env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = runtimeDir;
      return { env, inferred: true, warning: null };
    }
  }

  const authPath = env.XAUTHORITY || path.join(homeDir, '.Xauthority');
  if (authPath && existsSync(authPath)) {
    const lines = listXauthority(authPath);
    for (const line of lines) {
      const display = displayFromXauthLine(line);
      if (!display) continue;
      env.DISPLAY = display;
      env.XAUTHORITY = authPath;
      return {
        env,
        inferred: true,
        warning:
          `No DISPLAY was set; using detected desktop display DISPLAY=${display} ` +
          `XAUTHORITY=${authPath}. This launches normal Chromium, not headless mode.`,
      };
    }
  }

  return {
    env,
    inferred: false,
    warning:
      'No graphical session found (no DISPLAY, no WAYLAND_DISPLAY, no Wayland socket in ' +
      'XDG_RUNTIME_DIR). Webpilot runs a real browser window, so it needs a desktop or ' +
      'compositor session; a monitor is not required. On a server with no graphical ' +
      'session, emulate one: xvfb-run -a webpilot start -d',
  };
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

  if (seed.pinExtension !== false) {
    const pinned = Array.isArray(prefs.extensions.pinned_extensions)
      ? prefs.extensions.pinned_extensions
      : [];
    if (!pinned.includes(extensionId)) pinned.push(extensionId);
    prefs.extensions.pinned_extensions = pinned;
  }

  // Chrome tracks developer_mode, restore_on_startup, and startup_urls
  // with MAC-signed protection. Setting them externally triggers a tamper
  // reset on next launch — so we don't seed them. The --load-extension
  // flag works independently of the developer_mode UI preference.

  prefs.profile.name = seed.name || prefs.profile.name || 'Webpilot';
  prefs.profile.exited_cleanly = true;
  prefs.profile.exit_type = 'Normal';
  prefs.exited_cleanly = true;
  prefs.exit_type = 'Normal';
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
    throw new Error('No browser path configured. Set "browser" in ~/h17-webpilot/config.js');
  }
  const browserEnv = resolveBrowserDisplayEnv({ env: process.env });
  if (browserEnv.warning && !config.__displayWarningAlreadyShown) {
    console.log(formatWarn(browserEnv.warning));
  }

  // Expand ~ to home directory
  const profile = normalizeProfilePath(config.profile || '~/h17-webpilot/profile');

  // Kill only a previously managed process for this exact automation profile.
  // Profile matching is an optional fallback, not the default strategy.
  maybeKillManagedBrowser(profile, config);

  // Remove stale lock left by a previously force-killed browser instance.
  // Without this, Chromium shows a crash recovery dialog on next launch.
  try { fs.unlinkSync(path.join(profile, 'SingletonLock')); } catch {}

  refreshExtensionWorkerCache(profile, extensionPath);

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
    ...waylandPlatformArgs(browserEnv.env, config.browserArgs),
    ...(config.browserArgs || []),
    startUrl,
  ];

  // Browser output goes to a file (not a pipe): readable after a crash, no SIGPIPE.
  const logPath = browserLogPath(config.port);
  let logFd = 'ignore';
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    logFd = fs.openSync(logPath, 'w');
  } catch {}

  const child = spawn(browser, args, {
    stdio: ['ignore', logFd, logFd],
    detached: true,
    env: browserEnv.env,
  });
  if (typeof logFd === 'number') fs.closeSync(logFd);
  child.logPath = logPath;
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
  resolveBrowserDisplayEnv,
  waylandPlatformArgs,
  refreshExtensionWorkerCache,
  browserLogSummary,
  browserLogPath,
  formatWarn,
};
