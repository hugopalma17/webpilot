
// BridgeJSHandle — Puppeteer-compatible JSHandle


class BridgeJSHandle {
  constructor(page, descriptor) {
    this._page = page;
    this._descriptor = descriptor; // { type, handleId, value, properties }
  }

  asElement() {
    if (this._descriptor.type === 'element' && this._descriptor.handleId) {
      return new BridgeElement(this._page, this._descriptor.handleId, '');
    }
    return null;
  }

  async jsonValue() {
    if (this._descriptor.type === 'value') return this._descriptor.value;
    if (this._descriptor.type === 'null') return null;
    if (this._descriptor.type === 'object') {
      const result = {};
      for (const [key, prop] of Object.entries(this._descriptor.properties || {})) {
        if (prop.type === 'value') result[key] = prop.value;
        else result[key] = null;
      }
      return result;
    }
    return null;
  }

  async getProperty(name) {
    if (this._descriptor.type === 'object' && this._descriptor.properties) {
      const prop = this._descriptor.properties[name];
      if (prop) return new BridgeJSHandle(this._page, prop);
    }
    return new BridgeJSHandle(this._page, { type: 'null' });
  }
}


// BridgeElement — Puppeteer-compatible ElementHandle


class BridgeElement {
  constructor(page, handleId, selector) {
    this._page = page;
    this._handleId = handleId;
    this._selector = selector;
  }

  asElement() {
    return this;
  }

  async evaluate(fn, ...args) {
    const fnString = typeof fn === 'function' ? fn.toString() : fn;
    return this._page._send('dom.elementEvaluate', {
      handleId: this._handleId, fn: fnString, args,
    });
  }

  async boundingBox() {
    return this._page._send('dom.boundingBox', { handleId: this._handleId });
  }

  async click(options = {}) {
    return this._page._send('dom.click', { handleId: this._handleId, clickCount: options.clickCount });
  }

  async focus() {
    return this._page._send('dom.focus', { handleId: this._handleId });
  }

  async type(text) {
    await this.focus();
    return this._page._send('dom.type', { text });
  }

  async $(selector) {
    const handleId = await this._page._send('dom.querySelectorWithin', {
      parentHandleId: this._handleId, selector,
    });
    if (!handleId) return null;
    return new BridgeElement(this._page, handleId, selector);
  }

  async $$(selector) {
    const handleIds = await this._page._send('dom.querySelectorAllWithin', {
      parentHandleId: this._handleId, selector,
    });
    return handleIds.map(id => new BridgeElement(this._page, id, selector));
  }

  async getAttribute(name) {
    return this._page._send('dom.getAttribute', { handleId: this._handleId, name });
  }

  async getProperty(name) {
    return this._page._send('dom.getProperty', { handleId: this._handleId, name });
  }

  async isIntersectingViewport() {
    const box = await this.boundingBox();
    if (!box) return false;
    const vp = await this._page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    return box.x + box.width > 0 && box.x < vp.width &&
           box.y + box.height > 0 && box.y < vp.height;
  }

  async contentFrame() {
    return null;
  }
}

module.exports = { BridgeElement, BridgeJSHandle };
