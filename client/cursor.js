const { BridgeElement } = require('./element');


// BridgeCursor — ghost-cursor compatible cursor (raw, robotic movement)


class BridgeCursor {
  constructor(page) {
    this._page = page;
  }

  async moveTo(element) {
    if (element instanceof BridgeElement) {
      return this._page._send('dom.mouseMoveTo', { handleId: element._handleId });
    }
    return this._page._send('dom.mouseMoveTo', { selector: element });
  }

  async click(element) {
    await this.moveTo(element);
    if (element instanceof BridgeElement) {
      return this._page._send('dom.click', { handleId: element._handleId });
    }
    return this._page._send('dom.click', { selector: element });
  }
}

function createHumanCursor(page) {
  return new BridgeCursor(page);
}

module.exports = { BridgeCursor, createHumanCursor };
