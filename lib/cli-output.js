"use strict";

// Final status line for every CLI command: "OK[: summary]" or "ERROR: <plain English>".
// Outcome shape: { ok: boolean, message: string, unconfirmed?: boolean, warning?: string }.
// A warning is printed as its own [WARN] line before the status line.

function ok(message = "", extra = {}) {
  return { ok: true, message, ...extra };
}

function fail(message) {
  return { ok: false, message };
}

function unconfirmed(message) {
  return { ok: true, unconfirmed: true, message };
}

function formatStatus(outcome) {
  if (!outcome || !outcome.ok) {
    return `ERROR: ${(outcome && outcome.message) || "the command failed for an unknown reason."}`;
  }
  const label = outcome.unconfirmed ? "OK (unconfirmed)" : "OK";
  return outcome.message ? `${label}: ${outcome.message}` : label;
}

function seconds(ms) {
  const s = Math.round((Number(ms) || 0) / 100) / 10;
  return `${s} second${s === 1 ? "" : "s"}`;
}

function describeTarget(params = {}) {
  if (params.handleId) return params.handleId;
  if (params.selector) return params.selector;
  return null;
}

const REFUSAL_REASONS = {
  avoided: (r) => `it matches an avoid rule in the webpilot config${r.rule ? ` (${r.rule})` : ""}`,
  "svg-element": () => "it is an SVG graphic; target the link or button that contains it",
  "aria-hidden": () => "it is marked aria-hidden, a common bot trap",
  "no-offsetParent": () => "it is not rendered on the page (display: none, or inside a hidden parent)",
  "honeypot-class": (r) => `its class names look like a bot trap${r.detail ? ` (${r.detail})` : ""}`,
  "opacity-zero": () => "it is fully transparent (opacity 0), a common bot trap",
  "visibility-hidden": () => "it is hidden (visibility: hidden)",
  "sub-pixel": (r) => `it is too small to be a real control${r.detail ? ` (${r.detail} px)` : ""}, a common bot trap`,
  "no-bounding-box": () => "it has no size on the page (not rendered)",
  "off-screen": () => "it could not be scrolled into view",
  "element-disappeared": () => "it disappeared from the page before the click",
  "element-shifted": (r) => `it kept moving on the page${r.detail && r.detail !== "correction-exhausted" ? ` (moved ${r.detail})` : ""}, so the click was cancelled`,
  "nothing-at-point": () => "nothing is drawn at its position on screen",
  occluded: (r) => `another element is covering it${r.detail ? ` (${r.detail})` : ""}`,
};

function refusalReason(result) {
  const r = result || {};
  const fn = REFUSAL_REASONS[r.reason];
  if (fn) return fn(r);
  if (r.reason) return `the page refused it (${r.reason}${r.detail ? `: ${r.detail}` : ""})`;
  return "the browser did not report why";
}

const REFUSAL_FOOTER = " Re-inspect the page (discover, q or html) and pick a visible target instead of retrying the same one.";

const ACTIVITY = {
  "human.click": "the click",
  "dom.click": "the click",
  "human.type": "typing",
  "dom.type": "typing",
  "human.clearInput": "clearing the field",
  "human.scroll": "scrolling",
  "dom.scroll": "scrolling",
  "dom.keyPress": "the key press",
  "dom.keyDown": "the key press",
  "dom.keyUp": "the key release",
  "dom.setValue": "setting the value",
  "dom.focus": "focusing",
  "dom.mouseMoveTo": "the mouse move",
  "dom.uploadFile": "the upload",
  "dom.evaluate": "the script",
  "dom.elementEvaluate": "the script",
};

const SET_VALUE_WARNING =
  "dom.setValue wrote the value straight into the field: no click, no keystrokes, no human timing, only input and change events. Sites that watch for real typing can tell. For text fields use type.";
const DOM_TYPE_WARNING =
  "dom.type typed instantly, without the click and human timing that type (human.type) adds. Sites that watch typing rhythm can tell.";
const ISOLATED_EVAL_WARNING =
  "The page's security policy (CSP) blocks scripts, so this ran in the extension's isolated world: the DOM was readable, but page JavaScript globals were not.";

const NET_ERRORS = [
  [/^ERR_NAME_NOT_RESOLVED$|^ERR_NAME_RESOLUTION_FAILED$/, "the domain name could not be found (check the spelling, or DNS is down)"],
  [/^ERR_CONNECTION_REFUSED$/, "the server refused the connection (nothing is listening at that address)"],
  [/^ERR_CONNECTION_(RESET|CLOSED|ABORTED)$/, "the server dropped the connection"],
  [/^ERR_(CONNECTION_)?TIMED_OUT$/, "the server did not respond in time"],
  [/^ERR_INTERNET_DISCONNECTED$/, "the computer is offline"],
  [/^ERR_ADDRESS_UNREACHABLE$|^ERR_NETWORK_CHANGED$/, "the address cannot be reached from this network"],
  [/^ERR_CERT_|^ERR_SSL_/, "the site's HTTPS certificate or secure connection is not valid"],
  [/^ERR_UNSAFE_PORT$/, "browsers refuse that port as unsafe; serve the page on another port"],
  [/^ERR_ABORTED$/, "the browser did not open it as a page (it may have become a download, or another app handles that kind of link)"],
  [/^ERR_BLOCKED_BY_CLIENT$/, "the browser or one of its extensions blocked it"],
  [/^ERR_BLOCKED_BY_/, "the site or a browser policy blocked it"],
  [/^ERR_TOO_MANY_REDIRECTS$/, "the site redirects in a loop"],
  [/^ERR_EMPTY_RESPONSE$/, "the server closed the connection without sending a page"],
  [/^ERR_FILE_NOT_FOUND$/, "the file does not exist"],
  [/^ERR_(INVALID_URL|UNKNOWN_URL_SCHEME|DISALLOWED_URL_SCHEME)$/, "the URL is not valid"],
];

const HTTP_STATUS = {
  400: "Bad Request",
  401: "Unauthorized: the page needs a login",
  403: "Forbidden: the site refused the request, often bot protection",
  404: "Not Found",
  410: "Gone",
  429: "Too Many Requests: the site is rate-limiting, so slow down",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

function httpStatusError(url, status) {
  const text = HTTP_STATUS[status];
  return `Loaded ${url || "the page"}, but the server answered HTTP ${status}${text ? ` (${text})` : ""}. What is shown is the site's error page; read it with title or html before deciding what to do next.`;
}

function navigationError(url, rawError) {
  const code = String(rawError || "").replace(/^net::/, "");
  const where = url ? `Could not load ${url}` : "The page did not load";
  if (!code) return `${where}: the browser showed an error page.`;
  for (const [re, text] of NET_ERRORS) {
    if (re.test(code)) return `${where}: ${text} (${code}).`;
  }
  return `${where}: the browser reported ${code}.`;
}

const CANNOT_REACH_PAGE =
  "Webpilot could not reach this page. Browser pages (chrome:// URLs, the new tab page, the extension store) cannot be controlled, so open a normal web page with go <url>. If this is a normal page it may still be loading: run the command again in a moment.";

const ERROR_RULES = [
  [/^not connected$/i, () => "Lost the connection to the webpilot runtime before the command was sent. Run webpilot start, then try again."],
  [/^connection to the runtime closed$/i, () => "The webpilot runtime closed the connection before answering (it stopped or restarted). Run webpilot start, check the page with url or html, then try again."],
  [/timed out \((\d+(?:\.\d+)?)s\)/i, (m) => `The browser did not answer within ${m[1]} seconds. The command may still have run: check the page with url, html or ss before repeating it.`],
  [/Extension not connected/i, () => "The browser extension is not connected to the webpilot runtime (the browser is closed or still starting). Run webpilot start, then try again."],
  [/Extension disconnected/i, () => "The browser extension disconnected while the command was running (the browser closed or restarted). Run webpilot start, check the page, then try again."],
  [/Element not found: (.+)/i, (m) => `No element on the current page matches ${m[1]}. Inspect the page with discover, q or html and use a selector or el_ handle from there.`],
  [/Handle (\S+) not found/i, (m) => `Handle ${m[1]} is no longer valid: the page changed or reloaded since it was issued. Run discover or q again for a fresh handle.`],
  [/Handle (\S+) was garbage collected/i, (m) => `Handle ${m[1]} points to an element that was removed from the page. Run discover or q again for a fresh handle.`],
  [/No handleId or selector provided/i, () => "This command needs a CSS selector or an el_ handle."],
  [/No target for typing/i, () => "There is no focused field to type into. Give a target: type <selector|el_handle> <text>."],
  [/Receiving end does not exist|Could not establish connection|Cannot access (a|contents)|chrome:\/\/|chrome-extension:\/\/|extensions gallery cannot be scripted|Missing host permission/i, () => CANNOT_REACH_PAGE],
  [/No tab with id:? ?(\d+)/i, (m) => `Tab ${m[1]} no longer exists. Run .tabs to see the open tabs.`],
  [/No tabs available/i, () => "The browser has no open tabs. Open one with go <url>."],
  [/Cannot find a (next|previous) page in history/i, () => "There is no page to go to in this tab's history."],
  [/No response from content script/i, () => "The page did not answer; it may have been reloading. Run the command again. If it keeps happening, restart with webpilot restart."],
  [/Unknown action: (\S+)/i, (m) => `${m[1]} is not a webpilot action. Run webpilot .help to see the commands. If the name is right, the browser is running an old copy of the extension: restart it with webpilot restart.`],
  [/Evaluate timed out/i, () => "The script did not finish within 5 seconds."],
  [/ISOLATED error: (.+?)\.?$/i, (m) => `This page's security policy (CSP) blocks page scripts, and running it in the extension's isolated world failed too (${m[1]}). Read the page with html, q or discover instead.`],
  [/Evaluate failed/i, () => "This page's security policy (CSP) blocks running scripts. Read the page with html, q or discover instead."],
  [/filePath escapes upload directory/i, () => "The upload file must be inside the upload directory (config uploadDir, or the folder webpilot start ran from)."],
  [/File read error: (.+)/i, (m) => `Could not read the upload file: ${m[1]}`],
  [/ECONNREFUSED/i, (m, ctx) => `Nothing is listening at ${ctx.addr || "the webpilot address"}: the webpilot runtime is not running. Run webpilot start, then try again.`],
  [/Invalid url: "(.*)"/i, (m) => `"${m[1]}" is not a valid URL.`],
  [/Unexpected server response: (401|403)/i, () => "The webpilot runtime refused the connection because its access token did not match. Restart it with webpilot restart."],
];

function sentence(text) {
  const t = String(text || "").trim();
  if (!t) return "The command failed for an unknown reason.";
  const first = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

function plainError(raw, ctx = {}) {
  let message = raw && raw.message !== undefined ? raw.message : raw;
  message = String(message || "").split("\n\n")[0].trim();
  for (const [re, build] of ERROR_RULES) {
    const m = message.match(re);
    if (m) return build(m, ctx);
  }
  return sentence(message);
}

function isNavigatedAway(message) {
  return /navigated away/i.test(String(message || ""));
}

// Error from the transport or the extension, mapped to an outcome.
function outcomeFromError(err, ctx = {}) {
  const message = err && err.message !== undefined ? err.message : String(err || "");
  const { action, command } = ctx;
  if (isNavigatedAway(message)) {
    if (command === "back" || command === "forward") {
      return unconfirmed(`went ${command} in history. Use url to see where the browser landed.`);
    }
    const activity = ACTIVITY[action] || action || "the command";
    return unconfirmed(`the page navigated away while ${activity} was running. It reached the page, but its result could not be read. Check url or html before repeating it.`);
  }
  return fail(plainError(message, ctx));
}

// Result from the extension, mapped to an outcome.
function outcomeFromResult(action, params = {}, result, ctx = {}) {
  const target = describeTarget(params);
  const r = result && typeof result === "object" && !Array.isArray(result) ? result : null;

  if (r && r.navigatedAway) {
    const activity = ACTIVITY[action] || action;
    return unconfirmed(`the page navigated away while ${activity} was running. It reached the page, but webpilot could not confirm it finished. Check url or html before repeating it.`);
  }

  switch (action) {
    case "human.click":
    case "dom.click":
      if (r && r.clicked) return ok(`clicked ${target || "the element"}`);
      return fail(`Did not click ${target || "the element"}: ${refusalReason(r)}.${REFUSAL_FOOTER}`);

    case "human.type":
    case "dom.type": {
      if (r && r.typed === false) {
        return fail(`Did not type into ${target || "the field"}: ${refusalReason(r)}.${REFUSAL_FOOTER}`);
      }
      const text = String(params.text ?? "");
      const count = `${text.length} character${text.length === 1 ? "" : "s"}`;
      const extra = action === "dom.type" ? { warning: DOM_TYPE_WARNING } : {};
      if (target) return ok(`typed ${count} into ${target}`, extra);
      return ok(`typed "${text}" into the focused element (no target given: a target must start with #, . or [, or be an el_ handle)`, extra);
    }

    case "human.clearInput":
      if (r && r.cleared) return ok(`cleared ${target || "the field"}`);
      return fail(`Did not clear ${target || "the field"}: ${refusalReason(r)}.${REFUSAL_FOOTER}`);

    case "human.scroll":
    case "dom.scroll": {
      const direction = params.direction || "down";
      if (r && r.scrolled) return ok(`scrolled ${direction} ${Math.round(r.amount || 0)}px`);
      const edge = direction === "up" ? "top" : direction === "down" ? "bottom" : "edge";
      return ok(`nothing moved: already at the ${edge}, or there is nothing to scroll here`);
    }

    case "tabs.navigate":
      if (r && r.success === false && r.timeout) {
        return fail(`${params.url} did not respond within 30 seconds: the server is unreachable or far too slow. Check the address before trying again.`);
      }
      if (r && r.success === false) return fail(navigationError(params.url, r.error));
      if (r && r.status >= 400) return fail(httpStatusError(params.url, r.status));
      if (r && r.timeout) return ok(`opened ${params.url}, but it was still loading after 30 seconds. Use wait <selector> before reading it`);
      return ok(`loaded ${params.url}`);

    case "tabs.reload":
      if (r && r.success === false && r.timeout) return fail("The page did not respond within 30 seconds after the reload.");
      if (r && r.success === false) return fail(navigationError(null, r.error));
      if (r && r.status >= 400) return fail(httpStatusError(null, r.status));
      if (r && r.timeout) return ok("reloaded, but the page was still loading after 30 seconds");
      return ok("reloaded the page");

    case "tabs.goBack":
    case "tabs.goForward": {
      const where = action === "tabs.goBack" ? "back" : "forward";
      if (r && r.success === false && r.error === "no-history") {
        return fail(`There is no page to go ${where} to in this tab's history.`);
      }
      if (r && r.success === false) return fail(navigationError(null, r.error));
      if (r && r.timeout) return ok(`went ${where}, but the page was still loading after 30 seconds`);
      return ok(`went ${where} in history`);
    }

    case "tabs.waitForNavigation":
      if (r && r.success === false) return fail(navigationError(null, r.error));
      if (r && r.timeout) return fail(`No page load finished within ${seconds(params.timeout || 30000)}.`);
      return ok("page load finished");

    case "dom.waitForSelector":
      if (result == null) {
        return fail(`${params.selector} did not appear within ${seconds(params.timeout || 5000)}. Check the page with html or q, or wait longer: wait <selector> <ms>.`);
      }
      return ok(`${params.selector} is on the page (${result})`);

    case "dom.querySelector":
      if (result == null) return ok(`no element matches ${params.selector}`);
      return ok();

    case "dom.queryAllInfo":
    case "dom.querySelectorAll":
      if (Array.isArray(result) && result.length === 0) return ok(`no elements match ${params.selector}`);
      return ok();

    case "dom.boundingBox":
      if (result == null) return fail(`${target || "The element"} has no size on the page (it is hidden or not rendered).`);
      return ok();

    case "dom.keyPress":
      if (r && r.submitted) {
        return ok(`pressed ${params.key} and submitted the form; the next page may still be loading, so wait for something on it before reading`);
      }
      return ok(`pressed ${params.key}`);
    case "dom.keyDown":
      return ok(`holding ${params.key} down`);
    case "dom.keyUp":
      return ok(`released ${params.key}`);
    case "dom.focus":
      return ok(`focused ${target || "the element"}`);
    case "dom.setValue":
      return ok(`set the value of ${target || "the element"}`, { warning: SET_VALUE_WARNING });
    case "dom.uploadFile":
      return ok(`attached ${(r && r.fileName) || "the file"} to ${target || "the file input"}`);

    case "dom.evaluate":
      if (ctx.command === "back" || ctx.command === "forward") {
        return ok(`went ${ctx.command} in history. Use url to see where the browser landed`);
      }
      if (r && typeof r.warning === "string" && /isolated world/i.test(r.warning)) {
        return ok("", { warning: ISOLATED_EVAL_WARNING });
      }
      return ok();

    case "tabs.create":
      return ok(`opened a new tab${r && r.id ? ` (id ${r.id})` : ""}`);
    case "tabs.close":
      return ok("closed the tab");
    case "tabs.activate":
      return ok("switched to the tab");
    case "tabs.setViewport":
      return ok(`resized the window to ${params.width}x${params.height}`);
    case "cookies.set":
      return ok("cookie set");
    case "framework.shutdown":
      return ok("the webpilot runtime is shutting down");
    case "framework.reload":
      return ok("the extension is reloading. If the next command says the extension is not connected, run webpilot restart");

    default:
      if (r && r.success === false) {
        return fail(sentence(r.error || r.reason || `${action} reported a failure`));
      }
      if (r && (r.clicked === false || r.typed === false || r.cleared === false)) {
        return fail(`${action} was refused: ${refusalReason(r)}.${REFUSAL_FOOTER}`);
      }
      return ok();
  }
}

module.exports = {
  ok,
  fail,
  unconfirmed,
  formatStatus,
  plainError,
  navigationError,
  httpStatusError,
  outcomeFromError,
  outcomeFromResult,
};
