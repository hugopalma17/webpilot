#!/usr/bin/env node
'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const z = require('zod');
const WSBridge = require('./lib/ws-bridge');

const bridge = new WSBridge(process.env.WEBPILOT_WS_URL || 'ws://localhost:7331');

function textResult(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

function errorResult(msg) {
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
}

async function call(action, params = {}) {
  if (!bridge.connected) {
    try {
      await bridge.connect();
    } catch (e) {
      throw new Error(e.message);
    }
  }
  return bridge.send(action, params);
}

// --- Server ---

const server = new McpServer({
  name: 'webpilot-mcp',
  version: '0.1.0',
});

// --- Navigation tools ---

server.tool(
  'navigate',
  'Navigate the browser to a URL',
  { url: z.string().describe('The URL to navigate to') },
  async ({ url }) => {
    try {
      const result = await call('tabs.navigate', { url });
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'screenshot',
  'Take a screenshot of the current page. Returns an image the LLM can see.',
  { fullPage: z.boolean().optional().describe('Capture the full page, not just the viewport') },
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
  'List all open browser tabs with their IDs, URLs, and titles',
  {},
  async () => {
    try {
      const result = await call('tabs.list');
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'tabs_create',
  'Open a new browser tab',
  { url: z.string().optional().describe('URL to open in the new tab') },
  async ({ url }) => {
    try {
      const result = await call('tabs.create', url ? { url } : {});
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'tabs_close',
  'Close the current browser tab',
  {},
  async () => {
    try {
      const result = await call('tabs.close');
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'tabs_reload',
  'Reload the current page',
  {},
  async () => {
    try {
      const result = await call('tabs.reload');
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'tabs_activate',
  'Switch to a specific tab by its ID',
  { tabId: z.number().describe('The tab ID to activate') },
  async ({ tabId }) => {
    try {
      const result = await call('tabs.activate', { tabId });
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'tabs_wait_for_navigation',
  'Wait for the current tab to finish navigating',
  { timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)') },
  async ({ timeout }) => {
    try {
      const params = {};
      if (timeout) params.timeout = timeout;
      const result = await call('tabs.waitForNavigation', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'tabs_set_viewport',
  'Set the browser viewport size',
  {
    width: z.number().describe('Viewport width in pixels'),
    height: z.number().describe('Viewport height in pixels'),
  },
  async ({ width, height }) => {
    try {
      const result = await call('tabs.setViewport', { width, height });
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

// --- Cookies ---

server.tool(
  'cookies_get',
  'Get all cookies for the current page',
  {},
  async () => {
    try {
      const result = await call('cookies.getAll');
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'cookies_set',
  'Set a cookie',
  {
    url: z.string().describe('The URL to associate the cookie with'),
    name: z.string().describe('Cookie name'),
    value: z.string().describe('Cookie value'),
    domain: z.string().optional().describe('Cookie domain'),
    path: z.string().optional().describe('Cookie path'),
    secure: z.boolean().optional().describe('Whether the cookie is secure'),
    httpOnly: z.boolean().optional().describe('Whether the cookie is httpOnly'),
    sameSite: z.enum(['no_restriction', 'lax', 'strict']).optional().describe('SameSite attribute'),
    expirationDate: z.number().optional().describe('Expiration as Unix timestamp'),
  },
  async (params) => {
    try {
      const result = await call('cookies.set', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

// --- Interaction tools ---

server.tool(
  'click',
  'Click an element through the safe interaction pipeline. Provide either a CSS selector or a handleId from a previous query.',
  {
    selector: z.string().optional().describe('CSS selector of the element to click'),
    handleId: z.string().optional().describe('Handle ID from a previous find_elements/discover call'),
  },
  async ({ selector, handleId }) => {
    try {
      const params = {};
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      else return errorResult('Provide selector or handleId');
      const result = await call('human.click', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'type',
  'Type text with the configured interaction timing. Optionally target a specific element first.',
  {
    text: z.string().describe('The text to type'),
    selector: z.string().optional().describe('CSS selector of the input element'),
    handleId: z.string().optional().describe('Handle ID of the input element'),
  },
  async ({ text, selector, handleId }) => {
    try {
      const params = { text };
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      const result = await call('human.type', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'scroll',
  'Scroll the page or a specific element with the configured interaction policy',
  {
    direction: z.enum(['up', 'down']).optional().default('down').describe('Scroll direction'),
    amount: z.number().optional().describe('Scroll amount in pixels (random 250-550px if omitted)'),
    selector: z.string().optional().describe('CSS selector of element to scroll (scrolls window if omitted)'),
    handleId: z.string().optional().describe('Handle ID of element to scroll'),
  },
  async ({ direction, amount, selector, handleId }) => {
    try {
      const params = {};
      if (direction) params.direction = direction;
      if (amount) params.amount = amount;
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      const result = await call('human.scroll', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'key_press',
  'Press a keyboard key (Enter, Tab, Escape, Backspace, ArrowDown, etc.)',
  { key: z.string().describe('Key name: Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp, Space, etc.') },
  async ({ key }) => {
    try {
      const result = await call('dom.keyPress', { key });
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'press_key',
  'Press a keyboard key.',
  { key: z.string().describe('Key name: Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp, Space, etc.') },
  async ({ key }) => {
    try {
      const result = await call('dom.keyPress', { key });
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'clear_input',
  'Clear an input field through the safe input pipeline',
  {
    selector: z.string().optional().describe('CSS selector of the input to clear'),
    handleId: z.string().optional().describe('Handle ID of the input to clear'),
  },
  async ({ selector, handleId }) => {
    try {
      const params = {};
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      else return errorResult('Provide selector or handleId');
      const result = await call('human.clearInput', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'clear',
  'Clear an input field through the safe input pipeline.',
  {
    selector: z.string().optional().describe('CSS selector of the input to clear'),
    handleId: z.string().optional().describe('Handle ID of the input to clear'),
  },
  async ({ selector, handleId }) => {
    try {
      const params = {};
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      else return errorResult('Provide selector or handleId');
      const result = await call('human.clearInput', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

// --- Query & Inspect tools ---

server.tool(
  'find_elements',
  'Find all elements matching a CSS selector. Returns handle IDs and element info for follow-up actions.',
  { selector: z.string().describe('CSS selector to search for') },
  async ({ selector }) => {
    try {
      const result = await call('dom.queryAllInfo', { selector });
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'query',
  'Query elements matching a CSS selector and return handles plus summary info.',
  { selector: z.string().describe('CSS selector to search for') },
  async ({ selector }) => {
    try {
      const result = await call('dom.queryAllInfo', { selector });
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'discover',
  'Discover interactive elements on the page. Returns handle IDs, types, text, and selectors.',
  {},
  async () => {
    try {
      const result = await call('dom.discoverElements');
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'discover_elements',
  'Discover interactive elements on the current page.',
  {},
  async () => {
    try {
      const result = await call('dom.discoverElements');
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'get_html',
  'Read the current page HTML along with the title and URL.',
  {},
  async () => {
    try {
      const result = await call('dom.getHTML');
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'read_page',
  'Read the current page HTML, title, and URL.',
  {},
  async () => {
    try {
      const result = await call('dom.getHTML');
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'evaluate',
  'Execute JavaScript on the page. The function string is evaluated in the page context. Return serializable values.',
  {
    fn: z.string().describe('JavaScript function to execute, e.g. "() => document.title"'),
    args: z.array(z.any()).optional().describe('Arguments to pass to the function'),
  },
  async ({ fn, args }) => {
    try {
      const params = { fn };
      if (args) params.args = args;
      const result = await call('dom.evaluate', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'wait_for',
  'Wait for an element matching a CSS selector to appear in the DOM',
  {
    selector: z.string().describe('CSS selector to wait for'),
    timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
  },
  async ({ selector, timeout }) => {
    try {
      const params = { selector };
      if (timeout) params.timeout = timeout;
      const result = await call('dom.waitForSelector', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'wait_for_selector',
  'Wait for an element matching a CSS selector to appear in the DOM.',
  {
    selector: z.string().describe('CSS selector to wait for'),
    timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
  },
  async ({ selector, timeout }) => {
    try {
      const params = { selector };
      if (timeout) params.timeout = timeout;
      const result = await call('dom.waitForSelector', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

// --- DOM tools (direct) ---

server.tool(
  'dom_click',
  'Click an element directly without the safe interaction pipeline.',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
  },
  async ({ selector, handleId }) => {
    try {
      const params = {};
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      else return errorResult('Provide selector or handleId');
      const result = await call('dom.click', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_type',
  'Type text directly into the focused element without configured timing.',
  { text: z.string().describe('Text to type') },
  async ({ text }) => {
    try {
      const result = await call('dom.type', { text });
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_scroll',
  'Scroll the page or element directly. Returns before/after scroll positions.',
  {
    direction: z.enum(['up', 'down']).optional().default('down').describe('Scroll direction'),
    amount: z.number().optional().describe('Scroll amount in pixels'),
    selector: z.string().optional().describe('CSS selector of element to scroll'),
    handleId: z.string().optional().describe('Handle ID of element to scroll'),
  },
  async ({ direction, amount, selector, handleId }) => {
    try {
      const params = {};
      if (direction) params.direction = direction;
      if (amount) params.amount = amount;
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      const result = await call('dom.scroll', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_focus',
  'Focus an element',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
  },
  async ({ selector, handleId }) => {
    try {
      const params = {};
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      else return errorResult('Provide selector or handleId');
      const result = await call('dom.focus', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_set_value',
  'Set the value of an input element directly',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
    value: z.string().describe('Value to set'),
  },
  async ({ selector, handleId, value }) => {
    try {
      const params = { value };
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      else return errorResult('Provide selector or handleId');
      const result = await call('dom.setValue', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_get_attribute',
  'Get an attribute value from an element',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
    name: z.string().describe('Attribute name'),
  },
  async ({ selector, handleId, name }) => {
    try {
      const params = { name };
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      else return errorResult('Provide selector or handleId');
      const result = await call('dom.getAttribute', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_get_property',
  'Get a JavaScript property value from an element (e.g. value, checked, textContent)',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
    name: z.string().describe('Property name'),
  },
  async ({ selector, handleId, name }) => {
    try {
      const params = { name };
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      else return errorResult('Provide selector or handleId');
      const result = await call('dom.getProperty', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_bounding_box',
  'Get the bounding box (x, y, width, height) of an element',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
  },
  async ({ selector, handleId }) => {
    try {
      const params = {};
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      else return errorResult('Provide selector or handleId');
      const result = await call('dom.boundingBox', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_element_html',
  'Get the outerHTML or innerHTML of a specific element',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
    outer: z.boolean().optional().default(true).describe('Return outerHTML (true) or innerHTML (false)'),
  },
  async ({ selector, handleId, outer }) => {
    try {
      const params = {};
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      else return errorResult('Provide selector or handleId');
      if (outer !== undefined) params.outer = outer;
      const result = await call('dom.elementHTML', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_find_scrollable',
  'Find scrollable containers on the page by computed overflow style',
  {},
  async () => {
    try {
      const result = await call('dom.findScrollable');
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_mouse_move',
  'Move the cursor to an element or coordinates (raw, no bezier)',
  {
    selector: z.string().optional().describe('CSS selector to move to'),
    handleId: z.string().optional().describe('Handle ID to move to'),
    x: z.number().optional().describe('X coordinate'),
    y: z.number().optional().describe('Y coordinate'),
  },
  async ({ selector, handleId, x, y }) => {
    try {
      const params = {};
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      if (x !== undefined) params.x = x;
      if (y !== undefined) params.y = y;
      const result = await call('dom.mouseMoveTo', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_key_down',
  'Press and hold a key (without releasing)',
  { key: z.string().describe('Key name') },
  async ({ key }) => {
    try {
      const result = await call('dom.keyDown', { key });
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_key_up',
  'Release a held key',
  { key: z.string().describe('Key name') },
  async ({ key }) => {
    try {
      const result = await call('dom.keyUp', { key });
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_upload_file',
  'Upload a file to a file input element',
  {
    selector: z.string().optional().describe('CSS selector of the file input'),
    handleId: z.string().optional().describe('Handle ID of the file input'),
    filePath: z.string().describe('Absolute path to the file to upload'),
  },
  async ({ selector, handleId, filePath }) => {
    try {
      const params = { filePath };
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      else return errorResult('Provide selector or handleId');
      const result = await call('dom.uploadFile', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'dom_element_evaluate',
  'Execute JavaScript with a specific element as the first argument',
  {
    selector: z.string().optional().describe('CSS selector'),
    handleId: z.string().optional().describe('Handle ID'),
    fn: z.string().describe('JavaScript function receiving the element, e.g. "(el) => el.textContent"'),
  },
  async ({ selector, handleId, fn }) => {
    try {
      const params = { fn };
      if (handleId) params.handleId = handleId;
      else if (selector) params.selector = selector;
      else return errorResult('Provide selector or handleId');
      const result = await call('dom.elementEvaluate', params);
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

// --- Frames ---

server.tool(
  'frames_list',
  'List all frames (iframes) on the current page',
  {},
  async () => {
    try {
      const result = await call('frames.list');
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

// --- Cursor ---

server.tool(
  'cursor_position',
  'Get the current cursor position',
  {},
  async () => {
    try {
      const result = await call('cursor.getPosition');
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

// --- Framework ---

server.tool(
  'framework_reload',
  'Force-reload the browser extension',
  {},
  async () => {
    try {
      const result = await call('framework.reload');
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'framework_get_config',
  'Get the current framework configuration',
  {},
  async () => {
    try {
      const result = await call('framework.getConfig');
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.tool(
  'framework_set_config',
  'Update framework configuration at runtime',
  { config: z.record(z.any()).describe('Configuration object to merge into current config') },
  async ({ config }) => {
    try {
      const result = await call('framework.setConfig', { config });
      return textResult(result);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

// --- Start ---

async function main() {
  // Try connecting to WebPilot server eagerly (but don't block startup)
  bridge.connect().catch(() => {
    console.error('[webpilot-mcp] WebPilot server not running — start it with: npx webpilot start');
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[webpilot-mcp] MCP server running on stdio');
}

main().catch((err) => {
  console.error('[webpilot-mcp] Fatal:', err.message);
  process.exit(1);
});
