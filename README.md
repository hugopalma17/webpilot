# Webpilot

[![npm](https://img.shields.io/npm/v/h17-webpilot)](https://www.npmjs.com/package/h17-webpilot)
[![Socket Badge](https://socket.dev/api/badge/npm/package/h17-webpilot)](https://socket.dev/npm/package/h17-webpilot)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![Node](https://img.shields.io/node/v/h17-webpilot)](https://www.npmjs.com/package/h17-webpilot)
[![Publish](https://github.com/hugopalma17/webpilot/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/hugopalma17/webpilot/actions/workflows/npm-publish.yml)

**Webpilot drives a real browser — no CDP, no debugging port, nothing that announces itself as automation.**

It launches Chromium with a local extension runtime and exposes the live DOM over a loopback WebSocket, so a script or an LLM reads *structured elements* instead of page dumps or screenshots. It uses a real browser profile with real logged-in sessions, on your machine. Nothing transits a third party.

Runs on a desktop, or on a server under `xvfb-run`.

```bash
npm install -g h17-webpilot
webpilot start
webpilot -c "go example.com"
webpilot -c discover
```

## Why

Most browser automation drives the browser through the DevTools Protocol or WebDriver. Both work well, and both are visible to the page. Cloud browser services solve scale, but your cookies and page content live on someone else's machine and you pay per session.

Webpilot sits in neither category.

| | Webpilot | CDP/WebDriver tools | Cloud browser services |
|---|---|---|---|
| Control channel | Browser extension | CDP / WebDriver | CDP, remote |
| Debugging port exposed | **No** | Yes | Yes |
| Headless mode | **None — real browser only** | Optional | Usually |
| Sessions | **Your real profile, already logged in** | Fresh profile, you script auth | Cloud profile, you inject auth |
| Where data lives | **Your machine** | Your machine | Third party |
| Agent-facing output | **Element handles + live DOM** | Varies | Varies |
| Cost | Free, self-hosted | Free, self-hosted | Per session |

### When the cheap path fails

Reach for `curl` or an HTTP fetch tool first — it costs a fraction as much, and most of the time it works. Webpilot is what you escalate to when it comes back with nothing usable.

| Symptom | Cause | What Webpilot does |
|---|---|---|
| Empty shell, `<div id="root"></div>` | client-rendered SPA | renders the page, then you query the DOM |
| `403`, challenge page, or CAPTCHA wall | bot detection fingerprinting the HTTP client | real browser, real profile, no debugging port |
| Login wall | no session | your profile is already signed in |
| Consent or region interstitial | cookie gate | click through once; the profile remembers |
| Rate limiting on a scraper | request pattern | human-paced interaction, configurable |

A real sequence, from diagnosing a hardware fault:

```bash
# HTTP fetch of a vendor support page
->  empty. JS-rendered, no content in the response.

# Webpilot
webpilot -c "go https://www.asrock.com/mb/AMD/X870%20Pro%20RS/index.asp"
webpilot -c 'dom.queryAllInfo {"selector": "#BIOS tr"}'
->  18 firmware releases with versions, dates and changelogs
```

The changelog line that came back identified the firmware regression behind five days of memory corruption. No other tool in the stack could reach it.

You don't replace your fetch layer. You add the fallback that stops the task dying at a 403.

### The token argument

The primary interface is the live DOM, not screenshots. `discover`, `q`, and `dom.queryAllInfo` return real selectors and handles rather than markup.

On a JavaScript-rendered vendor changelog page:

```
webpilot -c html                     131,487 bytes into context
dom.queryAllInfo "#BIOS tr"          the same 18 rows, ~1.5 KB
```

Roughly **85× less context for the same information**. Screenshots cost vision tokens to convey a table; accessibility-tree dumps are often larger than the HTML. Returning handles is cheaper than either.

Screenshots still exist as a fallback for when layout or visual rendering is the actual question. For everything else, read the DOM.

### No headless, by design

Webpilot cannot run headless. The extension runtime needs a real browser with a real display.

That reads like a missing feature and is closer to a guarantee: there is no mode in which Webpilot looks like headless Chrome, because that mode does not exist. On a server, `xvfb-run` supplies a display and the browser is still a real browser — same binary, same extension, same fingerprint surface as a desktop session.

## Install

```bash
npm install -g h17-webpilot
```

### First run

```bash
webpilot start
```

If no config exists, the first run detects installed browsers, **prompts you to choose one**, and writes `~/h17-webpilot/config.js`.

> **Running under an agent or in CI?** That prompt needs a TTY. An agent shell cannot answer it, and the symptom is `Extension not connected`. Either run `webpilot start` once in a normal terminal to generate the config, or write the config yourself before first start:
>
> ```bash
> mkdir -p ~/h17-webpilot
> cat > ~/h17-webpilot/config.js <<'EOF'
> module.exports = {
>   browser: "/usr/bin/chromium",
>   profile: "~/h17-webpilot/profile",
> };
> EOF
> ```
>
> With a config present, `webpilot start` is non-interactive.

Use `webpilot start -d` for an append-only session log (`~/h17-webpilot/webpilot.log` by default).

`webpilot start` is idempotent — if the runtime is already up it exits cleanly without disturbing state. It prints `server ready on ws://localhost:7331 (pid <N>)` when both the runtime and the browser are ready. Wait for that line before issuing commands.

### Recommended browser setup

If you want to browse normally while Webpilot automates in parallel, give Webpilot its own Chromium-family browser and keep your everyday browser separate. A clean split is Helium, Chromium, Edge, or Vivaldi for Webpilot; Chrome (or your normal browser) for you. Webpilot then owns its binary, profile, and process tree while your personal browser stays independent.

```javascript
module.exports = {
  browser: "/Applications/Helium.app/Contents/MacOS/Helium",
  profile: "~/h17-webpilot/profile",
};
```

If you are not browsing manually at the same time, the same browser install with Webpilot's dedicated profile is fine.

## Running on a server

Webpilot does not switch to headless mode, so a server needs a display. `xvfb-run` provides one:

```bash
xvfb-run -a webpilot start -d
webpilot -c "go https://example.com"
```

Everything else behaves identically. This is the self-hosted path for CI, scrapers, and scheduled jobs — a real browser with a real extension, on your own box, with no per-session billing and no page content leaving the machine.

### Linux desktop display detection

On Linux, if the shell has no `DISPLAY` but `~/.Xauthority` contains a display entry, Webpilot uses the detected desktop display and prints a yellow `[WARN]` showing the `DISPLAY` and `XAUTHORITY` it selected. If no display can be detected, it warns and waits for real readiness to fail rather than claiming the server is ready.

## Quick start

```bash
webpilot -c "go example.com"
webpilot -c discover
webpilot -c "click h1"
webpilot -c "wait h1"
webpilot -c html
webpilot -c "cookies load ./cookies.json"
```

Use the same loop every time:

1. **Inspect** — `discover`, `q`, `html`
2. **Act** — `click`, `type`, `go`
3. **Verify** — `wait`, `url`, `q`

Do not guess selectors when `discover` can tell you the real ones, and do not assume a click worked. `click` returns `{ "clicked": true|false }`; a `false` is a refusal to respect, not an obstacle to brute-force through.

## CLI

```bash
webpilot -c "go example.com"    # single command, preferred for scripts and agents
webpilot                        # manual/debug REPL
webpilot start                  # launch browser + WS server
webpilot start -d               # launch with session logging
webpilot stop                   # stop running server
```

**Core commands**

| Command | Does |
|---|---|
| `go <url>` | navigate |
| `discover` | list interactive elements with handles |
| `q <selector>` / `query <selector>` | query elements |
| `wait <selector>` | wait for a selector |
| `click <selector\|handleId>` | safe click |
| `type [selector\|handleId] <text>` | target, focus, then type with the configured profile |
| `clear <selector>` | clear an input |
| `key <name>` / `press <name>` | send a key |
| `sd [px] [selector]` / `su [px] [selector]` | scroll down / up |
| `html` | read page HTML |
| `ss` | screenshot — for when layout is the question, not structure |
| `cookies` | dump cookies |
| `cookies load <file>` | load cookies from a JSON array file |
| `frames` | list frames |

Without a selector, `sd` and `su` scroll the document when it has scrollable
height; otherwise they use the largest visible scrollable panel. Use a selector
to choose a specific container. Large amounts stop at the top or bottom while
preserving the configured random flicks and pauses.
Content that finishes loading after the command returns needs another scroll.

Single commands can be passed as one quoted string or as trailing argv after `-c`:

```bash
webpilot -c "type el_2 hello world"
webpilot -c type el_2 hello world
webpilot -c .http go https://example.com
```

Quote typed text only when quote characters are part of what you want typed.

`.http` toggles response-event printing. In the REPL it persists for that session; for one-shot commands prefix each invocation, since every `-c` call is its own client process. Most useful around navigation and page-load commands — it is also the cheapest way to read a site's own JSON API instead of scraping its DOM.

Raw mode stays available:

```bash
webpilot -c 'human.click {"selector": "button[type=submit]"}'
webpilot -c '{"action": "dom.getHTML", "params": {}}'
```

## Node API

A wrapper over the same WebSocket protocol.

```javascript
const { startWithPage } = require('h17-webpilot');

const { page } = await startWithPage();
await page.navigate('https://example.com');
await page.query('h1');
await page.click('h1');
await page.waitFor('body');
```

| Method | Legacy alias |
|---|---|
| `navigate(url)` | `goto(url)` |
| `query(selector)` | `$(selector)` |
| `queryAll(selector)` | `$$(selector)` |
| `waitFor(selector)` | `waitForSelector(selector)` |
| `read()` | `content()` |
| `click(...)` | `humanClick(...)` |
| `type(...)` | `humanType(...)` |
| `scroll(...)` | `humanScroll(...)` |
| `clearInput(...)` | `humanClearInput(...)` |
| `pressKey(key)` | — |
| `configure(config)` | `setConfig(config)` |

## WebSocket protocol

Connect to `ws://127.0.0.1:7331` and send JSON:

```json
{ "id": "1", "action": "tabs.navigate", "params": { "url": "https://example.com" } }
```

The server requires the per-run token written to `~/h17-webpilot/token`. Pass it as a query parameter: `ws://127.0.0.1:7331/?token=<token>`. The CLI and Node API attach it for you. The bundled runtime extension reads the same per-run token from a generated extension-private `token.json`, bypassing extension resource caches when it loads that file.

Capability groups: `tabs`, `dom`, `human`, `cookies`, `events`, `framework`.

Full reference: [`protocol/PROTOCOL.md`](protocol/PROTOCOL.md)

## Config

Loaded from `~/h17-webpilot/config.js` (or `config.json`). Override with `--config <path>`.

- `framework` — runtime behavior, debug toggles, handle retention
- `human` — cursor, click, typing, scroll, and avoid rules

The public package exposes a lot of knobs on purpose, and ships no strong profile. **These defaults do not represent human behavior** — typing is very fast, overshoot is off, jitter is off, drift is off. They exist to show what is configurable.

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

### Auth / session bootstrap

```javascript
module.exports = {
  browser: "/Applications/Chromium.app/Contents/MacOS/Chromium",
  boot: {
    cookiesPath: "./cookies.json",
    commands: [
      "go https://example.com",
      "cookies load ./cookies.json",
      { action: "framework.getConfig", params: {} }
    ],
  },
};
```

`boot.cookiesPath` loads a cookie jar before commands run. `boot.commands` accepts CLI shorthand strings, `cookies load <file>` entries, and raw `{ action, params, tabId? }` objects.

## Security model

Webpilot is a local tool. The browser, the WebSocket server, and the client all run on the same machine, and the server is built to stay that way.

- **Loopback only.** The WebSocket server binds to `127.0.0.1` and does not accept connections from other machines.
- **Per-run token.** Each `webpilot start` generates a fresh token, writes it to `~/h17-webpilot/token`, and refuses any connection that does not present it. The CLI, Node API, and bundled extension read it automatically. The extension token config is extension-private, fetched with cache bypass, and rotates every run.
- **Origin rejection.** The server rejects WebSocket handshakes carrying a web-page `Origin` header, so a malicious page cannot reach the server even from the same machine.

Two behaviors that automated scanners sometimes flag are intentional and central to what the tool does:

- **Script execution in the page.** `dom.evaluate` runs caller-supplied JavaScript in the page. That is the feature — driving a browser means running code in pages you navigate to. Execution only happens for commands sent over the authenticated local socket.
- **Cookies over the socket.** The `cookies` command reads browser cookies and returns them over the WebSocket. The endpoint is the local `127.0.0.1` server above, not a remote host. Nothing is sent off the machine. Cookie access exists so you can save and restore your own sessions.

If you run an old version, upgrade — the token, loopback bind, and Origin rejection were added together. See [SECURITY.md](SECURITY.md) to report issues.

## What Webpilot does not do

- decide what to do next
- ship a tuned human profile
- ship site strategy, retries, or route doctrine

The user or LLM decides the workflow. Webpilot provides the browser runtime and the commands.

## Limits

- Defaults are for demonstration and development, not behavior parity.
- The user or LLM still has to choose selectors, waits, retries, and verification steps.
- `dom.evaluate` may hit CSP restrictions on some sites. DOM reading and interaction still work through the isolated content-script path.
- No headless mode. A server needs `xvfb-run` or an equivalent display.

## Tested browsers

Helium · Chromium · Google Chrome

## Skill usage

[`SKILL.md`](SKILL.md) explains how an LLM should use Webpilot as a browser tool.

## License

Apache 2.0
