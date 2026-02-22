# Human Browser

CDP-free browser automation with human-like behavior via Chrome extension + WebSocket.

Control Chromium through a WebSocket protocol. Any language can connect. Built-in human-like mouse movement, typing, scrolling, and trap detection. No Puppeteer, no Playwright, no debugging port, no `navigator.webdriver`.

## Install

```bash
npm install webpilot
```

## Quick Start

### 1. Configure

```bash
cp node_modules/webpilot/human-browser.config.example.js human-browser.config.js
```

Edit `human-browser.config.js` — set your browser path:

```javascript
module.exports = {
  browser: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  // Linux:   "/usr/bin/google-chrome"
  // Windows: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  profile: "./profile",
  port: 7331,
};
```

### 2. Start

```bash
npx webpilot start
```

### 3. Connect

#### Interactive CLI

```bash
npx webpilot
```

```
wp> go example.com
wp> discover
wp> click h1
wp> type #search hello world
wp> ss
```

#### Node.js (programmatic)

```javascript
const { startWithPage } = require('webpilot');

const { page } = await startWithPage();
await page.goto('https://example.com');
await page.humanClick('h1');
await page.humanType('Hello world', { selector: '#search' });
```

#### Any language (WebSocket)

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
} = require('webpilot');
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

For AI agents that need to browse the web: [`SKILLS.md`](SKILLS.md)

## Go CLI

A compiled Go CLI is also available in `cli/` for users who prefer a standalone binary:

```bash
cd cli && go build -o hb && ./hb
```

## License

Apache 2.0
