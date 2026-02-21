/**
 * raw-dispatch-failures.js
 *
 * Demonstrates every way vanilla JS dispatch (el.click(), dispatchEvent) fails
 * to behave like a real user, then contrasts with human.click / dom.click
 * which run the full human pipeline.
 *
 * Labels:
 *   DEMONSTRATES — raw approach does something a bot detector could catch /
 *                  a site owner could exploit.
 *   CONTRAST     — human.click / dom.click handles the case correctly.
 *
 * Run with the test server already up:
 *   node test/server.js               (separate terminal)
 *   node test/raw-dispatch-failures.js
 */

const { connectToServer } = require("../index");

// Raw dispatch demonstrations need dom.evaluate to work → no CSP.
// CSP behavior is tested separately in section 9.
const FIXTURES_URL      = "http://localhost:3456/raw-fixtures.html";
const FIXTURES_STRICT   = "http://localhost:3456/raw-fixtures.html?csp=strict";
const FIXTURES_UNSAFE_I = "http://localhost:3456/raw-fixtures.html?csp=unsafeInline";

let passed = 0;
let failed = 0;

function section(title) {
  console.log(`\n${"─".repeat(62)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(62)}\n`);
}

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓  ${message}`);
  } else {
    failed++;
    console.error(`  ✗  ${message}`);
  }
}

async function nav(page) {
  await page.goto(FIXTURES_URL);
  await page.waitForSelector("#ready");
  await new Promise((r) => setTimeout(r, 150)); // let page listeners settle
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function main() {
  const page = await connectToServer();

  // ── 1. isTrusted ─────────────────────────────────────────
  section("1 · SYNTHETIC EVENT DETECTABILITY  (isTrusted)");

  await nav(page);

  await page.evaluate(() => {
    window.__lastIsTrusted = null;
    document.getElementById("btn-istrusted").click();
  });
  const isTrustedElClick = await page.evaluate(() => window.__lastIsTrusted);
  assert(
    isTrustedElClick === false,
    "DEMONSTRATES: el.click()      → event.isTrusted = false  (bot-detectable)",
  );

  await page.evaluate(() => {
    window.__lastIsTrusted = null;
    document
      .getElementById("btn-istrusted")
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  const isTrustedDispatch = await page.evaluate(() => window.__lastIsTrusted);
  assert(
    isTrustedDispatch === false,
    "DEMONSTRATES: dispatchEvent() → event.isTrusted = false  (bot-detectable)",
  );

  // ── 2. Event sequence ────────────────────────────────────
  section("2 · INCOMPLETE EVENT SEQUENCE");

  await nav(page);

  await page.evaluate(() => {
    window.__eventSeq = [];
    const el = document.getElementById("btn-sequence");
    el.addEventListener("mousedown", () => window.__eventSeq.push("mousedown"));
    el.addEventListener("mouseup",   () => window.__eventSeq.push("mouseup"));
    el.addEventListener("click",     () => window.__eventSeq.push("click"));
    el.click();
  });
  const seq = await page.evaluate(() => window.__eventSeq);
  assert(seq.includes("click"), "el.click() fires click event");
  assert(
    !seq.includes("mousedown"),
    `DEMONSTRATES: el.click() skips mousedown  (got: [${seq}])`,
  );
  assert(
    !seq.includes("mouseup"),
    `DEMONSTRATES: el.click() skips mouseup    (got: [${seq}])`,
  );

  // CONTRAST: human.click dispatches mousedown → mouseup → click
  await nav(page);
  await page.evaluate(() => {
    window.__eventSeq = [];
    const el = document.getElementById("btn-sequence");
    el.addEventListener("mousedown", () => window.__eventSeq.push("mousedown"));
    el.addEventListener("mouseup",   () => window.__eventSeq.push("mouseup"));
    el.addEventListener("click",     () => window.__eventSeq.push("click"));
  });
  await page.humanClick(await page.$("#btn-sequence"));
  const humanSeq = await page.evaluate(() => window.__eventSeq);
  assert(
    humanSeq.includes("mousedown"),
    `CONTRAST:     human.click dispatches mousedown  (got: [${humanSeq}])`,
  );
  assert(
    humanSeq.includes("mouseup"),
    `CONTRAST:     human.click dispatches mouseup    (got: [${humanSeq}])`,
  );
  assert(
    humanSeq.includes("click"),
    `CONTRAST:     human.click dispatches click      (got: [${humanSeq}])`,
  );

  // ── 3. Coordinates ───────────────────────────────────────
  section("3 · ZERO COORDINATES IN SYNTHETIC EVENTS");

  await nav(page);

  await page.evaluate(() => {
    window.__lastCoords = null;
    document.getElementById("btn-coords").addEventListener("click", (e) => {
      window.__lastCoords = { clientX: e.clientX, clientY: e.clientY };
    });
    document.getElementById("btn-coords").click();
  });
  const rawCoords = await page.evaluate(() => window.__lastCoords);
  assert(
    rawCoords !== null && rawCoords.clientX === 0 && rawCoords.clientY === 0,
    `DEMONSTRATES: el.click() has no coordinates (clientX=${rawCoords?.clientX}, clientY=${rawCoords?.clientY})`,
  );

  // CONTRAST: human.click carries real viewport coordinates
  await nav(page);
  await page.evaluate(() => {
    window.__lastCoords = null;
    document.getElementById("btn-coords").addEventListener("click", (e) => {
      window.__lastCoords = { clientX: e.clientX, clientY: e.clientY };
    });
  });
  await page.humanClick(await page.$("#btn-coords"));
  const humanCoords = await page.evaluate(() => window.__lastCoords);
  assert(
    humanCoords !== null && (humanCoords.clientX > 0 || humanCoords.clientY > 0),
    `CONTRAST:     human.click carries real coords (clientX=${humanCoords?.clientX}, clientY=${humanCoords?.clientY})`,
  );

  // ── 4. Overlay bypass ────────────────────────────────────
  section("4 · OVERLAY BYPASS");

  await nav(page);

  // Raw: directly targets the buried element, ignoring what's on top
  await page.evaluate(() => {
    window.__underClicked  = 0;
    window.__overlayClicked = 0;
    document.getElementById("btn-under-overlay").addEventListener("click", () => { window.__underClicked++; });
    document.getElementById("btn-overlay").addEventListener("click",       () => { window.__overlayClicked++; });
    document.getElementById("btn-under-overlay").click();
  });
  const underRaw   = await page.evaluate(() => window.__underClicked);
  const overlayRaw = await page.evaluate(() => window.__overlayClicked);
  assert(
    underRaw > 0,
    "DEMONSTRATES: el.click() fires on element even when another element covers it",
  );
  assert(
    overlayRaw === 0,
    "DEMONSTRATES: el.click() bypasses the overlay entirely (wrong element receives event)",
  );

  // CONTRAST: human.click moves cursor to the target's coordinates.
  // document.elementFromPoint at those coords returns the overlay, so the
  // overlay receives the event — matching what a real user click would do.
  await nav(page);
  await page.evaluate(() => {
    window.__underClicked  = 0;
    window.__overlayClicked = 0;
    document.getElementById("btn-under-overlay").addEventListener("click", () => { window.__underClicked++; });
    document.getElementById("btn-overlay").addEventListener("click",       () => { window.__overlayClicked++; });
  });
  await page.humanClick(await page.$("#btn-under-overlay"));
  const underHuman   = await page.evaluate(() => window.__underClicked);
  const overlayHuman = await page.evaluate(() => window.__overlayClicked);
  assert(
    overlayHuman > 0,
    "CONTRAST:     human.click dispatches on overlay (element physically at those coordinates)",
  );
  assert(
    underHuman === 0,
    "CONTRAST:     human.click does NOT fire on the buried element",
  );

  // ── 5. Traps: raw dispatch fires on all ──────────────────
  section("5 · TRAP ELEMENTS  —  RAW DISPATCH FIRES ON ALL");

  const TRAPS = [
    { id: "trap-honeypot",   label: "honeypot class (ghost sr-only)"  },
    { id: "trap-aria",       label: "aria-hidden=\"true\""             },
    { id: "trap-opacity",    label: "opacity: 0"                      },
    { id: "trap-visibility", label: "visibility: hidden"              },
    { id: "trap-tiny",       label: "1×1 sub-pixel element"           },
    { id: "trap-offscreen",  label: "position offscreen (−9999px)"    },
  ];

  await nav(page);

  for (const { id, label } of TRAPS) {
    const key = `__${id.replace(/-/g, "_")}_clicked`;
    // Template-string evaluate so id/key are embedded literally, no arg-passing
    await page.evaluate(`() => {
      window['${key}'] = 0;
      const el = document.getElementById('${id}');
      if (el) {
        el.addEventListener('click', () => { window['${key}']++; });
        el.click();
      }
    }`);
    const count = await page.evaluate(`() => window['${key}'] || 0`);
    assert(count > 0, `DEMONSTRATES: el.click() fires on ${label}`);
  }

  // ── 6. Traps: human.click blocks all ─────────────────────
  section("6 · TRAP ELEMENTS  —  human.click BLOCKS ALL");

  await nav(page);

  for (const { id, label } of TRAPS) {
    const el = await page.$(`#${id}`);
    if (!el) { assert(false, `element not found: #${id}`); continue; }
    const result = await page.humanClick(el);
    assert(
      result.clicked === false,
      `CONTRAST: human.click blocks ${label}  (reason: ${result.reason})`,
    );
  }

  // ── 7. dom.click routes through human pipeline ───────────
  section("7 · dom.click NOW RUNS THE FULL HUMAN PIPELINE");

  await nav(page);

  for (const { id, label } of TRAPS) {
    const result = await page._send("dom.click", { selector: `#${id}` });
    assert(
      result.clicked === false,
      `dom.click blocks ${label}  (reason: ${result.reason})`,
    );
  }

  // dom.click on a safe, visible element must succeed
  await page.evaluate(() => { window.__visibleClicked = 0; });
  await page.evaluate(() => {
    document.getElementById("btn-visible").addEventListener("click", () => {
      window.__visibleClicked++;
    });
  });
  const domClickVisible = await page._send("dom.click", { selector: "#btn-visible" });
  assert(domClickVisible.clicked === true, "dom.click succeeds on safe visible element");
  const visibleCount = await page.evaluate(() => window.__visibleClicked);
  assert(visibleCount > 0, "dom.click dispatches the click event to the page");

  // ── 8. Disappearing element ──────────────────────────────
  section("8 · DISAPPEARING ELEMENT DURING INTERACTION");

  // Raw: fires before element can be removed
  await nav(page);
  await page.evaluate(() => {
    window.__trap_disappear_clicked = 0;
    const el = document.getElementById("trap-disappear");
    el.style.display = "block";
    el.addEventListener("click", () => { window.__trap_disappear_clicked++; });
    el.click(); // synchronous — element not gone yet
    setTimeout(() => el.remove(), 50);
  });
  const rawDisappear = await page.evaluate(() => window.__trap_disappear_clicked);
  assert(
    rawDisappear > 0,
    "DEMONSTRATES: el.click() fires before element removal can be detected",
  );

  // CONTRAST: human.click has a think-time delay of 200–500 ms.
  // Element is removed after 50 ms — well inside the window — so the
  // "element-disappeared" check fires before the click is dispatched.
  await nav(page);
  await page.evaluate(() => {
    window.__trap_disappear_clicked = 0;
    const el = document.getElementById("trap-disappear");
    el.style.display = "block";
    el.addEventListener("click", () => { window.__trap_disappear_clicked++; });
    setTimeout(() => el.remove(), 50);
  });
  const disappearEl    = await page.$(`#trap-disappear`);
  const humanDisappear = await page.humanClick(disappearEl);
  const disappearCount = await page.evaluate(() => window.__trap_disappear_clicked);
  assert(
    humanDisappear.clicked === false,
    `CONTRAST: human.click detects element disappeared during delay  (reason: ${humanDisappear.reason})`,
  );
  assert(
    disappearCount === 0,
    "CONTRAST: human.click does not fire on disappeared element",
  );

  // ── 9. CSP enforcement kills dom.evaluate injection ──────
  section("9 · STRICT CSP KILLS CODE INJECTION  (dom.evaluate)");

  // Sections 1-8 needed dom.evaluate to work.
  // Under strict CSP, new Function() is blocked in MAIN world and the
  // ISOLATED fallback also returns null — injection is dead.
  for (const { url, label } of [
    { url: FIXTURES_STRICT,   label: "strict CSP (no unsafe-eval, no unsafe-inline)" },
    { url: FIXTURES_UNSAFE_I, label: "unsafe-inline CSP (has unsafe-inline, lacks unsafe-eval)" },
  ]) {
    await page.goto(url);
    await page.waitForSelector("#ready");
    await new Promise((r) => setTimeout(r, 150));

    // dom.evaluate in MAIN world is blocked
    const evalResult = await page.evaluate(() => document.querySelector("#btn-visible") ? "found" : "missing");
    assert(
      evalResult === null,
      `DEMONSTRATES: dom.evaluate returns null under ${label}`,
    );

    // human.click still works (ISOLATED world, no eval needed)
    const el = await page.$(`#btn-visible`);
    const clickResult = await page.humanClick(el);
    assert(
      clickResult.clicked === true,
      `CONTRAST: human.click works under ${label}`,
    );

    // dom.click still works (same pipeline)
    const domClick = await page._send("dom.click", { selector: "#btn-visible" });
    assert(
      domClick.clicked === true,
      `CONTRAST: dom.click works under ${label}`,
    );
  }

  // ── Summary ──────────────────────────────────────────────
  console.log(`\n${"═".repeat(62)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`${"═".repeat(62)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
