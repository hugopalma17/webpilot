#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const z = require('zod');
const WSBridge = require('./lib/ws-bridge');

function parseBridgeAddr(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--addr' && argv[i + 1]) return argv[i + 1];
  }
  return 'ws://localhost:7331';
}

const bridge = new WSBridge(parseBridgeAddr(process.argv.slice(2)));

function textResult(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

function errorResult(msg) {
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
}

async function ensureBridge() {
  if (!bridge.connected) {
    await bridge.connect();
  }
}

async function call(action, params = {}) {
  await ensureBridge();
  return bridge.send(action, params);
}

async function loadCookiesFromFile(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const cookies = JSON.parse(raw);
  if (!Array.isArray(cookies)) {
    throw new Error(`Cookie file must contain a JSON array: ${resolved}`);
  }
  let ok = 0;
  let fail = 0;
  for (const cookie of cookies) {
    try {
      await call('cookies.set', { cookie });
      ok++;
    } catch {
      fail++;
    }
  }
  return { path: resolved, ok, fail };
}

function currentTabShape() {
  return {
    id: z.number().describe('Browser tab ID'),
    url: z.string().describe('Current tab URL'),
    title: z.string().describe('Current tab title'),
    active: z.boolean().describe('Whether the tab is active'),
    windowId: z.number().describe('Browser window ID'),
    index: z.number().describe('Tab index inside the window'),
  };
}

const server = new McpServer({
  name: 'webpilot-mcp',
  version: '0.3.8',
});

// Navigation / page state

server.tool(
  'navigate',
  'Navigate the active tab to a URL.',
  { url: z.string().describe('URL to open') },
  async ({ url }) => {
    try {
      return textResult(await call('tabs.navigate', { url }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'tabs_current',
  'Get the active tab URL, title, and browser tab metadata.',
  {},
  async () => {
    try {
      return textResult(await call('tabs.getCurrent'));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'page_url',
  'Get the active tab URL from browser tab state.',
  {},
  async () => {
    try {
      const tab = await call('tabs.getCurrent');
      return textResult(tab.url || '');
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'page_title',
  'Get the active tab title from browser tab state.',
  {},
  async () => {
    try {
      const tab = await call('tabs.getCurrent');
      return textResult(tab.title || '');
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'page_html',
  'Read the current page HTML with title and URL.',
  {},
  async () => {
    try {
      return textResult(await call('dom.getHTML'));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'screenshot',
  'Take a screenshot of the current page. Returns an image the LLM can inspect.',
  { fullPage: z.boolean().optional().describe('Capture the full page instead of the viewport') },
  async ({ fullPage }) => {
    try {
      const result = await call('tabs.screenshot', { fullPage });
      if (result && result.dataUrl) {
        const idx = result.dataUrl.indexOf(',');
        if (idx >= 0) {
          return {
            content: [{
              type: 'image',
              data: result.dataUrl.slice(idx + 1),
              mimeType: 'image/png',
            }],
          };
        }
      }
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'tabs_list',
  'List all open browser tabs.',
  {},
  async () => {
    try {
      return textResult(await call('tabs.list'));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'tabs_create',
  'Open a new browser tab.',
  { url: z.string().optional().describe('URL to open in the new tab') },
  async ({ url }) => {
    try {
      return textResult(await call('tabs.create', url ? { url } : {}));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'tabs_activate',
  'Activate a tab by browser tab ID.',
  { tabId: z.number().describe('Tab ID returned by tabs_list or tabs_current') },
  async ({ tabId }) => {
    try {
      return textResult(await call('tabs.activate', { tabId }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'tabs_close',
  'Close the active tab.',
  {},
  async () => {
    try {
      return textResult(await call('tabs.close'));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'tabs_reload',
  'Reload the active tab.',
  {},
  async () => {
    try {
      return textResult(await call('tabs.reload'));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'tabs_wait_for_navigation',
  'Wait for the active tab to finish navigating.',
  { timeout: z.number().optional().describe('Timeout in milliseconds') },
  async ({ timeout }) => {
    try {
      return textResult(await call('tabs.waitForNavigation', timeout ? { timeout } : {}));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'tabs_set_viewport',
  'Set the browser window viewport size.',
  {
    width: z.number().describe('Viewport width in pixels'),
    height: z.number().describe('Viewport height in pixels'),
  },
  async ({ width, height }) => {
    try {
      return textResult(await call('tabs.setViewport', { width, height }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

// Cookies / session

server.tool(
  'cookies_get',
  'Get cookies for the current page URL.',
  {},
  async () => {
    try {
      return textResult(await call('cookies.getAll'));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'cookies_set',
  'Set a cookie directly.',
  {
    url: z.string().optional().describe('Explicit cookie URL'),
    name: z.string().describe('Cookie name'),
    value: z.string().describe('Cookie value'),
    domain: z.string().optional().describe('Cookie domain'),
    path: z.string().optional().describe('Cookie path'),
    secure: z.boolean().optional().describe('Secure flag'),
    httpOnly: z.boolean().optional().describe('HttpOnly flag'),
    sameSite: z.enum(['no_restriction', 'lax', 'strict']).optional().describe('SameSite value'),
    expirationDate: z.number().optional().describe('Expiration as Unix timestamp'),
  },
  async (cookie) => {
    try {
      return textResult(await call('cookies.set', { cookie }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'cookies_load_file',
  'Load a cookie JSON array file and set each cookie into the active browser session.',
  {
    filePath: z.string().describe('Absolute or workspace-relative path to a cookies JSON file'),
  },
  async ({ filePath }) => {
    try {
      return textResult(await loadCookiesFromFile(filePath));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

// Human interaction

server.tool(
  'click',
  'Click an element through the safe interaction pipeline.',
  {
    selector: z.string().optional().describe('CSS selector of the target element'),
    handleId: z.string().optional().describe('Handle ID from query or discover'),
  },
  async ({ selector, handleId }) => {
    try {
      if (!selector && !handleId) return errorResult('Provide selector or handleId');
      return textResult(await call('human.click', handleId ? { handleId } : { selector }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'type',
  'Type text with the configured human interaction timing.',
  {
    text: z.string().describe('Text to type'),
    selector: z.string().optional().describe('CSS selector of the input'),
    handleId: z.string().optional().describe('Handle ID of the input'),
  },
  async ({ text, selector, handleId }) => {
    try {
      const params = { text };
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      return textResult(await call('human.type', params));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'scroll',
  'Scroll the window or a specific element with the configured human interaction policy.',
  {
    direction: z.enum(['up', 'down']).optional().default('down').describe('Scroll direction'),
    amount: z.number().optional().describe('Scroll amount in pixels'),
    selector: z.string().optional().describe('CSS selector of an element to scroll'),
    handleId: z.string().optional().describe('Handle ID of an element to scroll'),
  },
  async ({ direction, amount, selector, handleId }) => {
    try {
      const params = { direction };
      if (amount !== undefined) params.amount = amount;
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      return textResult(await call('human.scroll', params));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'clear',
  'Clear an input field through the safe input pipeline.',
  {
    selector: z.string().optional().describe('CSS selector of the input'),
    handleId: z.string().optional().describe('Handle ID of the input'),
  },
  async ({ selector, handleId }) => {
    try {
      if (!selector && !handleId) return errorResult('Provide selector or handleId');
      return textResult(await call('human.clearInput', handleId ? { handleId } : { selector }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'press_key',
  'Press a keyboard key in the active tab.',
  { key: z.string().describe('Key name: Enter, Tab, Escape, ArrowDown, ArrowUp, Space, etc.') },
  async ({ key }) => {
    try {
      return textResult(await call('dom.keyPress', { key }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

// Query / inspect

server.tool(
  'query',
  'Query elements matching a CSS selector and return handles plus summary info.',
  { selector: z.string().describe('CSS selector to search for') },
  async ({ selector }) => {
    try {
      return textResult(await call('dom.queryAllInfo', { selector }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'discover',
  'Discover interactive elements on the current page.',
  {},
  async () => {
    try {
      return textResult(await call('dom.discoverElements'));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'wait_for',
  'Wait for a selector to appear in the DOM.',
  {
    selector: z.string().describe('CSS selector to wait for'),
    timeout: z.number().optional().describe('Timeout in milliseconds'),
  },
  async ({ selector, timeout }) => {
    try {
      const params = { selector };
      if (timeout !== undefined) params.timeout = timeout;
      return textResult(await call('dom.waitForSelector', params));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'frames_list',
  'List frames on the current page.',
  {},
  async () => {
    try {
      return textResult(await call('frames.list'));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'box',
  'Get the bounding box for an element.',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
  },
  async ({ selector, handleId }) => {
    try {
      if (!selector && !handleId) return errorResult('Provide selector or handleId');
      return textResult(await call('dom.boundingBox', handleId ? { handleId } : { selector }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'evaluate',
  'Execute JavaScript in the page context and return a serializable result.',
  {
    fn: z.string().describe('JavaScript function string, for example "() => document.title"'),
    args: z.array(z.any()).optional().describe('Arguments to pass to the function'),
  },
  async ({ fn, args }) => {
    try {
      return textResult(await call('dom.evaluate', args ? { fn, args } : { fn }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

// Direct DOM tools kept explicit so agent users know they bypass the human pipeline.

server.tool(
  'dom_click',
  'Click an element directly without the human interaction pipeline.',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
  },
  async ({ selector, handleId }) => {
    try {
      if (!selector && !handleId) return errorResult('Provide selector or handleId');
      return textResult(await call('dom.click', handleId ? { handleId } : { selector }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_type',
  'Type text directly into the focused element without human timing.',
  { text: z.string().describe('Text to type') },
  async ({ text }) => {
    try {
      return textResult(await call('dom.type', { text }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_scroll',
  'Scroll directly without the human interaction pipeline.',
  {
    direction: z.enum(['up', 'down']).optional().default('down').describe('Scroll direction'),
    amount: z.number().optional().describe('Scroll amount in pixels'),
    selector: z.string().optional().describe('CSS selector of element to scroll'),
    handleId: z.string().optional().describe('Handle ID of element to scroll'),
  },
  async ({ direction, amount, selector, handleId }) => {
    try {
      const params = { direction };
      if (amount !== undefined) params.amount = amount;
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      return textResult(await call('dom.scroll', params));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_focus',
  'Focus an element directly.',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
  },
  async ({ selector, handleId }) => {
    try {
      if (!selector && !handleId) return errorResult('Provide selector or handleId');
      return textResult(await call('dom.focus', handleId ? { handleId } : { selector }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_set_value',
  'Set an input value directly. This bypasses the human interaction flow.',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
    value: z.string().describe('Value to set'),
  },
  async ({ selector, handleId, value }) => {
    try {
      if (!selector && !handleId) return errorResult('Provide selector or handleId');
      return textResult(await call('dom.setValue', handleId ? { handleId, value } : { selector, value }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_upload_file',
  'Upload a file directly to a file input. This bypasses clicking the upload button.',
  {
    selector: z.string().optional().describe('CSS selector of the file input'),
    handleId: z.string().optional().describe('Handle ID of the file input'),
    filePath: z.string().describe('Absolute path to the file'),
  },
  async ({ selector, handleId, filePath }) => {
    try {
      if (!selector && !handleId) return errorResult('Provide selector or handleId');
      return textResult(await call('dom.uploadFile', handleId ? { handleId, filePath } : { selector, filePath }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_get_attribute',
  'Read an attribute from an element.',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
    name: z.string().describe('Attribute name'),
  },
  async ({ selector, handleId, name }) => {
    try {
      if (!selector && !handleId) return errorResult('Provide selector or handleId');
      return textResult(await call('dom.getAttribute', handleId ? { handleId, name } : { selector, name }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_get_property',
  'Read a JavaScript property from an element.',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
    name: z.string().describe('Property name'),
  },
  async ({ selector, handleId, name }) => {
    try {
      if (!selector && !handleId) return errorResult('Provide selector or handleId');
      return textResult(await call('dom.getProperty', handleId ? { handleId, name } : { selector, name }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_element_html',
  'Read the HTML of a specific element.',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
    outer: z.boolean().optional().default(true).describe('Return outerHTML when true, innerHTML when false'),
  },
  async ({ selector, handleId, outer }) => {
    try {
      if (!selector && !handleId) return errorResult('Provide selector or handleId');
      return textResult(await call('dom.elementHTML', handleId ? { handleId, outer } : { selector, outer }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_element_evaluate',
  'Execute JavaScript with a specific element as the first argument.',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
    fn: z.string().describe('Function string receiving the element as its first argument'),
  },
  async ({ selector, handleId, fn }) => {
    try {
      if (!selector && !handleId) return errorResult('Provide selector or handleId');
      return textResult(await call('dom.elementEvaluate', handleId ? { handleId, fn } : { selector, fn }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

// Runtime

server.tool(
  'runtime_get_config',
  'Get the current framework runtime configuration.',
  {},
  async () => {
    try {
      return textResult(await call('framework.getConfig'));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'runtime_set_config',
  'Merge configuration into the running framework.',
  { config: z.record(z.any()).describe('Configuration object to merge into runtime state') },
  async ({ config }) => {
    try {
      return textResult(await call('framework.setConfig', { config }));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'runtime_reload_extension',
  'Force-reload the browser extension.',
  {},
  async () => {
    try {
      return textResult(await call('framework.reload'));
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

async function main() {
  bridge.connect().catch(() => {
    console.error('[webpilot-mcp] Webpilot server not running — start it with: webpilot start');
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[webpilot-mcp] MCP server running on stdio');
}

main().catch((err) => {
  console.error('[webpilot-mcp] Fatal:', err.message);
  process.exit(1);
});
