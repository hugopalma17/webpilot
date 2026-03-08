
// BridgeKeyboard — keyboard wrapper over dom.key* commands


class BridgeKeyboard {
  constructor(page) {
    this._page = page;
  }

  async type(text) {
    return this._page._send('dom.type', { text });
  }

  async press(key) {
    return this._page._send('dom.keyPress', { key });
  }

  async down(key) {
    return this._page._send('dom.keyDown', { key });
  }

  async up(key) {
    return this._page._send('dom.keyUp', { key });
  }
}

module.exports = { BridgeKeyboard };
