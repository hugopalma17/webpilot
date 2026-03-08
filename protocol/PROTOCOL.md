# Human Browser Protocol

Webpilot exposes browser control over WebSocket.

The protocol tells the browser what to do. It does not decide the task. The user or LLM chooses the sequence of actions.

## Connection

```text
WebSocket: ws://localhost:7331
```

The local server listens on this port. The extension connects on launch. Your client connects to the same server.

## Message Format

### Request
```json
{
  "id": "unique-string",
  "tabId": 123,
  "action": "action.name",
  "params": {}
}
```

- `id`: correlate responses
- `tabId`: optional target tab
- `action`: protocol action
- `params`: action-specific payload

### Response
```json
{ "id": "same-id", "result": {} }
```

or:

```json
{ "id": "same-id", "error": "error message" }
```

### Events
```json
{ "type": "event", "event": "response", "data": { "url": "...", "status": 200, "tabId": 123, "method": "GET" } }
{ "type": "event", "event": "urlChanged", "data": { "tabId": 123, "url": "https://..." } }
```

### Keepalive
- server sends `{ "type": "ping" }` every 20s
- extension responds with `{ "type": "pong" }`

## Handles

Many DOM commands return `handleId` values like `el_42`.

- created by `dom.querySelector`, `dom.querySelectorAll`, `dom.waitForSelector`
- used by `dom.click`, `dom.boundingBox`, `human.click`, and related commands
- stored with `WeakRef` and cleaned up after TTL or GC
- if both `handleId` and `selector` are provided, `handleId` wins

## Runtime Config

The extension runtime exposes:

| Action | Params | Returns |
|--------|--------|---------|
| `framework.setConfig` | `{ config: { handles?: { ttlMs?, cleanupIntervalMs? }, debug?: { cursor?, devtools?, sessionLog? } } }` | `{ ok: true, framework }` |
| `framework.getConfig` | `{}` | `{ framework, version }` |
| `framework.reload` | `{}` | `{ reloading: true }` |

Normal usage:
- Node loads `human-browser.config.js` or `~/h17-webpilot/config.js`
- the server injects `framework` and `human` settings into commands
- clients can still call `framework.setConfig` and `framework.getConfig` directly

The public package ships example defaults. They do not represent a human profile, and advanced cursor tuning or realistic timing still depends on user configuration.

## Boot Config

Webpilot can load state on startup from config before the user or LLM sends any commands.

Example:

```javascript
module.exports = {
  boot: {
    cookiesPath: "./cookies.json",
    commands: [
      "go https://hugopalma.work",
      "cookies load ./cookies.json",
      { action: "framework.getConfig", params: {} }
    ],
  },
};
```

Rules:
- `boot.cookiesPath` loads a cookie jar first
- `boot.commands` accepts CLI-style strings
- `boot.commands` also accepts raw command objects: `{ action, params, tabId? }`
- string commands support `cookies load <file>` in addition to normal shorthands

## Actions: Tabs

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
| `tabs.screenshot` | `{ fullPage? }` | `{ dataUrl }` |

## Actions: Frames

| Action | Params | Returns |
|--------|--------|---------|
| `frames.list` | `{}` | `[{ frameId, parentFrameId, url }]` |

## Actions: Cookies

| Action | Params | Returns |
|--------|--------|---------|
| `cookies.getAll` | `{ url? }` | `[{ name, value, domain, ... }]` |
| `cookies.set` | `{ cookie: { name, value, domain?, path?, secure?, httpOnly?, sameSite?, expires? } }` | `{ success: true }` |

## Actions: DOM

`dom.click` uses the same safe interaction pipeline as `human.click`. Other `dom.*` commands are direct DOM/runtime operations.

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
| `dom.evaluate` | `{ fn, args? }` | any |
| `dom.elementEvaluate` | `{ handleId, fn, args? }` | any |
| `dom.evaluateHandle` | `{ fn, args?, elementMarkers? }` | `{ type, handleId?, value?, properties? }` |
| `dom.getHTML` | `{}` | `{ html, title, url }` |
| `dom.elementHTML` | `{ handleId, limit? }` | `{ outer, inner, tag }` |
| `dom.queryAllInfo` | `{ selector }` | `[{ handleId, tag, id, cls, text, label }]` |
| `dom.batchQuery` | `{ selectors: [...] }` | `{ [selector]: boolean }` |
| `dom.findScrollable` | `{}` | `[{ handleId, tag, id, cls, overflowY, overflow, scrollHeight, clientHeight, children, text }]` |
| `dom.discoverElements` | `{}` | `{ elements, cursor, viewport, scrollY }` |
| `dom.setDebug` | `{ enabled }` | `{ debug: boolean }` |

### Keyboard Names
`Meta`, `Control`, `Shift`, `Alt`, `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `Space`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`, single characters, or code forms like `KeyA` and `Digit5`.

## Actions: Human

Human commands add safety checks and use injected `human.*` config.

Public config sections:
- `human.cursor`
- `human.click`
- `human.type`
- `human.scroll`
- `human.avoid`

### `human.click`

Example:

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

Returns:
- success: `{ "clicked": true }`
- blocked: `{ "clicked": false, "reason": "...", "detail": "..." }`

Built-in checks:
1. avoid rules
2. aria-hidden
3. missing `offsetParent`
4. honeypot class patterns
5. `opacity: 0`
6. `visibility: hidden`
7. sub-pixel size
8. missing bounding box
9. scroll into view
10. optional drift-away behavior from `human.cursor`
11. bezier path using `human.cursor`
12. think delay from `human.click`
13. disappearance check
14. shift check
15. `mousedown -> mouseup -> click` at actual cursor coordinates

Public defaults intentionally ship with advanced cursor tricks off or near zero:
- `overshootRatio: 0`
- `jitterRatio: 0`
- `stutterChance: 0`
- `driftThresholdPx: 0`

### `human.type`

Example:

```json
{
  "action": "human.type",
  "params": {
    "text": "Hello world",
    "selector": "#search-input"
  }
}
```

Returns:
- `{ "typed": true }`
- or `{ "typed": false, "reason": "avoided" }`

Typing cadence comes from `human.type`.

Public defaults are very fast:
- `baseDelayMin: 8`
- `baseDelayMax: 20`
- `pauseChance: 0`

These values show the configurable surface area. They are not a tuned profile.

### `human.scroll`

Example:

```json
{
  "action": "human.scroll",
  "params": {
    "handleId": "el_7",
    "direction": "down"
  }
}
```

Accepts `handleId`, `selector`, or neither.

Returns:
- `{ "scrolled": true, "amount": 487 }`

Scroll behavior comes from `human.scroll`.

### `human.clearInput`

Example:

```json
{
  "action": "human.clearInput",
  "params": { "selector": "#email-input" }
}
```

Returns:
- `{ "cleared": true }`
- or a click failure response

Behavior:
1. safe click to focus
2. triple-click to select
3. backspace/delete sequence

## `avoid`

All `human.*` commands accept:

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

Per-request `avoid` merges with global `human.avoid` config.

## Events

### `response`
```json
{ "type": "event", "event": "response", "data": { "url": "https://...", "status": 200, "tabId": 123, "method": "GET" } }
```

### `urlChanged`
```json
{ "type": "event", "event": "urlChanged", "data": { "tabId": 123, "url": "https://..." } }
```

### `cookiesChanged`
```json
{ "type": "event", "event": "cookiesChanged", "data": { "cookies": [...], "count": 42 } }
```

## CSP

Two execution contexts exist:
1. ISOLATED world: DOM-safe, CSP-safe
2. MAIN world: page globals, may be blocked by CSP

Commands that keep working under CSP:
- `dom.querySelector`
- `dom.querySelectorAll`
- `dom.getHTML`
- `human.click`
- `human.type`
- `human.scroll`
- `dom.click`

`dom.evaluate` and `dom.elementEvaluate` try MAIN first and fall back when possible.

## Example Python Client

```python
import asyncio, json, uuid, websockets

async def main():
    async with websockets.connect('ws://localhost:7331') as ws:
        async def send(action, params={}, tab_id=None):
            msg = {"id": str(uuid.uuid4()), "action": action, "params": params}
            if tab_id:
                msg["tabId"] = tab_id
            await ws.send(json.dumps(msg))
            resp = json.loads(await ws.recv())
            if "error" in resp:
                raise Exception(resp["error"])
            return resp["result"]

        tabs = await send("tabs.list")
        tab = tabs[0]["id"]
        await send("tabs.navigate", {"url": "https://example.com"}, tab)
        handle = await send("dom.querySelector", {"selector": "h1"}, tab)
        print(await send("human.click", {"handleId": handle}, tab))
        await send("human.type", {"text": "Hello", "selector": "#input"}, tab)

asyncio.run(main())
```
