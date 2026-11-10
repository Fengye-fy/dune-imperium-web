'use strict';

// Each sibling game implements the same plugin interface; no game-specific room logic.
const plugins = new Map([
  ['dune-imperium', require('./games/dune-imperium')]
]);

module.exports = { plugins };
