# Webpilot

[![npm](https://img.shields.io/npm/v/h17-webpilot)](https://www.npmjs.com/package/h17-webpilot)
[![Socket Badge](https://socket.dev/api/badge/npm/package/h17-webpilot)](https://socket.dev/npm/package/h17-webpilot)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![Node](https://img.shields.io/node/v/h17-webpilot)](https://www.npmjs.com/package/h17-webpilot)
[![Publish](https://github.com/hugopalma17/webpilot/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/hugopalma17/webpilot/actions/workflows/npm-publish.yml)

Webpilot is a browser tool.

It launches a real Chromium-based browser with a local extension runtime, exposes a WebSocket protocol, and lets a user, script, or LLM drive that browser through the same command surface.

**The primary interface is the live DOM — not screenshots.** `discover`, `html`, and `q` give you real page structure, real selectors, and real handles. Screenshots exist as a fallback for when layout or visual rendering is the actual question. For everything else, read the DOM.

What Webpilot does:
- starts and controls a real browser — no CDP, no detectable debugging port
- exposes the live DOM directly: navigation, element discovery, querying, interaction, cookies
- provides configurable cursor, click, typing, and scroll behavior
- works from the CLI, raw WebSocket, Node, or an MCP adapter

What Webpilot does not do:
- decide what to do next
- ship a tuned human profile
- ship site strategy, retries, or route doctrine

The user or LLM decides the workflow. Webpilot provides the browser runtime and commands.

## Install

```bash
npm install -g h17-webpilot
```

## Quick Start

### 1. Start

```bash
webpilot start
```

If no config exists, the first run will detect installed browsers, ask you to choose one, and generate `~/h17-webpilot/config.js`.

Use `webpilot start -d` for an append-only session log (`~/h17-webpilot/webpilot.log` by default).

### 2. Use the tool

```bash
webpilot -c 'go example.com'
webpilot -c 'discover'
webpilot -c 'click h1'
webpilot -c 'wait h1'
webpilot -c 'html'
webpilot -c 'cookies load ./cookies.json'
```

Use the same loop every time:
1. inspect
2. act
3. verify

## CLI

```bash
webpilot                        # interactive REPL
webpilot -c 'go example.com'   # single command
webpilot start                  # launch browser + WS server
webpilot start -d               # launch with session logging
webpilot stop                   # stop running server
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
- `ss`: save a screenshot — use when layout or visual rendering is the question, not DOM structure
- `cookies`: dump cookies
- `cookies load <file>`: load cookies from a JSON array file
- `frames`: list frames

Raw mode stays available:

```bash
webpilot -c 'human.click {"selector": "button[type=submit]"}'
webpilot -c '{"action": "dom.getHTML", "params": {}}'
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

Config is loaded from `~/h17-webpilot/config.js` (or `config.json`). Override with `--config <path>`.

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
