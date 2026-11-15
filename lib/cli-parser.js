"use strict";

function reportError(options, label, message) {
  if (options && typeof options.onError === "function") {
    options.onError(label, message);
  }
}

function isSelectorToken(token) {
  return (
    token.startsWith("#") ||
    token.startsWith(".") ||
    token.startsWith("[") ||
    token.includes("=")
  );
}

function parseScroll(parts, direction) {
  const params = { direction };
  for (const part of parts.slice(1)) {
    if (/^\d+$/.test(part)) params.amount = parseInt(part, 10);
    else params.selector = part;
  }
  return params;
}

// Shell-unquoted "#id" starts a comment, so the target never reaches the CLI.
const QUOTE_HINT =
  ' If the target starts with #, quote the whole command, e.g. webpilot -c "click #submit": unquoted, the shell treats #... as a comment and drops it.';

function missing(options, what, example, selectorHint = true) {
  reportError(
    options,
    "missing argument",
    `${what}. Example: ${example}.${selectorHint ? QUOTE_HINT : ""}`,
  );
  return null;
}

function normalizeUrl(input) {
  if (input.includes("://")) return input;
  return input.startsWith("localhost") || input.startsWith("127.0.0.1")
    ? "http://" + input
    : "https://" + input;
}

const GO_SCHEMES = new Set(["http:", "https:", "file:", "about:", "chrome:", "data:", "view-source:"]);

// { url } for something the browser can open as a page, or { error } in plain English.
function resolveGoUrl(input) {
  const raw = String(input || "").trim();
  if (/\s/.test(raw)) {
    return { error: `"${raw}" has a space in it, and URLs cannot contain spaces. Encode them as %20, or check that the URL was not split in two.` };
  }
  let candidate = raw;
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i);
  const hostPort = /^[a-z0-9.-]+:\d/i.test(raw);
  if (scheme && !hostPort) {
    const protocol = `${scheme[1].toLowerCase()}:`;
    if (protocol === "javascript:") {
      return { error: "go opens pages; to run JavaScript use eval <expression>." };
    }
    if (!GO_SCHEMES.has(protocol)) {
      const rest = raw.slice(scheme[0].length).replace(/^\/+/, "");
      const typo = /^[htps]{2,7}$/i.test(scheme[1]);
      return { error: `go cannot open "${protocol}" URLs; it opens web pages (http and https).${typo ? ` Did you mean https://${rest}?` : ""}` };
    }
  } else {
    candidate = normalizeUrl(raw);
  }
  try {
    new URL(candidate);
  } catch {
    return { error: `"${raw}" is not a valid URL. Example: go example.com or go https://example.com/path.` };
  }
  return { url: candidate };
}

function parseCommandArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return null;

  const tokens = argv.slice();
  let showHttp = false;
  if (tokens[0] === ".http" && tokens.length > 1) {
    showHttp = true;
    tokens.shift();
  }

  return {
    command: tokens.join(" "),
    showHttp,
  };
}

function resolveLine(line, options = {}) {
  if (!line || typeof line !== "string") return null;
  line = line.trim();
  if (!line) return null;

  if (line.startsWith("{")) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      reportError(
        options,
        "invalid JSON",
        `The command starts with { but is not valid JSON (${err.message}). Expected: {"action": "tabs.navigate", "params": {"url": "https://example.com"}}`,
      );
      return null;
    }
    if (!msg || typeof msg.action !== "string" || !msg.action) {
      reportError(options, "invalid JSON", 'The JSON command has no "action" field. Expected: {"action": "tabs.navigate", "params": {"url": "https://example.com"}}');
      return null;
    }
    return { action: msg.action, params: msg.params || {} };
  }

  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const rest = parts.slice(1).join(" ");

  switch (cmd) {
    case "go":
    case "nav":
    case "navigate":
    case "goto":
      if (!rest) return missing(options, "go needs a URL", "go example.com", false);
      {
        const target = resolveGoUrl(rest);
        if (target.error) {
          reportError(options, "invalid URL", target.error);
          return null;
        }
        return { action: "tabs.navigate", params: { url: target.url } };
      }

    case "click":
      if (!rest) return missing(options, "click needs a target (CSS selector or el_ handle)", 'click "#submit" or click el_3');
      return rest.startsWith("el_")
        ? { action: "human.click", params: { handleId: rest } }
        : { action: "human.click", params: { selector: rest } };

    case "type": {
      if (!rest) return missing(options, "type needs text, optionally after a target", 'type "#search" hello world');
      const first = parts[1];
      if (parts.length > 2 && first.startsWith("el_")) {
        return {
          action: "human.type",
          params: { handleId: first, text: parts.slice(2).join(" ") },
        };
      }
      if (parts.length > 2 && isSelectorToken(first)) {
        return {
          action: "human.type",
          params: { selector: first, text: parts.slice(2).join(" ") },
        };
      }
      return { action: "human.type", params: { text: rest } };
    }

    case "sd":
      return { action: "human.scroll", params: parseScroll(parts, "down") };

    case "su":
      return { action: "human.scroll", params: parseScroll(parts, "up") };

    case "q":
    case "query":
      if (!rest) return missing(options, "q needs a CSS selector", 'q "a[href]"');
      return { action: "dom.queryAllInfo", params: { selector: rest } };

    case "wait": {
      if (!rest) return missing(options, "wait needs a CSS selector, optionally followed by a timeout in ms", 'wait "#results" or wait "#results" 15000');
      const last = parts[parts.length - 1];
      if (parts.length > 2 && /^\d+$/.test(last)) {
        return {
          action: "dom.waitForSelector",
          params: { selector: parts.slice(1, -1).join(" "), timeout: parseInt(last, 10) },
        };
      }
      return { action: "dom.waitForSelector", params: { selector: rest } };
    }

    case "eval":
    case "js": {
      if (!rest) return missing(options, "eval needs a JavaScript expression", "eval document.title", false);
      let fn = rest;
      if (!fn.startsWith("()") && !fn.startsWith("function")) fn = "() => " + fn;
      return { action: "dom.evaluate", params: { fn } };
    }

    case "title":
      return { action: "tabs.getCurrent", params: { __printField: "title" } };

    case "url":
      return { action: "tabs.getCurrent", params: { __printField: "url" } };

    case "html":
      return { action: "dom.getHTML", params: {} };

    case "screenshot":
    case "ss":
      return { action: "tabs.screenshot", params: {} };

    case "reload":
      return { action: "tabs.reload", params: {} };

    case "back":
      return { action: "tabs.goBack", params: {} };

    case "forward":
      return { action: "tabs.goForward", params: {} };

    case "clear":
      if (!rest) return missing(options, "clear needs a target (CSS selector or el_ handle)", 'clear "#search"');
      return rest.startsWith("el_")
        ? { action: "human.clearInput", params: { handleId: rest } }
        : { action: "human.clearInput", params: { selector: rest } };

    case "key":
    case "press":
      if (!rest) return missing(options, "key needs a key name", "key Enter, key Tab, key Escape, key ArrowDown", false);
      return { action: "dom.keyPress", params: { key: rest } };

    case "discover":
      return { action: "dom.discoverElements", params: {} };

    case "frames":
      return { action: "frames.list", params: {} };

    case "cookies":
      if (!rest || rest === "get") return { action: "cookies.getAll", params: {} };
      reportError(
        options,
        "invalid argument",
        `cookies takes no argument (list cookies) or load <file> (restore cookies), not "${rest}".`,
      );
      return null;

    case "box":
      if (!rest) return missing(options, "box needs a target (CSS selector or el_ handle)", 'box "#logo" or box el_3');
      return rest.startsWith("el_")
        ? { action: "dom.boundingBox", params: { handleId: rest } }
        : { action: "dom.boundingBox", params: { selector: rest } };

    default:
      break;
  }

  const spaceIdx = line.indexOf(" ");
  const action = spaceIdx === -1 ? line : line.slice(0, spaceIdx);

  // Protocol actions are namespaced (tabs.*, dom.*, human.*); a bare word is a typo.
  if (!/^[a-z]+\.[A-Za-z]+$/.test(action)) {
    reportError(
      options,
      "unknown command",
      `Unknown command "${parts[0]}". Run webpilot .help to see the commands.`,
    );
    return null;
  }

  if (spaceIdx === -1) {
    return { action, params: {} };
  }

  const paramsStr = line.slice(spaceIdx + 1).trim();
  try {
    return { action, params: JSON.parse(paramsStr) };
  } catch (err) {
    reportError(
      options,
      "invalid params",
      `The parameters after ${action} must be JSON (${err.message}). Example: ${action} {"selector": "a[href]"}`,
    );
    return null;
  }
}

module.exports = {
  parseCommandArgv,
  resolveGoUrl,
  resolveLine,
};
