const { BridgePage } = require('./page');
const { BridgeElement, BridgeJSHandle } = require('./element');
const { BridgeKeyboard } = require('./keyboard');
const { BridgeCursor, createHumanCursor } = require('./cursor');

module.exports = {
  BridgePage,
  BridgeElement,
  BridgeJSHandle,
  BridgeKeyboard,
  BridgeCursor,
  createHumanCursor,
};
