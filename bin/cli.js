#!/usr/bin/env node
'use strict';

const WebSocket = require('ws');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
let counter = 0;
let rl = null;
let oneshot = false;

const pending = new Map(); // id -> { action, resolve }
let tabMap = []; // index 0-9 -> { id, url, title, active }

// --- Protocol actions (for tab completion) ---
const protocolActions = [
  'tabs.list', 'tabs.navigate', 'tabs.create', 'tabs.close',
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
  'framework.setConfig', 'framework.getConfig', 'framework.reload',
  'frames.list',
];

const shorthands = [
  'go', 'click', 'type', 'sd', 'su', 'q', 'wait', 'eval', 'js',
  'title', 'url', 'html', 'ss', 'screenshot', 'reload', 'back',
  'forward', 'clear', 'key', 'discover', 'cookies', 'box',
  'frames',
];

const dotCommands = ['.help', '.quit', '.exit', '.tab', '.tabs', '.events', '.status'];

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
  if (!oneshot || oneshotFired) return;
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

    pending.set(id, { action, resolve, reject });
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

  pending.set(id, { action, resolve: null });
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

function sendRawJSON(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    out(`${C.red}invalid JSON:${C.reset} ${e.message}`);
    return;
  }

  if (!msg.id) msg.id = nextID();
  const action = msg.action || '';

  pending.set(msg.id, { action, resolve: null });
  if (!wsSend(msg)) {
    pending.delete(msg.id);
    out(`${C.red}send failed:${C.reset} not connected`);
    return;
  }

  out(`${C.dim}-> ${action}${C.reset}`);

  const t = setTimeout(() => {
    if (pending.has(msg.id)) {
      pending.delete(msg.id);
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
      printResponse(msg, req.action);
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
  const pretty = JSON.stringify(msg.data, null, 2).replace(/\n/g, '\n  ');
  out(`${C.yellow}[${msg.event}]${C.reset} ${pretty}`);
}

function printResponse(msg, action) {
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

// --- Query helper ---

async function doQuery(selector) {
  out(`${C.dim}-> q ${selector}${C.reset}`);
  try {
    const result = await sendAndWait('dom.queryAllInfo', { selector });
    if (!Array.isArray(result) || result.length === 0) {
      out(`${C.dim}(no matches)${C.reset}`);
      oneshotDone();
      return;
    }
    out(`${C.bold}${result.length} match(es)${C.reset}`);
    for (const el of result) {
      out(`  ${C.green}${el.handleId}${C.reset}  ${formatEl(el)}`);
    }
  } catch (e) {
    out(`${C.red}error:${C.reset} ${e.message}`);
  }
  oneshotDone();
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

// --- Shorthand dispatch ---

function tryShorthand(line) {
  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const rest = parts.slice(1).join(' ');

  switch (cmd) {
    case 'go': case 'nav': case 'navigate': case 'goto': {
      if (!rest) { out(`${C.dim}usage: go <url>${C.reset}`); return true; }
      let url = rest;
      if (!url.includes('://')) {
        url = (url.startsWith('localhost') || url.startsWith('127.0.0.1'))
          ? 'http://' + url : 'https://' + url;
      }
      sendCommand('tabs.navigate', { url });
      return true;
    }

    case 'click': {
      if (!rest) { out(`${C.dim}usage: click <selector|handleId>${C.reset}`); return true; }
      if (rest.startsWith('el_')) sendCommand('human.click', { handleId: rest });
      else sendCommand('human.click', { selector: rest });
      return true;
    }

    case 'type': {
      if (!rest) { out(`${C.dim}usage: type [selector] <text>${C.reset}`); return true; }
      const first = parts[1];
      if (parts.length > 2 && (first.startsWith('#') || first.startsWith('.') ||
          first.startsWith('[') || first.includes('='))) {
        sendCommand('human.type', { selector: first, text: parts.slice(2).join(' ') });
      } else {
        sendCommand('human.type', { text: rest });
      }
      return true;
    }

    case 'sd': {
      const params = { direction: 'down' };
      for (const p of parts.slice(1)) {
        if (/^\d+$/.test(p)) params.amount = parseInt(p, 10);
        else params.selector = p;
      }
      sendCommand('human.scroll', params);
      return true;
    }

    case 'su': {
      const params = { direction: 'up' };
      for (const p of parts.slice(1)) {
        if (/^\d+$/.test(p)) params.amount = parseInt(p, 10);
        else params.selector = p;
      }
      sendCommand('human.scroll', params);
      return true;
    }

    case 'q': case 'query': {
      if (!rest) { out(`${C.dim}usage: q <selector>${C.reset}`); return true; }
      doQuery(rest);
      return true;
    }

    case 'wait': {
      if (!rest) { out(`${C.dim}usage: wait <selector>${C.reset}`); return true; }
      sendCommand('dom.waitForSelector', { selector: rest });
      return true;
    }

    case 'eval': case 'js': {
      if (!rest) { out(`${C.dim}usage: eval <js expression>${C.reset}`); return true; }
      let fn = rest;
      if (!fn.startsWith('()') && !fn.startsWith('function')) fn = '() => ' + fn;
      sendCommand('dom.evaluate', { fn });
      return true;
    }

    case 'title':
      sendCommand('dom.evaluate', { fn: '() => document.title' });
      return true;

    case 'url':
      sendCommand('dom.evaluate', { fn: '() => location.href' });
      return true;

    case 'html':
      sendCommand('dom.getHTML', {});
      return true;

    case 'screenshot': case 'ss':
      sendCommand('tabs.screenshot', {});
      return true;

    case 'reload':
      sendCommand('tabs.reload', {});
      return true;

    case 'back':
      sendCommand('dom.evaluate', { fn: '() => { history.back(); return true; }' });
      return true;

    case 'forward':
      sendCommand('dom.evaluate', { fn: '() => { history.forward(); return true; }' });
      return true;

    case 'clear': {
      if (!rest) { out(`${C.dim}usage: clear <selector>${C.reset}`); return true; }
      sendCommand('human.clearInput', { selector: rest });
      return true;
    }

    case 'key': case 'press': {
      if (!rest) { out(`${C.dim}usage: key <keyname>${C.reset}`); return true; }
      sendCommand('dom.keyPress', { key: rest });
      return true;
    }

    case 'discover':
      sendCommand('dom.discoverElements', {});
      return true;

    case 'frames':
      sendCommand('frames.list', {});
      return true;

    case 'cookies': {
      if (!rest || rest === 'get') sendCommand('cookies.getAll', {});
      else if (rest.startsWith('load')) loadCookies(rest);
      else out(`${C.dim}usage: cookies [get|load <file>]${C.reset}`);
      return true;
    }

    case 'box': {
      if (!rest) { out(`${C.dim}usage: box <selector|handleId>${C.reset}`); return true; }
      if (rest.startsWith('el_')) sendCommand('dom.boundingBox', { handleId: rest });
      else sendCommand('dom.boundingBox', { selector: rest });
      return true;
    }
  }

  return false;
}

// --- Dot commands ---

function dotCommand(line) {
  const parts = line.split(/\s+/);
  const cmd = parts[0];

  switch (cmd) {
    case '.help':
      out('');
      out(`${C.bold}Navigation${C.reset}`);
      out('  go <url>             navigate (auto-adds https://)');
      out('  reload / back        page navigation');
      out('  sd [px] [sel]        scroll down (optional amount + selector)');
      out('  su [px] [sel]        scroll up');
      out('');
      out(`${C.bold}Query${C.reset}`);
      out('  q <sel>              find all matches (handles + info)');
      out('  wait <sel>           wait for selector');
      out('  discover             list interactive elements');
      out('');
      out(`${C.bold}Interact${C.reset}`);
      out('  click <sel|handle>   human click');
      out('  type [sel] <text>    human type (sel: # . [ auto-detected)');
      out('  clear <sel>          clear input');
      out('  key <name>           keyPress (Enter, Tab, Escape...)');
      out('');
      out(`${C.bold}Inspect${C.reset}`);
      out('  eval <js>            evaluate JS expression');
      out('  title / url / html   quick page info');
      out('  ss                   screenshot (saves to file)');
      out('  box <sel>            bounding box');
      out('  cookies              dump all cookies');
      out('  frames               list all frames');
      out('');
      out(`${C.bold}Meta${C.reset}`);
      out('  .tabs                list tabs (0-9 aliases)');
      out('  .tab <n>             set active tab by alias or ID');
      out('  .events              toggle event display');
      out('  .status              connection info');
      out('  .quit                exit');
      out('');
      out(`${C.bold}Raw mode${C.reset}`);
      out('  action.name {json}   full protocol command');
      out('  {raw json}           raw WebSocket message');
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

    case '.status':
      out(`connected: ${C.green}yes${C.reset}`);
      out(activeTab ? `tab:       ${activeTab}` : `tab:       ${C.dim}(default)${C.reset}`);
      out(`events:    ${showEvents ? `${C.green}on${C.reset}` : `${C.dim}off${C.reset}`}`);
      oneshotDone();
      break;

    default:
      out(`${C.red}unknown: ${cmd}${C.reset} ${C.dim}(try .help)${C.reset}`);
      oneshotDone();
  }
}

// --- Main dispatch ---

function dispatch(line) {
  if (line.startsWith('.')) {
    dotCommand(line);
    return;
  }
  if (line.startsWith('{')) {
    sendRawJSON(line);
    return;
  }
  if (tryShorthand(line)) return;

  // action [params JSON]
  const spaceIdx = line.indexOf(' ');
  if (spaceIdx === -1) {
    sendCommand(line, {});
  } else {
    const action = line.slice(0, spaceIdx);
    const paramsStr = line.slice(spaceIdx + 1).trim();
    let params;
    try {
      params = JSON.parse(paramsStr);
    } catch (e) {
      out(`${C.red}invalid params:${C.reset} ${e.message}`);
      out(`  ${C.dim}usage: ${action} {"key": "value"}${C.reset}`);
      return;
    }
    sendCommand(action, params);
  }
}

// --- Start subcommand ---

async function startServer() {
  // Resolve the framework entry point relative to this CLI script
  const frameworkPath = path.resolve(__dirname, '..', 'index.js');
  let framework;
  try {
    framework = require(frameworkPath);
  } catch (e) {
    console.error(`${C.red}error:${C.reset} could not load framework: ${e.message}`);
    process.exit(1);
  }

  console.log(`${C.dim}starting human-browser server...${C.reset}`);
  try {
    const result = await framework.start();
    console.log(`${C.green}server ready${C.reset} on ws://localhost:${result.config?.port || 7331}`);
    console.log(`${C.dim}press Ctrl+C to stop${C.reset}`);

    process.on('SIGINT', () => {
      console.log(`\n${C.dim}shutting down...${C.reset}`);
      framework.killBrowserAndExit(result.browserProcess, result.server, 0);
    });
  } catch (e) {
    console.error(`${C.red}error:${C.reset} ${e.message}`);
    process.exit(1);
  }
}

// --- Main ---

function main() {
  const args = process.argv.slice(2);

  // Parse flags
  let addr = 'ws://localhost:7331';
  let cmd = null;
  let i = 0;

  while (i < args.length) {
    if (args[i] === '--addr' && args[i + 1]) {
      addr = args[i + 1];
      i += 2;
    } else if (args[i] === '-c' && args[i + 1]) {
      cmd = args[i + 1];
      i += 2;
    } else if (args[i] === 'start') {
      startServer();
      return;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: webpilot [options] [command]');
      console.log('');
      console.log('Commands:');
      console.log('  start              Launch browser + WS server');
      console.log('  (default)          Interactive REPL (connects to running server)');
      console.log('');
      console.log('Options:');
      console.log('  --addr <url>       WebSocket address (default: ws://localhost:7331)');
      console.log('  -c <command>       Execute command and exit');
      console.log('  -h, --help         Show this help');
      process.exit(0);
    } else {
      i++;
    }
  }

  // Connect to WebSocket
  try {
    conn = new WebSocket(addr);
  } catch (e) {
    console.error(`${C.red}failed to connect:${C.reset} ${e.message}`);
    console.error(`${C.dim}is the server running? (webpilot start)${C.reset}`);
    process.exit(1);
  }

  conn.on('error', (err) => {
    console.error(`${C.red}failed to connect:${C.reset} ${err.message}`);
    console.error(`${C.dim}is the server running? (webpilot start)${C.reset}`);
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
    // Non-interactive mode
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

main();
