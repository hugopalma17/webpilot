no bug---
name: human-browser
description: Skill for LLM agents to browse the web through the Human Browser WebSocket protocol. Covers navigation, interaction, data extraction, and recovery.
---

# Human Browser — LLM Navigation Skill

You control a real Chrome browser through WebSocket JSON messages (`ws://localhost:7331`). A Chrome extension receives your commands and executes them in-page with human-like behavior. You cannot see the page — you must look before every action.

## Mental Model

You are **blind**. The browser is a room you navigate by touch. Before every action:

1. **Look** — read the page (`dom.getHTML`, `dom.discoverElements`, `tabs.screenshot`)
2. **Think** — pick the right element from what you actually saw
3. **Act** — interact with it (`human.click`, `human.type`, `human.scroll`)
4. **Verify** — confirm the action worked (re-read, check URL, wait for expected element)

Never guess selectors. Never assume page state. Always look first.

## Wire Format

Every message you send:
```json
{ "id": "unique-id", "tabId": 123, "action": "action.name", "params": {} }
```

Every response you receive:
```json
{ "id": "same-id", "result": { ... } }
```

Or on error:
```json
{ "id": "same-id", "error": "message" }
```

You may also receive unsolicited events:
```json
{ "type": "event", "event": "urlChanged", "data": { "tabId": 123, "url": "..." } }
{ "type": "event", "event": "response", "data": { "url": "...", "status": 200, "tabId": 123 } }
```

Always use a unique `id` per request. Always include `tabId` (get it from `tabs.list`).

## Your Eyes

These are your tools for understanding the page. Use them constantly.

| Command | What it gives you | When to use |
|---------|-------------------|-------------|
| `dom.getHTML` | Full page HTML (title, url, html) | Understanding page structure, extracting data |
| `dom.discoverElements` | List of interactive elements with labels, roles, positions | Deciding what to click or type into |
| `dom.queryAllInfo` | Elements matching a selector with handleId, tag, id, class, text, label | Narrowing down from a known selector pattern |
| `tabs.screenshot` | Base64 PNG of the viewport | Visual debugging, understanding layout |
| `dom.findScrollable` | All scrollable containers with handleIds | Finding panels to scroll for more content |
| `dom.boundingBox` | Position and size of an element | Checking if element is visible/on-screen |

### Looking strategy

1. **First visit to a page**: Use `dom.getHTML` to understand the full structure. It returns raw HTML — parse it to find patterns, selectors, data attributes.
2. **Before clicking**: Use `dom.discoverElements` to see what's interactive, or `dom.queryAllInfo` with a candidate selector to find your target.
3. **After an action**: Use `dom.waitForSelector` on something you expect to appear, then look again to confirm.
4. **When lost**: `tabs.screenshot` gives you a visual snapshot. `dom.getHTML` gives you the truth.

## Your Hands

Two tiers of interaction commands exist. **Always prefer human commands.**

### Human commands (safe — use these)

Human commands include bezier cursor movement, randomized timing, honeypot detection, and avoid-rule checking. They behave like a real person.

| Command | Purpose | Key params |
|---------|---------|------------|
| `human.click` | Click an element | `handleId` or `selector`, optional `avoid` |
| `human.type` | Type text character-by-character | `text`, optional `handleId`/`selector` |
| `human.scroll` | Scroll a panel or the page | `handleId`/`selector`, `direction` |
| `human.clearInput` | Focus + select-all + delete | `handleId` or `selector` |

### Raw commands (direct — use only when you need precision)

| Command | Purpose |
|---------|---------|
| `dom.click` | Same pipeline as human.click (this IS the human pipeline) |
| `dom.type` | Direct text insertion, no per-character timing |
| `dom.keyPress` | Single key press (`Enter`, `Tab`, `Escape`, etc.) |
| `dom.keyDown` / `dom.keyUp` | Hold/release keys (for shortcuts like Ctrl+A) |
| `dom.scroll` | Direct scroll with exact pixel amount |
| `dom.focus` | Focus an element without clicking |
| `dom.setValue` | Set input value directly (for hidden fields, React state) |

### The avoid parameter

All human commands accept `avoid` — rules for elements that should never be interacted with:

```json
{
  "avoid": {
    "selectors": [".cookie-banner", "#popup-overlay"],
    "classes": ["sponsored", "ad-slot"],
    "ids": ["newsletter-signup"],
    "attributes": { "data-ad": "*", "data-tracking": "*" }
  }
}
```

If a human command returns `{ "clicked": false, "reason": "..." }`, the element was unsafe. Reasons include: `avoided`, `aria-hidden`, `no-offsetParent`, `honeypot-class`, `opacity-zero`, `visibility-hidden`, `sub-pixel`, `no-bounding-box`, `element-disappeared`, `element-shifted`. **Respect these. Do not retry the same element.**

## Navigation

### Going to a page

```json
{ "id": "1", "action": "tabs.navigate", "params": { "url": "https://example.com" } }
```

Then **wait for the page to load**:

```json
{ "id": "2", "action": "dom.waitForSelector", "params": { "selector": "body", "timeout": 10000 } }
```

Better: wait for a specific element you expect on that page, not just `body`.

### SPA navigation (clicking links instead of URL changes)

Many modern sites are single-page apps. Clicking a nav link doesn't trigger a full page load — it swaps content in-place. After clicking a link:

1. Wait for expected content: `dom.waitForSelector` with a selector unique to the destination
2. Do NOT rely on `urlChanged` events alone — the URL may update before content renders
3. If content doesn't appear within timeout, re-read the page with `dom.getHTML`

### Tab management

```json
{ "id": "1", "action": "tabs.list", "params": {} }
{ "id": "2", "action": "tabs.create", "params": { "url": "https://example.com" } }
{ "id": "3", "action": "tabs.activate", "params": {}, "tabId": 456 }
{ "id": "4", "action": "tabs.close", "params": {}, "tabId": 456 }
```

Always `tabs.list` first to get the `tabId` you need. Commands sent without `tabId` go to the active tab.

## Recipes

### Recipe: Fill and submit a search form

```
1. dom.getHTML                                    → find the search input selector
2. human.click    { selector: "#search-input" }   → focus the input
3. human.type     { text: "my query" }            → type the search
4. dom.keyPress   { key: "Enter" }                → submit
5. dom.waitForSelector { selector: ".results" }   → wait for results
6. dom.getHTML                                    → read results
```

### Recipe: Scroll through a list and collect items

```
1. dom.findScrollable                             → find scrollable panels
2. dom.getHTML                                    → read initial content
3. human.scroll   { handleId: "el_7", direction: "down" }  → scroll down
4. sleep 1-2s                                     → let content render
5. dom.getHTML                                    → read new content
6. Repeat 3-5 until you have enough or scroll stops moving
```

Use `dom.scroll` return values (`before`, `after`) to detect when you've hit the bottom: if `before === after`, there's nothing more to scroll.

### Recipe: Navigate a multi-page flow (e.g., checkout, wizard)

```
1. dom.getHTML                                    → understand current step
2. Fill in fields (human.click → human.type for each)
3. human.click    { selector: "button.next" }     → advance
4. dom.waitForSelector { selector: ".step-2" }    → wait for next step
5. dom.getHTML                                    → understand new step
6. Repeat until done
```

### Recipe: Handle a login form

```
1. dom.getHTML                                    → find email/password fields
2. human.click    { selector: "#email" }
3. human.type     { text: "user@example.com" }
4. human.click    { selector: "#password" }
5. human.type     { text: "password123" }
6. human.click    { selector: "button[type='submit']" }
7. dom.waitForSelector { selector: ".dashboard" } → wait for post-login page
```

If the site uses 2FA or CAPTCHA, you'll need to detect that from the DOM and handle accordingly.

### Recipe: Extract data from a detail page

```
1. dom.getHTML                                    → get full page HTML
2. Parse the HTML to find the data you need
3. If data is in specific elements:
   dom.queryAllInfo  { selector: ".product-card" }   → get handles + text summary
   dom.elementHTML   { handleId: "el_3" }            → get full HTML of one card
4. If data requires page JS globals (rare):
   dom.evaluate      { fn: "() => window.__DATA__" } → may fail on strict CSP sites
```

Prefer `dom.getHTML` + `dom.elementHTML` over `dom.evaluate`. They work on all sites regardless of CSP.

## Waiting

**This is the #1 source of failures.** Pages don't load instantly. SPAs swap content asynchronously. After every navigation or interaction that changes the page:

- **Use `dom.waitForSelector`** with a selector you expect to appear
- **Set a reasonable timeout** (5000-10000ms for navigation, 3000ms for in-page changes)
- **If the wait times out**, don't retry blindly — re-read the page with `dom.getHTML` to understand what actually happened

```json
{ "id": "1", "action": "dom.waitForSelector", "params": { "selector": ".results-loaded", "timeout": 8000 } }
```

Do NOT use fixed sleeps as a substitute for `waitForSelector`. Fixed sleeps are for behavioral pacing (looking human), not for waiting on page state.

## Recovery

Things go wrong. Handles go stale, pages redirect, elements disappear.

### Stale handle

If a command returns an error about an invalid handleId, the element was garbage-collected or the page navigated. **Re-query the selector:**

```
1. dom.querySelector { selector: "the-same-selector" }  → get fresh handleId
2. Retry your action with the new handleId
```

### Unexpected page

If after clicking you end up somewhere unexpected:
1. Check the URL: `dom.getHTML` returns `url` in its result
2. If wrong page: `tabs.navigate` back, or click the browser back button via `dom.evaluate`
3. If a popup/modal appeared: look for a close button, click it, then retry

### Element blocked

If `human.click` returns `{ clicked: false }`:
- `reason: "avoided"` — your avoid rules blocked it. Check if the rules are too aggressive.
- `reason: "no-offsetParent"` or `sub-pixel` — element is hidden or off-screen. Scroll first.
- `reason: "honeypot-class"` — genuine trap. Do not click.
- `reason: "element-disappeared"` — re-query and retry.
- `reason: "element-shifted"` — page was still loading. Wait, then retry.

### Timeout

If a command times out (30s default), the extension may be disconnected or the page is unresponsive.
1. Try `tabs.list` — if it works, the extension is alive
2. Try targeting a different tab or reloading: `tabs.reload`
3. If nothing responds, the server or extension may need restart

## Selector Strategy

**Never guess selectors.** Always derive them from what you see in `dom.getHTML` or `dom.discoverElements`.

Good selector sources (most to least stable):
1. **IDs**: `#login-form` — unique, stable
2. **Data attributes**: `[data-testid="submit"]`, `[aria-label="Search"]` — designed for automation
3. **Semantic HTML**: `button[type="submit"]`, `input[name="email"]`, `nav a[href="/about"]`
4. **Role attributes**: `[role="dialog"]`, `[role="navigation"]`
5. **Structural**: `.header > nav > ul > li:first-child a` — fragile, use as last resort

Bad selectors (avoid these):
- Hashed class names (`.css-1a2b3c`, `.sc-bZQynM`) — change every build
- Deep structural paths — break on any DOM change
- Guessed/assumed selectors you haven't verified in the actual HTML

### When you can't find a good selector

Use `dom.discoverElements` — it returns interactive elements with their labels, roles, and types. Pick from that list. Or use `dom.queryAllInfo` with a broad selector (like `button` or `a`) and filter by the `text` or `label` field.

## CSP Compatibility

The extension runs in Chrome's ISOLATED world (content script context). Most commands are immune to Content Security Policy restrictions.

**Always works (CSP-safe):** `dom.getHTML`, `dom.querySelector*`, `dom.queryAllInfo`, `dom.elementHTML`, `dom.findScrollable`, `dom.discoverElements`, `human.*`, `tabs.*`, `cookies.*`, `frames.list`

**May fail on strict-CSP sites:** `dom.evaluate`, `dom.elementEvaluate` — these try MAIN world first, fall back to ISOLATED. When falling back, they can access the DOM but NOT page JavaScript globals.

If you need page globals (`window.__INITIAL_STATE__`) and the site has strict CSP, that data is not accessible. Extract from the rendered DOM instead.

CSP errors in the browser console are harmless — sites cannot detect them.

## Do Not

- Do not guess selectors — always look at the page first
- Do not skip waiting after navigation — pages need time to render
- Do not retry a blocked click without understanding the reason
- Do not use `dom.evaluate` when `dom.getHTML` or `dom.elementHTML` would work
- Do not send commands without a `tabId` unless you're sure which tab is active
- Do not treat `human.click` returning `{ clicked: false }` as an error to force through — it's the extension protecting you
