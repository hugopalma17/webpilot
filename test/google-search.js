const { startWithPage, killBrowserAndExit } = require('../index');

let _server, _browserProcess;

async function main() {
  const { server, page, browserProcess } = await startWithPage();
  _server = server;
  _browserProcess = browserProcess;

  // --- Navigate to Google ---
  console.log('Navigating to Google...');
  await page.goto('https://www.google.com');
  await sleep(2000);

  // --- Enable debug mode to see cursor trail ---
  await page._send('dom.setDebug', { enabled: true });
  console.log('Debug mode ON — cursor trail visible\n');

  // --- Discover search selectors on the page ---
  console.log('\n--- Discovering input selectors ---');
  const inputs = await page.evaluate(() => {
    const els = document.querySelectorAll('input, textarea');
    return Array.from(els).map(el => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      name: el.name || '',
      id: el.id || '',
      className: el.className || '',
      title: el.title || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      placeholder: el.placeholder || '',
      visible: el.offsetParent !== null || getComputedStyle(el).display !== 'none',
      selector: el.id ? `#${el.id}`
        : el.name ? `${el.tagName.toLowerCase()}[name="${el.name}"]`
        : el.getAttribute('aria-label') ? `${el.tagName.toLowerCase()}[aria-label="${el.getAttribute('aria-label')}"]`
        : null,
    }));
  });

  console.log(`Found ${inputs.length} input elements:`);
  for (const input of inputs) {
    if (input.visible) {
      console.log(`  [${input.tag}] type="${input.type}" name="${input.name}" aria="${input.ariaLabel}" → ${input.selector}`);
    }
  }

  // --- Find the search box ---
  // Google uses textarea[name="q"] (or input[name="q"] in some layouts)
  const searchSelector = inputs.find(i => i.name === 'q' && i.visible)?.selector
    || 'textarea[name="q"]';
  console.log(`\nUsing search selector: ${searchSelector}`);

  const searchBox = await page.waitForSelector(searchSelector, { timeout: 10000 });
  if (!searchBox) {
    throw new Error(`Search box not found with selector: ${searchSelector}`);
  }

  // --- Human click on search box + type query ---
  console.log('Clicking search box...');
  const clickResult = await page.humanClick(searchBox);
  console.log('Click result:', clickResult);

  console.log('Typing "hugopalma.work"...');
  await page.humanType('hugopalma.work');
  await sleep(500);

  // --- Submit search ---
  console.log('Pressing Enter...');
  await page.keyboard.press('Enter');

  // --- Wait for results to load ---
  console.log('Waiting for results...');
  await page.waitForSelector('#search', { timeout: 15000 });
  await sleep(2000);

  // --- Discover result selectors ---
  console.log('\n--- Discovering result selectors ---');
  const resultInfo = await page.evaluate(() => {
    // Google wraps results in various containers — find the actual links
    const candidates = [
      'div#search a h3',          // standard result headings
      'div.g a h3',               // older layout
      '#rso a h3',                // result set organic
    ];
    for (const sel of candidates) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) {
        return {
          selector: sel,
          count: found.length,
          results: Array.from(found).slice(0, 10).map((h3, i) => ({
            index: i,
            title: h3.textContent,
            url: h3.closest('a')?.href || '',
          })),
        };
      }
    }
    return { selector: null, count: 0, results: [] };
  });

  if (!resultInfo.selector || resultInfo.count === 0) {
    console.log('No results found with known selectors. Dumping page structure...');
    await page.screenshot({ path: 'dumps/google_no_results.png' });
    server.close();
    process.exit(1);
  }

  console.log(`Found ${resultInfo.count} results using: ${resultInfo.selector}`);
  console.log('\nResults:');
  for (const r of resultInfo.results) {
    console.log(`  ${r.index + 1}. ${r.title}`);
    console.log(`     ${r.url}`);
  }

  // --- Pick a random result from 1-10 ---
  const maxPick = Math.min(resultInfo.results.length, 10);
  const pickIndex = Math.floor(Math.random() * maxPick);
  const picked = resultInfo.results[pickIndex];

  console.log(`\n--- Randomly picked result #${pickIndex + 1} ---`);
  console.log(`  "${picked.title}"`);
  console.log(`  ${picked.url}`);

  // --- Click the picked result ---
  const resultLinks = await page.$$(resultInfo.selector);
  if (resultLinks[pickIndex]) {
    console.log('\nClicking result...');
    const result = await page.humanClick(resultLinks[pickIndex]);
    console.log('Click result:', result);
    await sleep(3000);
    console.log('Landed on:', page.url());
  }

  await page.screenshot({ path: 'dumps/google_result.png' });
  console.log('\nScreenshot saved to dumps/google_result.png');

  console.log('\n--- Done ---');
  server.close();
  process.exit(0);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(err => {
  console.error('Error:', err.message);
  killBrowserAndExit(_browserProcess, _server, 1);
});
