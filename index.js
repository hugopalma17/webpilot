const path = require('path');
const fs = require('fs');
const os = require('os');
const { createServer, log, setLogLevel, initDebugLog, debugLog } = require('./lib/server');
const { launchBrowser } = require('./lib/launcher');
const { BridgePage } = require('./client/page');
const client = require('./client');


// Config Loader


const CONFIG_DEFAULTS = {
  browser: '',
  profile: '~/.human-browser/profile',
  port: 7331,
  startUrl: 'about:blank',
  viewport: { width: 1920, height: 1080 },
  browserArgs: [],
  connectionTimeout: 120000,
  logLevel: 'info',
  framework: {
    handles: {
      ttlMs: 15 * 60 * 1000,
      cleanupIntervalMs: 60 * 1000,
    },
    debug: {
      cursor: true,
      // devtools: false,
      // sessionLog: false,
    },
  },
  human: {
    avoid: { selectors: [], classes: [], ids: [], attributes: {} },
    click: { thinkDelayMin: 200, thinkDelayMax: 500, maxShiftPx: 50 },
    type: { baseDelayMin: 100, baseDelayMax: 250, variance: 30, pauseChance: 0.15, pauseMin: 200, pauseMax: 600 },
    scroll: { amountMin: 300, amountMax: 700, backScrollChance: 0.2, backScrollMin: 20, backScrollMax: 100 },
  },
};

function deepMerge(target, ...sources) {
  for (const source of sources) {
    if (!source) continue;
    for (const [key, val] of Object.entries(source)) {
      if (val && typeof val === 'object' && !Array.isArray(val) && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        target[key] = deepMerge({ ...target[key] }, val);
      } else if (val !== undefined) {
        target[key] = val;
      }
    }
  }
  return target;
}

function loadConfig(overrides = {}) {
  let fileConfig = {};
  const homeConfig = path.join(os.homedir(), '.config', 'human-browser');
  const candidates = [
    path.join(process.cwd(), 'human-browser.config.js'),
    path.join(process.cwd(), 'human-browser.config.json'),
    path.join(homeConfig, 'config.js'),
    path.join(homeConfig, 'config.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      if (candidate.endsWith('.js')) {
        fileConfig = require(candidate);
      } else {
        fileConfig = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      }
      break;
    }
  }

  return deepMerge({}, CONFIG_DEFAULTS, fileConfig, overrides);
}


// Start — launch browser + WS server, return transport


async function start(overrides = {}) {
  const config = loadConfig(overrides);
  setLogLevel(config.logLevel);

  // Kill anything holding our port from a previous run
  const port = config.port || 7331;
  try {
    require('child_process').execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
  } catch {}

  const fwDebug = config.framework?.debug || {};

  if (fwDebug.sessionLog) {
    initDebugLog(path.join(process.cwd(), 'debug_session.log'));
  }
  log('INFO', `Human Browser starting on port ${port}`);

  const server = createServer(config);
  const extensionPath = path.join(__dirname, 'extension');

  const browserProcess = launchBrowser(config, extensionPath);
  log('INFO', `Browser launched (PID ${browserProcess.pid})`);
  if (fwDebug.devtools) {
    log('INFO', `DevTools CDP port enabled: chrome://inspect or http://localhost:9222`);
  }

  const transport = await server.waitForConnection();
  log('INFO', 'Extension connected — ready for commands');

  // Version check: compare running extension vs local manifest
  try {
    const manifestPath = path.join(__dirname, 'extension', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const extConfig = await transport.send('framework.getConfig');
    debugLog('---', `Extension v${extConfig.version} (manifest: ${manifest.version})`);
    if (extConfig.version !== manifest.version) {
      log('WARN', `Extension version mismatch! Running: ${extConfig.version}, expected: ${manifest.version}`);
      debugLog('!!!', `VERSION MISMATCH running=${extConfig.version} expected=${manifest.version}`);
    } else {
      log('INFO', `Extension v${extConfig.version} verified`);
    }
  } catch (err) {
    log('WARN', `Version check failed: ${err.message}`);
  }

  // Close all tabs except the one on startUrl
  try {
    const tabs = await transport.send('tabs.list');
    if (tabs.length > 1) {
      const startUrl = config.startUrl || 'about:blank';
      const keep = tabs.find(t => t.url === startUrl || t.active) || tabs[0];
      for (const tab of tabs) {
        if (tab.id !== keep.id) {
          await transport.send('tabs.close', {}, tab.id);
        }
      }
      log('INFO', `Closed ${tabs.length - 1} extra tab(s)`);
    }
  } catch (err) {
    log('INFO', `Tab cleanup skipped: ${err.message}`);
  }

  return { server, transport, browserProcess, config };
}


// startWithPage — convenience: start + create BridgePage on first tab


async function startWithPage(overrides = {}) {
  const { server, transport, browserProcess, config } = await start(overrides);
  const page = new BridgePage(transport);

  // Find first non-extension tab
  const tabs = await transport.send('tabs.list');
  let targetTab = tabs.find(t => !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'));
  if (!targetTab && tabs.length > 0) targetTab = tabs[0];

  if (targetTab) {
    page.setTabId(targetTab.id);
    page._currentUrl = targetTab.url;
    log('INFO', `Active tab: ${targetTab.title || targetTab.url} (id: ${targetTab.id})`);
  }

  return { server, page, browserProcess, config };
}


// connectToServer — connect to an already-running WS server as a client


async function connectToServer(overrides = {}) {
  const config = loadConfig(overrides);
  const port = config.port || 7331;
  const WebSocket = require('ws');

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    let idCounter = 1;
    const pending = new Map();
    const eventListeners = {};

    ws.on('open', async () => {
      const transport = {
        send(action, params = {}, tabId = null) {
          return new Promise((res, rej) => {
            const id = idCounter++;
            pending.set(id, { resolve: res, reject: rej });
            const msg = { id, action, params };
            if (tabId) msg.tabId = tabId;
            ws.send(JSON.stringify(msg));
          });
        },
        on(event, fn) {
          if (!eventListeners[event]) eventListeners[event] = [];
          eventListeners[event].push(fn);
        },
        close() { ws.close(); },
      };

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id && pending.has(msg.id)) {
          const { resolve: res, reject: rej } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error));
          else res(msg.result);
        }
      });

      const page = new BridgePage(transport);

      // Find first non-extension tab
      const tabs = await transport.send('tabs.list');
      let targetTab = tabs.find(t => !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'));
      if (!targetTab && tabs.length > 0) targetTab = tabs[0];
      if (targetTab) {
        page.setTabId(targetTab.id);
        page._currentUrl = targetTab.url;
      }

      resolve(page);
    });

    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 5000);
  });
}


// Graceful shutdown helper — kills browser PID after delay


function killBrowserAndExit(browserProcess, server, code = 1) {
  if (server) try { server.close(); } catch {}
  if (browserProcess && browserProcess.pid) {
    log('INFO', `Killing browser (PID ${browserProcess.pid}) in 2s...`);
    setTimeout(() => {
      try { process.kill(browserProcess.pid); } catch {}
      process.exit(code);
    }, 2000);
  } else {
    process.exit(code);
  }
}

if (require.main === module) {
  start().then(({ server, browserProcess }) => {
    log('INFO', 'Accepting WebSocket commands. Press Ctrl+C to stop.');

    process.on('SIGINT', () => {
      log('INFO', 'Shutting down...');
      killBrowserAndExit(browserProcess, server, 0);
    });
  }).catch(err => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
}


// Exports


module.exports = {
  start,
  startWithPage,
  connectToServer,
  loadConfig,
  killBrowserAndExit,
  ...client,
};
