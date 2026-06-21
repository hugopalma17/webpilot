# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
