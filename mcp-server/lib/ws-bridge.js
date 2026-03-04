'use strict';

const WebSocket = require('ws');

class WSBridge {
  constructor(addr = 'ws://localhost:7331') {
    this.addr = addr;
    this.conn = null;
    this.counter = 0;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.addr);

      ws.on('open', () => {
        this.conn = ws;
        console.error(`[webpilot-mcp] connected to ${this.addr}`);
        resolve();
      });

      ws.on('error', (err) => {
        if (!this.conn) {
          reject(new Error(`Cannot connect to WebPilot server at ${this.addr} — is it running? (webpilot start)`));
          return;
        }
        console.error(`[webpilot-mcp] ws error: ${err.message}`);
      });

      ws.on('close', () => {
        this.conn = null;
        // Reject all pending requests
        for (const [id, entry] of this.pending) {
          entry.reject(new Error('WebSocket disconnected'));
          this.pending.delete(id);
        }
        console.error('[webpilot-mcp] disconnected from WebPilot server');
      });

      ws.on('message', (data) => this._onMessage(data.toString()));
    });
  }

  _onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    // Keepalive
    if (msg.type === 'ping') {
      if (this.conn && this.conn.readyState === WebSocket.OPEN) {
        this.conn.send(JSON.stringify({ type: 'pong' }));
      }
      return;
    }

    // Match response by ID
    if (msg.id && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) {
        entry.reject(new Error(msg.error));
      } else {
        entry.resolve(msg.result);
      }
    }
  }

  send(action, params = {}, tabId = null) {
    return new Promise((resolve, reject) => {
      if (!this.conn || this.conn.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to WebPilot server'));
        return;
      }

      const id = `mcp_${++this.counter}`;
      const msg = { id, action, params };
      if (tabId) msg.tabId = tabId;

      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout (30s) waiting for ${action}`));
        }
      }, 30000);
      timer.unref();

      this.pending.set(id, { resolve, reject, timer });
      this.conn.send(JSON.stringify(msg));
    });
  }

  get connected() {
    return this.conn && this.conn.readyState === WebSocket.OPEN;
  }

  close() {
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
  }
}

module.exports = WSBridge;
