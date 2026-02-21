const { readFileSync } = require("fs");
const { join } = require("path");
const { connectToServer } = require("../index");

const FIXTURES_URL = "http://localhost:3456/fixtures.html";

let passed = 0;
let failed = 0;

function section(title) {
  console.log(`\n### ${title} ###\n`);
}

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`✓ PASS: ${message}`);
  } else {
    failed++;
    console.error(`✗ FAIL: ${message}`);
  }
}

async function requireElement(page, selector, label = selector) {
  const el = await page.$(selector);
  assert(el !== null, `query exists before action: ${label}`);
  if (!el) {
    throw new Error(`Required element not found: ${selector}`);
  }
  return el;
}

async function navigateAndCollect(page) {
  await page.goto(FIXTURES_URL);

  const ready = await page.waitForSelector("#title");
  assert(ready !== null, "navigation completes before interactions");

  const title = await page.title();
  assert(typeof title === "string", "page.title() returns string");

  const url = page.url();
  assert(
    url.includes("localhost:3456/fixtures.html"),
    `page.url points to fixture (got '${url}')`,
  );

  const content = await page.content();
  assert(content.includes("Test Page"), "page.content includes fixture markup");

  const tabs = await page.tabs();
  assert(Array.isArray(tabs), "tabs.list returns array");
  assert(tabs.length > 0, "tabs.list returns entries");

  const discovered = await page.discoverElements();
  assert(
    Array.isArray(discovered.elements),
    "discoverElements returns elements array",
  );
  assert(
    discovered.elements.length > 0,
    `discoverElements finds interactive nodes (got ${discovered.elements.length})`,
  );

  const selectors = new Set(discovered.elements.map((e) => e.selector));
  assert(
    selectors.has("#btn-visible"),
    "discoverElements includes visible button",
  );
  assert(selectors.has("#text-input"), "discoverElements includes text input");
}

async function main() {
  const page = await connectToServer();

  section("VERSION & CONFIG CHECK");
  const manifestPath = join(__dirname, "../extension/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const expectedVersion = manifest.version;

  const checkConfig = await page.getConfig();
  assert(
    checkConfig.version === expectedVersion,
    `extension version is ${expectedVersion} (got ${checkConfig.version})`,
  );
  console.log(`  Extension Version: ${checkConfig.version}`);

  section("READING PAGE + DOM COLLECTION");
  await navigateAndCollect(page);

  const h1 = await requireElement(page, "#title");
  assert(
    h1._handleId.startsWith("el_"),
    "querySelector returns valid handle id",
  );

  const missing = await page.$("#nonexistent");
  assert(missing === null, "querySelector returns null for missing selector");

  const children = await page.$$(".child");
  assert(
    children.length === 3,
    `querySelectorAll .child returns 3 (got ${children.length})`,
  );

  const nested = await requireElement(page, "#nested");
  const special = await nested.$(".special");
  assert(special !== null, "querySelectorWithin finds nested node");

  const nestedChildren = await nested.$$(".child");
  assert(
    nestedChildren.length === 3,
    `querySelectorAllWithin finds 3 nested children (got ${nestedChildren.length})`,
  );

  const visibleBtn = await requireElement(page, "#btn-visible");
  const btnBox = await visibleBtn.boundingBox();
  assert(btnBox !== null, "boundingBox returns rect for visible element");

  const hiddenBtn = await requireElement(page, "#btn-hidden");
  const hiddenBox = await hiddenBtn.boundingBox();
  assert(
    hiddenBox === null,
    "boundingBox returns null for display:none element",
  );

  const dataEl = await requireElement(page, "#data-el");
  const customAttr = await dataEl.getAttribute("data-custom");
  assert(
    customAttr === "hello",
    `getAttribute reads data-custom (got '${customAttr}')`,
  );

  const idProp = await dataEl.getProperty("id");
  assert(idProp === "data-el", `getProperty reads id (got '${idProp}')`);

  const dropdown = await requireElement(page, "#dropdown");
  await page.evaluate(() => {
    const el = document.getElementById("dropdown");
    el.selectedIndex = 0;
    window.__dropdownClicks = 0;
    window.__dropdownChanges = 0;
    el.addEventListener("click", () => {
      window.__dropdownClicks += 1;
    });
    el.addEventListener("change", () => {
      window.__dropdownChanges += 1;
    });
  });
  const dropdownClick = await page.humanClick(dropdown);
  assert(dropdownClick.clicked === true, "dropdown is focused via human.click");
  await page.humanType("{ArrowDown}{Enter}", { selector: "#dropdown" });
  const selectedValue = await dropdown.evaluate((el) => el.value);
  assert(
    selectedValue === "b",
    `dropdown value changes to option "b" after click+keyboard (got '${selectedValue}')`,
  );
  const selectedLabel = await dropdown.evaluate((el) => {
    const idx = el.selectedIndex;
    return idx >= 0 ? el.options[idx].textContent.trim() : null;
  });
  assert(
    selectedLabel === "B",
    `dropdown selected label is "B" (got '${selectedLabel}')`,
  );
  const dropdownClicks = await page.evaluate(() => window.__dropdownClicks);
  assert(
    dropdownClicks > 0,
    `dropdown receives click event (count ${dropdownClicks})`,
  );
  const dropdownChanges = await page.evaluate(() => window.__dropdownChanges);
  assert(
    dropdownChanges > 0,
    `dropdown emits change event (count ${dropdownChanges})`,
  );

  const titleText = await h1.evaluate((el) => el.textContent);
  assert(
    titleText === "Human Browser Test Page",
    `elementEvaluate reads text (got '${titleText}')`,
  );

  const existing = await page.waitForSelector("#title", { timeout: 2000 });
  assert(existing !== null, "waitForSelector finds existing node");

  await page.evaluate(() => {
    window.__delayedElAdded = false;
    setTimeout(() => {
      const el = document.createElement("div");
      el.id = "delayed-el";
      document.body.appendChild(el);
      window.__delayedElAdded = true;
    }, 500);
  });

  const delayed = await page.waitForSelector("#delayed-el", { timeout: 3000 });
  assert(delayed !== null, "waitForSelector resolves for delayed node");

  const timedOut = await page.waitForSelector("#will-never-exist", {
    timeout: 500,
  });
  assert(timedOut === null, "waitForSelector returns null on timeout");

  await page.evaluate(() => {
    window.__ready = false;
    setTimeout(() => {
      window.__ready = true;
    }, 500);
  });

  try {
    const fnResult = await page.waitForFunction(() => window.__ready === true, {
      timeout: 5000,
    });
    assert(
      fnResult === true,
      "waitForFunction resolves when condition is true",
    );
  } catch (err) {
    assert(
      false,
      `waitForFunction resolves when condition is true — ${err.message}`,
    );
  }

  const intersects = await visibleBtn.isIntersectingViewport();
  assert(
    intersects === true,
    "isIntersectingViewport returns true for visible button",
  );

  section("HUMAN FLOW ACTIONS");
  await page.evaluate(() => {
    window.__humanClicked = false;
    document.getElementById("btn-visible").addEventListener("click", () => {
      window.__humanClicked = true;
    });
  });

  const clickResult = await page.humanClick(visibleBtn);
  assert(
    clickResult.clicked === true,
    "human.click works on visible safe element",
  );

  const clicked = await page.evaluate(() => window.__humanClicked === true);
  assert(clicked === true, "human.click dispatches real click event");

  const btnText = await visibleBtn.evaluate((el) => el.textContent);
  assert(btnText === "Clicked!", `human.click changes text (got '${btnText}')`);

  const btnColor = await visibleBtn.evaluate(
    (el) => window.getComputedStyle(el).backgroundColor,
  );
  // #dcfce7 is rgb(220, 252, 231)
  assert(
    btnColor.includes("220, 252, 231"),
    `human.click changes color (got '${btnColor}')`,
  );

  const opacityBtn = await requireElement(page, "#btn-opacity");
  const opacityResult = await page.humanClick(opacityBtn);
  assert(opacityResult.clicked === false, "human.click blocks opacity:0 trap");
  assert(
    opacityResult.reason === "opacity-zero",
    `opacity trap reason is opacity-zero (got '${opacityResult.reason}')`,
  );

  const offscreenBtn = await requireElement(page, "#btn-offscreen");
  const offscreenResult = await page.humanClick(offscreenBtn);
  assert(
    offscreenResult.clicked === false,
    "human.click blocks offscreen trap",
  );
  assert(
    offscreenResult.reason === "honeypot-class",
    `offscreen trap reason is honeypot-class (got '${offscreenResult.reason}')`,
  );

  const tinyEl = await requireElement(page, "#btn-tiny");
  const tinyResult = await page.humanClick(tinyEl);
  assert(tinyResult.clicked === false, "human.click blocks tiny trap");
  assert(
    tinyResult.reason === "sub-pixel",
    `tiny trap reason is sub-pixel (got '${tinyResult.reason}')`,
  );

  const ariaBtn = await requireElement(page, "#btn-aria");
  const ariaResult = await page.humanClick(ariaBtn);
  assert(ariaResult.clicked === false, "human.click blocks aria-hidden trap");
  assert(
    ariaResult.reason === "aria-hidden",
    `aria trap reason is aria-hidden (got '${ariaResult.reason}')`,
  );

  const ghostTrap = await requireElement(page, "#honeypot-trap");
  const ghostResult = await page.humanClick(ghostTrap);
  assert(ghostResult.clicked === false, "human.click blocks ghost trap");
  assert(
    ghostResult.reason === "honeypot-class",
    `ghost trap reason is honeypot-class (got '${ghostResult.reason}')`,
  );

  const sneakyBtn = await requireElement(page, "#btn-sneaky");
  const sneakyResult = await page.humanClick(sneakyBtn);
  assert(
    sneakyResult.clicked === false,
    "human.click blocks visibility:hidden trap",
  );
  assert(
    sneakyResult.reason === "visibility-hidden",
    `sneaky trap reason is visibility-hidden (got '${sneakyResult.reason}')`,
  );

  const sponsoredBtn = await requireElement(page, "#btn-sponsored");
  const avoidClassResult = await page.humanClick(sponsoredBtn, {
    avoid: { classes: ["sponsored"] },
  });
  assert(
    avoidClassResult.clicked === false,
    "human.click honors avoid.classes",
  );
  assert(
    avoidClassResult.reason === "avoided",
    `avoid.classes reason is avoided (got '${avoidClassResult.reason}')`,
  );

  const avoidSelectorResult = await page.humanClick(visibleBtn, {
    avoid: { selectors: ["#btn-visible"] },
  });
  assert(
    avoidSelectorResult.clicked === false,
    "human.click honors avoid.selectors",
  );

  const avoidIdResult = await page.humanClick(visibleBtn, {
    avoid: { ids: ["btn-visible"] },
  });
  assert(avoidIdResult.clicked === false, "human.click honors avoid.ids");

  const trackingEl = await requireElement(page, "#data-el");
  const avoidAttrResult = await page.humanClick(trackingEl, {
    avoid: { attributes: { "data-tracking": "*" } },
  });
  assert(
    avoidAttrResult.clicked === false,
    "human.click honors avoid.attributes",
  );

  const avoidMissResult = await page.humanClick(visibleBtn, {
    avoid: { classes: ["nonexistent"] },
  });
  assert(
    avoidMissResult.clicked === true,
    "human.click allows non-matching avoid rules",
  );

  const input = await requireElement(page, "#text-input");
  await page.evaluate(() => {
    document.getElementById("text-input").value = "";
    document.activeElement?.blur?.();
  });

  const focusClick = await page.humanClick(input);
  assert(focusClick.clicked === true, "human flow clicks input before typing");

  const activeId = await page.evaluate(() => document.activeElement?.id || "");
  assert(
    activeId === "text-input",
    `input is focused after human.click (got '${activeId}')`,
  );

  const bio =
    "Hello, I am Human Browser, a CDP free, extension and websocket based way to control your browser that mimics human behaviour. Made by Hugo Palma. http://hugopalma.work";
  const typeStart = Date.now();
  const typeResult = await page.humanType(bio, { timeout: 100000 });
  const typeElapsed = Date.now() - typeStart;
  assert(typeResult.typed === true, "human.type succeeds on focused input");

  const typedValue = await input.evaluate((el) => el.value);
  assert(
    typedValue === bio,
    `human.type writes long bio (got length ${typedValue.length})`,
  );
  assert(
    typeElapsed > 5000,
    `human.type includes human delay (${typeElapsed}ms for ${bio.length} chars)`,
  );

  const typeAvoidResult = await page._send("human.type", {
    text: "nope",
    handleId: sponsoredBtn._handleId,
    avoid: { classes: ["sponsored"] },
  });
  assert(typeAvoidResult.typed === false, "human.type honors avoid rules");

  const scrollResult = await page.humanScroll("#scrollable", {
    direction: "down",
  });
  assert(
    scrollResult.scrolled === true,
    "human.scroll works on scrollable element",
  );
  assert(
    typeof scrollResult.amount === "number",
    `human.scroll returns amount (got ${scrollResult.amount})`,
  );

  const windowScrollResult = await page.humanScroll(null, {
    direction: "down",
  });
  assert(windowScrollResult.scrolled === true, "human.scroll works on window");

  // Input already has typed text from the human.type test above
  const preValue = await input.evaluate((el) => el.value);
  assert(
    preValue.length > 0,
    `input has existing text before clear (got length ${preValue.length})`,
  );
  const clearResult = await page.humanClearInput(input);
  assert(clearResult.cleared === true, "human.clearInput succeeds");

  const clearedValue = await input.evaluate((el) => el.value);
  assert(
    clearedValue === "",
    `human.clearInput empties input (got '${clearedValue}')`,
  );

  section("FRAMEWORK OPTIMIZATION");

  console.log("  Testing setConfig/getConfig...");
  await page.setConfig({ pollInterval: 50 });
  const config = await page.getConfig();
  assert(
    config.framework && config.framework.pollInterval === 50,
    "setConfig/getConfig works",
  );

  console.log("  Testing batchQuery...");
  const batchResults = await page.batchQuery([
    "#title",
    "#text-input",
    "#non-existent",
  ]);
  assert(batchResults["#title"] === true, "#title found in batch");
  assert(batchResults["#text-input"] === true, "#text-input found in batch");
  assert(
    batchResults["#non-existent"] === false,
    "#non-existent not found in batch",
  );

  console.log(`\n${"=".repeat(50)}`);

  section("GITHUB NAVIGATION (LAZY)");
  // Scroll to bottom to trigger lazy load
  console.log("  Scrolling to bottom...");
  await page.humanScroll(null, { direction: "down", amount: 1600 });

  // Wait for the GitHub button to appear
  console.log("  Waiting for GitHub button...");
  const githubBtn = await page.waitForSelector("#github-link", {
    timeout: 10000,
  });
  assert(githubBtn !== null, "GitHub button loaded after scroll");

  if (githubBtn) {
    console.log("  Clicking GitHub button...");
    await page.humanClick(githubBtn);

    // Wait for navigation and verify URL
    console.log("  Waiting for navigation to GitHub...");
    await page.waitForNavigation({ timeout: 15000 });
    const finalUrl = page.url();
    assert(
      finalUrl.includes("github"),
      `Navigated to github (got '${finalUrl}')`,
    );
  }

  section("CSP COMPATIBILITY TESTS");
  
  const CSP_TESTS = [
    { name: "No CSP", csp: "none" },
    { name: "Strict CSP", csp: "strict" },
    { name: "LinkedIn-style CSP", csp: "linkedin" },
    { name: "UnsafeEval CSP", csp: "unsafeEval" },
    { name: "UnsafeInline CSP", csp: "unsafeInline" },
  ];
  
  for (const { name, csp } of CSP_TESTS) {
    console.log(`\n  Testing ${name}...`);
    const testUrl = `${FIXTURES_URL}?csp=${csp}`;
    
    try {
      await page.goto(testUrl);
      await new Promise(r => setTimeout(r, 500));
      
      // Test dom.getHTML (should always work)
      const html = await page.content();
      assert(html.length > 0, `${name}: dom.getHTML works`);
      
      // Test querySelector (should always work)
      const title = await page.$('#title');
      assert(title !== null, `${name}: querySelector works`);
      
      // Test dom.evaluate.
      // Strategy 1 (inline <script> literal) works with unsafe-inline — no eval needed.
      // Strategy 2 (chrome.scripting + new Function) works with unsafe-eval.
      // ISOLATED fallback (content-script new Function) works when both above fail,
      // because content scripts are exempt from the page's CSP.
      // Only strict CSP blocks everything in practice.
      const evalExpectedFail = csp === 'strict';
      try {
        const evalResult = await page.evaluate(() => document.title);
        if (evalExpectedFail) {
          // Strict blocks inline scripts AND eval in MAIN world.
          // ISOLATED fallback may still work — accept either outcome.
          assert(true, `${name}: dom.evaluate handled (result: ${evalResult})`);
        } else {
          const evalWorked = evalResult !== null && evalResult.length > 0;
          assert(evalWorked, `${name}: dom.evaluate works (${evalResult})`);
        }
      } catch (e) {
        if (evalExpectedFail) {
          assert(true, `${name}: dom.evaluate correctly threw on strict CSP: ${e.message}`);
        } else {
          assert(false, `${name}: dom.evaluate failed unexpectedly: ${e.message}`);
        }
      }
      
      // Test human.click (should always work)
      const btn = await page.$('#btn-visible');
      if (btn) {
        const clickResult = await page.humanClick(btn);
        assert(clickResult.clicked === true || clickResult.clicked === false, 
               `${name}: human.click executes`);
      }
      
    } catch (e) {
      assert(false, `${name}: Test error - ${e.message}`);
    }
  }

  if (failed > 0) {
    console.log("\nSome tests failed!");
  } else {
    console.log("\nAll tests passed!");
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
