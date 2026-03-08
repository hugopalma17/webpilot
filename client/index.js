const { BridgePage } = require('./page');
const { BridgeElement, BridgeJSHandle } = require('./element');
const { BridgeKeyboard } = require('./keyboard');
const { BridgeCursor, createHumanCursor } = require('./cursor');

module.exports = {
  BridgePage,
  AgentPage: BridgePage,
  BridgeElement,
  AgentElement: BridgeElement,
  BridgeJSHandle,
  BridgeKeyboard,
  BridgeCursor,
  createHumanCursor,
};
