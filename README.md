# Human Browser Framework

CDP-free browser automation framework exposed as a WebSocket interface.

Your software controls Chromium through extension commands, and users can script it in any language as long as they send valid WebSocket messages.

## Core Idea

- Control channel: WebSocket JSON protocol (`ws://localhost:7331`)
- Execution layer: MV3 extension + content script
- Interaction layer: human-like actions (`human.click`, `human.type`, `human.scroll`, `human.clearInput`)
- Safety layer: trap/honeypot checks + configurable avoid rules

No Puppeteer/Playwright API is required on the client side.

## Features

- Tab control: list, navigate, reload, activate, close, wait for navigation, viewport resize
- DOM control: query selectors, wait selectors, evaluate, element handles, click/focus/type/scroll
- Human actions:
  - non-linear bezier mouse movement with overshoot paths
  - randomized timing and typing cadence (per-character with variance)
  - scroll behavior with flick sub-scrolls and back-scroll variance
  - trap/honeypot blocking (opacity zero, hidden/offscreen/tiny, aria-hidden, sub-pixel)
  - configurable `avoid` rules per-request and global (selectors, classes, IDs, attributes)
- Cookie support: get/set cookies for session bootstrap, cookiesChanged events
- Frame inspection: list all frames in a tab (exposes iframes, trackers, detection systems)
- Bulk DOM queries: `queryAllInfo` (selector + snapshot), `batchQuery` (multi-selector existence), `findScrollable` (scrollable containers), `elementHTML` (element HTML), `getHTML` (full page HTML, CSP-safe)
- Events over WS: network responses, URL changes, cookie changes
- Screenshots: viewport and full-page capture
- CSP compatibility: MAIN world with automatic ISOLATED fallback on strict-CSP sites
- Framework config pushed at runtime (handle lifetime, debug overlay, human behavior tuning)
- Hot-reload: `framework.reload` to pick up extension code changes without restarting

## Architecture

1. Node server starts local WS bridge.
2. Chromium launches with the extension and a clean profile.
3. Extension connects to the WS bridge.
4. Your script (any language) connects to the same WS endpoint.
5. Commands are relayed to the extension and executed in-page.

## Quick Start

1. Configure browser path and behavior in `human-browser.config.js`.
2. Start the framework:

```bash
node index.js
```

3. Connect from your preferred language to:

```text
ws://localhost:7331
```

4. Send protocol messages:

```json
{
  "id": "1",
  "action": "tabs.navigate",
  "params": { "url": "https://example.com" }
}
```

## Protocol Docs

Full command reference and wire format:

- `protocol/PROTOCOL.md`

This is the main contract for language-agnostic clients.

## Language-Agnostic Usage

If your language can open a WebSocket and send JSON, it can drive the framework.

Client responsibilities:

- generate unique request `id`s
- send `action` + `params`
- correlate replies by `id`
- handle async events (`response`, `urlChanged`)

## Debug CLI

A Go CLI (`cli/`) connects to the WebSocket and sends commands interactively. Useful for testing and debugging.

```bash
cd cli && go build -o hb && ./hb
```

## Stability Notes

- This reduces obvious automation artifacts but is not a guarantee against all anti-bot systems.
- Keep extension and framework versions aligned.
- Prefer behavior-driven tests for parity across updates (`test/all-commands.js`).
