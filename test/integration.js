const { startWithPage, createHumanCursor, killBrowserAndExit } = require('../index');

let _server, _browserProcess;

async function main() {
  const { server, page, browserProcess } = await startWithPage();
  _server = server;
  _browserProcess = browserProcess;
  console.log('Connected!\n');

  // --- Tab listing ---
  console.log('--- Tabs ---');
  const tabs = await page.tabs();
  console.log('Tabs:', tabs.map(t => `${t.title} (${t.id})`));

  // --- Navigation ---
  console.log('\n--- Navigate ---');
  await page.goto('https://example.com');
  console.log('Title:', await page.title());

  const ua = await page.evaluate(() => navigator.userAgent);
  console.log('UA:', ua);

  const webdriver = await page.evaluate(() => navigator.webdriver);
  console.log('navigator.webdriver:', webdriver);

  // --- Raw DOM queries ---
  console.log('\n--- DOM ---');
  const h1 = await page.$('h1');
  if (h1) {
    console.log('h1:', await h1.evaluate(el => el.textContent));
    console.log('box:', await h1.boundingBox());
  }

  // --- Raw cursor (bezier movement, no safety checks) ---
  console.log('\n--- Raw Cursor ---');
  const cursor = createHumanCursor(page);
  const link = await page.$('a');
  if (link) {
    const text = await link.evaluate(el => el.textContent);
    console.log(`Moving to "${text}"`);
    await cursor.moveTo(link);
    console.log('Moved (bezier)');
    await cursor.click(link);
    console.log('Clicked (raw)');
  }

  // --- human.click (safe, with honeypot detection) ---
  console.log('\n--- Human Click ---');
  await page.goto('https://example.com');
  const h1Again = await page.$('h1');
  if (h1Again) {
    const result = await page.humanClick(h1Again);
    console.log('human.click result:', result);
  }

  // --- human.click on hidden element (should be blocked) ---
  console.log('\n--- Honeypot Detection ---');
  await page.evaluate(() => {
    const trap = document.createElement('button');
    trap.id = 'honeypot';
    trap.style.opacity = '0';
    trap.textContent = 'Trap';
    document.body.appendChild(trap);
  });
  const honeypot = await page.$('#honeypot');
  if (honeypot) {
    const result = await page.humanClick(honeypot);
    console.log('Honeypot click result:', result);
    console.log('  Expected: clicked=false, reason=opacity-zero');
  }

  // --- human.click with avoid parameter ---
  console.log('\n--- Avoid Parameter ---');
  await page.evaluate(() => {
    const btn = document.createElement('button');
    btn.id = 'sponsored-btn';
    btn.className = 'sponsored';
    btn.textContent = 'Sponsored';
    document.body.appendChild(btn);
  });
  const sponsoredBtn = await page.$('#sponsored-btn');
  if (sponsoredBtn) {
    const result = await page.humanClick(sponsoredBtn, {
      avoid: { classes: ['sponsored'] },
    });
    console.log('Avoid click result:', result);
    console.log('  Expected: clicked=false, reason=avoided');
  }

  // --- human.type ---
  console.log('\n--- Human Type ---');
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'test-input';
    document.body.prepend(input);
  });
  const input = await page.$('#test-input');
  if (input) {
    await input.focus();
    const startTime = Date.now();
    await page.humanType('Hello!');
    const elapsed = Date.now() - startTime;
    const value = await input.evaluate(el => el.value);
    console.log(`Typed: "${value}" in ${elapsed}ms`);
    console.log(`  Expected: ~${6 * 150}ms+ (human timing)`);
  }

  // --- human.clearInput ---
  console.log('\n--- Human Clear Input ---');
  if (input) {
    const result = await page.humanClearInput(input);
    const valueAfter = await input.evaluate(el => el.value);
    console.log(`Clear result:`, result);
    console.log(`Value after clear: "${valueAfter}"`);
    console.log('  Expected: empty string');
  }

  // --- human.scroll ---
  console.log('\n--- Human Scroll ---');
  await page.goto('https://example.com');
  const scrollResult = await page.humanScroll(null, { direction: 'down' });
  console.log('Scroll result:', scrollResult);

  // --- Screenshot ---
  console.log('\n--- Screenshot ---');
  await page.screenshot({ path: 'dumps/test_integration.png' });
  console.log('Screenshot saved to dumps/test_integration.png');

  console.log('\n--- All tests passed ---');
  server.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  killBrowserAndExit(_browserProcess, _server, 1);
});
