#!/usr/bin/env node
'use strict';

// CLI client. Connects only to the local runtime on 127.0.0.1 using the
// per-run token from ~/h17-webpilot/token. No remote endpoints, no telemetry.

const WebSocket = require('ws');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { authedWsUrl } = require('../lib/auth');
const { parseCommandArgv, resolveLine: resolveCliLine } = require('../lib/cli-parser');
const {
  ok,
  fail,
  formatStatus,
  plainError,
  outcomeFromError,
  outcomeFromResult,
} = require('../lib/cli-output');
const { waitForReadyServer } = require('../lib/readiness');

function loadFirstRunUtils() {
  try {
    return require('../lib/first-run');
  } catch {
    const { execFileSync } = require('child_process');
    const HOME_CONFIG_DIR = path.join(os.homedir(), 'h17-webpilot');

    function configCandidates() {
      return [
        path.join(HOME_CONFIG_DIR, 'config.js'),
        path.join(HOME_CONFIG_DIR, 'config.json'),
      ];
    }

    function findExistingConfig() {
      return configCandidates().find((candidate) => fs.existsSync(candidate)) || null;
    }

    function commandPath(binary) {
      try {
        return execFileSync('which', [binary], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
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

    function detectBrowsers() {
      const results = [];
      const seen = new Set();
      if (process.platform === 'darwin') {
        const appRoots = ['/Applications', path.join(os.homedir(), 'Applications')];
        const apps = [
          ['Google Chrome', 'Google Chrome.app/Contents/MacOS/Google Chrome'],
          ['Chromium', 'Chromium.app/Contents/MacOS/Chromium'],
          ['Helium', 'Helium.app/Contents/MacOS/Helium'],
        ];
        for (const root of appRoots) {
          for (const [label, rel] of apps) {
            pushCandidate(results, seen, label, path.join(root, rel));
          }
        }
      } else if (process.platform === 'win32') {
        const roots = [
          process.env.PROGRAMFILES,
          process.env['PROGRAMFILES(X86)'],
          process.env.LOCALAPPDATA,
        ].filter(Boolean);
        const rels = [
          ['Google Chrome', 'Google/Chrome/Application/chrome.exe'],
          ['Chromium', 'Chromium/Application/chrome.exe'],
        ];
        for (const root of roots) {
          for (const [label, rel] of rels) {
            pushCandidate(results, seen, label, path.join(root, rel));
          }
        }
      } else {
        const binaries = [
          ['Google Chrome', 'google-chrome'],
          ['Google Chrome Stable', 'google-chrome-stable'],
          ['Chromium', 'chromium'],
          ['Chromium Browser', 'chromium-browser'],
        ];
        for (const [label, binary] of binaries) {
          const found = commandPath(binary);
          if (found) pushCandidate(results, seen, label, found);
        }
      }
      return results;
    }

    function writeDefaultConfig(browserPath, targetPath = path.join(HOME_CONFIG_DIR, 'config.js')) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const contents = `module.exports = {
  browser: ${JSON.stringify(browserPath || '')},
  profile: "~/h17-webpilot/profile",
  port: 7331,
  startUrl: "https://hugopalma.work",
  viewport: { width: 1920, height: 1080 },
  browserArgs: [],
  connectionTimeout: 120000,
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
      cursor: true,
    },
  },
  human: {
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
    avoid: { selectors: [], classes: [], ids: [], attributes: {} },
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

    return {
      HOME_CONFIG_DIR,
      findExistingConfig,
      detectBrowsers,
      writeDefaultConfig,
    };
  }
}

const {
  HOME_CONFIG_DIR,
  findExistingConfig,
  detectBrowsers,
  writeDefaultConfig,
} = loadFirstRunUtils();
const { loadConfig } = require('../index');
const {
  stopManagedBrowser,
  normalizeProfilePath,
  resolveBrowserDisplayEnv,
  formatWarn,
} = require('../lib/launcher');

// --- ANSI colors ---
const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

// Disable colors if not a TTY
if (!process.stdout.isTTY) {
  for (const k of Object.keys(C)) C[k] = '';
}

// --- State ---
let conn = null;
let currentAddr = 'ws://localhost:7331';
let activeTab = 0;
let activeAlias = -1;
let showEvents = true;
let showHttp = false;
let counter = 0;
let rl = null;
let oneshot = false;
let pipeMode = false;

const pending = new Map(); // id -> { resolve, reject, timer }
let tabMap = []; // index 0-9 -> { id, url, title, active }

// --- Protocol actions (for tab completion) ---
const protocolActions = [
  'tabs.list', 'tabs.getCurrent', 'tabs.navigate', 'tabs.create', 'tabs.close',
  'tabs.activate', 'tabs.reload', 'tabs.goBack', 'tabs.goForward', 'tabs.waitForNavigation',
  'tabs.setViewport', 'tabs.screenshot',
  'cookies.getAll', 'cookies.set',
  'dom.querySelector', 'dom.querySelectorAll',
  'dom.querySelectorWithin', 'dom.querySelectorAllWithin',
  'dom.waitForSelector', 'dom.boundingBox',
  'dom.click', 'dom.mouseMoveTo', 'dom.focus',
  'dom.type', 'dom.keyPress', 'dom.keyDown', 'dom.keyUp',
  'dom.scroll', 'dom.setValue', 'dom.getAttribute',
  'dom.getProperty', 'dom.evaluate', 'dom.elementEvaluate',
  'dom.evaluateHandle', 'dom.discoverElements', 'dom.setDebug',
  'dom.getHTML', 'dom.elementHTML', 'dom.queryAllInfo',
  'dom.batchQuery', 'dom.findScrollable', 'dom.uploadFile',
  'human.click', 'human.type', 'human.scroll', 'human.clearInput',
  'framework.setConfig', 'framework.getConfig', 'framework.reload', 'framework.shutdown',
  'frames.list',
];

const shorthands = [
  'go', 'click', 'type', 'sd', 'su', 'q', 'wait', 'eval', 'js',
  'title', 'url', 'html', 'ss', 'screenshot', 'reload', 'back',
  'forward', 'clear', 'key', 'discover', 'cookies', 'box',
  'frames', 'dump',
];

const dotCommands = ['.help', '.quit', '.exit', '.tab', '.tabs', '.events', '.http', '.status'];

const allCompletions = [...dotCommands, ...protocolActions, ...shorthands];

// --- Helpers ---

function nextID() {
  return `wp_${++counter}`;
}

function out(msg) {
  if (rl) {
    // Clear current line, print, then redisplay prompt
    process.stdout.write('\r\x1b[K');
    console.log(msg);
    rl.prompt(true);
  } else {
    console.log(msg);
  }
}

function statusLine(outcome) {
  const text = formatStatus(outcome);
  if (!C.reset) return text;
  const color = !outcome || !outcome.ok ? C.red : outcome.unconfirmed ? C.yellow : C.green;
  return text.replace(/^(OK \(unconfirmed\)|OK|ERROR)/, (label) => `${color}${label}${C.reset}`);
}

// Warning line (if any), then the single OK/ERROR status line.
function printOutcome(outcome) {
  if (outcome && outcome.warning) out(`${C.yellow}[WARN]${C.reset} ${outcome.warning}`);
  out(statusLine(outcome));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Tab alias helpers ---

function resolveTab(input) {
  const n = parseInt(input, 10);
  if (isNaN(n)) return null;
  // Check alias map first (0-9 range)
  if (n >= 0 && n < tabMap.length) return tabMap[n].id;
  // Otherwise treat as raw Chrome tab ID
  return n;
}

function updateTabMap(tabs) {
  tabMap = Array.isArray(tabs) ? tabs : [];
}

function setPrompt() {
  if (!rl) return;
  rl.setPrompt(activeAlias >= 0 ? `wp[${activeAlias}]> ` : 'wp> ');
}

// --- WebSocket send ---

function wsSend(obj) {
  if (!conn || conn.readyState !== WebSocket.OPEN) return false;
  conn.send(JSON.stringify(obj));
  return true;
}

// The server clamps params.timeout to 100..60000 ms and adds 2 s; wait a little longer
// so its own timeout message arrives first.
function commandTimeoutMs(params) {
  const raw = Number(params && params.timeout);
  const serverMs = Number.isFinite(raw) && raw > 0 ? Math.min(Math.max(raw, 100), 60000) : 30000;
  return serverMs + 5000;
}

// --- Send command and wait for response ---

function sendAndWait(action, params, tabId) {
  return new Promise((resolve, reject) => {
    const id = nextID();
    const msg = { id, action, params: params || {} };
    const target = tabId || activeTab;
    if (target) msg.tabId = target;

    const timeoutMs = commandTimeoutMs(params);
    const timer = setTimeout(() => {
      if (pending.delete(id)) {
        reject(new Error(`Command ${action} timed out (${timeoutMs / 1000}s)`));
      }
    }, timeoutMs);
    timer.unref();

    pending.set(id, { resolve, reject, timer });
    if (!wsSend(msg)) {
      clearTimeout(timer);
      pending.delete(id);
      reject(new Error('not connected'));
    }
  });
}

function rejectAllPending(message) {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error(message));
  }
  pending.clear();
}

// --- Response/event formatting ---

function onMessage(data) {
  let msg;
  try {
    msg = JSON.parse(data);
  } catch { return; }

  // Match response by ID
  if (msg.id && pending.has(msg.id)) {
    const req = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(req.timer);
    if (msg.error) req.reject(new Error(msg.error));
    else req.resolve(msg.result);
    return;
  }

  // Handle ping
  if (msg.type === 'ping') {
    wsSend({ type: 'pong' });
    return;
  }

  // Print event
  if (showEvents && msg.event) {
    printEvent(msg);
  }
}

function printEvent(msg) {
  if (!msg.event) return;
  // HTTP response events gated behind .http toggle — compact format
  if (msg.event === 'response') {
    if (!showHttp) return;
    const d = msg.data || {};
    const status = d.status || '?';
    const method = (d.method || 'GET').padEnd(4);
    const color = status >= 400 ? C.red : status >= 300 ? C.yellow : C.dim;
    out(`  ${color}${status}${C.reset} ${C.dim}${method}${C.reset} ${d.url || ''}`);
    return;
  }
  const pretty = JSON.stringify(msg.data, null, 2).replace(/\n/g, '\n  ');
  out(`${C.yellow}[${msg.event}]${C.reset} ${pretty}`);
}

const NULL_EXPLAINED = new Set(['dom.waitForSelector', 'dom.querySelector', 'dom.boundingBox']);

function printResult(result, action, params = {}) {
  // tabs.list: formatted table
  if (action === 'tabs.list' && Array.isArray(result) && result.length > 0) {
    updateTabMap(result);
    for (let i = 0; i < result.length; i++) {
      const t = result[i];
      let title = t.title || '';
      if (title.length > 50) title = title.slice(0, 47) + '...';
      const selected = t.id === activeTab ? `${C.green}>${C.reset}` : ' ';
      out(`${selected} ${C.bold}${i}${C.reset}  ${C.dim}${t.id}${C.reset}  ${t.url}  ${C.dim}${title}${C.reset}`);
    }
    out(`${C.dim}  .tab <0-${result.length - 1}> to switch tabs${C.reset}`);
    return;
  }

  if (action === 'tabs.getCurrent' && result && typeof result === 'object') {
    if (params && params.__printField) {
      out(String(result[params.__printField] ?? ''));
      return;
    }
  }

  // dom.discoverElements: formatted list
  if (action === 'dom.discoverElements' && result && result.elements) {
    const els = result.elements;
    let links = 0, buttons = 0, inputs = 0;
    for (const el of els) {
      if (el.type === 'link') links++;
      else if (el.type === 'button') buttons++;
      else if (el.type === 'input') inputs++;
    }
    out(`${C.bold}${els.length} elements${C.reset}  ${C.dim}(${links} links, ${buttons} buttons, ${inputs} inputs)${C.reset}`);
    out('');
    for (const el of els) {
      let label = el.text || '';
      if (label.length > 50) label = label.slice(0, 47) + '...';
      if (el.type === 'link') {
        let href = el.href || '';
        if (href.length > 60) href = href.slice(0, 57) + '...';
        out(`  ${C.green}${el.handleId}${C.reset}  ${C.yellow}[link]${C.reset}  ${C.dim}"${label}"${C.reset}  ${C.dim}-> ${href}${C.reset}`);
      } else if (el.type === 'button') {
        out(`  ${C.green}${el.handleId}${C.reset}  ${C.yellow}[btn]${C.reset}   ${C.dim}"${label}"${C.reset}  ${C.dim}${el.selector || ''}${C.reset}`);
      } else if (el.type === 'input') {
        let desc = el.inputType || '';
        if (el.name) desc += ` name=${el.name}`;
        if (el.placeholder) desc += ` "${el.placeholder}"`;
        out(`  ${C.green}${el.handleId}${C.reset}  ${C.yellow}[input]${C.reset} ${C.dim}${desc}${C.reset}  ${C.dim}${el.selector || ''}${C.reset}`);
      }
    }
    return;
  }

  // dom.queryAllInfo: formatted list
  if (action === 'dom.queryAllInfo' && Array.isArray(result)) {
    if (result.length === 0) {
      out(`${C.dim}(no matches)${C.reset}`);
      return;
    }
    out(`${C.bold}${result.length} match(es)${C.reset}`);
    for (const el of result) {
      out(`  ${C.green}${el.handleId}${C.reset}  ${formatEl(el)}`);
    }
    return;
  }

  // Default: pretty-print JSON. Skip "nothing" results the status line already explains.
  if (result === undefined) return;
  if (result === null && NULL_EXPLAINED.has(action)) return;
  out(JSON.stringify(result, null, 2));
}

function formatEl(el) {
  let desc = `<${el.tag || '?'}`;
  if (el.id) desc += `#${el.id}`;
  if (el.cls) desc += `.${el.cls.replace(/ /g, '.')}`;
  desc += '>';
  if (el.label) {
    let label = el.label;
    if (label.length > 50) label = label.slice(0, 47) + '...';
    desc += ` ${C.dim}"${label}"${C.reset}`;
  } else if (el.text) {
    let text = el.text;
    if (text.length > 50) text = text.slice(0, 47) + '...';
    desc += ` ${C.dim}"${text}"${C.reset}`;
  }
  return desc;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

// Returns the absolute path of the saved PNG; throws on bad data or write failure.
function saveScreenshot(dataUrl, filePath) {
  const idx = dataUrl.indexOf(',');
  if (idx < 0) throw new Error('the browser returned invalid image data');
  const data = Buffer.from(dataUrl.slice(idx + 1), 'base64');
  const target = path.resolve(filePath || `screenshot_${timestamp()}.png`);
  fs.writeFileSync(target, data);
  out(`${C.green}screenshot:${C.reset} ${target} (${data.length} bytes)`);
  return target;
}

// --- Cookie loader ---

async function loadCookies(rest) {
  const parts = rest.split(/\s+/);
  const file = parts[1]
    ? path.resolve(parts[1].replace(/^~(?=$|\/)/, os.homedir()))
    : path.join(os.homedir(), 'h17-webpilot', 'cookies.json');

  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fail(`Cookie file not found: ${file}`);
    if (e instanceof SyntaxError) return fail(`${file} is not valid JSON (${e.message}).`);
    return fail(`Could not read ${file}: ${e.message}`);
  }

  if (!Array.isArray(data)) return fail(`${file} must contain a JSON array of cookies.`);
  if (data.length === 0) return ok(`${file} contains no cookies; nothing was loaded`);

  out(`${C.dim}-> cookies.set x${data.length}${C.reset}`);
  const results = await Promise.allSettled(
    data.map((cookie) => sendAndWait('cookies.set', { cookie })),
  );
  const failed = results.filter((r) => r.status === 'rejected');
  const loaded = data.length - failed.length;
  out(`${C.green}${loaded} cookies loaded${C.reset}, ${failed.length} failed`);
  if (failed.length === 0) return ok(`loaded ${loaded} cookies from ${file}`);
  const firstError = plainError(failed[0].reason, { addr: currentAddr });
  if (loaded === 0) return fail(`None of the ${data.length} cookies in ${file} loaded. First error: ${firstError}`);
  return ok(`loaded ${loaded} of ${data.length} cookies from ${file}; ${failed.length} failed (first error: ${firstError})`);
}

// --- Dump helper ---

async function doDump() {
  const dir = path.resolve(`dump_${timestamp()}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return fail(`Could not create ${dir}: ${e.message}`);
  }
  out(`${C.dim}-> dump to ${dir}/${C.reset}`);

  const saved = [];
  const failed = [];
  const step = async (name, fn) => {
    try {
      const detail = await fn();
      out(`  ${C.green}${name}${C.reset} (${detail})`);
      saved.push(name);
    } catch (e) {
      const reason = plainError(e, { addr: currentAddr });
      out(`  ${C.red}${name} failed:${C.reset} ${reason}`);
      failed.push(`${name}: ${reason}`);
    }
  };

  await step('cookies.json', async () => {
    const cookies = await sendAndWait('cookies.getAll', {});
    fs.writeFileSync(path.join(dir, 'cookies.json'), JSON.stringify(cookies, null, 2));
    return `${Array.isArray(cookies) ? cookies.length : 0} cookies`;
  });

  await step('screenshot.png', async () => {
    const ss = await sendAndWait('tabs.screenshot', {});
    const idx = ss && ss.dataUrl ? ss.dataUrl.indexOf(',') : -1;
    if (idx < 0) throw new Error('the browser returned no image');
    const data = Buffer.from(ss.dataUrl.slice(idx + 1), 'base64');
    fs.writeFileSync(path.join(dir, 'screenshot.png'), data);
    return `${data.length} bytes`;
  });

  await step('page.html', async () => {
    const html = await sendAndWait('dom.getHTML', {});
    const content = html && html.html ? html.html : JSON.stringify(html, null, 2);
    fs.writeFileSync(path.join(dir, 'page.html'), content);
    return `${Buffer.byteLength(content)} bytes`;
  });

  out(`${C.bold}dump complete:${C.reset} ${saved.length} saved${failed.length ? `, ${C.red}${failed.length} failed${C.reset}` : ''} -> ${dir}/`);
  if (failed.length === 0) return ok(`saved ${saved.join(', ')} to ${dir}`);
  if (saved.length === 0) return fail(`Nothing was saved to ${dir}. ${failed.join(' ')}`);
  return ok(`saved ${saved.join(', ')} to ${dir}; could not save ${failed.join(' ')}`);
}

// --- Dot commands ---

function printHelp() {
  out('');
  out(`${C.bold}Flow${C.reset}`);
  out('  inspect -> act -> verify');
  out('  html / title / url / discover / q  inspect current page state first');
  out('  every command ends with one line: OK[: summary] or ERROR: <reason>');
  out('  exit code is 0 for OK, 1 for ERROR');
  out('');
  out(`${C.bold}Navigation${C.reset}`);
  out('  go <url>             navigate and wait for the page to load (aliases: nav, navigate, goto)');
  out('  reload               reload current tab');
  out('  back                 history back');
  out('  forward              history forward');
  out('  sd [px] [sel]        scroll down (optional amount + selector)');
  out('  su [px] [sel]        scroll up');
  out('');
  out(`${C.bold}Query${C.reset}`);
  out('  q <sel>              find all matches (alias: query)');
  out('  wait <sel> [ms]      wait for selector (default 5000 ms, max 60000)');
  out('  discover             list interactive elements with el_ handles');
  out('');
  out(`${C.bold}Interact${C.reset}`);
  out('  click <sel|handle>   human click');
  out('  type [sel|handle] <text> click the target, then type (appends; clear first)');
  out('  clear <sel|handle>   clear input');
  out('  key <name>           key press: Enter, Tab, Escape, ArrowDown... (alias: press)');
  out('  cookies load [file]  load cookies from a JSON array file');
  out('');
  out(`${C.bold}Inspect${C.reset}`);
  out('  eval <js>            evaluate JS expression (alias: js)');
  out('  title                current tab title');
  out('  url                  current tab URL');
  out('  html                 current page HTML');
  out('  ss                   screenshot (alias: screenshot)');
  out('  box <sel|handle>     bounding box');
  out('  cookies              get all cookies');
  out('  dump                 save cookies + screenshot + html');
  out('  frames               list all frames');
  out('');
  out(`${C.bold}Tabs and meta${C.reset}`);
  out('  .tabs                list tabs (0-9 aliases)');
  out('  .tab <n>             switch to a tab by alias or ID');
  out('  .events              toggle event display');
  out('  .http                toggle HTTP response events');
  out('  .status              connection info');
  out('  .quit                exit');
  out('');
  out(`${C.bold}Runtime${C.reset}`);
  out('  webpilot start       start browser + runtime (reuses one that is already running and ready)');
  out('  webpilot start -d    same, and append WS commands/events to a session log');
  out('  webpilot restart     stop and start again');
  out('  webpilot stop        stop browser + runtime');
  out('  session log path     framework.debug.sessionLogPath or ~/h17-webpilot/webpilot.log');
  out('');
  out(`${C.bold}Raw mode${C.reset}`);
  out('  action.name {json}   full protocol command');
  out('  {raw json}           raw WebSocket message');
  out('');
  out(`${C.dim}repo: https://github.com/hugopalma17/webpilot${C.reset}`);
  out(`${C.dim}Hugo Palma${C.reset}`);
  out('');
}

async function switchTab(arg) {
  let realID = resolveTab(arg);
  if (realID === null) return fail(`"${arg}" is not a tab number. Run .tabs to list the tabs, then .tab <n>.`);

  if (!tabMap.some((t) => t.id === realID)) {
    try {
      updateTabMap(await sendAndWait('tabs.list', {}));
    } catch (e) {
      return outcomeFromError(e, { action: 'tabs.list', addr: currentAddr });
    }
    realID = resolveTab(arg);
    if (!tabMap.some((t) => t.id === realID)) {
      return fail(`There is no tab ${arg}. Run .tabs to list the open tabs.`);
    }
  }

  activeTab = realID;
  const n = parseInt(arg, 10);
  activeAlias = n >= 0 && n < tabMap.length && tabMap[n].id === realID ? n : -1;
  setPrompt();

  const tab = tabMap.find((t) => t.id === realID);
  let label = (tab && tab.url) || '';
  if (label.length > 60) label = label.slice(0, 57) + '...';
  out(label ? `tab -> ${C.green}${realID}${C.reset}  ${label}` : `tab -> ${C.green}${realID}${C.reset}`);

  // One-shot processes forget activeTab on exit; activate the tab so later commands use it.
  if (oneshot && !pipeMode) {
    try {
      await sendAndWait('tabs.activate', {}, realID);
    } catch (e) {
      return outcomeFromError(e, { action: 'tabs.activate', addr: currentAddr });
    }
    return ok(`switched to tab ${realID}; the next commands act on it`);
  }
  return ok(`commands now target tab ${realID}`);
}

async function dotCommand(line) {
  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case '.help':
      printHelp();
      return ok();

    case '.quit': case '.exit':
      if (pipeMode) return ok('stopped here; the remaining lines were not run', { quit: true });
      out(`${C.dim}bye${C.reset}`);
      if (conn) conn.close();
      process.exit(0);
      return ok();

    case '.tab': {
      if (parts.length > 1) return switchTab(parts[1]);
      if (!activeTab) {
        out(`no active tab ${C.dim}(using the browser's active tab)${C.reset}`);
      } else {
        const i = tabMap.findIndex((t) => t.id === activeTab);
        out(`active tab: ${activeTab}${i >= 0 ? ` [${i}] ${tabMap[i].url}` : ''}`);
      }
      return ok();
    }

    case '.tabs': {
      out(`${C.dim}-> tabs.list${C.reset}`);
      try {
        const result = await sendAndWait('tabs.list', {});
        printResult(result, 'tabs.list', {});
        return Array.isArray(result) && result.length === 0 ? ok('no tabs are open') : ok();
      } catch (e) {
        return outcomeFromError(e, { action: 'tabs.list', addr: currentAddr });
      }
    }

    case '.events':
      showEvents = !showEvents;
      out(`events ${showEvents ? `${C.green}on${C.reset}` : `${C.dim}off${C.reset}`}`);
      return ok();

    case '.http':
      showHttp = !showHttp;
      out(`http ${showHttp ? `${C.green}on${C.reset}` : `${C.dim}off${C.reset}`}`);
      return ok();

    case '.status':
      out(`connected: ${C.green}yes${C.reset}`);
      out(activeTab ? `tab:       ${activeTab}` : `tab:       ${C.dim}(default)${C.reset}`);
      out(`events:    ${showEvents ? `${C.green}on${C.reset}` : `${C.dim}off${C.reset}`}`);
      out(`http:      ${showHttp ? `${C.green}on${C.reset}` : `${C.dim}off${C.reset}`}`);
      return ok();

    default:
      return fail(`Unknown command "${cmd}". Run webpilot .help to see the commands.`);
  }
}

// --- Command runner (shared by -c, pipe mode and the REPL) ---

async function runCommand(line) {
  line = String(line || '').trim();
  if (!line) return fail('No command given. Run webpilot .help to see the commands.');
  if (line.startsWith('.')) return dotCommand(line);

  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const rest = parts.slice(1).join(' ');
  if (cmd === 'dump') return doDump();
  if (cmd === 'cookies' && /^load\b/.test(rest)) return loadCookies(rest);

  let parseError = null;
  const resolved = resolveCliLine(line, {
    onError(label, message) {
      parseError = message;
    },
  });
  if (!resolved) {
    return fail(parseError || `Could not understand "${line}". Run webpilot .help to see the commands.`);
  }

  const { action, params } = resolved;
  out(`${C.dim}-> ${action}${C.reset}`);

  let result;
  try {
    result = await sendAndWait(action, params);
  } catch (e) {
    return outcomeFromError(e, { action, params, command: cmd, addr: currentAddr });
  }

  if (action === 'tabs.screenshot') {
    if (!result || !result.dataUrl) return fail('The browser returned no image.');
    try {
      return ok(`screenshot saved to ${saveScreenshot(result.dataUrl)}`);
    } catch (e) {
      return fail(`Could not save the screenshot: ${e.message}`);
    }
  }

  printResult(result, action, params);
  return outcomeFromResult(action, params, result, { command: cmd });
}

// Parse-only check: an outcome when the command is malformed, null when it can be sent.
function precheckCommand(line) {
  line = String(line || '').trim();
  if (!line) return fail('No command given. Run webpilot .help to see the commands.');
  if (line.startsWith('.')) {
    const dot = line.split(/\s+/)[0].toLowerCase();
    return dotCommands.includes(dot)
      ? null
      : fail(`Unknown command "${dot}". Run webpilot .help to see the commands.`);
  }
  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const rest = parts.slice(1).join(' ');
  if (cmd === 'dump' || (cmd === 'cookies' && /^load\b/.test(rest))) return null;
  let parseError = null;
  const resolved = resolveCliLine(line, { onError(label, message) { parseError = message; } });
  return resolved ? null : fail(parseError || `Could not understand "${line}". Run webpilot .help to see the commands.`);
}

function safeRun(line) {
  return runCommand(line).catch((e) => fail(plainError(e, { addr: currentAddr })));
}

// --- Start subcommand ---

const CONFIG_DIR = path.join(os.homedir(), 'h17-webpilot');
function portFromAddr(addr) {
  try {
    const parsed = new URL(addr);
    return parseInt(parsed.port || '7331', 10) || 7331;
  } catch {
    return 7331;
  }
}

function pidFileForPort(port) {
  return path.join(CONFIG_DIR, port === 7331 ? 'server.pid' : `server-${port}.pid`);
}

// Options a running daemon was started with, used to decide whether start can reuse it.
function stateFileForPort(port) {
  return path.join(CONFIG_DIR, port === 7331 ? 'server.json' : `server-${port}.json`);
}

function readServerState(addr) {
  try {
    return JSON.parse(fs.readFileSync(stateFileForPort(portFromAddr(addr)), 'utf8'));
  } catch {
    return null;
  }
}

function writeServerState(addr, state) {
  try {
    fs.writeFileSync(stateFileForPort(portFromAddr(addr)), JSON.stringify(state, null, 2));
  } catch {}
}

function removeServerState(addr) {
  try { fs.unlinkSync(stateFileForPort(portFromAddr(addr))); } catch {}
}

// Append the per-run auth token (written by index.js start() to
// ~/h17-webpilot/token) to a WS address. The server requires it; without the
// file the raw addr is returned so the auth failure surfaces clearly.
function authedAddr(addr) {
  return authedWsUrl(addr);
}

function getServerPid(addr = 'ws://localhost:7331') {
  const pidFile = pidFileForPort(portFromAddr(addr));
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    // Check if process is alive
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function waitForServer(addr, timeoutMs = 15000) {
  return waitForReadyServer(addr, timeoutMs);
}

function serverLogPath(addr) {
  const port = portFromAddr(addr);
  return path.join(CONFIG_DIR, port === 7331 ? 'server.log' : `server-${port}.log`);
}

// Readiness, except a daemon that dies during startup fails at once with its own reason.
function waitForDaemon(addr, child, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    child.once('exit', () => {
      let reason = '';
      try {
        const lines = fs.readFileSync(serverLogPath(addr), 'utf8').split('\n').reverse();
        const line = lines.find((l) => /failed to start:|uncaughtException:|failed to load framework:/.test(l));
        if (line) reason = line.replace(/^.*?(failed to start|uncaughtException|failed to load framework):\s*/, '');
      } catch {}
      const err = new Error(reason || 'the webpilot runtime exited during startup');
      err.daemonExited = true;
      settle(reject, err);
    });
    waitForServer(addr, timeoutMs).then(
      () => settle(resolve),
      (err) => settle(reject, err),
    );
  });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// Waits for the old daemon process to exit (its cleanup stops its browser), not
// just for its pid file, which stopServer removes up front.
function waitForServerStop(addr, pid, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function attempt() {
      if (!processAlive(pid)) {
        try { fs.unlinkSync(pidFileForPort(portFromAddr(addr))); } catch {}
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`the old webpilot runtime (pid ${pid}) did not stop within ${timeoutMs / 1000} seconds`));
        return;
      }
      setTimeout(attempt, 200);
    }
    attempt();
  });
}

function spawnDaemon(addr, startOptions = {}) {
  const { spawn } = require('child_process');
  const daemonPath = path.resolve(__dirname, 'server-daemon.js');
  const daemonArgs = [daemonPath, '--port', String(startOptions.port || portFromAddr(addr))];
  if (startOptions.browser) daemonArgs.push('--browser', startOptions.browser);
  if (startOptions.configPath) daemonArgs.push('--config', startOptions.configPath);
  if (startOptions.sessionLog) daemonArgs.push('-d');
  const child = spawn(process.execPath, daemonArgs, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...(startOptions.browserEnv || {}) },
    cwd: process.cwd(),
  });
  child.unref();
  return child;
}

function printBrowserCandidates(candidates) {
  for (let i = 0; i < candidates.length; i++) {
    console.log(`  ${i + 1}. ${candidates[i].label} — ${candidates[i].path}`);
  }
}

function prompt(question) {
  return new Promise((resolve) => {
    const ask = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    ask.question(question, (answer) => {
      ask.close();
      resolve(answer.trim());
    });
  });
}

function exitWith(outcome) {
  printOutcome(outcome);
  process.exit(outcome && outcome.ok ? 0 : 1);
}

function failCli(message) {
  exitWith(fail(message));
}

function expandHome(p) {
  return p ? p.replace(/^~(?=$|[\\/])/, os.homedir()) : p;
}

async function ensureFirstRunConfig(startOptions = {}) {
  const explicitConfig = startOptions.configPath
    ? path.resolve(expandHome(startOptions.configPath))
    : null;
  if (explicitConfig && fs.existsSync(explicitConfig)) return explicitConfig;

  const existing = explicitConfig ? null : findExistingConfig();
  if (existing) return existing;

  const targetPath = explicitConfig || path.join(HOME_CONFIG_DIR, 'config.js');
  const selectedBrowser = startOptions.browser || null;
  if (selectedBrowser) {
    const configPath = writeDefaultConfig(selectedBrowser, targetPath);
    console.log(`${C.green}created config${C.reset} ${configPath}`);
    console.log(`${C.dim}browser source: --browser${C.reset}`);
    return configPath;
  }

  const candidates = detectBrowsers();

  if (candidates.length === 0) {
    const configPath = writeDefaultConfig('', targetPath);
    exitWith(fail(
      `No Chromium-based browser was found. A template config was written to ${configPath}: ` +
      'set browser: "/path/to/browser" in it, or pass --browser <path>, then run webpilot start again.',
    ));
  }

  if (candidates.length === 1) {
    const configPath = writeDefaultConfig(candidates[0].path, targetPath);
    console.log(`${C.green}created config${C.reset} ${configPath}`);
    console.log(`${C.dim}browser detected: ${candidates[0].label}${C.reset}`);
    return configPath;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(`${C.yellow}multiple Chromium-based browsers found${C.reset}`);
    printBrowserCandidates(candidates);
    exitWith(fail(
      'Several browsers are installed and webpilot cannot ask which one to use from a non-interactive shell. ' +
      'Run webpilot start once in a normal terminal to choose, or pass --browser <path> from the list above.',
    ));
  }

  console.log(`${C.yellow}no config found${C.reset}`);
  console.log('Choose a browser for the generated default config:');
  printBrowserCandidates(candidates);

  while (true) {
    const answer = await prompt(`Select browser [1-${candidates.length}] or q to abort: `);
    if (!answer) continue;
    if (answer.toLowerCase() === 'q') exitWith(fail('Setup cancelled; no config was written.'));
    const idx = parseInt(answer, 10);
    if (Number.isInteger(idx) && idx >= 1 && idx <= candidates.length) {
      const selected = candidates[idx - 1];
      const configPath = writeDefaultConfig(selected.path, targetPath);
      console.log(`${C.green}created config${C.reset} ${configPath}`);
      console.log(`${C.dim}browser selected: ${selected.label}${C.reset}`);
      return configPath;
    }
  }
}

function fileHash(filePath) {
  try {
    return require('crypto').createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function requestedStartState(startOptions = {}) {
  const configPath = startOptions.configPath
    ? path.resolve(expandHome(startOptions.configPath))
    : findExistingConfig();
  return {
    configPath: configPath || null,
    configHash: configPath ? fileHash(configPath) : null,
    browser: startOptions.browser || null,
  };
}

// null when the running runtime can be reused as-is, otherwise why it must restart.
async function restartReason(addr, startOptions) {
  const state = readServerState(addr);
  if (!state) return 'it was started by an older webpilot or by hand, so its settings are unknown';
  const wanted = requestedStartState(startOptions);
  if ((state.configPath || null) !== wanted.configPath) {
    return `a different config was requested (running: ${state.configPath || 'none'}, requested: ${wanted.configPath || 'none'})`;
  }
  if ((state.configHash || null) !== wanted.configHash) return `${wanted.configPath} changed since it started`;
  if ((state.browser || null) !== wanted.browser) return 'a different --browser was requested';
  if (startOptions.sessionLog && !state.sessionLog) return 'the session log (-d) was requested';
  try {
    await waitForReadyServer(addr, 3000);
  } catch {
    return 'it is not answering (the browser may have been closed)';
  }
  return null;
}

async function startServer(addr, startOptions = {}, { force = false } = {}) {
  const existing = getServerPid(addr);
  if (existing) {
    const reason = force ? 'restart was requested' : await restartReason(addr, startOptions);
    if (!reason) {
      console.log(`server already running on ${addr} (pid ${existing}); nothing was restarted`);
      return { pid: existing, reused: true };
    }
    console.log(`${C.yellow}restarting server${C.reset} (pid ${existing}): ${reason}`);
    stopServer(addr);
    try {
      await waitForServerStop(addr, existing);
    } catch (e) {
      exitWith(fail(`${sentenceCase(e.message)}. Stop it with webpilot stop, then run webpilot start again.`));
    }
  }

  const configPath = await ensureFirstRunConfig(startOptions);

  const displayEnv = resolveBrowserDisplayEnv({ env: process.env });
  if (displayEnv.warning) console.log(formatWarn(displayEnv.warning));
  if (displayEnv.warning || displayEnv.inferred) startOptions.browserEnv = displayEnv.env;

  console.log(`${C.dim}starting human-browser server...${C.reset}`);
  const daemon = spawnDaemon(addr, startOptions);
  const pid = daemon.pid;
  // Recorded at spawn: a runtime that becomes ready after the CLI gave up is still reusable.
  writeServerState(addr, {
    pid,
    ...requestedStartState(startOptions),
    sessionLog: !!startOptions.sessionLog,
    startedAt: new Date().toISOString(),
  });
  try {
    await waitForDaemon(addr, daemon);
  } catch (e) {
    const logPath = serverLogPath(addr);
    if (e.daemonExited) {
      removeServerState(addr);
      exitWith(fail(`Webpilot could not start. ${sentenceCase(e.message)}${/[.!?]$/.test(e.message) ? '' : '.'} Details are in ${logPath}.`));
    }
    exitWith(fail(
      `The browser did not connect back to webpilot within 15 seconds (${e.message}). ` +
      `It may still be starting: run webpilot start again in a moment, and it will reuse the runtime once it is ready. ` +
      `If it never becomes ready, check that the browser path in ${configPath || 'the config'} still exists. ` +
      `Details are in ${logPath}.`,
    ));
  }

  console.log(`${C.green}server ready${C.reset} on ${addr} (pid ${pid})`);
  if (startOptions.sessionLog) {
    let sessionLogPath = path.join(os.homedir(), 'h17-webpilot', 'webpilot.log');
    try {
      const config = loadConfig({
        ...(startOptions.browser ? { browser: startOptions.browser } : {}),
        ...(startOptions.port ? { port: startOptions.port } : {}),
        ...(startOptions.configPath ? { __configPath: startOptions.configPath } : {}),
        __sessionLog: true,
      });
      const configuredPath = config.framework?.debug?.sessionLogPath;
      if (configuredPath) {
        const baseDir = config.__sourcePath
          ? path.dirname(config.__sourcePath)
          : process.cwd();
        sessionLogPath = path.isAbsolute(configuredPath)
          ? configuredPath
          : path.resolve(baseDir, configuredPath);
      }
    } catch {}
    console.log(`${C.dim}session log: ${sessionLogPath}${C.reset}`);
  }
  return { pid, reused: false };
}

function sentenceCase(text) {
  const t = String(text || '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Uses the running instance's recorded config (or an explicit --config), so the
// profile fallback never targets another instance's browser.
function stopServer(addr = 'ws://localhost:7331', configPath = null) {
  const pid = getServerPid(addr);
  const state = readServerState(addr);
  const instanceConfig = configPath
    ? path.resolve(expandHome(configPath))
    : (state && state.configPath) || null;
  let config = null;
  try {
    config = loadConfig(instanceConfig ? { __configPath: instanceConfig } : {});
  } catch {}
  removeServerState(addr);
  if (!pid) {
    if (config?.profile) {
      stopManagedBrowser(normalizeProfilePath(config.profile), { fallbackToProfileMatch: true });
    }
    console.log(`${C.dim}no server running${C.reset}`);
    return null;
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`${C.green}server stopped${C.reset} (pid ${pid})`);
  } catch {
    console.log(`${C.dim}server already stopped${C.reset}`);
  }
  if (config?.profile) {
    stopManagedBrowser(normalizeProfilePath(config.profile), { fallbackToProfileMatch: true });
  }
  try { fs.unlinkSync(pidFileForPort(portFromAddr(addr))); } catch {}
  return pid;
}

// --- Main ---

// Exit once stdout has drained; the timer only fires if something else holds the loop open.
function finish(code) {
  process.exitCode = code;
  if (conn) {
    const c = conn;
    conn = null;
    try { c.close(); } catch {}
  }
  setTimeout(() => process.exit(code), 3000).unref();
}

function connectAndRun(addr, cmd) {
  currentAddr = addr;
  let opened = false;
  try {
    conn = new WebSocket(authedAddr(addr));
  } catch (e) {
    exitWith(fail(plainError(e, { addr })));
  }

  conn.on('error', (err) => {
    if (!opened) exitWith(fail(plainError(err, { addr })));
  });

  conn.on('close', () => {
    rejectAllPending('connection to the runtime closed');
    if (!oneshot) {
      out(`\n${C.red}[disconnected]${C.reset}`);
      process.exit(0);
    }
  });

  conn.on('message', (data) => onMessage(data.toString()));

  conn.on('open', async () => {
    opened = true;

    // Single command: -c <command> or bare positional words
    if (cmd) {
      oneshot = true;
      const outcome = await safeRun(cmd);
      // --http: keep collecting response events for a moment, then report.
      if (showHttp) await sleep(parseInt(process.env.WEBPILOT_HTTP_DRAIN_MS, 10) || 5000);
      printOutcome(outcome);
      finish(outcome.ok ? 0 : 1);
      return;
    }

    // Pipe mode: stdin is not a TTY (e.g. echo 'go x.com\ndiscover' | webpilot)
    if (!process.stdin.isTTY) {
      oneshot = true;
      pipeMode = true;
      const pipeRL = readline.createInterface({ input: process.stdin });
      const lines = [];
      const idleHint = setTimeout(() => {
        if (!lines.length) {
          process.stderr.write('webpilot: waiting for commands on stdin. To run one command: webpilot -c "<command>"\n');
        }
      }, 3000);
      idleHint.unref();
      pipeRL.on('line', (l) => { const t = l.trim(); if (t) lines.push(t); });
      pipeRL.on('close', async () => {
        clearTimeout(idleHint);
        if (!lines.length) {
          printOutcome(fail('No command given. Run one with webpilot -c "<command>" (for example webpilot -c "go example.com"), or pipe commands in, one per line.'));
          finish(1);
          return;
        }
        let failures = 0;
        for (const line of lines) {
          const outcome = await safeRun(line);
          printOutcome(outcome);
          if (!outcome.ok) failures++;
          if (outcome.quit) break;
        }
        pipeMode = false;
        finish(failures ? 1 : 0);
      });
      return;
    }

    // Interactive REPL
    const histFile = path.join(os.homedir(), '.wp_history');

    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'wp> ',
      historySize: 1000,
      completer: (line) => {
        const hits = allCompletions.filter(c => c.startsWith(line));
        return [hits.length ? hits : allCompletions, line];
      },
    });

    // Load history
    try {
      const hist = fs.readFileSync(histFile, 'utf8').split('\n').filter(Boolean);
      for (const h of hist) rl.history.push(h);
    } catch {}

    // Signal handler
    process.on('SIGINT', () => {
      console.log();
      if (conn) conn.close();
      // Save history
      try {
        fs.writeFileSync(histFile, rl.history.slice().reverse().join('\n') + '\n');
      } catch {}
      process.exit(0);
    });

    out(`${C.green}connected${C.reset} to ${addr}`);

    // Auto-fetch tabs on connect
    dotCommand('.tabs');

    rl.prompt();

    rl.on('line', (line) => {
      line = line.trim();
      if (!line) { rl.prompt(); return; }

      // Save to history file (append)
      try {
        fs.appendFileSync(histFile, line + '\n');
      } catch {}

      safeRun(line).then(printOutcome);
      rl.prompt();
    });

    rl.on('close', () => {
      if (conn) conn.close();
      process.exit(0);
    });
  });
}

const TRAILING_OPTIONS = new Set(['--addr', '--port', '--browser', '--config', '--http', '--help']);

function printUsage() {
  console.log('Usage: webpilot [options] [command]');
  console.log('       webpilot [options] -c "<command>"');
  console.log('');
  console.log('Flow: inspect -> act -> verify');
  console.log('      use html/discover/q before interaction when state is uncertain');
  console.log('');
  console.log('Every command prints its output, then one final line:');
  console.log('  OK[: summary]        it worked (exit code 0)');
  console.log('  ERROR: <reason>      it did not, in plain English (exit code 1)');
  console.log('No need to wrap commands in timeout or sleep: the final line is the confirmation.');
  console.log('');
  console.log('Commands:');
  console.log('  start [-d]         Launch browser + runtime; reuses one that is already running and ready');
  console.log('  restart [-d]       Stop, then start again');
  console.log('  stop               Stop browser + runtime');
  console.log('  <command>          Run one browser command, e.g. webpilot go example.com');
  console.log('  (none)             Interactive REPL, or one command per line from a pipe');
  console.log('');
  console.log('Options:');
  console.log('  -d                 Append WS commands/events to ~/h17-webpilot/webpilot.log on start');
  console.log('                     (or framework.debug.sessionLogPath from config)');
  console.log('  --addr <url>       WebSocket address (default: ws://localhost:7331)');
  console.log('  --port <n>         Override WS port for start/stop/connect');
  console.log('  --browser <path>   Override browser binary for start');
  console.log('  --config <path>    Use a specific config file for start/stop');
  console.log('  -c <command>       Run one browser command and exit (same as the bare form)');
  console.log('  --http             Show HTTP responses (single-command & REPL)');
  console.log('  -h, --help         Show this help');
  console.log('');
  console.log('Quote the command when it has #, [ ], >, *, or quotes in it:');
  console.log('  webpilot -c "click #submit"      (unquoted, the shell drops #submit as a comment)');
  console.log('');
  console.log('Browser commands: webpilot .help');
  console.log('');
  console.log('Pipe mode:');
  console.log('  printf "go example.com\\ndiscover\\n" | webpilot');
}

async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  let addr = 'ws://localhost:7331';
  let cmd = null;
  let subcommand = null;
  let startOptions = {
    browser: null,
    configPath: null,
    port: null,
    sessionLog: false,
  };
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    if (arg === '--addr' && args[i + 1]) {
      addr = args[i + 1];
      i += 2;
    } else if (arg === '--addr') {
      failCli('--addr requires a value');
    } else if (arg === '-d') {
      startOptions.sessionLog = true;
      i += 1;
    } else if (arg === '--port' && args[i + 1]) {
      const port = parseInt(args[i + 1], 10);
      if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        failCli(`invalid port: ${args[i + 1]}`);
      }
      startOptions.port = port;
      addr = `ws://localhost:${port}`;
      i += 2;
    } else if (arg === '--port') {
      failCli('--port requires a value');
    } else if (arg === '--browser' && args[i + 1]) {
      startOptions.browser = args[i + 1];
      i += 2;
    } else if (arg === '--browser') {
      failCli('--browser requires a value');
    } else if (arg === '--config' && args[i + 1]) {
      startOptions.configPath = args[i + 1];
      i += 2;
    } else if (arg === '--config') {
      failCli('--config requires a value');
    } else if (arg === '--http') {
      showHttp = true;
      i++;
    } else if (arg === '-c') {
      const parsed = parseCommandArgv(args.slice(i + 1));
      if (!parsed || !parsed.command) failCli('-c needs a command, for example: webpilot -c "go example.com"');
      cmd = parsed.command;
      if (parsed.showHttp) showHttp = true;
      i = args.length;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith('-')) {
      failCli(`unknown option: ${arg}. Run webpilot --help to see the options.`);
    } else if (!subcommand && (arg === 'start' || arg === 'stop' || arg === 'restart')) {
      subcommand = arg;
      i += 1;
    } else if (subcommand) {
      failCli(`${subcommand} does not take "${arg}". Run browser commands separately, e.g. webpilot -c "go example.com".`);
    } else {
      // Bare words are the command: webpilot go example.com == webpilot -c go example.com
      const parsed = parseCommandArgv(args.slice(i));
      cmd = parsed.command;
      if (parsed.showHttp) showHttp = true;
      i = args.length;
    }
  }

  if (startOptions.sessionLog && subcommand !== 'start' && subcommand !== 'restart') {
    failCli('-d only works with start or restart');
  }

  if (subcommand === 'start' || subcommand === 'restart') {
    const started = await startServer(addr, startOptions, { force: subcommand === 'restart' });
    exitWith(ok(started.reused
      ? `webpilot is already running and ready on ${addr} (pid ${started.pid})`
      : `webpilot is running and ready on ${addr} (pid ${started.pid})`));
  }

  if (subcommand === 'stop') {
    const pid = stopServer(addr, startOptions.configPath);
    exitWith(ok(pid ? `webpilot stopped (pid ${pid})` : 'webpilot was not running'));
  }

  // Help needs no browser; never auto-start one just to print it.
  if (cmd && cmd.trim().toLowerCase() === '.help') {
    printHelp();
    exitWith(ok());
  }
  if (cmd && /^\.(quit|exit)$/i.test(cmd.trim())) {
    exitWith(ok('nothing to quit: a single command exits on its own'));
  }

  // Everything after the command word is the command, so options there would be
  // typed or navigated to instead of applied.
  if (cmd) {
    const misplaced = cmd.split(/\s+/).find((token) => TRAILING_OPTIONS.has(token));
    if (misplaced) {
      failCli(`Put options before the command, e.g. webpilot ${misplaced} <value> -c "<command>". "${misplaced}" was found inside the command.`);
    }
  }

  // A command that cannot run fails before any browser is started.
  if (cmd) {
    const problem = precheckCommand(cmd);
    if (problem) exitWith(problem);
  }

  // Auto-start: if server isn't running, start it
  if (!getServerPid(addr)) {
    await startServer(addr, startOptions);
  }

  connectAndRun(addr, cmd);
}

main().catch((err) => {
  failCli(plainError(err));
});
