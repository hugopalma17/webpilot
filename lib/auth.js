const fs = require("fs");
const os = require("os");
const path = require("path");

function defaultTokenPath() {
  return path.join(os.homedir(), "h17-webpilot", "token");
}

function readAuthToken(options = {}) {
  const tokenPath = options.tokenPath || defaultTokenPath();
  try {
    return fs.readFileSync(tokenPath, "utf8").trim();
  } catch {
    return "";
  }
}

function authedWsUrl(addr, options = {}) {
  let url;
  try {
    url = new URL(addr);
  } catch {
    return addr;
  }

  // Server binds IPv4 loopback; localhost may resolve to ::1 first.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";

  const token =
    options.token !== undefined ? String(options.token) : readAuthToken(options);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

module.exports = {
  authedWsUrl,
  defaultTokenPath,
  readAuthToken,
};
