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
| `framework.setConfig` | `{ config: { handles?: { ttlMs?, cleanupIntervalMs? }, debug?: { enabled? } } }` | `{ ok: true, framework }` |
| `framework.getConfig` | `{}` | `{ framework }` |

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

## Actions: Cookies

| Action | Params | Returns |
|--------|--------|---------|
| `cookies.getAll` | `{ url? }` | `[{ name, value, domain, ... }]` |
| `cookies.set` | `{ cookie: { name, value, domain?, path?, secure?, httpOnly?, sameSite?, expires? } }` | `{ success: true }` |

## Actions: DOM (Raw)

| Action | Params | Returns |
|--------|--------|---------|
| `dom.querySelector` | `{ selector }` | `handleId` or `null` |
| `dom.querySelectorAll` | `{ selector }` | `[handleId, ...]` |
| `dom.querySelectorWithin` | `{ parentHandleId, selector }` | `handleId` or `null` |
| `dom.querySelectorAllWithin` | `{ parentHandleId, selector }` | `[handleId, ...]` |
| `dom.waitForSelector` | `{ selector, timeout? }` | `handleId` or `null` |
| `dom.boundingBox` | `{ handleId \| selector }` | `{ x, y, width, height }` or `null` |
| `dom.click` | `{ handleId \| selector, clickCount? }` | `{ clicked: true }` |
| `dom.mouseMoveTo` | `{ handleId \| selector }` | `{ x, y }` |
| `dom.focus` | `{ handleId \| selector }` | `{ focused: true }` |
| `dom.type` | `{ text, handleId?, selector? }` | `{ typed: true }` |
| `dom.keyPress` | `{ key }` | `{ pressed: true }` |
| `dom.keyDown` | `{ key }` | `{ down: true }` |
| `dom.keyUp` | `{ key }` | `{ up: true }` |
| `dom.scroll` | `{ selector?, direction?, amount?, behavior? }` | `{ scrolled: true }` |
| `dom.setValue` | `{ handleId \| selector, value }` | `{ set: true }` |
| `dom.getAttribute` | `{ handleId \| selector, name }` | string or `null` |
| `dom.getProperty` | `{ handleId \| selector, name }` | any |
| `dom.evaluate` | `{ fn, args? }` | any (serializable) |
| `dom.elementEvaluate` | `{ handleId, fn, args? }` | any (serializable) |
| `dom.evaluateHandle` | `{ fn, args?, elementMarkers? }` | `{ type, handleId?, value?, properties? }` |
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
9. Bezier mouse movement to element
10. Random think-time delay (200-500ms default)
11. Element disappeared during delay → `reason: "element-disappeared"`
12. Element shifted > 50px during delay → `reason: "element-shifted"`
13. mousedown → mouseup → click dispatch

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
- Per-character dispatch with random delays (100-250ms ± 30ms)
- 15% chance of "thinking pause" (200-600ms) between characters
- Minimum 50ms per character
- Uses native value setter for React/framework compatibility

### human.scroll

```json
{
  "action": "human.scroll",
  "params": {
    "selector": ".results-panel",
    "direction": "down"
  }
}
```

**Returns**: `{ "scrolled": true, "amount": 487 }`

Scroll behavior:
- Random scroll amount (300-700px default)
- Smooth scrolling
- 20% chance of small back-scroll (20-100px) for realism
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

---

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
