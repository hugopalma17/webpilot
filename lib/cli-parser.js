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

function normalizeUrl(input) {
  if (input.includes("://")) return input;
  return input.startsWith("localhost") || input.startsWith("127.0.0.1")
    ? "http://" + input
    : "https://" + input;
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
      reportError(options, "invalid JSON", err.message);
      return null;
    }
    return { action: msg.action || "", params: msg.params || {} };
  }

  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const rest = parts.slice(1).join(" ");

  switch (cmd) {
    case "go":
    case "nav":
    case "navigate":
    case "goto":
      if (!rest) return null;
      return { action: "tabs.navigate", params: { url: normalizeUrl(rest) } };

    case "click":
      if (!rest) return null;
      return rest.startsWith("el_")
        ? { action: "human.click", params: { handleId: rest } }
        : { action: "human.click", params: { selector: rest } };

    case "type": {
      if (!rest) return null;
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
      if (!rest) return null;
      return { action: "dom.queryAllInfo", params: { selector: rest } };

    case "wait":
      if (!rest) return null;
      return { action: "dom.waitForSelector", params: { selector: rest } };

    case "eval":
    case "js": {
      if (!rest) return null;
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
      return {
        action: "dom.evaluate",
        params: { fn: "() => { history.back(); return true; }" },
      };

    case "forward":
      return {
        action: "dom.evaluate",
        params: { fn: "() => { history.forward(); return true; }" },
      };

    case "clear":
      if (!rest) return null;
      return { action: "human.clearInput", params: { selector: rest } };

    case "key":
    case "press":
      if (!rest) return null;
      return { action: "dom.keyPress", params: { key: rest } };

    case "discover":
      return { action: "dom.discoverElements", params: {} };

    case "frames":
      return { action: "frames.list", params: {} };

    case "cookies":
      if (!rest || rest === "get") return { action: "cookies.getAll", params: {} };
      return null;

    case "box":
      if (!rest) return null;
      return rest.startsWith("el_")
        ? { action: "dom.boundingBox", params: { handleId: rest } }
        : { action: "dom.boundingBox", params: { selector: rest } };

    default:
      break;
  }

  const spaceIdx = line.indexOf(" ");
  if (spaceIdx === -1) {
    return { action: line, params: {} };
  }

  const action = line.slice(0, spaceIdx);
  const paramsStr = line.slice(spaceIdx + 1).trim();
  try {
    return { action, params: JSON.parse(paramsStr) };
  } catch (err) {
    reportError(options, "invalid params", err.message);
    return null;
  }
}

module.exports = {
  parseCommandArgv,
  resolveLine,
};
