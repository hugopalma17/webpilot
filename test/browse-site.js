const { startWithPage, killBrowserAndExit, BridgeElement } = require('../index');

let _server, _browserProcess;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Discover elements — returns { elements, cursor, viewport, scrollY }
async function discoverElements(page, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await sleep(500);
    const result = await page.discoverElements();

    if (result && result.elements && result.elements.length > 0) return result;

    console.log(`  (attempt ${attempt}/${maxRetries}) — no elements found, reloading page...`);
    await page.reload();
    await sleep(2000);
  }
  return { elements: [], cursor: { x: 0, y: 0 }, viewport: { width: 1280, height: 900 }, scrollY: 0 };
}

function logElements(elements) {
  const links = elements.filter(e => e.type === 'link');
  const buttons = elements.filter(e => e.type === 'button');
  const inputs = elements.filter(e => e.type === 'input');

  if (links.length) {
    console.log(`  Links (${links.length}):`);
    for (const l of links.slice(0, 15)) {
      console.log(`    "${l.text}" → ${l.href}`);
    }
    if (links.length > 15) console.log(`    ... and ${links.length - 15} more`);
  }
  if (buttons.length) {
    console.log(`  Buttons (${buttons.length}):`);
    for (const b of buttons) console.log(`    "${b.text}" [${b.selector}]`);
  }
  if (inputs.length) {
    console.log(`  Inputs (${inputs.length}):`);
    for (const inp of inputs) console.log(`    [${inp.inputType}] name="${inp.name}" placeholder="${inp.placeholder}" → ${inp.selector}`);
  }
  if (!links.length && !buttons.length && !inputs.length) {
    console.log('  (no interactive elements found)');
  }
}

// Click an element — humanClick handles scroll if off-screen, retry on shift
async function clickElement(page, el, maxRetries = 3) {
  const urlBefore = page.url();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let handle;
    if (el.handleId) {
      handle = new BridgeElement(page, el.handleId, el.selector);
    } else {
      handle = await page.$(el.selector);
      if (!handle) {
        console.log(`  Could not find element: ${el.selector}`);
        return false;
      }
    }

    const result = await page.humanClick(handle);
    console.log(`  Click result (attempt ${attempt}):`, result);

    if (result.clicked) {
      await sleep(1000);
      const urlAfter = page.url();
      if (el.type === 'link' && urlAfter === urlBefore) {
        console.log(`  URL unchanged (${urlAfter}) — click may not have navigated, retrying...`);
        await sleep(1000);
        continue;
      }
      console.log(`  URL: ${urlBefore} → ${urlAfter}`);
      return true;
    }

    // Retry on recoverable failures
    if (result.reason === 'element-shifted' || result.reason === 'element-disappeared') {
      console.log(`  Retrying after ${result.reason}...`);
      await sleep(500);
      continue;
    }

    // Non-recoverable (honeypot, avoided, off-screen after max scroll, etc.)
    return false;
  }

  console.log(`  Failed after ${maxRetries} attempts`);
  return false;
}

async function main() {
  const { server, page, browserProcess } = await startWithPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 HumanBrowser/1.0',
  });
  _server = server;
  _browserProcess = browserProcess;

  // --- Navigate to hugopalma.work ---
  console.log('=== Navigating to hugopalma.work ===');
  await page.goto('https://hugopalma.work');
  await sleep(3000);
  console.log(`URL: ${page.url()}`);
  console.log(`Title: ${await page.title()}\n`);

  // --- Round 1: Discover + click ---
  console.log('=== Round 1: Discover selectors ===');
  let discovery = await discoverElements(page);
  let elements = discovery.elements;
  logElements(elements);

  let inputs = elements.filter(e => e.type === 'input');
  if (inputs.length) {
    console.log('\n  >> Found input on first page! Skipping to typing.\n');
  } else {
    const clickables = elements.filter(e => e.type === 'link' || e.type === 'button');
    const internal = clickables.filter(e => !e.href || e.href.includes('hugopalma.work') || e.href.startsWith('/'));
    const pick = pickRandom(internal.length ? internal : clickables);
    if (pick) {
      console.log(`\n  >> Clicking: "${pick.text}" (${pick.type})`);
      await clickElement(page, pick);
      await sleep(2000);
    }
  }

  // --- Rounds 2+: Keep navigating until we find an input ---
  let round = 2;
  while (round <= 10) {
    console.log(`=== Round ${round}: Discover selectors ===`);
    discovery = await discoverElements(page);
    elements = discovery.elements;
    logElements(elements);

    inputs = elements.filter(e => e.type === 'input');
    if (inputs.length) {
      console.log('\n  >> Found input field!\n');
      break;
    }

    const clickables = elements.filter(e => e.type === 'link' || e.type === 'button');
    const internal = clickables.filter(e => !e.href || e.href.includes('hugopalma.work') || e.href.startsWith('/'));
    const pick = pickRandom(internal.length ? internal : clickables);
    if (!pick) {
      console.log('\n  No clickable elements found. Going back.\n');
      await page.keyboard.press('Alt+ArrowLeft');
      await sleep(2000);
      round++;
      continue;
    }

    console.log(`\n  >> Clicking: "${pick.text}" (${pick.type})`);
    await clickElement(page, pick);
    await sleep(2000);
    round++;
  }

  // --- Fill all inputs ---
  inputs = elements.filter(e => e.type === 'input');
  if (inputs.length) {
    const testValues = {
      name: 'Human Browser Bot',
      text: 'Human Browser Bot',
      email: 'bot@human-browser.dev',
      textarea: 'Hello from human-browser! This is an automated test of the contact form.',
    };

    console.log(`=== Filling ${inputs.length} input(s) ===`);
    for (const input of inputs) {
      const value = testValues[input.name] || testValues[input.inputType] || 'test input';
      console.log(`  [${input.inputType}] ${input.selector} → "${value}"`);

      let handle;
      if (input.handleId) {
        handle = new BridgeElement(page, input.handleId, input.selector);
      } else {
        handle = await page.$(input.selector);
      }

      if (handle) {
        await page.humanClick(handle);
        await sleep(300);
        await page.humanType(value);
        await sleep(500);
      } else {
        console.log(`    Could not find: ${input.selector}`);
      }
    }

    // Look for a submit button and click it
    const buttons = elements.filter(e => e.type === 'button');
    const submitBtn = buttons.find(b =>
      b.text.toLowerCase().includes('send') ||
      b.text.toLowerCase().includes('submit') ||
      b.selector.includes('submit')
    );

    if (submitBtn) {
      console.log(`\n  >> Submitting via: "${submitBtn.text}"`);
      await clickElement(page, submitBtn);
    } else {
      console.log('\n  >> No submit button found, pressing Enter...');
      await page.keyboard.press('Enter');
    }

    await sleep(3000);
    console.log(`  URL after submit: ${page.url()}`);

    console.log('\n=== Post-submit: Discover selectors ===');
    const postDiscovery = await discoverElements(page);
    logElements(postDiscovery.elements);
  } else {
    console.log('=== No input field found after all rounds ===');
  }

  // --- Pause: keep browser open ---
  console.log('\n=== PAUSED — browser stays open. Press Ctrl+C to exit. ===');
  await page.screenshot({ path: 'dumps/browse_site.png' });
  console.log('Screenshot saved to dumps/browse_site.png');
}

main().catch(err => {
  console.error('Error:', err.message);
  killBrowserAndExit(_browserProcess, _server, 1);
});
