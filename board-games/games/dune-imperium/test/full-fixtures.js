'use strict';
const assert = require('node:assert/strict');
const game = require('..');
let serial = 0;
const card = cardId => ({ uid: `full-${++serial}`, cardId });
const active = s => s.players.find(p => p.id === s.currentPlayerId);
const act = (s, action) => game.applyAction(s, s.currentPlayerId, action);
function create(leader = 'paul-atreides', count = 3) {
  let s = game.createGame({ players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `玩家${i}` })) });
  const target = s.players[s.firstPlayerIndex].id;
  const filler = ['earl-memnon-thorvald', 'glossu-the-beast-rabban', 'countess-ariana-thorvald', 'count-ilban-richese'].filter(x => x !== leader);
  const choices = new Map(s.players.map(p => [p.id, p.id === target ? leader : filler.shift()]));
  while (s.phase === 'leader-selection') s = act(s, { type: 'chooseLeader', leaderId: 'leader-' + choices.get(s.currentPlayerId) });
  if (s.phase === 'effect-choice') s = act(s, { type: 'chooseEffect', option: 0 });
  assert.equal(s.phase, 'player-turns'); assert.equal(s.currentPlayerId, target);
  return s;
}
function choose(s, text) {
  const option = game.getView(s, s.currentPlayerId).pending.options.find(o => o.label.includes(text));
  assert.ok(option, `Missing option: ${text}`);
  return act(s, { type: 'chooseEffect', option: option.option });
}
function place(s, cardId, spaceId, fields = {}) {
  const c = card(cardId); active(s).hand = [c];
  const legal = game.getLegalActions(s, s.currentPlayerId).find(a => a.type === 'agent' && a.cardUid === c.uid && a.spaceId === spaceId && !a.effectOrder && !a.leaderEffectAt);
  assert.ok(legal, `Illegal fixture placement: ${cardId} -> ${spaceId}`);
  return act(s, { ...legal, ...fields });
}
function forceTurn(s, id = s.currentPlayerId) {
  s.phase = 'player-turns'; s.pending = null; s.currentPlayerId = id;
  s.turn = { playerId: id, kind: 'agent', atStart: true, recruited: 0, deployed: 0,
    freshGarrison: 0, freshConflict: 0, boardOldDeployed: 0, masterstrokeOffered: false };
  return s;
}
function finishReveal(s) {
  if (s.phase === 'player-turns') s = act(s, { type: 'reveal' });
  let steps = 0;
  while (s.phase === 'reveal' || s.phase === 'effect-choice') {
    assert.ok(steps++ < 100);
    const actions = game.getLegalActions(s, s.currentPlayerId);
    const next = actions.find(a => a.type === 'resolveReveal') || actions.find(a => a.type === 'chooseEffect') || actions.find(a => a.type === 'endReveal');
    s = act(s, next);
  }
  return s;
}
module.exports = { game, card, active, act, create, choose, place, forceTurn, finishReveal };
