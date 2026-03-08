#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

function parseArgs(argv) {
  const options = {
    port: 7331,
    browser: null,
    configPath: null,
    sessionLog: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--port':
        options.port = parseInt(argv[++i] || '7331', 10) || 7331;
        break;
      case '--browser':
        options.browser = argv[++i] || null;
        break;
      case '--config':
        options.configPath = argv[++i] || null;
        break;
      case '-d':
        options.sessionLog = true;
        break;
      default:
        break;
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const CONFIG_DIR = path.join(os.homedir(), 'h17-webpilot');
const PORT = options.port;
const PID_FILE = path.join(CONFIG_DIR, PORT === 7331 ? 'server.pid' : `server-${PORT}.pid`);

// Ensure config dir exists
fs.mkdirSync(CONFIG_DIR, { recursive: true });

// Write PID
fs.writeFileSync(PID_FILE, String(process.pid));

// Redirect stdout/stderr to log file
const logPath = path.join(CONFIG_DIR, PORT === 7331 ? 'server.log' : `server-${PORT}.log`);
const logStream = fs.createWriteStream(logPath, { flags: 'w' });
process.stdout.write = logStream.write.bind(logStream);
process.stderr.write = logStream.write.bind(logStream);

const framework = require(path.resolve(__dirname, '..', 'index.js'));
const {
  clearBrowserState,
  stopManagedBrowser,
  normalizeProfilePath,
} = require(path.resolve(__dirname, '..', 'lib', 'launcher.js'));

let browserProcess = null;
let server = null;
let activeConfig = null;
let shuttingDown = false;

function cleanup(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server) try { server.close(); } catch {}
  if (activeConfig?.profile) {
    stopManagedBrowser(normalizeProfilePath(activeConfig.profile), { fallbackToProfileMatch: true });
  } else if (browserProcess && browserProcess.pid) {
    try { process.kill(-browserProcess.pid, 'SIGTERM'); } catch {
      try { process.kill(browserProcess.pid, 'SIGTERM'); } catch {}
    }
  }
  clearBrowserState();
  try { fs.unlinkSync(PID_FILE); } catch {}
  process.exit(code);
}

process.on('SIGTERM', () => cleanup(0));
process.on('SIGINT', () => cleanup(0));
process.on('uncaughtException', (err) => {
  console.error(`uncaughtException: ${err.stack || err.message}`);
  cleanup(1);
});
process.on('unhandledRejection', (err) => {
  console.error(`unhandledRejection: ${err && err.stack ? err.stack : err}`);
  cleanup(1);
});

framework.start({
  ...(options.browser ? { browser: options.browser } : {}),
  ...(options.configPath ? { __configPath: options.configPath } : {}),
  ...(options.sessionLog ? { __sessionLog: true } : {}),
  ...(options.port ? { port: options.port } : {}),
  __internal: { onShutdown: cleanup },
}).then((result) => {
  browserProcess = result.browserProcess;
  server = result.server;
  activeConfig = result.config || null;
  console.log(`server ready on ws://localhost:${result.config?.port || 7331} (pid ${process.pid})`);
}).catch((err) => {
  console.error(`failed to start: ${err.message}`);
  try { fs.unlinkSync(PID_FILE); } catch {}
  process.exit(1);
});
