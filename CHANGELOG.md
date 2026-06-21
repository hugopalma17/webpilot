# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
