---
name: webpilot
description: Use when the user asks to navigate a webpage, scrape data from a site, fill out a form, log into a service, click buttons, take a screenshot, automate browser actions, drive Chrome, control a browser, extract content from a URL, search inside a logged-in account, or do anything that requires a real browser session. Drives the user's actual Chrome via the webpilot CLI and a local WebSocket runtime; not headless.
---

# Webpilot Skill

Use Webpilot as a browser tool.

It gives you a local browser runtime, a CLI, and a WebSocket command surface. Your job is not to guess. Your job is to inspect page state, choose a safe action, run it, and verify the result.

**Do not default to screenshots.** Webpilot exposes the live DOM directly. Screenshots are slow, expensive, and unnecessary for most tasks. Use `html`, `discover`, and `q` to read page state. Reserve `ss` for cases where layout or visual rendering is the actual question.

## First Run (mandatory bootstrap, do this in order, every session)

Webpilot launches a real Chromium-based browser with its extension auto-injected via `--load-extension`. The extension dials back to the local runtime (a Node process listening on `ws://localhost:7331`). All of this is configured by `~/h17-webpilot/config.js`. The very first run on a new machine is **interactive** because it has to detect installed browsers and ask the user which one to use. That interactivity is the single most common reason new users hit `Extension not connected` from inside an agent.

### Step 1 — Verify CLI installed

```bash
webpilot --help
```

If the command is not found, install it first and retry:

```bash
npm install -g h17-webpilot
```

### Step 2 — Verify the config exists

```bash
test -f ~/h17-webpilot/config.js || test -f ~/h17-webpilot/config.json && echo "config ok" || echo "config missing"
```

- If the output is `config ok`, skip to Step 3.
- If the output is `config missing`, **stop and ask the user to complete first-run setup in a real terminal**, because the prompt requires interactive input that this agent shell cannot provide. Surface this verbatim:

> **First-run setup needed (one-time per machine).**
>
> Open a normal terminal and run:
>
> ```
> webpilot start
> ```
>
> The command will detect installed browsers, ask you to choose one, write `~/h17-webpilot/config.js`, then launch the browser. Once you see the browser window open, you can press Ctrl+C to stop it. Tell me when this is done and I will continue.

After the user confirms, re-check Step 2 and proceed.

### Step 3 — Start the runtime and WAIT for it to be ready

Run this **every session, unconditionally**. The command is idempotent — if the runtime is already up, it exits cleanly without disrupting state.

```bash
webpilot start -d
```

**Wait for the command to return.** It prints `server ready on ws://localhost:7331 (pid <N>)` when both the runtime and the launched browser are ready. Do not fire any `webpilot -c ...` command until this line appears. Racing ahead produces false connection failures.

`-d` writes an append-only session log to `~/h17-webpilot/webpilot.log` (configurable via `framework.debug.sessionLogPath`). Always pass `-d` so the log exists if you need to debug later.

### Step 4 — Verify the connection

```bash
webpilot -c .tabs
```

- If this returns a list of open tabs (or an empty array), you are ready. Proceed to the rest of this skill.
- If this returns **`Extension not connected`** after Steps 1–3 all succeeded, the launched browser process probably failed to start or crashed. **Do not retry, do not loop.** Surface this to the user:

> The webpilot runtime is up but the browser it tried to launch did not connect back. Likely cause: the browser binary path in `~/h17-webpilot/config.js` no longer exists (browser was uninstalled, moved, or updated to a new path). Open the config and verify the `browser:` field points to a real executable. If it does, share the contents of `~/h17-webpilot/webpilot.log` so we can see what the launcher reported.

Wait for the user to fix or confirm before retrying.

## Quoting Rule

Always double-quote the entire `-c` argument when it contains spaces or special characters:

```bash
webpilot -c "type #input hello world"
webpilot -c "click #submit"
webpilot -c "go https://example.com"
```

Single-word commands can omit quotes:

```bash
webpilot -c html
webpilot -c discover
webpilot -c ss
```

Never use single quotes. Never nest unescaped quotes inside the `-c` argument; escaped quotes (e.g., `{\"selector\": \"a[href]\"}`) are permitted when required by the Raw Protocol.

## Operating Loop

Use this order every time:

1. Inspect.
2. Act.
3. Verify.

Do not skip the inspect step unless you already have fresh page state from the immediately preceding command.

## Inspect

Use these first:

- `webpilot -c html` — read the current page DOM, title, and URL
- `webpilot -c discover` — list interactive elements, their handles, and CSS selectors
- `webpilot -c "q <selector>"` — query specific elements
- `webpilot -c "wait <selector>"` — wait for a known state change
- `webpilot -c ss` — last resort, only when layout or visual rendering is the actual question

## Act

Use the safest matching action:

- `webpilot -c "click <selector|handleId>"`
- `webpilot -c "type <cssSelector> <text>"`
- `webpilot -c "clear <selector>"`
- `webpilot -c "key <name>"`
- `webpilot -c "sd [px] [selector]"`
- `webpilot -c "su [px] [selector]"`
- `webpilot -c "go <url>"`
- `webpilot -c "cookies load ./cookies.json"` — when the task requires restoring an existing session

**`type` selector rule:** `type` auto-detects selectors by their first character: `#`, `.`, or `[`. Handle IDs (`el_*`) are **not** recognized by `type` and will be typed as literal text. Always use the CSS selector from `discover` output (the last column, e.g. `#APjFqb`, `.search-input`, `[name=q]`), not the handle ID.

**`type` requires a preceding `click`:** `type` is supposed to chain a click internally, but this does not always work. Always `click` the target element first, then `type` into it. This is the reliable pattern:

```bash
webpilot -c "click #APjFqb"
webpilot -c "type #APjFqb hello world"
```

**`click` accepts both** handle IDs and CSS selectors. Always `discover` or `q` immediately before interacting so handles and selectors are fresh.

`click` goes through the human action pipeline. If the runtime refuses the action, respect the refusal and re-inspect the page.

## Verify

After navigation or interaction, confirm the new state:

- `webpilot -c "wait <selector>"`
- `webpilot -c url`
- `webpilot -c title`
- `webpilot -c html`
- `webpilot -c "q <selector>"`

## Safe Usage Rules

- Never guess selectors when `html` or `discover` can tell you the real ones.
- Never assume a click worked. Verify it.
- Never treat `{ "clicked": false }` as something to brute-force through.
- Never confuse DOM reading with interaction. Read first, then act.
- Re-query stale handles instead of reusing them blindly.
- Do not use `eval` — it hits CSP on most sites.

## Raw Protocol

If you need a protocol action that the shorthand CLI does not expose directly, send it through raw mode:

```bash
webpilot -c "dom.queryAllInfo {\"selector\": \"a[href]\"}"
webpilot -c "human.scroll {\"selector\": \".feed\", \"direction\": \"down\"}"
webpilot -c "framework.getConfig {}"
```

You can also send a full JSON message:

```bash
webpilot -c "{\"action\": \"tabs.navigate\", \"params\": {\"url\": \"https://example.com\"}}"
```

## Strategy Notes

- Use `html`, `discover`, and `q` for DOM inspection (avoid `eval` due to CSP).
- Use `wait` after page-changing actions.
- Use handle IDs for `click`, CSS selectors for `type`.
- Use screenshots when layout or visibility is the uncertainty, not HTML structure.
- If the task needs a preloaded authenticated session, load cookies first or use config boot commands.

## MCP Server

An MCP adapter is available for environments that support the Model Context Protocol (e.g. Claude Desktop, Cursor, Windsurf).

Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "webpilot": {
      "command": "npx",
      "args": ["webpilot-mcp"]
    }
  }
}
```

The MCP server connects to the same WebSocket runtime (`ws://localhost:7331`). Start the runtime first with `webpilot start`, then the MCP tools become available in the host application automatically.

## Limits

- Public defaults are generic and uncalibrated.
- This tool does not give you task strategy, retries, route doctrine, or tuned behavior profiles.
- Advanced outcomes depend on how well you choose selectors, waits, verification steps, and configuration.
