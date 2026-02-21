const { spawn, execSync } = require('child_process');
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

function launchBrowser(config, extensionPath) {
  const browser = config.browser;
  if (!browser) {
    throw new Error('No browser path configured. Set "browser" in human-browser.config.js');
  }

  // Expand ~ to home directory
  const profile = (config.profile || '~/.human-browser/profile').replace(/^~/, os.homedir());

  // Kill any existing instance of this browser before wiping
  killBrowser(browser);

  // Wipe profile for a clean session (no leftover tabs/cookies from previous runs)
  // Retry in case Chromium is still releasing file locks
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (fs.existsSync(profile)) {
        fs.rmSync(profile, { recursive: true, force: true });
      }
      break;
    } catch (err) {
      if (attempt === 2) throw err;
      execSync('sleep 1', { stdio: 'ignore' });
    }
  }
  fs.mkdirSync(profile, { recursive: true });

  const viewport = config.viewport || { width: 1280, height: 900 };
  const startUrl = config.startUrl || 'about:blank';

  const args = [
    `--user-data-dir=${profile}`,
    `--load-extension=${extensionPath}`,
    '--disable-fre',
    '--no-default-browser-check',
    '--no-first-run',
    `--window-size=${viewport.width},${viewport.height}`,
    ...(config.userAgent ? [`--user-agent=${config.userAgent}`] : []),
    ...(config.browserArgs || []),
    startUrl,
  ];

  const child = spawn(browser, args, { stdio: 'ignore', detached: true });
  child.unref();
  return child;
}

module.exports = { launchBrowser };
