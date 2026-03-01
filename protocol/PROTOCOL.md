# Human Browser Protocol

CDP-free browser automation over WebSocket. Any language can connect and send commands.

## Connection

```
WebSocket: ws://localhost:7331
```

The Human Browser server listens on this port. The Chrome extension auto-connects on launch. Your client connects to the same server — commands are relayed to the extension.

## Message Format

### Request (Client → Server)
```json
{
  "id": "unique-string",
  "tabId": 123,
  "action": "action.name",
  "params": {}
}
```

- `id` — correlate responses. Use any unique string (UUID recommended).
- `tabId` — target tab. If omitted, defaults to the active tab.
- `action` — the command to execute.
- `params` — action-specific parameters.

### Response (Server → Client)
```json
{ "id": "same-id", "result": {} }
```
or on error:
```json
{ "id": "same-id", "error": "error message" }
```

### Events (Server → Client, unsolicited)
```json
{ "type": "event", "event": "response", "data": { "url": "...", "status": 200, "tabId": 123, "method": "GET" } }
{ "type": "event", "event": "urlChanged", "data": { "tabId": 123, "url": "https://..." } }
```

### Keepalive
Server sends `{ "type": "ping" }` every 20s. Extension responds with `{ "type": "pong" }`.

## Command Timeout
All commands time out after **30 seconds**.

---

## Element Handles

Many commands return or accept `handleId` strings (e.g., `"el_42"`). These are references to DOM elements stored in the extension's content script.

- Created by `dom.querySelector`, `dom.querySelectorAll`, `dom.waitForSelector`
- Used by `dom.click`, `dom.boundingBox`, `human.click`, etc.
- Internally stored as `WeakRef` — auto-cleaned after configurable inactivity TTL (default 15 minutes) or if the element is garbage-collected
- Most commands accept either `handleId` OR `selector` — if both are provided, `handleId` takes priority

### Framework Runtime Config

The extension runtime is configurable through:

| Action | Params | Returns |
|--------|--------|---------|
| `framework.setConfig` | `{ config: { handles?: { ttlMs?, cleanupIntervalMs? }, debug?: { cursor?, devtools?, sessionLog? } } }` | `{ ok: true, framework }` |
| `framework.getConfig` | `{}` | `{ framework, version }` |
| `framework.reload` | `{}` | `{ reloading: true }` — force-reloads extension (picks up new code) |

For normal use, the Node bridge automatically injects framework config from `human-browser.config.js` into `dom.*` and `human.*` commands.
You can also update/read it explicitly with `framework.setConfig` and `framework.getConfig`.

---

## Actions: Tab Management

| Action | Params | Returns |
|--------|--------|---------|
| `tabs.list` | `{}` | `[{ id, url, title, active, windowId, index }]` |
| `tabs.navigate` | `{ url }` | `{ success: true }` |
| `tabs.create` | `{ url? }` | `{ id, url, title }` |
| `tabs.close` | `{}` | `{ success: true }` |
| `tabs.activate` | `{}` | `{ success: true }` |
| `tabs.reload` | `{}` | `{ success: true }` |
| `tabs.waitForNavigation` | `{ timeout? }` | `{ success: true }` |
| `tabs.setViewport` | `{ width, height }` | `{ success: true }` |
| `tabs.screenshot` | `{ fullPage? }` | `{ dataUrl }` (base64 PNG) |

## Actions: Frames

| Action | Params | Returns |
|--------|--------|---------|
| `frames.list` | `{}` | `[{ frameId, parentFrameId, url }]` — all frames in the tab (requires `webNavigation` permission) |

## Actions: Cookies

| Action | Params | Returns |
|--------|--------|---------|
| `cookies.getAll` | `{ url? }` | `[{ name, value, domain, ... }]` |
| `cookies.set` | `{ cookie: { name, value, domain?, path?, secure?, httpOnly?, sameSite?, expires? } }` | `{ success: true }` |

## Actions: DOM

> **Note:** `dom.click` runs the full human pipeline (honeypot detection, bezier cursor movement, scroll into view, think-time delay). It is equivalent to `human.click`. All other `dom.*` commands are raw and direct.

| Action | Params | Returns |
|--------|--------|---------|
| `dom.querySelector` | `{ selector }` | `handleId` or `null` |
| `dom.querySelectorAll` | `{ selector }` | `[handleId, ...]` |
| `dom.querySelectorWithin` | `{ parentHandleId, selector }` | `handleId` or `null` |
| `dom.querySelectorAllWithin` | `{ parentHandleId, selector }` | `[handleId, ...]` |
| `dom.waitForSelector` | `{ selector, timeout? }` | `handleId` or `null` |
| `dom.boundingBox` | `{ handleId \| selector }` | `{ x, y, width, height }` or `null` |
| `dom.click` | `{ handleId \| selector, clickCount?, avoid? }` | `{ clicked: true }` or `{ clicked: false, reason }` |
| `dom.mouseMoveTo` | `{ handleId \| selector }` | `{ x, y }` |
| `dom.focus` | `{ handleId \| selector }` | `{ focused: true }` |
| `dom.type` | `{ text, handleId?, selector? }` | `{ typed: true }` |
| `dom.keyPress` | `{ key }` | `{ pressed: true }` |
| `dom.keyDown` | `{ key }` | `{ down: true }` |
| `dom.keyUp` | `{ key }` | `{ up: true }` |
| `dom.scroll` | `{ handleId? \| selector?, direction?, amount?, behavior? }` | `{ scrolled: true, before, after, target }` |
| `dom.setValue` | `{ handleId \| selector, value }` | `{ set: true }` |
| `dom.getAttribute` | `{ handleId \| selector, name }` | string or `null` |
| `dom.getProperty` | `{ handleId \| selector, name }` | any |
| `dom.evaluate` | `{ fn, args? }` | any (serializable) |
| `dom.elementEvaluate` | `{ handleId, fn, args? }` | any (serializable) |
| `dom.evaluateHandle` | `{ fn, args?, elementMarkers? }` | `{ type, handleId?, value?, properties? }` |
| `dom.getHTML` | `{}` | `{ html, title, url }` — full page HTML from ISOLATED world (CSP-safe) |
| `dom.elementHTML` | `{ handleId, limit? }` | `{ outer, inner, tag }` — element HTML (default limit 5000 chars) |
| `dom.queryAllInfo` | `{ selector }` | `[{ handleId, tag, id, cls, text, label }]` — query + snapshot in one call |
| `dom.batchQuery` | `{ selectors: [...] }` | `{ [selector]: boolean }` — check existence of multiple selectors |
| `dom.findScrollable` | `{}` | `[{ handleId, tag, id, cls, overflowY, overflow, scrollHeight, clientHeight, children, text }]` |
| `dom.discoverElements` | `{}` | `{ elements, cursor, viewport, scrollY }` |
| `dom.setDebug` | `{ enabled }` | `{ debug: boolean }` |

### Key Names for Keyboard Commands
`Meta`, `Control`, `Shift`, `Alt`, `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `Space`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`, or single characters (`a`, `5`), or code format (`KeyA`, `Digit5`).

---

## Actions: Human (Safe)

Human commands include built-in safety checks (honeypot detection, bezier cursor movement, random timing). They accept an optional `avoid` parameter and receive timing config from the server's `human-browser.config.js`.

### human.click

```json
{
  "action": "human.click",
  "params": {
    "handleId": "el_42",
    "avoid": {
      "selectors": [".premium-upsell"],
      "classes": ["sponsored"],
      "ids": ["popup-cta"],
      "attributes": { "data-ad": "*" }
    }
  }
}
```

**Returns** (success): `{ "clicked": true }`
**Returns** (blocked): `{ "clicked": false, "reason": "...", "detail": "..." }`

**Built-in safety checks** (always run, in order):
1. `avoid` rules match → `reason: "avoided"`
2. aria-hidden → `reason: "aria-hidden"`
3. No offsetParent (hidden) → `reason: "no-offsetParent"`
4. Honeypot class names (ghost, sr-only, visually-hidden, trap, honey, offscreen) → `reason: "honeypot-class"`
5. Opacity zero → `reason: "opacity-zero"`
6. Visibility hidden → `reason: "visibility-hidden"`
7. Sub-pixel size (< 5px) → `reason: "sub-pixel"`
8. No bounding box → `reason: "no-bounding-box"`
9. Scroll element into comfortable view (`scrollIntoView` + fallback human scroll steps)
10. If cursor is within 80px of target, drift to a random nearby point first (avoids teleport-click appearance)
11. Bezier mouse movement to element (overshoot path if dist > 200px)
12. Random think-time delay (150-400ms default)
13. Element disappeared during delay → `reason: "element-disappeared"`
14. Element shifted > 50px during delay → `reason: "element-shifted"`
15. Dispatch `mousedown → mouseup → click` on `document.elementFromPoint(cursorX, cursorY)` — if nothing is at cursor coordinates, click aborts

### human.type

```json
{
  "action": "human.type",
  "params": {
    "text": "Hello world",
    "selector": "#search-input",
    "avoid": { "classes": ["disabled"] }
  }
}
```

**Returns**: `{ "typed": true }` or `{ "typed": false, "reason": "avoided" }`

Typing behavior:
- Per-character dispatch with random delays (80-180ms ± 25ms)
- 12% chance of "thinking pause" (150-400ms) between characters
- Minimum 50ms per character
- Uses native value setter for React/framework compatibility

### human.scroll

```json
{
  "action": "human.scroll",
  "params": {
    "handleId": "el_7",
    "direction": "down"
  }
}
```

Accepts `handleId`, `selector`, or neither (scrolls window). If the target element is scrollable, scrolls it; otherwise scrolls the window.

**Returns**: `{ "scrolled": true, "amount": 487 }`

Scroll behavior:
- Random scroll amount (250-550px default)
- Smooth scrolling with flick-style sub-scrolls
- 10% chance of small back-scroll for realism
- Scrolls the specified element if scrollable, otherwise scrolls the window

### human.clearInput

```json
{
  "action": "human.clearInput",
  "params": { "selector": "#email-input" }
}
```

**Returns**: `{ "cleared": true }` or click failure response

Behavior:
1. `human.click` to focus (runs all safety checks)
2. Triple-click with human timing to select all text
3. Backspace to delete

---

## The `avoid` Parameter

All `human.*` commands accept `avoid`:

```json
{
  "avoid": {
    "selectors": [".cookie-banner", "#popup button"],
    "classes": ["sponsored", "ad-slot"],
    "ids": ["newsletter-signup"],
    "attributes": { "data-ad": "*", "data-tracking": "*" }
  }
}
```

- **selectors**: CSS selectors. Checks `el.matches(sel)` and `el.closest(sel)`.
- **classes**: Class names. Checks `el.classList.contains(cls)` and ancestors.
- **ids**: Element IDs. Checks `el.id` and ancestors.
- **attributes**: Attribute presence. `"*"` means any value; otherwise exact match.

Per-request `avoid` merges with (doesn't replace) the global avoid config from `human-browser.config.js`.

---

## Events

### `response`
Fired when an HTTP request completes in any tab.
```json
{ "type": "event", "event": "response", "data": { "url": "https://...", "status": 200, "tabId": 123, "method": "GET" } }
```

### `urlChanged`
Fired when a tab's URL changes (navigation, pushState, replaceState).
```json
{ "type": "event", "event": "urlChanged", "data": { "tabId": 123, "url": "https://..." } }
```

### `cookiesChanged`
Fired periodically (every 2s) when cookie count changes for the active tab.
```json
{ "type": "event", "event": "cookiesChanged", "data": { "cookies": [...], "count": 42 } }
```

---

## Content Security Policy (CSP)

### Overview

The Human Browser operates within a Chrome extension using two JavaScript execution contexts:

1. **ISOLATED World** (Content Script Context) - CSP-safe, full DOM access
2. **MAIN World** (Page Context) - Requires `unsafe-eval` or `unsafe-inline`, access to page globals

### CSP-Resistant Operations (Always Work)

These commands run in ISOLATED world and are **immune to CSP restrictions**:

| Action | Context | CSP Affected? |
|--------|---------|---------------|
| `dom.querySelector` | ISOLATED | [NO] No |
| `dom.querySelectorAll` | ISOLATED | [NO] No |
| `dom.getHTML` | ISOLATED | [NO] No |
| `human.click` | ISOLATED | [NO] No |
| `human.type` | ISOLATED | [NO] No |
| `human.scroll` | ISOLATED | [NO] No |
| `dom.click` | ISOLATED | [NO] No |
| `dom.scroll` | ISOLATED | [NO] No |
| `tabs.*` | Extension | [NO] No |

### CSP-Sensitive Operations

These commands attempt MAIN world execution first, then fall back to ISOLATED:

| Action | Strategy | CSP Fallback |
|--------|----------|--------------|
| `dom.evaluate` | Try MAIN → ISOLATED fallback | Falls back to ISOLATED (limited to DOM) |
| `dom.elementEvaluate` | Try MAIN → ISOLATED fallback | Falls back to ISOLATED |
| `page.content()` | Uses `dom.getHTML` | [YES] CSP-safe |

### Understanding CSP Errors

**CSP errors in DevTools console are harmless and expected on sites with strict CSP.**

Sites with CSP headers like:
```
Content-Security-Policy: script-src 'self'
```

Will block MAIN world script execution, resulting in console errors like:
```
EvalError: Evaluating a string as JavaScript violates CSP directive
```

**This is NOT a problem because:**

1. **Sites cannot detect client-side CSP errors** - they have no access to your DevTools console
2. **Fallback mechanisms activate automatically** - ISOLATED world operations continue working
3. **Normal browsers also trigger CSP errors** on these sites - it's indistinguishable from regular browsing
4. **No server-side detection** - the errors never leave your local browser

### Anti-Detection Architecture

Unlike CDP-based automation (Puppeteer/Playwright), this extension approach:

| Detection Method | CDP/Puppeteer | Extension |
|------------------|---------------|-----------|
| Remote debugging port | [YES] Exposed (9222) | [NO] None |
| `navigator.webdriver` | [YES] `true` | [NO] Undefined |
| `window.chrome.runtime` | [YES] Missing | [NO] Present |
| Network signatures | [YES] CDP patterns | [NO] Normal WS |
| CSP console errors | [NO] Visible | [NO] Same as normal browsing |

**The extension is architecturally stealth because:**
- No open debugging ports
- Native Chrome execution context
- WebSocket traffic looks like normal site activity
- CSP errors are indistinguishable from regular browsing

### When to Use MAIN World

Only use MAIN world (via `dom.evaluate`) when you need:

- Access to page JavaScript globals (`window.__INITIAL_STATE__`)
- Calling page-defined functions
- Reading variables from the page's JS scope

**Example - Extracting from rendered HTML (CSP-safe):**
```javascript
// This works on ALL sites regardless of CSP
const html = await page.content(); // Uses dom.getHTML (ISOLATED)
const elements = await page.discoverElements(); // ISOLATED
const jobData = await page.evaluate(() => {
  // Tries MAIN first, falls back to ISOLATED
  return document.querySelector('.job')?.textContent;
});
```

**Example - Requiring page globals (CSP-restricted):**
```javascript
// This may fail on CSP-strict sites
const state = await page.evaluate(() => {
  return window.__INITIAL_STATE__; // Requires MAIN world
});
// On CSP-strict sites, returns null or throws
```

### Testing CSP Compatibility

The test server includes CSP test endpoints:

```bash
# Start test server
node test/server.js

# Test different CSP configurations:
curl http://localhost:3456/?csp=strict      # Blocks all inline/eval
curl http://localhost:3456/?csp=none        # No CSP

# Run CSP compatibility tests
node test/all-commands.js
```

### Best Practices

1. **Prefer ISOLATED world operations** - Use `dom.getHTML`, `querySelector`, `human.*` commands
2. **Extract from rendered DOM** - After scrolling triggers lazy loading.
3. **Use data attributes** - Sites often store data in `data-*` attributes (e.g., `data-view-tracking-scope`)
4. **Avoid MAIN world unless necessary** - Only for accessing page globals
5. **Don't worry about CSP console errors** - They're invisible to server-side detection

## Example: Python Client

```python
import asyncio, json, uuid, websockets

async def main():
    async with websockets.connect('ws://localhost:7331') as ws:
        async def send(action, params={}, tab_id=None):
            msg = {"id": str(uuid.uuid4()), "action": action, "params": params}
            if tab_id: msg["tabId"] = tab_id
            await ws.send(json.dumps(msg))
            resp = json.loads(await ws.recv())
            if "error" in resp: raise Exception(resp["error"])
            return resp["result"]

        # List tabs
        tabs = await send("tabs.list")
        tab = tabs[0]["id"]

        # Navigate
        await send("tabs.navigate", {"url": "https://example.com"}, tab)

        # Query an element
        handle = await send("dom.querySelector", {"selector": "h1"}, tab)

        # Human click (safe, with bezier cursor + honeypot detection)
        result = await send("human.click", {"handleId": handle}, tab)
        print(result)  # { "clicked": true } or { "clicked": false, "reason": "..." }

        # Human type
        await send("human.type", {"text": "Hello", "selector": "#input"}, tab)

asyncio.run(main())
```
