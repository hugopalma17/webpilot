---
name: human-browser
description: Skill for LLM agents to browse the web using the Human Browser CLI. Human-like mouse, typing, scrolling, and trap detection. No CDP, no navigator.webdriver.
---

# Human Browser — LLM Navigation Skill

You control a real Chrome browser. A Chrome extension executes your commands in-page with human-like behavior (bezier curves, randomized timing, honeypot detection). No CDP, no debugging port, no `navigator.webdriver`.

## Setup

```bash
npm install -g h17-webpilot
webpilot start              # launches browser + server (detached)
```

Server auto-starts if not running when you use `-c`.

## How to Use

Run commands via bash with `webpilot -c`:

```bash
npx webpilot -c 'go example.com'
npx webpilot -c 'discover'
npx webpilot -c 'click button[type="submit"]'
npx webpilot -c 'type #search hello world'
npx webpilot -c 'ss'
```

Each call connects, sends the command, prints the result, and exits. Chain actions with separate calls — one command per invocation.

## Mental Model

You are **blind**. Before every action:

1. **Look** — `html`, `discover`, `q <selector>`, or `ss`
2. **Think** — pick the right element from what you actually saw
3. **Act** — `click`, `type`, `key`, `sd`/`su`
4. **Verify** — re-read the page to confirm the action worked

Never guess selectors. Never assume page state. Always look first.

## Command Reference

### Navigation

| Command | Description |
|---------|-------------|
| `go <url>` | Navigate (auto-adds `https://`) |
| `reload` | Reload page |
| `back` / `forward` | History navigation |
| `sd [px] [selector]` | Scroll down (default ~300px) |
| `su [px] [selector]` | Scroll up |

### Look (use constantly)

| Command | Description |
|---------|-------------|
| `html` | Full page HTML — title, URL, and DOM. Your primary tool for understanding page structure and extracting data. |
| `discover` | All interactive elements (links, buttons, inputs) with labels and roles. Use before clicking. |
| `q <selector>` | Query matching elements — returns handle IDs + tag/class/text/label per match. |
| `wait <selector>` | Block until selector appears (use after navigation or clicks that change the page). |
| `ss` | Screenshot (saves PNG). Use when you need visual context. |
| `box <selector>` | Bounding box — check if element is visible/on-screen. |
| `frames` | List all iframes in the page. |

### Interact

| Command | Description |
|---------|-------------|
| `click <selector\|handleId>` | Human click — bezier cursor movement, honeypot checks, timing variance. |
| `type [selector] <text>` | Human type — character-by-character with randomized cadence. Selector auto-detected if starts with `#`, `.`, `[`, or `=`. |
| `clear <selector>` | Clear an input field (focus + select all + delete). |
| `key <name>` | Key press — `Enter`, `Tab`, `Escape`, `ArrowDown`, etc. |
| `eval <js>` | Evaluate JavaScript expression. May fail on strict-CSP sites. |
| `cookies` | Dump all cookies. |
| `dump` | Save cookies + screenshot + HTML to timestamped directory. |

### Tabs

| Command | Description |
|---------|-------------|
| `.tabs` | List open tabs with 0–9 aliases. |
| `.tab <n>` | Switch to tab by alias. |

### Raw Protocol

Any protocol command can be sent directly:

```bash
npx webpilot -c 'dom.queryAllInfo {"selector": "a[href]"}'
npx webpilot -c 'human.scroll {"selector": ".feed", "direction": "down"}'
npx webpilot -c 'dom.waitForSelector {"selector": ".results", "timeout": 8000}'
```

Format: `action.name {json params}`

## Recipes

### Search form

```bash
npx webpilot -c 'go google.com'
npx webpilot -c 'html'                          # find the search input
npx webpilot -c 'click textarea[name="q"]'
npx webpilot -c 'type my search query'
npx webpilot -c 'key Enter'
npx webpilot -c 'wait #search'                  # wait for results
npx webpilot -c 'html'                          # read results
```

### Scroll and read

```bash
npx webpilot -c 'go news.ycombinator.com'
npx webpilot -c 'html'                          # read initial content
npx webpilot -c 'sd'                            # scroll down
npx webpilot -c 'html'                          # read new content
npx webpilot -c 'sd'                            # scroll more
npx webpilot -c 'html'                          # repeat until done
```

### Login

```bash
npx webpilot -c 'go example.com/login'
npx webpilot -c 'discover'                      # find form fields
npx webpilot -c 'click #email'
npx webpilot -c 'type user@example.com'
npx webpilot -c 'click #password'
npx webpilot -c 'type mypassword'
npx webpilot -c 'click button[type="submit"]'
npx webpilot -c 'wait .dashboard'               # confirm login succeeded
```

### Fill a multi-step form

```bash
npx webpilot -c 'html'                          # understand current step
npx webpilot -c 'click #first-name'
npx webpilot -c 'type Hugo'
npx webpilot -c 'click #last-name'
npx webpilot -c 'type Palma'
npx webpilot -c 'click button.next'
npx webpilot -c 'wait .step-2'                  # wait for next step
npx webpilot -c 'html'                          # read new step
```

### Read structured content

```bash
npx webpilot -c 'html'                          # get full DOM
# Parse the HTML output to find what you need.
# For specific elements:
npx webpilot -c 'q .product-card'               # get handles + summary
npx webpilot -c 'dom.elementHTML {"handleId": "el_3"}'  # full HTML of one element
```

## Safety Layer

`click` uses the human pipeline — it refuses to click unsafe elements and returns a reason:

| Reason | Meaning | Action |
|--------|---------|--------|
| `avoided` | Matched an avoid rule | Check if rules are too broad |
| `no-offsetParent` / `sub-pixel` | Hidden or off-screen | Scroll first, then retry |
| `honeypot-class` | Trap element (sr-only, ghost, etc.) | Do not click |
| `element-disappeared` | Gone from DOM | Re-query with `q`, retry |
| `element-shifted` | Moved during think time | Wait, then retry |
| `aria-hidden` / `opacity-zero` / `visibility-hidden` | Invisible | Find the visible version |

**Respect refusals. Do not force-click.**

## Waiting

**#1 source of failures.** Pages don't load instantly. After every navigation or click that changes the page:

```bash
npx webpilot -c 'wait .expected-element'
```

If the wait times out, don't retry blindly — run `html` to see what actually loaded.

## Recovery

- **Stale handle**: Re-query with `q <selector>` to get a fresh handle ID.
- **Unexpected page**: Run `html` to check the URL and DOM. Navigate back or close popups as needed.
- **Timeout / no response**: Run `.tabs` to check if the extension is alive. Try `reload`.

## Selector Strategy

**Never guess selectors.** Always derive them from `html` or `discover` output.

Good (most to least stable):
1. IDs: `#login-form`
2. Data attributes: `[data-testid="submit"]`, `[aria-label="Search"]`
3. Semantic HTML: `button[type="submit"]`, `input[name="email"]`
4. Role: `[role="dialog"]`
5. Structural: `.header > nav a` — fragile, last resort

Bad: hashed classes (`.css-1a2b3c`), deep paths, anything you haven't verified in the actual HTML.

## Do Not

- Guess selectors — always look first
- Skip waiting after navigation
- Retry a refused click without understanding the reason
- Use `eval` when `html` would work
- Treat `{ clicked: false }` as an error to force through

## Advanced: WebSocket API

For programmatic integration from any language, connect directly to `ws://localhost:7331` and send JSON:

```json
{ "id": "1", "action": "tabs.navigate", "params": { "url": "https://example.com" } }
```

Full protocol spec: `protocol/PROTOCOL.md`
