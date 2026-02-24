const { start, killBrowserAndExit } = require('../index');
const { exec } = require('child_process');
const path = require('path');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const TIMEOUT = 8000;

let _server, _browserProcess;
let passed = 0, failed = 0, total = 0;

// Run a CLI command via -c flag, return stdout
function cli(cmd) {
  return new Promise((resolve) => {
    const proc = exec(`node "${CLI}" -c "${cmd}"`, {
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
  const { server, transport, browserProcess, config } = await start({
    browser: '/Applications/Helium.app/Contents/MacOS/Helium',
  });
  _server = server;
  _browserProcess = browserProcess;

  // Navigate to example.com via transport (setup)
  const tabs = await transport.send('tabs.list');
  const tab = tabs.find((t) => !t.url.startsWith('chrome'));
  if (tab) await transport.send('tabs.navigate', { url: 'https://example.com' }, tab.id);
  else await transport.send('tabs.navigate', { url: 'https://example.com' });

  // Wait for page load
  await new Promise((r) => setTimeout(r, 2000));

  console.log('\n--- CLI Integration Tests ---\n');

  // .tabs — list tabs
  let out = await cli('.tabs');
  assert('.tabs lists open tabs', out.includes('example.com'), out);

  // discover — find interactive elements
  out = await cli('discover');
  assert('discover finds elements', out.includes('elements') || out.includes('[link]'), out);
  assert('discover returns handleIds', out.includes('el_'), out);

  // q — query selector
  out = await cli('q h1');
  assert('q h1 finds heading', out.includes('match') || out.includes('el_'), out);

  out = await cli('q a');
  assert('q a finds links', out.includes('match') || out.includes('el_'), out);

  // title
  out = await cli('title');
  assert('title returns page title', out.includes('Example Domain'), out);

  // url
  out = await cli('url');
  assert('url returns current URL', out.includes('example.com'), out);

  // eval
  out = await cli('eval document.querySelectorAll("p").length');
  assert('eval runs JS and returns result', /[0-9]+/.test(out), out);

  // html
  out = await cli('html');
  assert('html returns page HTML', out.includes('<h1>') || out.includes('Example Domain'), out);

  // box — bounding box
  out = await cli('box h1');
  assert('box returns bounding box', out.includes('"x"') && out.includes('"y"'), out);

  // ss — screenshot
  out = await cli('ss');
  assert('screenshot saves file', out.includes('screenshot') && out.includes('.png'), out);

  // go — navigate
  out = await cli('go example.com');
  assert('go navigates to URL', out.includes('tabs.navigate'), out);

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
  assert('q works after reload', out.includes('match') || out.includes('el_'), out);

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
  assert('raw protocol command works', out.includes('Example Domain') || out.includes('html'), out);

  // --- Summary ---
  console.log(`\n--- ${passed}/${total} passed, ${failed} failed ---\n`);
  killBrowserAndExit(_browserProcess, _server, failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  killBrowserAndExit(_browserProcess, _server, 1);
});
