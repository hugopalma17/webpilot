---
name: human-browser
description: Use this skill when an LLM/subagent needs to navigate websites and interact with pages through the Human Browser WebSocket framework instead of Puppeteer/Playwright/CDP.
---

# Human Browser Subagent Skill

Use this skill when an LLM/subagent needs to navigate websites and interact with pages through the Human Browser WebSocket framework instead of Puppeteer/Playwright/CDP.

## Scope

- Drive browser behavior through `ws://localhost:7331`.
- Use protocol actions from `protocol/PROTOCOL.md`.
- Prefer human-like actions (`human.*`) for user-facing interactions.
- Keep DOM reads and extraction via `dom.*`.

## Preconditions

- Framework server is running (`node index.js`).
- Extension is connected.
- Client can open WebSocket and send JSON.

## Trigger Conditions

Apply this skill when the task includes any of:

- "navigate site"
- "click/type/scroll like a human"
- "avoid traps/honeypots"
- "browser automation via websocket"
- "language-agnostic browser scripting"

## Operating Rules

- Use `human.click` for clickable UI interactions.
- Use `human.type` for typing text into focused fields.
- Use `human.scroll` for scrolling panels/pages.
- Use `human.clearInput` before replacing text in inputs.
- Use `dom.querySelector` and `dom.waitForSelector` before interacting.
- Use `dom.evaluate`/`dom.elementEvaluate` for extraction only.
- Treat hidden/ghost/offscreen/tiny targets as unsafe unless explicitly required.

## Standard Interaction Flow

1. `tabs.list`
2. `tabs.navigate` to target URL
3. `dom.waitForSelector` on a known stable element
4. `dom.querySelector` for actionable element
5. `human.click` to focus/open
6. `human.type` or keyboard command as needed
7. `human.scroll` if content is off-screen
8. `dom.evaluate` to validate result state

## Reliability Patterns

- Always include unique request `id`.
- Match responses by `id`.
- Handle unsolicited events: `response`, `urlChanged`.
- On timeout, retry with a fresh selector query.
- On element-handle errors, re-query selector and continue.
- On route drift, re-navigate to canonical URL and resume.

## Safety Patterns

- Use `avoid` filters in `human.click` for known bad classes/selectors.
- Respect `clicked:false` with reason; do not force-click hidden traps.
- Re-validate target URL after key navigation actions.

## Command Templates

### Navigate

```json
{ "id": "1", "action": "tabs.navigate", "params": { "url": "https://example.com" } }
```

### Find Element

```json
{ "id": "2", "action": "dom.querySelector", "params": { "selector": "button[type='submit']" } }
```

### Human Click With Avoid

```json
{
  "id": "3",
  "action": "human.click",
  "params": {
    "selector": "button[type='submit']",
    "avoid": {
      "classes": ["sponsored", "ad-slot"],
      "selectors": [".popup-close"],
      "ids": ["tracking-only"],
      "attributes": { "data-honeypot": "*" }
    }
  }
}
```

### Human Type

```json
{ "id": "4", "action": "human.type", "params": { "text": "query text" } }
```

### Read Result

```json
{ "id": "5", "action": "dom.evaluate", "params": { "fn": "() => document.title", "args": [] } }
```

## Output Expectations For Subagents

- Report actions performed in order.
- Report blocked interactions with exact `reason` values.
- Report final URL and extraction results.
- Report retries/fallbacks used.

## CSP (Content Security Policy) Guidance

### Understanding CSP in This Framework

The Human Browser runs in a Chrome extension with two JavaScript execution contexts:

**ISOLATED World** (Content Script) - Always available, CSP-safe:
- Full DOM access (`querySelector`, `getHTML`, etc.)
- Human interactions (`human.click`, `human.type`, `human.scroll`)
- Safe for ALL websites regardless of CSP

**MAIN World** (Page Context) - CSP-restricted:
- Access to page globals (`window.__INITIAL_STATE__`)
- May fail on sites with strict CSP (`script-src 'self'`)
- Automatically falls back to ISOLATED on failure

### CSP-Safe Operations (Always Work)

These commands work on **all sites**, including CSP-strict ones:

| Command | Use Case |
|---------|----------|
| `dom.getHTML` | Get full page HTML |
| `dom.querySelector` / `dom.querySelectorAll` | Find elements |
| `dom.discoverElements` | List all interactive elements |
| `human.click` | Click elements safely |
| `human.type` | Type text human-like |
| `human.scroll` | Scroll pages/panels |
| `page.content()` | Get page HTML (uses `dom.getHTML`) |

### When CSP Errors Appear

**CSP errors in the DevTools console are harmless and expected.**

Sites with strict CSP will show errors like:
```
EvalError: Evaluating a string as JavaScript violates CSP
```

**This is NOT a problem:**
- Sites cannot detect these client-side errors
- Fallback mechanisms activate automatically
- Normal browsers also show these errors on CSP sites
- No server-side detection possible

### Anti-Detection Advantage

Unlike Puppeteer/Playwright (CDP-based), this extension:

| Detection Method | CDP | Extension |
|------------------|-----|-----------|
| Remote debugging port | Exposed (9222) | None |
| `navigator.webdriver` | `true` | Undefined |
| Chrome APIs | Missing | Present |
| CSP console errors | Visible | Same as normal browsing |

### Best Practices

1. **Prefer ISOLATED world** - Use `dom.getHTML`, `querySelector`, `human.*` for most operations
2. **Extract from rendered DOM** - After clicking/scrolling, read the HTML that was rendered
3. **Use data attributes** - Sites often store data in `data-*` attributes (stable across redesigns)
4. **Ignore CSP errors** - They're invisible to server-side detection
5. **Use MAIN world only when needed** - Only for accessing page JavaScript globals

### Example: CSP-Safe Data Extraction

```javascript
// [YES] CSP-safe: Extract from rendered DOM
const jobs = await page.evaluate(() => {
  const cards = document.querySelectorAll('[data-view-name="job-card"]');
  return Array.from(cards).map(card => ({
    title: card.querySelector('h3')?.textContent,
    company: card.querySelector('.company')?.textContent,
    // Read from data attributes (very stable)
    jobId: card.getAttribute('data-job-id')
  }));
});

// [WARN] CSP-restricted: Access page globals (may fail on strict CSP)
const state = await page.evaluate(() => {
  return window.__INITIAL_STATE__; // Requires MAIN world
});
```

## Do Not

- Do not depend on Puppeteer/Playwright/CDP APIs.
- Do not bypass human safety checks by default.
- Do not assume one selector works across all pages without fallback.
- Do not worry about CSP console errors - they are harmless to detection.
