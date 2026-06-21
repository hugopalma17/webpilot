---
name: webpilot
description: Use when the user asks to navigate a webpage, scrape data from a site, fill out a form, log into a service, click buttons, take a screenshot, automate browser actions, drive Chrome or Helium, control a browser, extract content from a URL, search inside a logged-in account, or do anything that requires a real browser session. Uses the webpilot CLI and a local WebSocket runtime; not headless.
---

# Webpilot Skill

Use Webpilot as a browser tool.

It gives you a local browser runtime, a CLI, and a WebSocket command surface. Your job is not to guess. Your job is to inspect page state, choose a safe action, run it, and verify the result.

**Primary driving path:** use `webpilot start` once, then `webpilot -c ...` one-shot commands. The interactive REPL exists for manual testing/debugging and should not be the default way an agent drives a browser.

**Browser split when browsing in parallel:** if the user wants to browse normally while Webpilot automates in parallel, use a dedicated Chromium-family browser for Webpilot and keep the user's personal browser separate. Helium, Chromium, Edge, and Vivaldi all work for this role. If the user is not browsing manually at the same time, using the same browser install with Webpilot's dedicated profile is fine.

**Do not default to screenshots.** Webpilot exposes the live DOM directly. Screenshots are slow, expensive, and unnecessary for most tasks. Use `html`, `discover`, and `q` to read page state. Reserve `ss` for cases where layout or visual rendering is the actual question.

## First Run (mandatory bootstrap, do this in order, every session)

Webpilot launches a real Chromium-based browser with its extension auto-injected via `--load-extension`. The extension dials back to the token-authenticated local runtime (a Node process listening on `ws://localhost:7331`). All of this is configured by `~/h17-webpilot/config.js`. The very first run on a new machine is **interactive** because it has to detect installed browsers and ask the user which one to use. That interactivity is the single most common reason new users hit `Extension not connected` from inside an agent.

When first-run setup asks for a browser, ask whether the user plans to browse manually while Webpilot runs. If yes, recommend a dedicated Webpilot browser, not the user's daily browser. Good splits include Helium/Chrome, Chromium/Chrome, Edge/Chrome, or Vivaldi/Chrome.

On Linux/XFCE-style desktops, the agent shell may not inherit `DISPLAY`. Webpilot can infer `DISPLAY`/`XAUTHORITY` from the user's `~/.Xauthority`; when it does, it prints a yellow `[WARN]` and still launches normal Chromium, not headless mode. If X auth is stale or missing, readiness will fail instead of printing `server ready`.

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

At the beginning of a fresh task/session, run this before `webpilot -c ...` commands unless you have already verified the runtime is ready in the current thread. Do not restart an already-ready runtime just to be tidy; that disrupts browser state.

```bash
webpilot start -d
```

**Run `start` bare — never pipe it through `head`/`tail`/etc.** The server attaches to that stdout; when the pager closes the pipe, SIGPIPE kills it (it then restarts on every later `-c` call, breaking the session).

**Wait for the command to return.** It prints `server ready on ws://localhost:7331 (pid <N>)` only after the authenticated local runtime has successfully round-tripped a command through the injected extension. Do not fire any `webpilot -c ...` command until this line appears. Step 4 is still the quick visible verification before doing page work.

`-d` writes an append-only session log to `~/h17-webpilot/webpilot.log` (configurable via `framework.debug.sessionLogPath`). Always pass `-d` so the log exists if you need to debug later.

### Step 4 — Verify the connection

```bash
webpilot -c .tabs
```

- If this returns a list of open tabs (or an empty array), you are ready. Proceed to the rest of this skill.
- If this returns **`Extension not connected`** after Steps 1–3 all succeeded, the launched browser process probably failed to start or crashed. **Do not retry, do not loop.** Surface this to the user:

> The webpilot runtime is up but the browser it tried to launch did not connect back. Likely cause: the browser binary path in `~/h17-webpilot/config.js` no longer exists (browser was uninstalled, moved, or updated to a new path). Open the config and verify the `browser:` field points to a real executable. If it does, share the contents of `~/h17-webpilot/webpilot.log` so we can see what the launcher reported.

Wait for the user to fix or confirm before retrying.

## `-c` Command Form

Prefer unquoted trailing argv for simple commands:

```bash
webpilot -c type el_2 hello world
webpilot -c click el_1
webpilot -c go https://example.com
```

Quoted whole-command form is also supported when it helps the shell preserve selectors or special characters:

```bash
webpilot -c "type #input hello world"
webpilot -c "click button[type=submit]"
```

Do not add shell quotes around typed text unless the literal quote characters should be typed into the page. Single-word commands can omit quotes: `webpilot -c html`, `webpilot -c discover`, `webpilot -c ss`.

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
- `webpilot -c ss` — screenshot; use when layout/visual rendering is the question, or to verify when DOM/URL state is ambiguous ("did that take?")
- `webpilot -c dump` — one-shot capture of the **whole page** to `dump_<ts>/` (page.html + screenshot.png + cookies.json) for offline grep; best when a page is large or DOM-hostile
- `.http` in the interactive REPL — toggle response-event printing for the rest of that CLI session
- `webpilot -c .http go <url>` — enable response-event printing for that one-shot page load/navigation command; useful when the DOM fights back and structured responses are available

## Act

Use the safest matching action:

- `webpilot -c "click <selector|handleId>"`
- `webpilot -c "type <selector|el_handle> <text>"`
- `webpilot -c "clear <selector>"`
- `webpilot -c "key <name>"`
- `webpilot -c "sd [px] [selector]"`
- `webpilot -c "su [px] [selector]"`
- `webpilot -c "go <url>"`
- `webpilot -c "cookies load ./cookies.json"` — when the task requires restoring an existing session

`-c` accepts both a quoted whole command and unquoted trailing argv. These are equivalent:

```bash
webpilot -c "type el_2 hello world"
webpilot -c type el_2 hello world
```

Do not add shell quotes around typed text unless the literal quote characters should be typed into the page. `.http` toggles for the rest of an interactive REPL session. For one-shot `-c` invocations, prefix the command after `-c` because the client process exits when the command finishes; this is most useful for navigation/page-load activity:

```bash
webpilot -c .http go https://example.com
```

**`type` targets + chaining (v1.3.3+):** `type` takes a CSS **selector** (first char `#`/`.`/`[`, or contains `=`) **or** an `el_*` **handle** as its first token. Given either, `human.type` **chains the cursor-move + click + focus itself** — no preceding `click` needed:

```bash
webpilot -c "type .search-input hello world"   # selector — chains click+focus+type
webpilot -c "type el_42 hello world"            # handle (v1.3.3+) — same chain
```

Caveats: a bare tag selector (`input.foo`, no leading `#`/`.`/`[`) is treated as **literal text**, not a selector — always lead with `#`/`.`/`[`. `type` **appends** to existing content; `clear` the field first for a fresh value. (Pre-v1.3.3 the CLI typed handles literally and a manual `click` was required.)

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
- `click` and `type` both accept a selector or an `el_*` handle (v1.3.3+); both chain the human click. `type` selectors must lead with `#`/`.`/`[`.
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
