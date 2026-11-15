# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 15-11-26

### Changed

- Every CLI command ends with one status line: `OK[: summary]`, `OK (unconfirmed): ...`, or `ERROR: <plain-English reason>`, with exit code 0 or 1. Pipe mode prints one per command and exits 1 if any failed. Raw `dom.setValue` and `dom.type`, and `eval` falling back to the isolated world, print a `[WARN]` line.
- `webpilot start` reuses a running runtime that answers and uses the same config (path and contents). It restarts only for a different `--config`/`--browser`, an edited config, a newly requested `-d`, or a browser that stopped answering, and says which. New `webpilot restart` forces a restart.
- Browser commands run without `-c`: `webpilot go example.com`.
- `wait <selector> [ms]` takes an optional timeout; `clear` accepts `el_` handles.
- In single-command mode, `.tab <n>` activates the tab so later commands act on it.
- `ss` and `dump` print absolute paths.
- Pin `ws` to 8.21.0.

### Fixed

- Missing arguments (`click`, `go`, ...), unknown commands, invalid JSON, `.tab`, and `cookies load` no longer hang for 36 seconds with no output; they fail at once with the reason. A `#selector` lost to an unquoted shell comment is called out.
- Commands without an answer from the browser now end in an `ERROR` instead of exiting 0 silently; long `timeout` params get a matching client wait.
- `go`/`reload` report pages that failed to load (DNS, refused connection, certificate, ...) instead of `{ success: true }`: the protocol now returns `{ success: false, error }`, and the Node API's `page.goto()`/`page.reload()` reject (like Puppeteer), with `err.code` such as `ERR_NAME_NOT_RESOLVED`.
- When a page navigates away mid-action, page-changing actions are no longer replayed on the next page, and scripts are no longer re-run in other worlds. The action reports `navigatedAway` instead.
- A script that ran and threw (or timed out) is no longer run again by the fallback strategies; its own error is reported instead of a CSP message. `chrome.scripting` swallowed exceptions (the result was `null`); evaluate now reports them.
- Behaviour change for the Node API: `page.evaluate()` on a page whose CSP blocks every evaluation strategy now rejects with the CSP error instead of resolving `null`.
- `go` validates the address first (spaces, mistyped or unsupported schemes such as `htp:` or `javascript:` fail at once with a suggestion), reports a server that never answers as an `ERROR` after 30 seconds instead of `OK ... still loading`, reports cancelled navigations (downloads, OS-handled links), and treats HTTP 4xx/5xx answers as an `ERROR` that names the status. `tabs.navigate` results carry the main-frame `status`; `page.goto()` returns it without throwing on HTTP errors, like Puppeteer.
- `back`/`forward` use the browser's history from the extension (`tabs.goBack`/`tabs.goForward` actions) instead of page JavaScript, so they work on CSP-strict pages (they silently did nothing there), wait for the page like `go`, and say when there is no page to go to.
- `click` no longer refuses visible elements it cannot scroll into the central comfort band (left/right window edges, short pages), and no longer scrolls the page up and down trying; `position: fixed` controls are no longer refused as "not rendered", and a visible control inside a fixed layer (header, floating button, modal) is clicked without scrolling the page.
- `stop` and config-change restarts use the running instance's config, so they no longer stop another instance's browser by profile; `restart` waits for the old runtime to exit before starting the new one.
- Options placed after a command (`webpilot go x --port 7332`) are refused instead of being typed or navigated to; `.quit`/`.exit` keep the status line and exit code.
- A deferred `human.click` that would land on a covering element is refused before reporting `clicked: true`.
- `key Enter` in a form field submits the form the way a real key press does (default submit button, or a one-field form), unless the page cancels the keydown or keypress. Synthetic key events never triggered the browser's own submission, so searches typed by agents silently went nowhere.
- `eval`, `back` and `forward` no longer wait 5 seconds on browsers that block content-script inline scripts (seen on Chromium 155): the blocked attempt is detected at once and the next strategy runs.
- A script that navigates the page while `chrome.scripting` is still waiting on it reports `navigatedAway` instead of hanging until the command timeout.
- The launcher drops the profile's cached service workers when the extension worker files change, once no process uses the profile. Chrome otherwise keeps running the cached extension worker across restarts and version bumps, so upgrades did not take effect in existing profiles. Site service workers and their caches in the webpilot profile are cleared at the same time and re-register on the next visit.
- A browser that crashes or cannot be found at launch fails `start` at once with its own error (kept in `~/h17-webpilot/browser.log`) instead of waiting out `connectionTimeout`; on a Wayland-only session the launcher adds `--ozone-platform=wayland` unless `browserArgs` choose a platform.
- Linux launcher accepts `WAYLAND_DISPLAY`, and finds the compositor's `wayland-N` socket in `XDG_RUNTIME_DIR` when an agent shell has no display variables (a monitor is not required). The no-session warning points to `xvfb-run` for servers instead of XFCE.
- Stale-extension hint says `webpilot restart` instead of `node index.js`.

### Documentation

- Skill and README document the status line, double-quoting selectors, headless machines via `xvfb-run`, and the idempotent `start`. The skill drops the MCP section (the MCP server left this repo in 5ba52cc) and the stale SIGPIPE warning (the daemon is detached with its stdio ignored).

## [1.4.4] - 15-09-26

### Documentation

- Publish the full README update covering positioning, setup, usage, and deployment guidance.

## [1.4.3] - 15-09-26

### Fixed

- Let selector-free `sd` and `su` find the visible scrollable panel when the document cannot scroll.
- Return at vertical scroll boundaries for large amounts instead of continuing flicks until the command times out. Randomized motion and pauses are preserved.

### Tests

- Extend the existing CLI fixture with window/panel scrolling, large requests, boundary responses, and immediate/delayed lazy loading.

## [1.3.6] - 2026-06-21

### Security

- Keep the token-authenticated local WebSocket model and harden extension token delivery by fetching the generated runtime token config with `cache: "no-store"` and a per-load cache buster.
- Share token URL handling between the CLI and Node API so both attach the per-run token from `~/h17-webpilot/token`.
- Add regression coverage for missing/wrong tokens, web-page Origin rejection, rotating `chrome-extension://` Origins, extension handshakes, Node API auth, stale `token.json` avoidance, and CLI `type el_* ...` target preservation.
- Make `webpilot start` print `server ready` only after an authenticated command succeeds through the injected extension.
- On Linux, infer a desktop `DISPLAY`/`XAUTHORITY` from `~/.Xauthority` when the shell lacks `DISPLAY`, print a yellow `[WARN]`, and launch normal Chromium rather than headless mode.

### Fixed

- Accept unquoted trailing argv after `-c`, so `webpilot -c type el_2 hello world` is parsed as the same command as `webpilot -c "type el_2 hello world"`.
- Allow `webpilot -c .http <command...>` to enable HTTP response printing for that one-shot command, especially around navigation/page-load commands.

### Documentation

- Recommend a dedicated browser split only when users want to browse manually while Webpilot automates in parallel.

## [1.3.5] - 2026-06-21

### Security

- Restrict `dom.uploadFile` to paths inside the configured upload directory (default: current working directory). Relative paths that escape the directory are now rejected, preventing path-traversal uploads.
- Move persisted cookie jar from the current working directory (`cookies.json`) to `~/h17-webpilot/cookies.json`. The location can be overridden with the `cookiePath` config option.

### Fixed

- Remove duplicate `tabs.reload` handler in the extension service worker.
- Restrict npm publish workflow to SemVer tag patterns and update Node.js to 22.
- Keep package and extension manifest versions in sync.

### Added

- New optional config fields: `uploadDir` and `cookiePath`.

## [1.3.4] - Previous release

- Local WebSocket bridge with per-run token, Origin rejection, and loopback bind.
- CLI, Node API, and Chrome extension for browser automation.
