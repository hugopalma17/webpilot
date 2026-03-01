# Human Browser

[![npm](https://img.shields.io/npm/v/h17-webpilot)](https://www.npmjs.com/package/h17-webpilot)
[![Socket Badge](https://socket.dev/api/badge/npm/package/h17-webpilot)](https://socket.dev/npm/package/h17-webpilot)

CDP-free browser automation with human-like behavior via Chrome extension + WebSocket.

Control Chromium through a WebSocket protocol. Any language can connect. Built-in human-like mouse movement, typing, scrolling, and trap detection. No Puppeteer, no Playwright, no debugging port, no `navigator.webdriver`.

Let your AI browse fast and safely.

## Install

```bash
npm install h17-webpilot
```

## Quick Start

### 1. Configure

Create `~/.config/human-browser/config.js` (or `human-browser.config.js` in your project):

```javascript
module.exports = {
  browser: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  // Linux:   "/usr/bin/google-chrome"
  // Windows: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
};
```

### 2. Use

```bash
webpilot start                          # launches browser + server (detached)
webpilot -c 'go example.com'            # navigate
webpilot -c 'discover'                  # list interactive elements
webpilot -c 'click h1'                  # human click
webpilot -c 'type #search hello world'  # human type
webpilot -c 'ss'                        # screenshot
webpilot stop                           # stop server + browser
```

Or enter the interactive REPL:

```bash
webpilot
```

```
wp> go example.com
wp> discover
wp> click h1
wp> type #search hello world
wp> ss
```

### Node.js (programmatic)

```javascript
const { startWithPage } = require('h17-webpilot');

const { page } = await startWithPage();
await page.goto('https://example.com');
await page.humanClick('h1');
await page.humanType('Hello world', { selector: '#search' });
```

### Any language (WebSocket)

Connect to `ws://localhost:7331` and send JSON:

```json
{ "id": "1", "action": "tabs.navigate", "params": { "url": "https://example.com" } }
```

## CLI Reference

**Navigation:**
- `go <url>` — navigate (auto-adds `https://`)
- `reload` / `back` / `forward` — page navigation
- `sd [px] [selector]` — scroll down
- `su [px] [selector]` — scroll up

**Query:**
- `q <selector>` — find all matches with handle IDs
- `wait <selector>` — wait for selector to appear
- `discover` — list all interactive elements

**Interact:**
- `click <selector|handleId>` — human click (bezier cursor + safety checks)
- `type [selector] <text>` — human type (character-by-character with variance)
- `clear <selector>` — clear input field
- `focus <selector>` — focus element
- `key <name>` — key press (Enter, Tab, Escape...)

**Inspect:**
- `eval <js>` — evaluate JavaScript
- `title` / `url` / `html` — quick page info
- `ss` — screenshot (saves PNG to current directory)
- `box <selector>` — bounding box
- `cookies` — dump all cookies
- `frames` — list all frames

**Meta:**
- `.tabs` — list tabs (with 0-9 aliases)
- `.tab <n>` — switch active tab
- `.events` — toggle event display
- `.status` — connection info
- `.quit` — exit

**Raw mode:**
- `action.name {"key": "value"}` — any protocol command
- `{"id": "1", "action": "...", ...}` — raw WebSocket JSON

## Programmatic API

```javascript
const {
  start,           // Launch browser + WS server
  startWithPage,   // start + return BridgePage on first tab
  connectToServer, // Connect to already-running server
  loadConfig,      // Load human-browser.config.js
  BridgePage,      // Page automation class
  BridgeElement,   // DOM element wrapper
  BridgeKeyboard,  // Keyboard input
  BridgeCursor,    // Mouse cursor with bezier movement
} = require('h17-webpilot');
```

## Architecture

1. Node.js server starts a local WebSocket bridge on port 7331
2. Chromium launches with the extension loaded into a clean profile
3. The extension connects to the WS bridge from its service worker
4. Your code (any language) connects to the same WS endpoint
5. Commands are relayed to the extension and executed in-page

The extension runs as a content script in Chrome's ISOLATED world. No CDP, no debugging protocol, no detectable automation flags.

### Human Behavior

All `human.*` commands include:

- Bezier curve mouse movement with overshoot
- Randomized timing and typing cadence
- Scroll behavior with flick sub-scrolls and back-scroll variance
- 13-point honeypot/trap detection (aria-hidden, offsetParent, opacity, visibility, sub-pixel, bounding-box shift, class-name regex)
- Configurable `avoid` rules per-request and global

### Safety Layer

`human.click` returns `{ clicked: false, reason: "..." }` instead of clicking unsafe elements:

- `aria-hidden` — screen reader hidden
- `honeypot-class` — trap class names (ghost, sr-only, visually-hidden, etc.)
- `opacity-zero` / `visibility-hidden` — invisible elements
- `sub-pixel` — elements smaller than 5x5px
- `element-shifted` — element moved during think time
- `no-bounding-box` / `element-disappeared` — element not in DOM

## Protocol

Full WebSocket protocol specification: [`protocol/PROTOCOL.md`](protocol/PROTOCOL.md)

## LLM Integration

For AI agents that need to browse the web: [`SKILL.md`](SKILL.md)

## License

Apache 2.0
