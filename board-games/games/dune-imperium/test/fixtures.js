'use strict';

// Historical snapshots for the unchanged v1/v2 regression suites.
const crypto = require('node:crypto');
const game = require('..');
const { CARDS, INTRIGUES, developmentConflicts } = require('../data');
const instance = cardId => ({ uid: crypto.randomUUID(), cardId });
const V3_MARKET = new Set(['kwisatz-haderach', 'reverend-mother-mohiam', 'shifting-allegiances', 'test-of-humanity', 'the-voice']);
const V3_INTRIGUES = new Set(['intrigue-bindu-suspension', 'intrigue-bypass-protocol', 'intrigue-demand-respect',
  'intrigue-infiltrate', 'intrigue-poison-snooper', 'intrigue-to-the-victory', 'intrigue-urgent-mission']);

function createLegacy(ruleset, count = 3) {
  const s = game.createGame({ players: Array.from({ length: count }, (_, n) => ({ id: `p${n}`, name: `玩家${n}` })) });
  s.ruleset = ruleset; s.round = 1; s.phase = 'player-turns'; s.currentPlayerId = s.players[s.firstPlayerIndex].id;
  if (ruleset === 'core-dev-v1') {
    s.conflictDeck = developmentConflicts();
    s.marketDeck = Object.values(CARDS).filter(c => c.developmentOnly).flatMap(c => Array.from({ length: 6 }, () => instance(c.id)));
    s.intrigueDeck = Object.values(INTRIGUES).filter(c => c.developmentOnly).flatMap(c => Array.from({ length: 6 }, () => instance(c.id)));
  } else {
    s.marketDeck = [...s.market, ...s.marketDeck].filter(c => !V3_MARKET.has(c.cardId));
    s.intrigueDeck = s.intrigueDeck.filter(c => !V3_INTRIGUES.has(c.cardId));
  }
  s.conflict = s.conflictDeck.shift(); s.market = s.marketDeck.splice(-5);
  for (const p of s.players) {
    p.hand = Array.from({ length: 5 }, () => p.deck.pop());
    for (const key of ['leaderId', 'leaderState', 'setAsideMarket', 'resolvingIntrigues', 'infiltrate']) delete p[key];
  }
  for (const key of ['agentPositions', 'voiceBlocks', 'removedMarket', 'leaderSelectionOrder']) delete s[key];
  return s;
}
module.exports = { createLegacy };
