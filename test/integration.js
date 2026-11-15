const { start, killBrowserAndExit, AgentPage } = require('../index');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const TIMEOUT = 8000;
// WEBPILOT_TEST_BROWSER / WEBPILOT_PORT run this off macOS or next to another runtime.
const BROWSER = process.env.WEBPILOT_TEST_BROWSER || '/Applications/Helium.app/Contents/MacOS/Helium';
const PORT_ARG = process.env.WEBPILOT_PORT ? `--port ${process.env.WEBPILOT_PORT} ` : '';

let _server, _browserProcess;
let passed = 0, failed = 0, total = 0;

// Run a CLI command via -c flag, return stdout
function cli(cmd) {
  return new Promise((resolve) => {
    const proc = exec(`node "${CLI}" ${PORT_ARG}-c "${cmd}"`, {
      timeout: TIMEOUT + 2000,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => {
      proc.kill();
      resolve(out);
    }, TIMEOUT);
    proc.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

function assert(name, condition, output) {
  total++;
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    if (output) console.log(`    got: ${output.trim().slice(0, 200)}`);
    failed++;
  }
}

async function main() {
  console.log('Starting server + browser...');
  const startupLogs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => {
    startupLogs.push(args.join(' '));
    originalConsoleLog(...args);
  };

  const { server, transport, browserProcess, config } = await start({
    browser: BROWSER,
    ...(process.env.WEBPILOT_PORT ? { port: Number(process.env.WEBPILOT_PORT) } : {}),
    human: { calibrated: false },
  });

  // Pid file the CLI checks, so the -c calls below attach to this runtime.
  const os = require('os');
  const port = config.port || 7331;
  const pidFile = path.join(os.homedir(), 'h17-webpilot', port === 7331 ? 'server.pid' : `server-${port}.pid`);
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, String(process.pid));
  process.on('exit', () => { try { fs.unlinkSync(pidFile); } catch {} });
  console.log = originalConsoleLog;
  _server = server;
  _browserProcess = browserProcess;

  assert(
    'start warns on uncalibrated public profile',
    startupLogs.join('\n').includes('Using uncalibrated public profile'),
    startupLogs.join('\n'),
  );

  // Local fixture page: no dependency on outside sites (example.com asks not to be used for tests).
  const http = require('http');
  const fixtureServer = http.createServer((req, res) => {
    fs.readFile(path.join(__dirname, 'fixtures.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  });
  await new Promise((r) => fixtureServer.listen(0, '127.0.0.1', r));
  fixtureServer.unref();
  const FIXTURE_HOST = `127.0.0.1:${fixtureServer.address().port}`;
  const FIXTURE_URL = `http://${FIXTURE_HOST}/fixtures.html`;

  const tabs = await transport.send('tabs.list');
  const tab = tabs.find((t) => !t.url.startsWith('chrome'));
  if (tab) await transport.send('tabs.navigate', { url: FIXTURE_URL }, tab.id);
  else await transport.send('tabs.navigate', { url: FIXTURE_URL });

  // Wait for page load
  await new Promise((r) => setTimeout(r, 2000));

  console.log('\n--- CLI Integration Tests ---\n');

  const page = new AgentPage(transport);
  if (tab) page.setTabId(tab.id);

  let gotoError = null;
  try {
    await page.goto('https://webpilot-test.invalid/');
  } catch (err) {
    gotoError = err;
  }
  assert('page.goto rejects when the page fails to load', gotoError && gotoError.code === 'ERR_NAME_NOT_RESOLVED' && gotoError.message.includes('domain name could not be found'), String(gotoError));
  await page.goto(FIXTURE_URL);

  const html = await page.read();
  assert('AgentPage.read alias returns HTML', html.includes('Human Browser Test Page'), html);

  const heading = await page.query('h1');
  assert('AgentPage.query alias returns an element', !!heading, String(heading));

  const waited = await page.waitFor('h1');
  assert('AgentPage.waitFor alias resolves', !!waited, String(waited));

  const listedTabs = await page.listTabs();
  assert('AgentPage.listTabs alias returns tabs', Array.isArray(listedTabs) && listedTabs.length > 0, JSON.stringify(listedTabs));

  // .tabs — list tabs
  let out = await cli('.tabs');
  assert('.tabs lists open tabs', out.includes(FIXTURE_HOST) && out.trim().endsWith('OK'), out);

  // discover — find interactive elements
  out = await cli('discover');
  assert('discover finds elements', out.includes('elements') || out.includes('[link]'), out);
  assert('discover returns handleIds', out.includes('el_'), out);

  // q — query selector
  out = await cli('q h1');
  assert('q h1 finds heading', out.includes('1 match') && out.includes('el_'), out);

  out = await cli('q button');
  assert('q button finds buttons', /\b[0-9]+ match/.test(out) && out.includes('el_'), out);

  // title
  out = await cli('title');
  assert('title returns page title', out.includes('Test Page') && out.trim().endsWith('OK'), out);

  // url
  out = await cli('url');
  assert('url returns current URL', out.includes(FIXTURE_URL), out);

  // eval
  // cli() wraps the command in shell double quotes, so the JS uses single quotes.
  out = await cli("eval document.querySelectorAll('p').length");
  assert('eval runs JS and returns result', /^[0-9]+$/m.test(out) && out.trim().endsWith('OK'), out);

  // html
  out = await cli('html');
  assert('html returns page HTML', out.includes('Human Browser Test Page'), out);

  // box — bounding box
  out = await cli('box h1');
  assert('box returns bounding box', out.includes('"x"') && out.includes('"y"'), out);

  // ss — screenshot
  out = await cli('ss');
  assert('screenshot saves file', out.includes('screenshot') && out.includes('.png'), out);

  // go — navigate
  out = await cli(`go ${FIXTURE_HOST}/fixtures.html`);
  assert('go navigates to URL', out.includes('tabs.navigate') && out.includes(`OK: loaded ${FIXTURE_URL}`), out);

  // reload
  out = await cli('reload');
  assert('reload works', out.includes('tabs.reload'), out);

  // Wait for reload
  await new Promise((r) => setTimeout(r, 2000));

  // discover after reload — confirms content script re-injects
  out = await cli('discover');
  assert('discover works after reload', out.includes('elements') || out.includes('[link]'), out);

  // q after reload
  out = await cli('q h1');
  assert('q works after reload', out.includes('1 match') && out.includes('el_'), out);

  // cookies
  out = await cli('cookies');
  assert('cookies returns cookie data', out.includes('cookies.getAll') || out.includes('['), out);

  // frames
  out = await cli('frames');
  assert('frames lists frames', out.includes('frameId') || out.includes('frames.list'), out);

  // key
  out = await cli('key Tab');
  assert('key sends keypress', out.includes('dom.keyPress'), out);

  // .status
  out = await cli('.status');
  assert('.status shows connection info', out.includes('connected'), out);

  // .help
  out = await cli('.help');
  assert('.help shows help text', out.includes('Navigation') && out.includes('Query'), out);

  // Raw protocol command
  out = await cli('dom.getHTML {}');
  assert('raw protocol command works', out.includes('Human Browser Test Page'), out);

  // --- Summary ---
  console.log(`\n--- ${passed}/${total} passed, ${failed} failed ---\n`);
  killBrowserAndExit(_browserProcess, _server, failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  killBrowserAndExit(_browserProcess, _server, 1);
});
