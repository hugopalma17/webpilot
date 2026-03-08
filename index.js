const path = require('path');
const fs = require('fs');
const os = require('os');
const { createServer, log, setLogLevel, initDebugLog, debugLog } = require('./lib/server');
const { launchBrowser, clearBrowserState } = require('./lib/launcher');
const { BridgePage } = require('./client/page');
const client = require('./client');


// Config Loader


const CONFIG_DEFAULTS = {
  browser: '',
  profile: '~/h17-webpilot/profile',
  port: 7331,
  startUrl: 'https://hugopalma.work',
  viewport: { width: 1920, height: 1080 },
  browserArgs: [],
  connectionTimeout: 120000,
  logLevel: 'info',
  framework: {
    handles: {
      ttlMs: 15 * 60 * 1000,
      cleanupIntervalMs: 60 * 1000,
    },
    profileSeed: {
      name: 'Webpilot',
      developerMode: true,
      pinExtension: true,
      restoreOnStartup: 0,
      startupUrls: [],
    },
    debug: {
      cursor: true,
      // devtools: false,
      // sessionLog: false,
    },
  },
  human: {
    calibrated: false,
    profileName: 'public-default',
    avoid: { selectors: [], classes: [], ids: [], attributes: {} },
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
    type: { baseDelayMin: 8, baseDelayMax: 20, variance: 4, pauseChance: 0, pauseMin: 0, pauseMax: 0 },
    scroll: { amountMin: 180, amountMax: 320, backScrollChance: 0.03, backScrollMin: 8, backScrollMax: 24 },
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
  const {
    __configPath,
    __sessionLog,
    __sessionLogPath,
    __internal,
    ...configOverrides
  } = overrides || {};
  let fileConfig = {};
  let sourcePath = null;
  const homeConfig = path.join(os.homedir(), 'h17-webpilot');
  const explicitConfig = __configPath
    ? path.resolve(String(__configPath).replace(/^~/, os.homedir()))
    : null;
  const candidates = explicitConfig
    ? [explicitConfig]
    : [
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
      sourcePath = candidate;
      break;
    }
  }

  const runtimeOverrides = {};
  if (__sessionLog || __sessionLogPath) {
    runtimeOverrides.framework = {
      debug: {
        sessionLog: !!__sessionLog || !!__sessionLogPath,
        ...( __sessionLogPath ? { sessionLogPath: __sessionLogPath } : {} ),
      },
    };
  }

  const config = deepMerge({}, CONFIG_DEFAULTS, fileConfig, runtimeOverrides, configOverrides);
  Object.defineProperty(config, '__sourcePath', {
    value: sourcePath,
    enumerable: false,
    configurable: true,
  });
  return config;
}

function resolvePathFromConfig(config, inputPath) {
  if (!inputPath) return inputPath;
  if (path.isAbsolute(inputPath)) return inputPath;
  const baseDir = config.__sourcePath
    ? path.dirname(config.__sourcePath)
    : process.cwd();
  return path.resolve(baseDir, inputPath);
}

function resolveBootCommand(line) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    const msg = JSON.parse(trimmed);
    return { action: msg.action || '', params: msg.params || {}, tabId: msg.tabId ?? null };
  }

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const rest = parts.slice(1).join(' ');

  switch (cmd) {
    case 'go':
    case 'nav':
    case 'navigate':
    case 'goto': {
      if (!rest) return null;
      let url = rest;
      if (!url.includes('://')) {
        url = (url.startsWith('localhost') || url.startsWith('127.0.0.1'))
          ? 'http://' + url
          : 'https://' + url;
      }
      return { action: 'tabs.navigate', params: { url } };
    }
    case 'click':
      if (!rest) return null;
      return rest.startsWith('el_')
        ? { action: 'human.click', params: { handleId: rest } }
        : { action: 'human.click', params: { selector: rest } };
    case 'type': {
      if (!rest) return null;
      const first = parts[1];
      if (
        parts.length > 2 &&
        (first.startsWith('#') ||
          first.startsWith('.') ||
          first.startsWith('[') ||
          first.includes('='))
      ) {
        return {
          action: 'human.type',
          params: { selector: first, text: parts.slice(2).join(' ') },
        };
      }
      return { action: 'human.type', params: { text: rest } };
    }
    case 'sd':
    case 'su': {
      const p = { direction: cmd === 'sd' ? 'down' : 'up' };
      for (const a of parts.slice(1)) {
        if (/^\d+$/.test(a)) p.amount = parseInt(a, 10);
        else p.selector = a;
      }
      return { action: 'human.scroll', params: p };
    }
    case 'q':
    case 'query':
      if (!rest) return null;
      return { action: 'dom.queryAllInfo', params: { selector: rest } };
    case 'wait':
      if (!rest) return null;
      return { action: 'dom.waitForSelector', params: { selector: rest } };
    case 'eval':
    case 'js': {
      if (!rest) return null;
      let fn = rest;
      if (!fn.startsWith('()') && !fn.startsWith('function')) fn = '() => ' + fn;
      return { action: 'dom.evaluate', params: { fn } };
    }
    case 'title':
      return { action: 'dom.evaluate', params: { fn: '() => document.title' } };
    case 'url':
      return { action: 'dom.evaluate', params: { fn: '() => location.href' } };
    case 'html':
      return { action: 'dom.getHTML', params: {} };
    case 'reload':
      return { action: 'tabs.reload', params: {} };
    case 'back':
      return { action: 'dom.evaluate', params: { fn: '() => { history.back(); return true; }' } };
    case 'forward':
      return { action: 'dom.evaluate', params: { fn: '() => { history.forward(); return true; }' } };
    case 'clear':
      if (!rest) return null;
      return { action: 'human.clearInput', params: { selector: rest } };
    case 'key':
    case 'press':
      if (!rest) return null;
      return { action: 'dom.keyPress', params: { key: rest } };
    case 'discover':
      return { action: 'dom.discoverElements', params: {} };
    case 'frames':
      return { action: 'frames.list', params: {} };
    case 'cookies':
      if (!rest || rest === 'get') return { action: 'cookies.getAll', params: {} };
      return null;
    case 'box':
      if (!rest) return null;
      return rest.startsWith('el_')
        ? { action: 'dom.boundingBox', params: { handleId: rest } }
        : { action: 'dom.boundingBox', params: { selector: rest } };
    default:
      break;
  }

  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return { action: trimmed, params: {} };
  const action = trimmed.slice(0, spaceIdx);
  const params = JSON.parse(trimmed.slice(spaceIdx + 1).trim());
  return { action, params };
}

async function loadCookiesFromFile(transport, config, filePath) {
  const resolvedPath = resolvePathFromConfig(config, filePath);
  const data = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  if (!Array.isArray(data)) {
    throw new Error(`Boot cookies file must contain a JSON array: ${resolvedPath}`);
  }
  let ok = 0;
  let fail = 0;
  for (const cookie of data) {
    try {
      await transport.send('cookies.set', { cookie });
      ok++;
    } catch {
      fail++;
    }
  }
  return { ok, fail, path: resolvedPath };
}

async function runBootSequence(transport, config) {
  const boot = config.boot || {};
  if (!boot || typeof boot !== 'object') return;

  if (boot.cookiesPath) {
    const result = await loadCookiesFromFile(transport, config, boot.cookiesPath);
    log('INFO', `Boot cookies loaded from ${result.path} (${result.ok} ok, ${result.fail} failed)`);
  }

  if (!Array.isArray(boot.commands) || boot.commands.length === 0) return;

  for (const entry of boot.commands) {
    if (!entry) continue;

    if (typeof entry === 'object' && !Array.isArray(entry)) {
      if (entry.cookiesPath) {
        const result = await loadCookiesFromFile(transport, config, entry.cookiesPath);
        log('INFO', `Boot cookies loaded from ${result.path} (${result.ok} ok, ${result.fail} failed)`);
        continue;
      }
      if (!entry.action) throw new Error('Boot command object requires action');
      await transport.send(entry.action, entry.params || {}, entry.tabId ?? null);
      continue;
    }

    if (typeof entry !== 'string') {
      throw new Error(`Unsupported boot command type: ${typeof entry}`);
    }

    const trimmed = entry.trim();
    if (!trimmed) continue;

    if (trimmed.toLowerCase().startsWith('cookies load')) {
      const parts = trimmed.split(/\s+/);
      const filePath = parts[2] || 'cookies.json';
      const result = await loadCookiesFromFile(transport, config, filePath);
      log('INFO', `Boot cookies loaded from ${result.path} (${result.ok} ok, ${result.fail} failed)`);
      continue;
    }

    const resolved = resolveBootCommand(trimmed);
    if (!resolved) continue;
    await transport.send(resolved.action, resolved.params || {}, resolved.tabId ?? null);
  }
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

  if (fwDebug.sessionLog || fwDebug.sessionLogPath) {
    const sessionLogPath = resolvePathFromConfig(
      config,
      fwDebug.sessionLogPath || path.join(os.homedir(), 'h17-webpilot', 'webpilot.log'),
    );
    initDebugLog(sessionLogPath);
  }
  log('INFO', `Human Browser starting on port ${port}`);
  if (!config.human?.calibrated) {
    log(
      'WARN',
      'Using uncalibrated public profile. Built-in human settings are generic development defaults.',
    );
  }

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

  try {
    await runBootSequence(transport, config);
  } catch (err) {
    log('WARN', `Boot sequence failed: ${err.message}`);
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
      clearBrowserState();
      process.exit(code);
    }, 2000);
  } else {
    clearBrowserState();
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
  startSession: startWithPage,
  connectToServer,
  connect: connectToServer,
  loadConfig,
  killBrowserAndExit,
  ...client,
};
