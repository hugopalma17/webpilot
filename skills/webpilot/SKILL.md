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

## Reading Results

Every `webpilot` command prints its output, then **one final status line**, and exits:

| Final line | Meaning | Exit code |
|---|---|---|
| `OK` or `OK: <summary>` | it worked, e.g. `OK: clicked #submit`, `OK: loaded https://example.com` | 0 |
| `OK (unconfirmed): <why>` | the action reached the page, but the page navigated away before it could confirm; check `url` or `html` before repeating it | 0 |
| `ERROR: <reason>` | it did not work; the reason is plain English and says what to do next | 1 |

A `[WARN] ...` line above the status line flags something worth knowing that did not stop the command (for example, a raw action that skipped the human pipeline).

The status line is the confirmation. Run commands directly and read the last line: do not wrap them in `timeout`, `sleep`, or polling loops waiting for a confirmation. Every command is bounded; one that gets no answer from the browser ends with an `ERROR` saying so (30 seconds by default, longer only when you pass a longer `timeout`).

## First Run (mandatory bootstrap, do this in order, every session)

Webpilot launches a real Chromium-based browser with its extension auto-injected via `--load-extension`. The extension dials back to the token-authenticated local runtime (a Node process listening on `ws://localhost:7331`). All of this is configured by `~/h17-webpilot/config.js`. The very first run on a new machine is **interactive** because it has to detect installed browsers and ask the user which one to use. That interactivity is the single most common reason new users hit `Extension not connected` from inside an agent.

When first-run setup asks for a browser, ask whether the user plans to browse manually while Webpilot runs. If yes, recommend a dedicated Webpilot browser, not the user's daily browser. Good splits include Helium/Chrome, Chromium/Chrome, Edge/Chrome, or Vivaldi/Chrome.

Webpilot always drives a real browser window; there is no headless mode. Any graphical session works: macOS, Windows, Linux on X11 or Wayland. A monitor is not required: on a machine running a desktop or Wayland compositor with no screen attached, the browser renders into the compositor as usual, and Webpilot finds the compositor's display on its own even when the agent shell has no `DISPLAY` or `WAYLAND_DISPLAY`. Only a server with no graphical session at all needs an emulated one:

```bash
xvfb-run -a webpilot start -d
```

`webpilot start` prints a warning naming this fix when it cannot find any graphical session.

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
- If the output is `config missing` and the user has already told you which browser to use, you can create the config without the prompt: `webpilot start -d --browser /path/to/browser`.
- Otherwise **stop and ask the user to complete first-run setup in a real terminal**, because the prompt requires interactive input that this agent shell cannot provide. Surface this verbatim:

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

Run this at the beginning of every session:

```bash
webpilot start -d
```

It is safe to run when Webpilot is already up: a runtime that is running, answering, and using the same config is reused, not restarted, so open tabs and logins are kept. It restarts only when it has to: a different `--config` or `--browser` was requested, the config file changed since it started, or the browser stopped answering. The output says which. To force a fresh browser, run `webpilot restart`.

**Wait for the command to return.** It ends with `OK: webpilot is running and ready ...` (or `... already running and ready ...`) only after a command has round-tripped through the browser extension. Do not send browser commands before that line. If it ends with `ERROR:`, read the reason; it says what to fix.

`-d` writes an append-only session log to `~/h17-webpilot/webpilot.log` (configurable via `framework.debug.sessionLogPath`). Always pass `-d` so the log exists if you need to debug later.

### Step 4 — Verify the connection

```bash
webpilot -c .tabs
```

- If it lists the open tabs and ends with `OK`, you are ready. Proceed to the rest of this skill.
- If it ends with **`ERROR: The browser extension is not connected ...`** after Steps 1–3 succeeded, the launched browser probably failed to start or crashed. **Do not retry, do not loop.** Surface this to the user:

> The webpilot runtime is up but the browser it tried to launch did not connect back. Likely cause: the browser binary path in `~/h17-webpilot/config.js` no longer exists (browser was uninstalled, moved, or updated to a new path). Open the config and verify the `browser:` field points to a real executable. If it does, share `~/h17-webpilot/server.log`, which holds what the launcher reported.

Wait for the user to fix or confirm before retrying.

## Command Form

Pass one browser command per call, wrapped in double quotes:

```bash
webpilot -c "click #submit"
webpilot -c "type #search hello world"
webpilot -c "go https://example.com"
webpilot -c html
```

Quote anything with a selector in it. Unquoted, the shell eats it before Webpilot sees it: `#submit` starts a shell comment, `[type=submit]` and `*` are glob patterns, and `>` redirects output to a file. Single words such as `html`, `discover`, `ss`, `url` need no quotes.

`-c` is optional: `webpilot go example.com` is the same as `webpilot -c "go example.com"`.

Everything after the target in `type` is typed as-is, including any quote characters.

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
- `webpilot -c .http go <url>` — also print the HTTP responses the page loads (method, status, URL); useful when the DOM fights back and the site has its own JSON API

## Act

Use the safest matching action:

- `webpilot -c "click <selector|handleId>"`
- `webpilot -c "type <selector|el_handle> <text>"`
- `webpilot -c "clear <selector|el_handle>"`
- `webpilot -c "key <name>"` — `Enter`, `Tab`, `Escape`, `Backspace`, `ArrowDown`, ... `Enter` in a form field submits the form like a real key press; the status line then says `submitted the form`, and the next page may still be loading, so `wait` for something on it
- `webpilot -c "sd [px] [selector]"`
- `webpilot -c "su [px] [selector]"`
- `webpilot -c "go <url>"`
- `webpilot -c back` / `webpilot -c forward` — move through the tab's history
- `webpilot -c .tabs`, then `webpilot -c ".tab <n>"` — switch to another tab (for example one a link opened); later commands act on it
- `webpilot -c "cookies load ./cookies.json"` — when the task requires restoring an existing session

**`type` targets + chaining (v1.3.3+):** `type` takes a CSS **selector** (first char `#`/`.`/`[`, or contains `=`) **or** an `el_*` **handle** as its first token. Given either, `human.type` **chains the cursor-move + click + focus itself** — no preceding `click` needed:

```bash
webpilot -c "type .search-input hello world"   # selector — chains click+focus+type
webpilot -c "type el_42 hello world"            # handle (v1.3.3+) — same chain
```

Caveats: a bare tag selector (`input.foo`, no leading `#`/`.`/`[`) is treated as **literal text**, not a selector — always lead with `#`/`.`/`[`. When that happens the status line says so: `OK: typed "input.foo hello" into the focused element (no target given ...)`. `type` **appends** to existing content; `clear` the field first for a fresh value.

**`click` accepts both** handle IDs and CSS selectors. Always `discover` or `q` immediately before interacting so handles and selectors are fresh.

`click` goes through the human action pipeline. It refuses targets that are covered, invisible, or look like bot traps, and says why: `ERROR: Did not click #submit: another element is covering it (div.cookie-banner) ...`. Respect the refusal: re-inspect the page and deal with what is in the way (close the banner, scroll, pick the visible control) instead of retrying the same click.

## Verify

After navigation or interaction, confirm the new state:

- `webpilot -c "wait <selector>"` — waits up to 5 seconds; `wait <selector> 15000` waits longer (max 60000 ms)
- `webpilot -c url`
- `webpilot -c title`
- `webpilot -c html`
- `webpilot -c "q <selector>"`

## Safe Usage Rules

- Never guess selectors when `html` or `discover` can tell you the real ones.
- Never assume a click worked. Verify it.
- Never brute-force through a refused click (`ERROR: Did not click ...`).
- Never confuse DOM reading with interaction. Read first, then act.
- Re-query stale handles instead of reusing them blindly.
- Prefer `html`, `q` and `discover` over `eval`: many sites block page scripts, and `eval` then ends with an `ERROR` naming the CSP.

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
- Navigate like a person: open the site with `go`, then move through it by clicking links, menus and buttons. Jumping between deep URLs with repeated `go` is not how people browse, and it skips the pages that set up state (cookies, redirects, consent).
- `go` ends with an `ERROR` when the page did not really load: a bad address, an unreachable server (after 30 seconds), or an HTTP error status such as 403, 404 or 429. Read the reason before retrying; a 403 or 429 usually means slow down or stop.
- Use `wait` after page-changing actions. `go` already waits for the page to load; if it reports the page was still loading after 30 seconds, `wait` for the element you need.
- `click` and `type` both accept a selector or an `el_*` handle (v1.3.3+); both chain the human click. `type` selectors must lead with `#`/`.`/`[`.
- Use screenshots when layout or visibility is the uncertainty, not HTML structure.
- If the task needs a preloaded authenticated session, load cookies first or use config boot commands.

## Limits

- Public defaults are generic and uncalibrated.
- This tool does not give you task strategy, retries, route doctrine, or tuned behavior profiles.
- Advanced outcomes depend on how well you choose selectors, waits, verification steps, and configuration.
