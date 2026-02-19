const { spawn, execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Kill only browser instances using our specific profile directory.
// This avoids killing the user's personal browser sessions (e.g. Google Chrome with YouTube open).
function killExistingBrowser(profileDir) {
  if (!profileDir) return;
  try {
    // Find and kill only processes that have our --user-data-dir in their command line
    execSync(`pkill -f "user-data-dir=${profileDir}" 2>/dev/null || true`, { stdio: 'ignore' });
    // Give the OS a moment to clean up
    execSync('sleep 1', { stdio: 'ignore' });
  } catch {}
}

function launchBrowser(config, extensionPath) {
  const browser = config.browser;
  if (!browser) {
    throw new Error('No browser path configured. Set "browser" in human-browser.config.js');
  }

  // Expand ~ to home directory
  const profile = (config.profile || '~/.human-browser/profile').replace(/^~/, os.homedir());

  // Ensure profile directory exists
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

  // Kill any existing instance using this profile to ensure fresh extension load
  killExistingBrowser(profile);

  const child = spawn(browser, args, { stdio: 'ignore', detached: true });
  child.unref();
  return child;
}

module.exports = { launchBrowser };
