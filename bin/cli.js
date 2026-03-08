#!/usr/bin/env node
'use strict';

const WebSocket = require('ws');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');

function loadFirstRunUtils() {
  try {
    return require('../lib/first-run');
  } catch {
    const { execFileSync } = require('child_process');
    const HOME_CONFIG_DIR = path.join(os.homedir(), 'h17-webpilot');

    function configCandidates(cwd = process.cwd()) {
      return [
        path.join(cwd, 'human-browser.config.js'),
        path.join(cwd, 'human-browser.config.json'),
        path.join(HOME_CONFIG_DIR, 'config.js'),
        path.join(HOME_CONFIG_DIR, 'config.json'),
      ];
    }

    function findExistingConfig(cwd = process.cwd()) {
      return configCandidates(cwd).find((candidate) => fs.existsSync(candidate)) || null;
    }

    function commandPath(binary) {
      try {
        return execFileSync('which', [binary], { encoding: 'utf8' }).trim() || null;
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
      developerMode: true,
      pinExtension: true,
      restoreOnStartup: 0,
      startupUrls: [],
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
const { stopManagedBrowser, normalizeProfilePath } = require('../lib/launcher');

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
let activeTab = 0;
let activeAlias = -1;
let showEvents = true;
let showHttp = false;
let counter = 0;
let rl = null;
let oneshot = false;
let pipeMode = false;

const pending = new Map(); // id -> { action, resolve }
let tabMap = []; // index 0-9 -> { id, url, title, active }

// --- Protocol actions (for tab completion) ---
const protocolActions = [
  'tabs.list', 'tabs.getCurrent', 'tabs.navigate', 'tabs.create', 'tabs.close',
  'tabs.activate', 'tabs.reload', 'tabs.waitForNavigation',
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
  'dom.batchQuery', 'dom.findScrollable',
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

let oneshotFired = false;
function oneshotDone() {
  if (!oneshot || oneshotFired || pipeMode) return;
  oneshotFired = true;
  // Close connection — Node exits naturally once event loop drains (stdout flushes)
  // Keep oneshot=true so conn.on('close') doesn't print [disconnected]
  if (conn) { conn.close(); conn = null; }
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
  tabMap = tabs;
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

// --- Send command and wait for response ---

function sendAndWait(action, params) {
  return new Promise((resolve, reject) => {
    const id = nextID();
    const msg = { id, action, params: params || {} };
    if (activeTab) msg.tabId = activeTab;

    pending.set(id, { action, params, resolve, reject });
    if (!wsSend(msg)) {
      pending.delete(id);
      reject(new Error('not connected'));
      return;
    }

    // Timeout after 35s
    const t = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('timeout'));
      }
    }, 35000);
    t.unref();
  });
}

// --- High-level send + print ---

function sendCommand(action, params) {
  const id = nextID();
  const msg = { id, action, params: params || {} };
  if (activeTab) msg.tabId = activeTab;

  pending.set(id, { action, params, resolve: null });
  if (!wsSend(msg)) {
    pending.delete(id);
    out(`${C.red}send failed:${C.reset} not connected`);
    return;
  }

  out(`${C.dim}-> ${action}${C.reset}`);

  // Timeout
  const t = setTimeout(() => {
    if (pending.has(id)) {
      pending.delete(id);
      out(`${C.red}timeout${C.reset} (35s)`);
    }
  }, 35000);
  t.unref();
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
    if (req.resolve) {
      // Promise-based (sendAndWait)
      if (msg.error) req.reject(new Error(msg.error));
      else req.resolve(msg.result);
    } else {
      // Fire-and-forget (sendCommand)
      printResponse(msg, req.action, req.params);
      oneshotDone();
    }
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

function printResponse(msg, action, params = {}) {
  if (msg.error) {
    out(`${C.red}error:${C.reset} ${msg.error}`);
    return;
  }

  const result = msg.result;

  // Screenshot: save to file
  if (action === 'tabs.screenshot' && result && result.dataUrl) {
    saveScreenshot(result.dataUrl);
    return;
  }

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
    out(`${C.dim}  .tab <0-${result.length - 1}> to target a tab${C.reset}`);
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

  // Default: pretty-print JSON
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

function saveScreenshot(dataUrl) {
  const idx = dataUrl.indexOf(',');
  if (idx < 0) {
    out(`${C.red}error:${C.reset} invalid screenshot data`);
    return;
  }
  const data = Buffer.from(dataUrl.slice(idx + 1), 'base64');
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const name = `screenshot_${ts}.png`;
  fs.writeFileSync(name, data);
  out(`${C.green}screenshot:${C.reset} ${name} (${data.length} bytes)`);
}

// --- Cookie loader ---

function loadCookies(rest) {
  const parts = rest.split(/\s+/);
  const file = parts[1] || 'cookies.json';

  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    out(`${C.red}error:${C.reset} ${e.message}`);
    return;
  }

  if (!Array.isArray(data)) {
    out(`${C.red}error:${C.reset} expected JSON array`);
    return;
  }

  let ok = 0, fail = 0;
  let done = 0;
  for (const cookie of data) {
    sendAndWait('cookies.set', { cookie })
      .then(() => { ok++; })
      .catch(() => { fail++; })
      .finally(() => {
        done++;
        if (done === data.length) {
          out(`${C.green}${ok} cookies loaded${C.reset}, ${fail} failed`);
        }
      });
  }
}

// --- Dump helper ---

async function doDump() {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const dir = `dump_${ts}`;
  fs.mkdirSync(dir, { recursive: true });
  out(`${C.dim}-> dump to ${dir}/${C.reset}`);

  let ok = 0, fail = 0;

  // Cookies
  try {
    const cookies = await sendAndWait('cookies.getAll', {});
    fs.writeFileSync(path.join(dir, 'cookies.json'), JSON.stringify(cookies, null, 2));
    out(`  ${C.green}cookies.json${C.reset} (${Array.isArray(cookies) ? cookies.length : 0} cookies)`);
    ok++;
  } catch (e) {
    out(`  ${C.red}cookies failed:${C.reset} ${e.message}`);
    fail++;
  }

  // Screenshot
  try {
    const ss = await sendAndWait('tabs.screenshot', {});
    if (ss && ss.dataUrl) {
      const idx = ss.dataUrl.indexOf(',');
      if (idx >= 0) {
        const data = Buffer.from(ss.dataUrl.slice(idx + 1), 'base64');
        fs.writeFileSync(path.join(dir, 'screenshot.png'), data);
        out(`  ${C.green}screenshot.png${C.reset} (${data.length} bytes)`);
        ok++;
      }
    }
  } catch (e) {
    out(`  ${C.red}screenshot failed:${C.reset} ${e.message}`);
    fail++;
  }

  // HTML
  try {
    const html = await sendAndWait('dom.getHTML', {});
    const content = html && html.html ? html.html : JSON.stringify(html, null, 2);
    fs.writeFileSync(path.join(dir, 'page.html'), content);
    out(`  ${C.green}page.html${C.reset} (${Buffer.byteLength(content)} bytes)`);
    ok++;
  } catch (e) {
    out(`  ${C.red}html failed:${C.reset} ${e.message}`);
    fail++;
  }

  out(`${C.bold}dump complete:${C.reset} ${ok} saved${fail ? `, ${C.red}${fail} failed${C.reset}` : ''} -> ${dir}/`);
  oneshotDone();
}

// --- Dot commands ---

function dotCommand(line) {
  const parts = line.split(/\s+/);
  const cmd = parts[0];

  switch (cmd) {
    case '.help':
      out('');
      out(`${C.bold}Flow${C.reset}`);
      out('  inspect -> act -> verify');
      out('  html / title / url / discover / q  inspect current page state first');
      out('');
      out(`${C.bold}Navigation${C.reset}`);
      out('  go <url>             navigate (aliases: nav, navigate, goto)');
      out('  reload               reload current tab');
      out('  back                 history back');
      out('  forward              history forward');
      out('  sd [px] [sel]        scroll down (optional amount + selector)');
      out('  su [px] [sel]        scroll up');
      out('');
      out(`${C.bold}Query${C.reset}`);
      out('  q <sel>              find all matches (alias: query)');
      out('  wait <sel>           wait for selector');
      out('  discover             list interactive elements');
      out('');
      out(`${C.bold}Interact${C.reset}`);
      out('  click <sel|handle>   human click');
      out('  type [sel] <text>    human type (sel: # . [ auto-detected)');
      out('  clear <sel>          clear input');
      out('  key <name>           keyPress (alias: press)');
      out('  cookies load <file>  load cookies from a JSON array file');
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
      out(`${C.bold}Meta${C.reset}`);
      out('  .tabs                list tabs (0-9 aliases)');
      out('  .tab <n>             set active tab by alias or ID');
      out('  .events              toggle event display');
      out('  .http                toggle HTTP response events');
      out('  .status              connection info');
      out('  .quit                exit');
      out('');
      out(`${C.bold}Runtime${C.reset}`);
      out('  webpilot start       start managed browser + daemon');
      out('  webpilot start -d    start and append WS commands/events to a session log');
      out('  webpilot stop        stop managed browser + daemon');
      out('  session log path     framework.debug.sessionLogPath or ~/h17-webpilot/webpilot.log');
      out('');
      out(`${C.bold}Raw mode${C.reset}`);
      out('  action.name {json}   full protocol command');
      out('  {raw json}           raw WebSocket message');
      out('');
      out(`${C.dim}repo: https://github.com/hugopalma17/webpilot${C.reset}`);
      out(`${C.dim}Hugo Palma${C.reset}`);
      out('');
      oneshotDone();
      break;

    case '.quit': case '.exit':
      out(`${C.dim}bye${C.reset}`);
      if (conn) conn.close();
      process.exit(0);
      break;

    case '.tab': {
      if (parts.length > 1) {
        const realID = resolveTab(parts[1]);
        if (realID === null) {
          out(`${C.red}invalid tab: ${parts[1]}${C.reset}`);
          break;
        }
        activeTab = realID;

        // Track alias for prompt
        const n = parseInt(parts[1], 10);
        if (n >= 0 && n < tabMap.length && tabMap[n].id === realID) {
          activeAlias = n;
        } else {
          activeAlias = -1;
        }

        // Show what was selected
        let label = '';
        for (const t of tabMap) {
          if (t.id === realID) {
            label = t.url || '';
            if (label.length > 60) label = label.slice(0, 57) + '...';
            break;
          }
        }
        out(label
          ? `tab -> ${C.green}${realID}${C.reset}  ${label}`
          : `tab -> ${C.green}${realID}${C.reset}`);
        setPrompt();
      } else {
        if (!activeTab) {
          out(`no active tab ${C.dim}(using server default)${C.reset}`);
        } else {
          let label = '';
          for (let i = 0; i < tabMap.length; i++) {
            if (tabMap[i].id === activeTab) {
              label = ` [${i}] ${tabMap[i].url}`;
              break;
            }
          }
          out(`active tab: ${activeTab}${label}`);
        }
      }
      break;
    }

    case '.tabs':
      sendCommand('tabs.list', {});
      break;

    case '.events':
      showEvents = !showEvents;
      out(`events ${showEvents ? `${C.green}on${C.reset}` : `${C.dim}off${C.reset}`}`);
      oneshotDone();
      break;

    case '.http':
      showHttp = !showHttp;
      out(`http ${showHttp ? `${C.green}on${C.reset}` : `${C.dim}off${C.reset}`}`);
      oneshotDone();
      break;

    case '.status':
      out(`connected: ${C.green}yes${C.reset}`);
      out(activeTab ? `tab:       ${activeTab}` : `tab:       ${C.dim}(default)${C.reset}`);
      out(`events:    ${showEvents ? `${C.green}on${C.reset}` : `${C.dim}off${C.reset}`}`);
      out(`http:      ${showHttp ? `${C.green}on${C.reset}` : `${C.dim}off${C.reset}`}`);
      oneshotDone();
      break;

    default:
      out(`${C.red}unknown: ${cmd}${C.reset} ${C.dim}(try .help)${C.reset}`);
      oneshotDone();
  }
}

// --- Awaitable dispatch (for pipe mode) ---

async function dispatchWait(line) {
  if (line.startsWith('.')) {
    dotCommand(line);
    return;
  }

  // Resolve action + params from line (shorthand or raw)
  const resolved = resolveLine(line);
  if (!resolved) return; // dotCommand or invalid

  const { action, params } = resolved;
  out(`${C.dim}-> ${action}${C.reset}`);
  try {
    const result = await sendAndWait(action, params);
    printResponse({ result }, action, params);
  } catch (e) {
    out(`${C.red}error:${C.reset} ${e.message}`);
  }
}

// Parses a line into { action, params } without sending. Returns null if handled inline.
function resolveLine(line) {
  if (line.startsWith('{')) {
    let msg;
    try { msg = JSON.parse(line); } catch (e) {
      out(`${C.red}invalid JSON:${C.reset} ${e.message}`);
      return null;
    }
    return { action: msg.action || '', params: msg.params || {} };
  }

  // Try shorthands
  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const rest = parts.slice(1).join(' ');

  switch (cmd) {
    case 'go': case 'nav': case 'navigate': case 'goto': {
      if (!rest) return null;
      let url = rest;
      if (!url.includes('://')) {
        url = (url.startsWith('localhost') || url.startsWith('127.0.0.1'))
          ? 'http://' + url : 'https://' + url;
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
      if (parts.length > 2 && (first.startsWith('#') || first.startsWith('.') ||
          first.startsWith('[') || first.includes('='))) {
        return { action: 'human.type', params: { selector: first, text: parts.slice(2).join(' ') } };
      }
      return { action: 'human.type', params: { text: rest } };
    }
    case 'sd': {
      const p = { direction: 'down' };
      for (const a of parts.slice(1)) {
        if (/^\d+$/.test(a)) p.amount = parseInt(a, 10);
        else p.selector = a;
      }
      return { action: 'human.scroll', params: p };
    }
    case 'su': {
      const p = { direction: 'up' };
      for (const a of parts.slice(1)) {
        if (/^\d+$/.test(a)) p.amount = parseInt(a, 10);
        else p.selector = a;
      }
      return { action: 'human.scroll', params: p };
    }
    case 'q': case 'query':
      if (!rest) return null;
      return { action: 'dom.queryAllInfo', params: { selector: rest } };
    case 'wait':
      if (!rest) return null;
      return { action: 'dom.waitForSelector', params: { selector: rest } };
    case 'eval': case 'js': {
      if (!rest) return null;
      let fn = rest;
      if (!fn.startsWith('()') && !fn.startsWith('function')) fn = '() => ' + fn;
      return { action: 'dom.evaluate', params: { fn } };
    }
    case 'title':
      return { action: 'tabs.getCurrent', params: { __printField: 'title' } };
    case 'url':
      return { action: 'tabs.getCurrent', params: { __printField: 'url' } };
    case 'html':
      return { action: 'dom.getHTML', params: {} };
    case 'screenshot': case 'ss':
      return { action: 'tabs.screenshot', params: {} };
    case 'reload':
      return { action: 'tabs.reload', params: {} };
    case 'back':
      return { action: 'dom.evaluate', params: { fn: '() => { history.back(); return true; }' } };
    case 'forward':
      return { action: 'dom.evaluate', params: { fn: '() => { history.forward(); return true; }' } };
    case 'clear':
      if (!rest) return null;
      return { action: 'human.clearInput', params: { selector: rest } };
    case 'key': case 'press':
      if (!rest) return null;
      return { action: 'dom.keyPress', params: { key: rest } };
    case 'discover':
      return { action: 'dom.discoverElements', params: {} };
    case 'frames':
      return { action: 'frames.list', params: {} };
    case 'cookies':
      if (!rest || rest === 'get') return { action: 'cookies.getAll', params: {} };
      // cookies load handled specially — fall through
      return null;
    case 'box':
      if (!rest) return null;
      return rest.startsWith('el_')
        ? { action: 'dom.boundingBox', params: { handleId: rest } }
        : { action: 'dom.boundingBox', params: { selector: rest } };
    default:
      break;
  }

  // Not a shorthand — treat as action [params]
  const spaceIdx = line.indexOf(' ');
  if (spaceIdx === -1) {
    return { action: line, params: {} };
  }
  const action = line.slice(0, spaceIdx);
  const paramsStr = line.slice(spaceIdx + 1).trim();
  try {
    return { action, params: JSON.parse(paramsStr) };
  } catch (e) {
    out(`${C.red}invalid params:${C.reset} ${e.message}`);
    return null;
  }
}

// --- Main dispatch ---

function dispatch(line) {
  if (line.startsWith('.')) {
    dotCommand(line);
    return;
  }

  // Special shorthands that need their own flow (dump, cookies load)
  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const rest = parts.slice(1).join(' ');
  if (cmd === 'dump') { doDump(); return; }
  if (cmd === 'cookies' && rest.startsWith('load')) { loadCookies(rest); return; }

  const resolved = resolveLine(line);
  if (!resolved) return;
  sendCommand(resolved.action, resolved.params);
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
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function attempt() {
      const ws = new WebSocket(addr);
      ws.on('open', () => { ws.close(); resolve(); });
      ws.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('server did not start in time'));
          return;
        }
        setTimeout(attempt, 300);
      });
    }
    attempt();
  });
}

function waitForServerStop(addr, pid, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function attempt() {
      const current = getServerPid(addr);
      if (!current || current !== pid) {
        try { fs.unlinkSync(pidFileForPort(portFromAddr(addr))); } catch {}
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`server did not stop in time (pid ${pid})`));
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
    env: { ...process.env },
    cwd: process.cwd(),
  });
  child.unref();
  return child.pid;
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

function failCli(message) {
  console.error(`${C.red}error:${C.reset} ${message}`);
  process.exit(1);
}

async function ensureFirstRunConfig(startOptions = {}) {
  const explicitConfig = startOptions.configPath
    ? path.resolve(startOptions.configPath.replace(/^~/, os.homedir()))
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
    console.error(`${C.red}no Chromium-based browser found${C.reset}`);
    console.error(`${C.dim}created template config at ${configPath}${C.reset}`);
    console.error(`${C.dim}set browser: \"/path/to/browser\" and run webpilot start again${C.reset}`);
    process.exit(1);
  }

  if (candidates.length === 1) {
    const configPath = writeDefaultConfig(candidates[0].path, targetPath);
    console.log(`${C.green}created config${C.reset} ${configPath}`);
    console.log(`${C.dim}browser detected: ${candidates[0].label}${C.reset}`);
    return configPath;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(`${C.yellow}multiple Chromium-based browsers found${C.reset}`);
    printBrowserCandidates(candidates);
    console.error(`${C.dim}use --browser or create ${targetPath}${C.reset}`);
    process.exit(1);
  }

  console.log(`${C.yellow}no config found${C.reset}`);
  console.log('Choose a browser for the generated default config:');
  printBrowserCandidates(candidates);

  while (true) {
    const answer = await prompt(`Select browser [1-${candidates.length}] or q to abort: `);
    if (!answer) continue;
    if (answer.toLowerCase() === 'q') process.exit(1);
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

async function startServer(addr, startOptions = {}) {
  const existing = getServerPid(addr);
  if (existing) {
    console.log(`${C.yellow}restarting server${C.reset} (pid ${existing})`);
    stopServer(addr);
    try {
      await waitForServerStop(addr, existing);
    } catch (e) {
      console.error(`${C.red}error:${C.reset} ${e.message}`);
      process.exit(1);
    }
  }

  await ensureFirstRunConfig(startOptions);

  console.log(`${C.dim}starting human-browser server...${C.reset}`);
  const pid = spawnDaemon(addr, startOptions);
  try {
    await waitForServer(addr);
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
    return pid;
  } catch (e) {
    const logPath = path.join(CONFIG_DIR, 'server.log');
    console.error(`${C.red}error:${C.reset} ${e.message}`);
    console.error(`${C.dim}check ${logPath} for details${C.reset}`);
    process.exit(1);
  }
}

function stopServer(addr = 'ws://localhost:7331') {
  const pid = getServerPid(addr);
  let config = null;
  try {
    config = loadConfig();
  } catch {}
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

function connectAndRun(addr, cmd) {
  try {
    conn = new WebSocket(addr);
  } catch (e) {
    console.error(`${C.red}failed to connect:${C.reset} ${e.message}`);
    process.exit(1);
  }

  conn.on('error', (err) => {
    console.error(`${C.red}failed to connect:${C.reset} ${err.message}`);
    process.exit(1);
  });

  conn.on('close', () => {
    if (!oneshot) {
      out(`\n${C.red}[disconnected]${C.reset}`);
      process.exit(0);
    }
  });

  conn.on('message', (data) => onMessage(data.toString()));

  conn.on('open', () => {
    // Non-interactive mode: -c <command>
    if (cmd) {
      oneshot = true;
      dispatch(cmd);
      // Fallback timeout — normally exits via oneshotDone()
      const fallback = setTimeout(() => {
        conn.close();
        process.exit(0);
      }, 36000);
      fallback.unref();
      return;
    }

    // Pipe mode: stdin is not a TTY (e.g. echo 'go x.com\ndiscover' | webpilot)
    if (!process.stdin.isTTY) {
      oneshot = true;
      pipeMode = true;
      const pipeRL = readline.createInterface({ input: process.stdin });
      const lines = [];
      pipeRL.on('line', (l) => { const t = l.trim(); if (t) lines.push(t); });
      pipeRL.on('close', async () => {
        for (const line of lines) {
          try {
            await dispatchWait(line);
          } catch (e) {
            out(`${C.red}error:${C.reset} ${e.message}`);
          }
        }
        pipeMode = false;
        if (conn) { conn.close(); conn = null; }
        process.exit(0);
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
    sendCommand('tabs.list', {});

    rl.prompt();

    rl.on('line', (line) => {
      line = line.trim();
      if (!line) { rl.prompt(); return; }

      // Save to history file (append)
      try {
        fs.appendFileSync(histFile, line + '\n');
      } catch {}

      dispatch(line);
      rl.prompt();
    });

    rl.on('close', () => {
      if (conn) conn.close();
      process.exit(0);
    });
  });
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
    if (args[i] === 'start' || args[i] === 'stop') {
      if (subcommand) failCli(`multiple commands: ${subcommand} and ${args[i]}`);
      subcommand = args[i];
      i += 1;
    } else if (args[i] === '--addr' && args[i + 1]) {
      addr = args[i + 1];
      i += 2;
    } else if (args[i] === '--addr') {
      failCli('--addr requires a value');
    } else if (args[i] === '-d') {
      startOptions.sessionLog = true;
      i += 1;
    } else if (args[i] === '--port' && args[i + 1]) {
      const port = parseInt(args[i + 1], 10);
      if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        failCli(`invalid port: ${args[i + 1]}`);
      }
      startOptions.port = port;
      addr = `ws://localhost:${port}`;
      i += 2;
    } else if (args[i] === '--port') {
      failCli('--port requires a value');
    } else if (args[i] === '--browser' && args[i + 1]) {
      startOptions.browser = args[i + 1];
      i += 2;
    } else if (args[i] === '--browser') {
      failCli('--browser requires a value');
    } else if (args[i] === '--config' && args[i + 1]) {
      startOptions.configPath = args[i + 1];
      i += 2;
    } else if (args[i] === '--config') {
      failCli('--config requires a value');
    } else if (args[i] === '-c' && args[i + 1]) {
      cmd = args[i + 1];
      i += 2;
    } else if (args[i] === '-c') {
      failCli('-c requires a command');
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: webpilot [options] [command]');
      console.log('');
      console.log('Flow: inspect -> act -> verify');
      console.log('      use html/discover/q before interaction when state is uncertain');
      console.log('');
      console.log('Commands:');
      console.log('  start [-d]         Launch browser + WS server');
      console.log('  stop               Stop running server');
      console.log('  (default)          Interactive REPL');
      console.log('');
      console.log('Options:');
      console.log('  -d                 Append WS commands/events to ~/h17-webpilot/webpilot.log on start');
      console.log('                     (or framework.debug.sessionLogPath from config)');
      console.log('  --addr <url>       WebSocket address (default: ws://localhost:7331)');
      console.log('  --port <n>         Override WS port for start/stop/connect');
      console.log('  --browser <path>   Override browser binary for start');
      console.log('  --config <path>    Use a specific config file for start/stop');
      console.log('  -c <command>       Execute single command and exit');
      console.log('  -h, --help         Show this help');
      console.log('');
      console.log('Pipe mode:');
      console.log('  echo "go x.com\\ndiscover" | webpilot');
      console.log('  webpilot <<EOF');
      console.log('  go example.com');
      console.log('  discover');
      console.log('  click #btn');
      console.log('  EOF');
      process.exit(0);
    } else {
      if (args[i].startsWith('-')) {
        failCli(`unknown option: ${args[i]}`);
      }
      i++;
    }
  }

  if (startOptions.sessionLog && subcommand && subcommand !== 'start') {
    failCli('-d is only valid with start');
  }

  if (subcommand === 'start') {
    await startServer(addr, startOptions);
    process.exit(0);
  }

  if (subcommand === 'stop') {
    stopServer(addr);
    process.exit(0);
  }

  // Auto-start: if server isn't running, start it
  if (!getServerPid(addr)) {
    await startServer(addr, startOptions);
  }

  connectAndRun(addr, cmd);
}

main().catch((err) => {
  failCli(err && err.message ? err.message : String(err));
});
