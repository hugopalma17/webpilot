const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Kill all instances of the configured browser binary.
function killBrowser(browserPath) {
  if (!browserPath) return;
  try {
    const name = path.basename(browserPath);
    execSync(`pkill -f "${name}" 2>/dev/null || true`, { stdio: 'ignore' });
    execSync('sleep 2', { stdio: 'ignore' });
  } catch {}
}

// Chrome derives unpacked extension IDs from the absolute path:
// SHA-256 hash → first 32 hex chars → each hex digit mapped to a-p
function computeExtensionId(extensionAbsPath) {
  const hash = crypto.createHash('sha256').update(extensionAbsPath).digest('hex');
  return hash.slice(0, 32).split('').map(c =>
    String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))
  ).join('');
}

// First run: seed Default/Preferences with pinned extension + clean exit flags
function seedProfile(profilePath, extensionPath) {
  const defaultDir = path.join(profilePath, 'Default');
  fs.mkdirSync(defaultDir, { recursive: true });

  const extId = computeExtensionId(path.resolve(extensionPath));
  const prefs = {
    extensions: { pinned_extensions: [extId] },
    profile: { exited_cleanly: true, exit_type: 'Normal' },
    session: { restore_on_startup: 5 },
  };
  fs.writeFileSync(path.join(defaultDir, 'Preferences'), JSON.stringify(prefs));
}

// Subsequent runs: delete session files so Chrome doesn't restore old tabs,
// mark profile as cleanly exited to suppress the "restore" bar
function cleanSession(profilePath) {
  const defaultDir = path.join(profilePath, 'Default');
  for (const f of ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs']) {
    try { fs.unlinkSync(path.join(defaultDir, f)); } catch {}
  }

  const prefsPath = path.join(defaultDir, 'Preferences');
  try {
    if (fs.existsSync(prefsPath)) {
      const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
      if (!prefs.profile) prefs.profile = {};
      prefs.profile.exited_cleanly = true;
      prefs.profile.exit_type = 'Normal';
      fs.writeFileSync(prefsPath, JSON.stringify(prefs));
    }
  } catch {}
}

function launchBrowser(config, extensionPath) {
  const browser = config.browser;
  if (!browser) {
    throw new Error('No browser path configured. Set "browser" in human-browser.config.js');
  }

  // Expand ~ to home directory
  const profile = (config.profile || '~/.human-browser/profile').replace(/^~/, os.homedir());

  // Kill any existing instance of this browser
  killBrowser(browser);

  if (fs.existsSync(path.join(profile, 'Default'))) {
    cleanSession(profile);
  } else {
    seedProfile(profile, extensionPath);
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
  child.unref();
  return child;
}

module.exports = { launchBrowser };
