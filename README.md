# Webpilot

[![npm](https://img.shields.io/npm/v/h17-webpilot)](https://www.npmjs.com/package/h17-webpilot)
[![Socket Badge](https://socket.dev/api/badge/npm/package/h17-webpilot)](https://socket.dev/npm/package/h17-webpilot)

Webpilot is a browser tool.

It launches a tested Chromium-based browser with a local extension runtime, exposes a WebSocket protocol, and lets a user, script, or LLM drive that browser through the same command surface.

What Webpilot does:
- starts and controls a real browser
- exposes navigation, DOM, cookies, screenshots, and safe interaction commands
- provides configurable cursor, click, typing, and scroll behavior
- works from the CLI, raw WebSocket, Node, or an MCP adapter

What Webpilot does not do:
- decide what to scrape
- decide what step comes next
- ship a tuned human profile
- ship site strategy, retries, or route doctrine

The user or LLM decides the workflow. Webpilot only provides the browser runtime and commands.

## Install

```bash
npm install -g h17-webpilot
```

## Quick Start

### 1. Configure

Create `~/h17-webpilot/config.js` or `human-browser.config.js` in your project:

```javascript
module.exports = {
  browser: "/Applications/Chromium.app/Contents/MacOS/Chromium",
  human: {
    calibrated: false,
    profileName: "public-default",
    cursor: {
      overshootRatio: 0,
    },
  },
};
```

The example file is `human-browser.config.example.js`.

### 2. Start

```bash
npx webpilot start
npx webpilot start -d
```

This launches the browser and starts the local WebSocket bridge on `ws://localhost:7331`.

Use `npx webpilot start -d` if you want an append-only session log.

- default log path: `~/h17-webpilot/webpilot.log`
- override path in config with `framework.debug.sessionLogPath`

### 3. Use the tool

```bash
npx webpilot -c 'go example.com'
npx webpilot -c 'discover'
npx webpilot -c 'click h1'
npx webpilot -c 'wait h1'
npx webpilot -c 'html'
npx webpilot -c 'cookies load ./cookies.json'
```

Use the same loop every time:
1. inspect
2. act
3. verify

## CLI

```bash
npx webpilot
npx webpilot -c 'go example.com'
npx webpilot start
npx webpilot start -d
npx webpilot stop
```

Core commands:
- `go <url>`: navigate
- `discover`: list interactive elements with handles
- `q <selector>` / `query <selector>`: query elements
- `wait <selector>`: wait for a selector
- `click <selector|handleId>`: safe click
- `type [selector] <text>`: type with the configured public profile
- `clear <selector>`: clear an input
- `key <name>` / `press <name>`: send a key
- `sd [px] [selector]` / `su [px] [selector]`: scroll
- `html`: read page HTML
- `ss`: save a screenshot
- `cookies`: dump cookies
- `cookies load <file>`: load cookies from a JSON array file
- `frames`: list frames
- `npx webpilot start -d`: start detached and append WS commands/events to `~/h17-webpilot/webpilot.log` unless config overrides the path

Raw mode stays available:

```bash
npx webpilot -c 'human.click {"selector": "button[type=submit]"}'
npx webpilot -c '{"action": "dom.getHTML", "params": {}}'
```

## WebSocket Protocol

Connect to `ws://localhost:7331` and send JSON:

```json
{ "id": "1", "action": "tabs.navigate", "params": { "url": "https://example.com" } }
```

Capability groups:
- `tabs`
- `dom`
- `human`
- `cookies`
- `events`
- `framework`

Full reference: `protocol/PROTOCOL.md`

## Node API

The Node API is a wrapper over the same WebSocket protocol.

```javascript
const { startWithPage } = require('h17-webpilot');

const { page } = await startWithPage();
await page.navigate('https://example.com');
await page.query('h1');
await page.click('h1');
await page.waitFor('body');
```

Useful methods:
- `navigate(url)` / legacy `goto(url)`
- `query(selector)` / legacy `$(selector)`
- `queryAll(selector)` / legacy `$$(selector)`
- `waitFor(selector)` / legacy `waitForSelector(selector)`
- `read()` / legacy `content()`
- `click(...)` / legacy `humanClick(...)`
- `type(...)` / legacy `humanType(...)`
- `scroll(...)` / legacy `humanScroll(...)`
- `clearInput(...)` / legacy `humanClearInput(...)`
- `pressKey(key)`
- `configure(config)` / legacy `setConfig(config)`

## Config

Public config is split into:
- `framework`: runtime behavior, debug toggles, handle retention
- `human`: cursor, click, typing, scroll, and avoid rules

The public package exposes a lot of knobs on purpose. The user decides how much to tune. The package does not ship a strong profile.

Example:

```javascript
module.exports = {
  framework: {
    debug: {
      cursor: true,
      sessionLogPath: '~/h17-webpilot/webpilot.log',
    },
  },
  human: {
    calibrated: false,
    profileName: 'public-default',
    cursor: {
      spreadRatio: 0.16,
      jitterRatio: 0,
      stutterChance: 0,
      driftThresholdPx: 0,
      overshootRatio: 0,
    },
    click: {
      thinkDelayMin: 35,
      thinkDelayMax: 90,
      maxShiftPx: 50,
    },
    type: {
      baseDelayMin: 8,
      baseDelayMax: 20,
      variance: 4,
      pauseChance: 0,
      pauseMin: 0,
      pauseMax: 0,
    },
  },
};
```

Auth/session bootstrap example:

```javascript
module.exports = {
  browser: "/Applications/Chromium.app/Contents/MacOS/Chromium",
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

`boot.cookiesPath` loads a cookie jar before commands run.
`boot.commands` accepts:
- command strings like the CLI shorthands
- `cookies load <file>` entries
- raw objects: `{ action, params, tabId? }`

These defaults do not represent a human profile:
- typing is very fast
- overshoot is off
- jitter is off
- drift is off

They are there to show what is configurable. The package does not ship your final values.

## First Run

If no config file exists, `npx webpilot start` will:
- detect installed browsers
- ask the user to choose one when needed
- generate `~/h17-webpilot/config.js`

The generated config uses the same public defaults shown above.

If you start with `npx webpilot start -d`, session logging is enabled even if the config does not set it.
The path comes from `framework.debug.sessionLogPath` when present, otherwise it falls back to `~/h17-webpilot/webpilot.log`.

## Tested Browsers

Tested browsers:
- Chromium
- Helium
- Google Chrome

## Limits

- Defaults are for demonstration and development, not for behavior parity.
- The browser tool does not decide workflows.
- The user or LLM still has to choose selectors, waits, retries, and verification steps.
- `dom.evaluate` may hit CSP restrictions on some sites. DOM reading and interaction still work through the isolated content-script path.

## Skill Usage

`SKILL.md` explains how an LLM should use Webpilot as a browser tool.

## License

Apache 2.0
