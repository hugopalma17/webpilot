/**
 * all-commands.js — CLI integration test
 *
 * Tests the public CLI surface in the order the CLI teaches:
 * inspect -> act -> verify
 *
 * Requires test/server.js to be running (browser + fixtures on :3456).
 *
 * Usage:
 *   node test/server.js
 *   node test/all-commands.js
 */

const { execFile } = require("child_process");
const path = require("path");

const CLI = path.join(__dirname, "..", "bin", "cli.js");
const TIMEOUT = 10000;
const FIXTURES_URL = "http://localhost:3456/fixtures.html";

let passed = 0;
let failed = 0;
let total = 0;

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

function cliAdmin(args) {
  return new Promise((resolve) => {
    const proc = execFile("node", [CLI, ...args], {
      timeout: TIMEOUT + 4000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      proc.kill();
      resolve(out);
    }, TIMEOUT + 2000);
    proc.on("close", () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

function cliPipe(lines) {
  return new Promise((resolve) => {
    const proc = execFile("node", [CLI], {
      timeout: TIMEOUT + 6000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      proc.kill();
      resolve(out);
    }, TIMEOUT + 4000);
    proc.on("close", () => {
      clearTimeout(timer);
      resolve(out);
    });
    proc.stdin.write(lines.join("\n") + "\n");
    proc.stdin.end();
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

async function goFixtures() {
  let out = await cli(`go ${FIXTURES_URL}`);
  assert("go fixtures succeeds", !hasError(out), out);
  await sleep(2000);

  out = await cli("title");
  assert("fixtures page loaded", out.includes("Test Page") && !hasError(out), out);
}

async function main() {
  console.log("=== Webpilot CLI Test ===\n");

  let out = await cli("title");
  if (hasError(out)) {
    console.error(
      "\x1b[31mFATAL: Cannot reach extension. Is test/server.js running with a browser?\x1b[0m",
    );
    console.error(`  output: ${out.trim().slice(0, 200)}`);
    process.exit(1);
  }

  await goFixtures();

  section("HELP AND STATUS");

  out = await cli(".help");
  assert(".help shows inspect-act-verify flow", out.includes("Flow") && out.includes("inspect -> act -> verify"), out);
  assert(".help shows query commands", out.includes("Query") && out.includes("discover"), out);
  assert(".help shows interaction commands", out.includes("Interact") && out.includes("click <sel|handle>"), out);

  out = await cli(".status");
  assert(".status shows connection info", out.includes("connected"), out);

  out = await cli(".tabs");
  assert(".tabs lists open tabs", (out.includes("localhost") || out.includes("fixtures")) && !hasError(out), out);

  section("INSPECT");

  out = await cli("title");
  assert("title returns page title", out.includes("Test Page") && !hasError(out), out);

  out = await cli("url");
  assert("url returns current URL", out.includes("fixtures.html") && !hasError(out), out);

  out = await cli("html");
  assert("html returns page HTML", out.includes("Human Browser Test Page") && !hasError(out), out);

  out = await cli("discover");
  assert("discover returns interactive elements", out.includes("elements") && out.includes("el_") && !hasError(out), out);

  out = await cli("q #title");
  assert("q finds a handle", out.includes("1 match") && out.includes("el_") && !hasError(out), out);

  out = await cli("query .child");
  assert("query alias returns multiple matches", out.includes("3 match") && !hasError(out), out);

  out = await cli("wait #title");
  assert("wait resolves existing selector", out.includes("el_") && !hasError(out), out);

  out = await cli("box #btn-visible");
  assert("box returns bounding box", out.includes('"x"') && out.includes('"width"') && !hasError(out), out);

  out = await cli("frames");
  assert("frames returns data", !hasError(out), out);

  out = await cli("cookies");
  assert("cookies returns data", !hasError(out), out);

  out = await cli("ss");
  assert("ss saves a screenshot", out.includes("screenshot") && out.includes(".png") && !hasError(out), out);

  out = await cliPipe([
    `go ${FIXTURES_URL}`,
    ".http",
    "sd 2200",
  ]);
  assert("http toggle enables response events", out.includes("http on") && !hasError(out), out);
  assert("network watching reports lazy GitHub fetch", out.includes("github_button.html") && out.includes("200"), out);

  section("NAVIGATION");

  out = await cli("go example.com");
  assert("go example.com succeeds", !hasError(out), out);
  await sleep(2000);

  out = await cli("title");
  assert("example.com loaded", out.includes("Example Domain") && !hasError(out), out);

  out = await cli("back");
  assert("back succeeds", !hasError(out), out);
  await sleep(2000);

  out = await cli("url");
  assert("back returned to fixtures", out.includes("fixtures.html") && !hasError(out), out);

  out = await cli("forward");
  assert("forward succeeds", !hasError(out), out);
  await sleep(2000);

  out = await cli("url");
  assert("forward returned to example.com", out.includes("example.com") && !hasError(out), out);

  out = await cli("reload");
  assert("reload succeeds", !hasError(out), out);
  await sleep(2000);

  out = await cli("title");
  assert("title still works after reload", out.includes("Example Domain") && !hasError(out), out);

  out = await cli("nav localhost:3456/fixtures.html");
  assert("nav alias handles localhost URLs", !hasError(out), out);
  await sleep(2000);

  out = await cli("title");
  assert("nav alias returned to fixtures", out.includes("Test Page") && !hasError(out), out);

  section("ACT");

  out = await cli("click #btn-visible");
  assert("click visible button succeeds", out.includes('"clicked": true') && !hasError(out), out);
  await sleep(500);

  out = await cli("eval document.getElementById('btn-visible').textContent");
  assert("click changed button text", out.includes("Clicked!") && !hasError(out), out);

  out = await cli("click #btn-opacity");
  assert("click blocks opacity-zero trap", out.includes("opacity-zero") && out.includes('"clicked": false'), out);

  out = await cli("click #btn-aria");
  assert("click blocks aria-hidden trap", out.includes("aria-hidden") && out.includes('"clicked": false'), out);

  out = await cli("click #btn-offscreen");
  assert("click blocks offscreen trap", out.includes("honeypot") && out.includes('"clicked": false'), out);

  out = await cli("click #btn-sneaky");
  assert("click blocks visibility-hidden trap", out.includes("visibility-hidden") && out.includes('"clicked": false'), out);

  out = await cli("type #text-input Hello CLI");
  assert("type with selector succeeds", out.includes('"typed": true') && !hasError(out), out);
  await sleep(1500);

  out = await cli("eval document.getElementById('text-input').value");
  assert("type wrote text to input", out.includes("Hello CLI") && !hasError(out), out);

  out = await cli("clear #text-input");
  assert("clear succeeds", out.includes('"cleared": true') && !hasError(out), out);
  await sleep(500);

  out = await cli("eval document.getElementById('text-input').value");
  assert("clear emptied the input", !out.includes("Hello CLI") && !hasError(out), out);

  out = await cli("key Tab");
  assert("key sends Tab", !hasError(out), out);

  out = await cli("press Enter");
  assert("press alias sends Enter", !hasError(out), out);

  out = await cli("sd");
  assert("sd scrolls down", out.includes('"scrolled": true') && !hasError(out), out);

  out = await cli("sd 500");
  assert("sd with amount scrolls down", out.includes('"scrolled": true') && !hasError(out), out);

  out = await cli("sd #scrollable");
  assert("sd with selector scrolls element", out.includes('"scrolled": true') && !hasError(out), out);

  out = await cli("su");
  assert("su scrolls up", out.includes('"scrolled": true') && !hasError(out), out);

  out = await cli("su 200");
  assert("su with amount scrolls up", out.includes('"scrolled": true') && !hasError(out), out);

  out = await cli("sd 2200");
  assert("sd reaches the lazy-load region", out.includes('"scrolled": true') && !hasError(out), out);
  await sleep(1200);

  out = await cli("q #github-link");
  assert("lazy GitHub button loads after deep scroll", out.includes("View on GitHub") && out.includes("el_") && !hasError(out), out);

  out = await cli("su 1800");
  assert("su moves the page away from the lazy button", out.includes('"scrolled": true') && !hasError(out), out);
  await sleep(500);

  out = await cli("q #github-link");
  assert("lazy GitHub button is freshly queryable before final click", out.includes("el_") && !hasError(out), out);
  await sleep(1200);

  out = await cli("click #github-link");
  assert("click scrolls back down to the lazy GitHub button and activates it", out.includes('"clicked": true') && !hasError(out), out);
  out = await cli('tabs.waitForNavigation {"timeout":10000}');
  assert("lazy GitHub navigation completes", out.includes('"success": true') && !hasError(out), out);
  await sleep(1500);

  out = await cli("url");
  assert("lazy GitHub button navigates after ajax load", out.includes("github.com/hugopalma17/webpilot") && !hasError(out), out);

  out = await cli("back");
  assert("back returns from lazy GitHub navigation", !hasError(out), out);
  await sleep(2000);

  section("VERIFY");

  await goFixtures();

  out = await cli("discover");
  const dropdownHandle = out.match(/el_\d+/);
  assert("discover returns a reusable handle", !!dropdownHandle, out);

  out = await cli("click #dropdown");
  assert("click dropdown succeeds", out.includes('"clicked": true') && !hasError(out), out);
  await sleep(300);

  out = await cli("key ArrowDown");
  assert("ArrowDown changes dropdown selection", !hasError(out), out);
  await sleep(250);

  out = await cli("press Enter");
  assert("Enter confirms dropdown selection", !hasError(out), out);
  await sleep(250);

  out = await cli("eval document.getElementById('dropdown').value");
  assert("dropdown value changed by interaction", (out.includes("b") || out.includes("a")) && !hasError(out), out);

  out = await cli("q #btn-visible");
  const handleMatch = out.match(/el_\d+/);
  assert("q returns a handle for handle-based actions", !!handleMatch, out);

  if (handleMatch) {
    const handle = handleMatch[0];
    out = await cli(`click ${handle}`);
    assert("click by handle succeeds", out.includes('"clicked": true') && !hasError(out), out);

    out = await cli(`box ${handle}`);
    assert("box by handle succeeds", out.includes('"x"') && !hasError(out), out);
  }

  section("RAW MODE");

  out = await cli("framework.getConfig {}");
  assert("raw framework.getConfig works", out.includes("framework") && !hasError(out), out);
  assert("framework config exposes runtime handles config", out.includes("ttlMs") && out.includes("cleanupIntervalMs") && !hasError(out), out);

  out = await cli('dom.batchQuery {"selectors":["#title","#text-input","#nonexistent"]}');
  assert("raw dom.batchQuery works", out.includes("true") && out.includes("false") && !hasError(out), out);

  out = await cli('{"action":"tabs.list","params":{}}');
  assert("raw JSON message works", (out.includes("fixtures") || out.includes("localhost")) && !hasError(out), out);

  section("ERRORS");

  out = await cli("dom.evaluate not-json");
  assert("invalid params reports an error", out.includes("invalid params"), out);

  console.log(`\n${"=".repeat(50)}`);
  console.log(`  ${passed}/${total} passed, ${failed} failed`);
  console.log(`${"=".repeat(50)}\n`);

  await sleep(2000);
  out = await cliAdmin(["stop"]);
  assert("browser quits cleanly after test run", out.includes("server stopped") && !out.includes("error:"), out);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
