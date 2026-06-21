# Security Policy

## Threat model

Webpilot drives a real browser on your machine. It runs three local parts: a Chromium based browser with a bundled extension, a WebSocket server, and a client (the CLI, the Node API, or a raw WebSocket caller). All three are meant to run on the same machine, under the same user.

The server is designed to stay local and authenticated:

- It binds to `127.0.0.1`, so it is not reachable from other machines on the network.
- It requires a per-run token. Each `webpilot start` generates a fresh token and writes it to `~/h17-webpilot/token`. Connections without the token are refused. The token rotates on every run.
- It rejects WebSocket handshakes that carry a browser `Origin` header, so a web page cannot reach the server even from the same machine.

## Behaviors that look risky but are intended

Static scanners sometimes flag two things. Both are core features, not backdoors.

### Script execution in the page

The `dom.evaluate` command runs caller supplied JavaScript inside the page. This is the point of a browser automation tool. It only runs for commands sent over the authenticated local socket. There is no path for a remote party or an arbitrary web page to inject code, because the socket is loopback only, token gated, and Origin rejecting.

### Cookie access over the socket

The `cookies` command reads browser cookies and returns them over the WebSocket. The destination is the local `127.0.0.1` server, not a remote host. Nothing leaves the machine. Cookie access exists so you can save and restore your own logged in sessions. What you do with a saved cookie jar is up to you, and you should treat exported cookies like any other credential.

## Supported versions

Security fixes land on the latest published version. The loopback bind, per-run token, and Origin rejection were introduced together. If you run a version without them, upgrade.

```bash
npm install -g h17-webpilot
```

## Security fixes by version

### 1.3.5

- **`dom.uploadFile` path containment**: Previously, a relative `filePath` could walk outside the intended directory. Upload paths are now resolved against `config.uploadDir` (defaulting to the current working directory) and rejected if they escape that root.
- **Cookie jar location**: Persisted cookies were written to `cookies.json` in the process working directory, which could leak session data to an unexpected location. They are now saved to `~/h17-webpilot/cookies.json` by default, configurable via `config.cookiePath`.

## Reporting a vulnerability

If you find a security issue, please do not open a public issue first. Report it privately:

- Open a GitHub security advisory on the repository, or
- Email the maintainer at the address listed on the npm package and GitHub profile.

Include the version, a description, and steps to reproduce. You will get an acknowledgement, and a fix or explanation will follow. Coordinated disclosure is appreciated.
