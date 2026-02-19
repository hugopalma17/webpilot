const { execSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const config = require("../human-browser.config.js");

// Kill any previously running instance of this server + stale browsers
try {
  const myPid = process.pid;
  const pids = execSync('pgrep -f "node test/server.js"', { encoding: "utf8" })
    .trim()
    .split("\n")
    .map(Number)
    .filter((p) => p !== myPid && p > 0);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  if (pids.length)
    console.log(`[test] Killed stale server process(es): ${pids.join(", ")}`);
} catch {}
try {
  execSync(`pkill -9 -f ${config.browser} 2>/dev/null`, { stdio: "ignore" });
} catch {}

const { startWithPage, killBrowserAndExit } = require("../index");
const HTTP_PORT = 3456;
const testDir = path.dirname(__filename);

// Simple static file server for test fixtures
const httpServer = http.createServer((req, res) => {
  const filePath = path.join(
    testDir,
    req.url === "/" ? "fixtures.html" : req.url,
  );
  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": types[ext] || "text/plain" });
    res.end(data);
  });
});

async function main() {
  // Start HTTP server for test fixtures
  await new Promise((resolve) => httpServer.listen(HTTP_PORT, resolve));
  console.log(`[test] Fixtures server: http://localhost:${HTTP_PORT}/`);

  // Start browser + WS bridge
  const { server, page, browserProcess } = await startWithPage({
    startUrl: `http://localhost:${HTTP_PORT}/`,
  });

  console.log(
    `[test] Browser ready. Run tests with: node test/all-commands.js`,
  );
  console.log(`[test] Press Ctrl+C to stop.\n`);

  process.on("SIGINT", () => {
    console.log("\n[test] Shutting down...");
    httpServer.close();
    killBrowserAndExit(browserProcess, server, 0);
  });
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
