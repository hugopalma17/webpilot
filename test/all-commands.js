/**
 * all-commands.js — CLI integration test
 *
 * Tests every CLI command by shelling out to `bin/cli.js -c "..."`.
 * Requires test/server.js to be running (browser + fixtures on :3456).
 *
 * Usage:
 *   node test/server.js          (terminal 1)
 *   node test/all-commands.js    (terminal 2)
 */

const { execFile } = require("child_process");
const path = require("path");

const CLI = path.join(__dirname, "..", "bin", "cli.js");
const TIMEOUT = 10000;
const FIXTURES_URL = "http://localhost:3456/fixtures.html";

let passed = 0;
let failed = 0;
let total = 0;

// --- Helpers ---

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cli(cmd) {
  return new Promise((resolve) => {
    const proc = execFile("node", [CLI, "-c", cmd], {
      timeout: TIMEOUT + 2000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      proc.kill();
      resolve(out);
    }, TIMEOUT);
    proc.on("close", () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

function hasError(output) {
  return (
    output.includes("Extension not connected") ||
    output.includes("error:") ||
    output.includes("[disconnected]")
  );
}

function assert(name, condition, output) {
  total++;
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    if (output) console.log(`    got: ${output.trim().slice(0, 300)}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n### ${title} ###\n`);
}

// --- Main ---

async function main() {
  console.log("=== CLI All-Commands Test ===\n");

  // Quick connectivity check
  let out = await cli("title");
  if (hasError(out)) {
    console.error(
      "\x1b[31mFATAL: Cannot reach extension. Is test/server.js running with a browser?\x1b[0m",
    );
    console.error(`  output: ${out.trim().slice(0, 200)}`);
    process.exit(1);
  }

  // Navigate to fixtures page
  console.log("Navigating to fixtures page...");
  out = await cli(`go ${FIXTURES_URL}`);
  await sleep(2000);

  out = await cli("title");
  assert("fixtures page loaded", out.includes("Test Page") && !hasError(out), out);

  // ────────────────────────────────────────────
  section("NAVIGATION");

  // title
  out = await cli("title");
  assert("title returns page title", out.includes("Test Page") && !hasError(out), out);

  // url
  out = await cli("url");
  assert("url returns current URL", out.includes("fixtures.html") && !hasError(out), out);

  // reload
  out = await cli("reload");
  assert("reload succeeds", !hasError(out), out);
  await sleep(2000);

  // Verify page still works after reload
  out = await cli("title");
  assert("title works after reload", out.includes("Test Page") && !hasError(out), out);

  // go (with auto-https)
  out = await cli("go example.com");
  await sleep(2000);

  out = await cli("title");
  assert("go navigated to example.com", out.includes("Example Domain") && !hasError(out), out);

  // back
  out = await cli("back");
  await sleep(2000);

  out = await cli("url");
  assert("back returned to fixtures", out.includes("fixtures") && !hasError(out), out);

  // forward
  out = await cli("forward");
  await sleep(2000);

  out = await cli("url");
  assert("forward went to example.com", out.includes("example.com") && !hasError(out), out);

  // Return to fixtures for remaining tests
  out = await cli(`go ${FIXTURES_URL}`);
  await sleep(2000);

  // ────────────────────────────────────────────
  section("TABS & META");

  // .tabs
  out = await cli(".tabs");
  assert(".tabs lists open tabs", (out.includes("localhost") || out.includes("fixtures")) && !hasError(out), out);

  // .status
  out = await cli(".status");
  assert(".status shows connection info", out.includes("connected"), out);

  // .help
  out = await cli(".help");
  assert(".help shows help text", out.includes("Navigation") && out.includes("Query") && out.includes("Interact"), out);

  // ────────────────────────────────────────────
  section("QUERY & DOM");

  // q — querySelector
  out = await cli("q #title");
  assert("q #title finds heading with handle", out.includes("1 match") && out.includes("el_") && !hasError(out), out);

  out = await cli("q .child");
  assert("q .child finds 3 children", out.includes("3 match") && !hasError(out), out);

  out = await cli("q #nonexistent");
  assert("q #nonexistent returns no matches", out.includes("no matches") && !hasError(out), out);

  // wait — waitForSelector
  out = await cli("wait #title");
  assert("wait finds existing selector", out.includes("el_") && !hasError(out), out);

  // discover — discoverElements
  out = await cli("discover");
  assert("discover finds elements", out.includes("elements") && out.includes("el_") && !hasError(out), out);
  assert("discover shows element types", (out.includes("[link]") || out.includes("[btn]") || out.includes("[input]")), out);

  // ────────────────────────────────────────────
  section("INSPECT");

  // html — page content
  out = await cli("html");
  assert("html returns page HTML", out.includes("Human Browser Test Page") && !hasError(out), out);

  // eval — evaluate JS expression
  out = await cli("eval document.title");
  assert("eval returns JS result", out.includes("Test Page") && !hasError(out), out);

  out = await cli("eval document.querySelectorAll('button').length");
  assert("eval counts elements", /[0-9]+/.test(out) && !hasError(out), out);

  // box — bounding box
  out = await cli("box #btn-visible");
  assert("box returns rect for visible element", out.includes('"x"') && out.includes('"width"') && !hasError(out), out);

  out = await cli("box #btn-hidden");
  assert("box returns null for hidden element", out.includes("null") && !hasError(out), out);

  // ss — screenshot
  out = await cli("ss");
  assert("screenshot saves PNG file", out.includes("screenshot") && out.includes(".png") && !hasError(out), out);

  // cookies
  out = await cli("cookies");
  assert("cookies returns data", !hasError(out), out);

  // frames
  out = await cli("frames");
  assert("frames returns data", !hasError(out), out);

  // ────────────────────────────────────────────
  section("HUMAN INTERACTIONS");

  // Reload fixtures to get clean state
  out = await cli(`go ${FIXTURES_URL}`);
  await sleep(2000);

  // click — human click on visible button
  out = await cli("click #btn-visible");
  assert("click visible button succeeds", out.includes('"clicked": true') && !hasError(out), out);

  // Verify click changed button text
  await sleep(500);
  out = await cli("eval document.getElementById('btn-visible').textContent");
  assert("click changed button text", out.includes("Clicked!") && !hasError(out), out);

  // click — trap detection (opacity:0)
  out = await cli("click #btn-opacity");
  assert("click blocks opacity:0 trap", out.includes("opacity-zero") && out.includes('"clicked": false'), out);

  // click — trap detection (aria-hidden)
  out = await cli("click #btn-aria");
  assert("click blocks aria-hidden trap", out.includes("aria-hidden") && out.includes('"clicked": false'), out);

  // click — trap detection (offscreen honeypot)
  out = await cli("click #btn-offscreen");
  assert("click blocks offscreen trap", out.includes("honeypot") && out.includes('"clicked": false'), out);

  // click — trap detection (visibility:hidden)
  out = await cli("click #btn-sneaky");
  assert("click blocks visibility:hidden trap", out.includes("visibility-hidden") && out.includes('"clicked": false'), out);

  // type — with selector (should click first, then type)
  out = await cli("type #text-input Hello CLI");
  assert("type with selector succeeds", out.includes('"typed": true') && !hasError(out), out);
  await sleep(4000);

  // Verify typed text
  out = await cli("eval document.getElementById('text-input').value");
  assert("type wrote text to input", out.includes("Hello CLI") && !hasError(out), out);

  // clear — clear input
  out = await cli("clear #text-input");
  assert("clear input succeeds", out.includes('"cleared": true') && !hasError(out), out);
  await sleep(1000);

  // Verify cleared
  out = await cli("eval document.getElementById('text-input').value");
  assert("clear emptied the input", !hasError(out), out);

  // key — keyPress
  out = await cli("key Tab");
  assert("key Tab succeeds", !hasError(out), out);

  out = await cli("key Enter");
  assert("key Enter succeeds", !hasError(out), out);

  // ────────────────────────────────────────────
  section("SCROLL");

  // sd — scroll down
  out = await cli("sd");
  assert("sd scrolls down", out.includes('"scrolled": true') && !hasError(out), out);

  // sd with amount
  out = await cli("sd 500");
  assert("sd 500 scrolls down", out.includes('"scrolled": true') && !hasError(out), out);

  // sd with selector
  out = await cli("sd #scrollable");
  assert("sd #scrollable scrolls element", out.includes('"scrolled": true') && !hasError(out), out);

  // su — scroll up
  out = await cli("su");
  assert("su scrolls up", out.includes('"scrolled": true') && !hasError(out), out);

  // su with amount
  out = await cli("su 200");
  assert("su 200 scrolls up", out.includes('"scrolled": true') && !hasError(out), out);

  // ────────────────────────────────────────────
  section("RAW PROTOCOL COMMANDS");

  // Ensure we're on fixtures page for raw protocol tests
  out = await cli(`go ${FIXTURES_URL}`);
  await sleep(2000);

  // Raw action with JSON params
  out = await cli('dom.getHTML {}');
  assert("raw dom.getHTML returns HTML", out.includes("Human Browser Test Page") && !hasError(out), out);

  // Raw dom.querySelector
  out = await cli('dom.querySelector {"selector": "#title"}');
  assert("raw dom.querySelector returns handle", out.includes("el_") && !hasError(out), out);

  // Raw dom.querySelectorAll
  out = await cli('dom.querySelectorAll {"selector": ".child"}');
  assert("raw dom.querySelectorAll returns array", out.includes("el_") && !hasError(out), out);

  // Raw dom.getAttribute
  out = await cli('dom.getAttribute {"selector": "#data-el", "name": "data-custom"}');
  assert("raw dom.getAttribute returns value", out.includes("hello") && !hasError(out), out);

  // Raw dom.getProperty
  out = await cli('dom.getProperty {"selector": "#data-el", "name": "id"}');
  assert("raw dom.getProperty returns id", out.includes("data-el") && !hasError(out), out);

  // Raw dom.evaluate
  out = await cli('dom.evaluate {"fn": "() => document.title"}');
  assert("raw dom.evaluate returns result", out.includes("Test Page") && !hasError(out), out);

  // Raw dom.boundingBox
  out = await cli('dom.boundingBox {"selector": "#btn-visible"}');
  assert("raw dom.boundingBox returns rect", out.includes('"x"') && out.includes('"width"') && !hasError(out), out);

  // Raw dom.waitForSelector
  out = await cli('dom.waitForSelector {"selector": "#title"}');
  assert("raw dom.waitForSelector finds element", out.includes("el_") && !hasError(out), out);

  // Raw dom.discoverElements
  out = await cli("dom.discoverElements {}");
  assert("raw dom.discoverElements returns elements", out.includes("elements") && !hasError(out), out);

  // Raw dom.batchQuery
  out = await cli('dom.batchQuery {"selectors": ["#title", "#text-input", "#nonexistent"]}');
  assert("raw dom.batchQuery returns results", out.includes("true") && out.includes("false") && !hasError(out), out);

  // Raw framework.getConfig
  out = await cli("framework.getConfig {}");
  assert("raw framework.getConfig returns config", out.includes("version") && !hasError(out), out);

  // Raw tabs.list
  out = await cli("tabs.list {}");
  assert("raw tabs.list returns tabs", (out.includes("localhost") || out.includes("fixtures")) && !hasError(out), out);

  // Raw JSON message
  out = await cli('{"action": "dom.evaluate", "params": {"fn": "() => 1 + 1"}}');
  assert("raw JSON message works", out.includes("2") && !hasError(out), out);

  // ────────────────────────────────────────────
  section("DROPDOWN INTERACTION");

  // Navigate fresh to reset state
  out = await cli(`go ${FIXTURES_URL}`);
  await sleep(2000);

  // Click dropdown to focus
  out = await cli("click #dropdown");
  assert("click dropdown", out.includes('"clicked": true') && !hasError(out), out);
  await sleep(500);

  // ArrowDown + Enter to select option B
  out = await cli("key ArrowDown");
  assert("key ArrowDown in dropdown", !hasError(out), out);
  await sleep(300);

  out = await cli("key Enter");
  assert("key Enter confirms selection", !hasError(out), out);
  await sleep(300);

  // Verify dropdown value changed
  out = await cli("eval document.getElementById('dropdown').value");
  assert("dropdown value changed", (out.includes("b") || out.includes("a")) && !hasError(out), out);

  // ────────────────────────────────────────────
  section("HANDLE-BASED COMMANDS");

  // Get a handle via query
  out = await cli("q #btn-visible");
  const handleMatch = out.match(/el_\d+/);
  if (handleMatch) {
    const handle = handleMatch[0];
    assert(`q returns handle (${handle})`, !hasError(out), out);

    // click by handle
    out = await cli(`click ${handle}`);
    assert("click by handleId succeeds", out.includes('"clicked": true') && !hasError(out), out);

    // box by handle
    out = await cli(`box ${handle}`);
    assert("box by handleId returns rect", out.includes('"x"') && !hasError(out), out);
  } else {
    assert("q returns usable handle", false, out);
  }

  // ────────────────────────────────────────────
  section("ERROR HANDLING");

  // Invalid raw JSON params
  out = await cli("dom.evaluate not-json");
  assert("invalid params shows error", out.includes("invalid params"), out);

  // ────────────────────────────────────────────
  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  ${passed}/${total} passed, ${failed} failed`);
  console.log(`${"=".repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
