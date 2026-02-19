const { startWithPage, killBrowserAndExit } = require('../index');

let _server, _browserProcess;

async function main() {
  const { server, page, browserProcess } = await startWithPage();
  _server = server;
  _browserProcess = browserProcess;

  console.log('=== Navigate to hugopalma.work ===');
  await page.goto('https://hugopalma.work');
  await new Promise(r => setTimeout(r, 3000));
  console.log(`URL: ${page.url()}`);

  // Test 1: Simple string return
  console.log('\n=== Test 1: Simple string ===');
  try {
    const r1 = await page.evaluate(() => 'hello');
    console.log('Result:', JSON.stringify(r1), typeof r1);
  } catch (e) {
    console.log('Error:', e.message);
  }

  // Test 2: document.title
  console.log('\n=== Test 2: document.title ===');
  try {
    const r2 = await page.evaluate(() => document.title);
    console.log('Result:', JSON.stringify(r2), typeof r2);
  } catch (e) {
    console.log('Error:', e.message);
  }

  // Test 3: querySelectorAll count
  console.log('\n=== Test 3: querySelectorAll a ===');
  try {
    const r3 = await page.evaluate(() => document.querySelectorAll('a').length);
    console.log('Result:', JSON.stringify(r3), typeof r3);
  } catch (e) {
    console.log('Error:', e.message);
  }

  // Test 4: querySelector by known selector from the curl
  console.log('\n=== Test 4: Known selector ===');
  try {
    const handle = await page.$('a#nav-journal');
    console.log('Handle:', handle);
    if (handle) {
      const text = await handle.evaluate(el => el.textContent);
      console.log('Text:', text);
    }
  } catch (e) {
    console.log('Error:', e.message);
  }

  // Test 5: dom.querySelector directly through transport
  console.log('\n=== Test 5: Raw dom.querySelector ===');
  try {
    const r5 = await page._send('dom.querySelector', { selector: 'a' });
    console.log('Result:', JSON.stringify(r5));
  } catch (e) {
    console.log('Error:', e.message);
  }

  // Test 6: dom.querySelectorAll directly
  console.log('\n=== Test 6: Raw dom.querySelectorAll ===');
  try {
    const r6 = await page._send('dom.querySelectorAll', { selector: 'a' });
    console.log('Result:', JSON.stringify(r6));
  } catch (e) {
    console.log('Error:', e.message);
  }

  console.log('\n=== Done ===');
  server.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  killBrowserAndExit(_browserProcess, _server, 1);
});
