'use strict';
// User-run integration cases. This file is not executed by the implementation task.
const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('..');
const X = require('../expansion-state');
const clone = value => JSON.parse(JSON.stringify(value));
let serial = 0;
const card = cardId => ({ uid: `expansion-engine-${++serial}`, cardId });
const player = s => s.players.find(p => p.id === s.currentPlayerId);
const act = (s, a) => game.applyAction(s, s.currentPlayerId, a);
function boot(expansions) {
  let s = game.createGame({ players: ['a', 'b', 'c'].map(id => ({ id, name: id })), options: { expansions } });
  for (const leaderId of ['leader-paul-atreides', 'leader-count-ilban-richese', 'leader-duke-leto-atreides']) s = act(s, { type: 'chooseLeader', leaderId });
  return s;
}
function choose(s, text) {
  const selected = game.getView(s, s.currentPlayerId).pending.options.find(o => o.label.includes(text));
  assert.ok(selected, `missing choice: ${text}`);
  return act(s, { type: 'chooseEffect', option: selected.option });
}
function settle(s) {
  for (let n = 0; n < 100 && s.phase === 'effect-choice'; n++) s = act(s, { type: 'chooseEffect', option: 0 });
  assert.notEqual(s.phase, 'effect-choice'); return s;
}

test('all four room configurations construct actual inventories and enter a playable first turn', () => {
  for (const expansions of [[], ['rise-of-ix'], ['immortality'], ['rise-of-ix', 'immortality']]) {
    const s = boot(expansions), ix = expansions.includes('rise-of-ix'), imm = expansions.includes('immortality');
    assert.equal(s.phase, 'player-turns'); assert.equal(s.round, 1);
    assert.equal(s.ruleset, expansions.length ? 'expansions-dev-v4' : 'base-dev-v3');
    assert.equal(s.market.length + s.marketDeck.length, 67 + (ix ? 35 : 0) + (imm ? 30 : 0));
    assert.equal(s.intrigueDeck.length, 40 + (ix ? 17 : 0) + (imm ? 15 : 0));
    assert.deepEqual([s.conflict, ...s.conflictDeck].map(c => c.level), [1, 2, 2, 2, 2, 2, 3, 3, 3, 3]);
    assert.equal(Boolean(s.ix), ix); assert.equal(Boolean(s.immortality), imm);
    if (ix) assert.deepEqual(s.ix.techStacks.map(stack => stack.length), [6, 6, 6]);
    if (imm) {
      assert.equal(s.immortality.tleilaxuRow.length, 2); assert.equal(s.immortality.tleilaxuDeck.length, 16);
      for (const p of s.players) assert.equal([...p.hand, ...p.deck].filter(c => c.cardId === 'experimentation').length, 2);
    }
    assert.ok(game.getLegalActions(s, s.currentPlayerId).some(a => a.type === 'agent'));
    if (expansions.length) X.assertConservation(s);
  }
});

test('Experimentation resolves research and specimens through persisted chooseEffect, then offers deployment', () => {
  let s = boot(['immortality']); const c = card('experimentation'), id = s.currentPlayerId;
  player(s).hand = [c];
  s = act(s, { type: 'agent', cardUid: c.uid, spaceId: 'imperial-basin' });
  assert.equal(s.phase, 'effect-choice');
  const restored = clone(s); assert.deepEqual(game.getLegalActions(restored, id), game.getLegalActions(s, id));
  s = choose(restored, '1:0');
  const p = s.players.find(p => p.id === id);
  assert.equal(p.immortality.research, '1:0'); assert.equal(p.immortality.specimens, 1); assert.equal(p.resources.spice, 1);
  assert.equal(s.phase, 'agent-choice'); assert.ok(game.getLegalActions(s, id).some(a => a.type === 'deploy'));
  X.assertConservation(s);
});

test('Ix shipping is a real board action and removed base locations are rejected', () => {
  let s = boot(['rise-of-ix']); const c = card('dune-desert-planet'); player(s).hand = [c];
  assert.ok(!game.getView(s, s.currentPlayerId).spaces.some(space => space.id === 'sell-melange'));
  assert.throws(() => act(s, { type: 'agent', cardUid: c.uid, spaceId: 'secure-contract' }), { code: 'ILLEGAL_PLACEMENT' });
  s = act(s, { type: 'agent', cardUid: c.uid, spaceId: 'smuggling' });
  s = choose(s, '推进一格');
  assert.equal(player(s).ix.shipping, 1); assert.equal(player(s).resources.solari, 1); assert.equal(s.phase, 'agent-end');
});

test('Ghola copies the other agent box, both cards are grafted, and only one agent is placed', () => {
  let s = boot(['immortality']); const first = card('tleilaxu-ghola'), second = card('tleilaxu-corrino-genes');
  player(s).hand = [first, second];
  assert.throws(() => act(s, { type: 'agent', cardUid: first.uid, spaceId: 'arrakeen' }), { code: 'INVALID_GRAFT' });
  s = act(s, { type: 'agent', cardUids: [first.uid, second.uid], spaceId: 'wealth' });
  assert.equal(s.pending.options.length, 24); s = settle(s);
  assert.equal(player(s).immortality.tleilaxu, 2); assert.equal(player(s).intrigues.length, 1);
  assert.equal(s.agentPositions.length, 1); assert.equal(player(s).resources.solari, 2);
});

test('grafted Power Play is not doubled by Ghola, and each self-trash uses its own source UID', () => {
  let s = boot(['immortality']); const ghola = card('tleilaxu-ghola'), power = card('power-play'); player(s).hand = [ghola, power];
  s = settle(act(s, { type: 'agent', cardUids: [ghola.uid, power.uid], spaceId: 'wealth' }));
  assert.equal(player(s).influence.emperor, 2);
  assert.ok(s.trashed.some(c => c.uid === ghola.uid)); assert.ok(s.trashed.some(c => c.uid === power.uid));
});

test('Usurp end-turn trash refills the row and executes Replacement Eyes on-trash', () => {
  let s = boot(['immortality']); const usurp = card('tleilaxu-usurp'), eyes = card('imm-replacement-eyes');
  player(s).hand = [usurp]; s.market[0] = eyes;
  s = settle(act(s, { type: 'agent', cardUid: usurp.uid, graftMarketUid: eyes.uid, spaceId: 'arrakeen' }));
  const id = s.currentPlayerId;
  s = act(s, { type: 'endAgent' });
  assert.ok(s.trashed.some(c => c.uid === eyes.uid)); assert.ok(!s.market.some(c => c.uid === eyes.uid));
  assert.equal(s.players.find(p => p.id === id).immortality.tleilaxu, 1);
});

test('a dreadnought-only combat reaches rewards, occupation choice, and the next round', () => {
  let s = boot(['rise-of-ix']); const id = s.currentPlayerId, p = player(s);
  p.ix.dreadnoughts = { supply: 1, garrison: 0, conflict: 1 }; p.swords = 2;
  s.phase = 'combat'; delete s.turn; s.combatPasses = 0;
  s.conflict = { id: 'ship-conflict', level: 1, rewards: [{ vp: 1 }, { solari: 1 }, { spice: 1 }] };
  s.conflictDeck = [{ id: 'next-conflict', level: 2, rewards: [{ vp: 1 }, { solari: 1 }, { spice: 1 }] }];
  assert.equal(game.getView(s, id).players.find(p => p.id === id).strength, 5);
  s = act(s, { type: 'passCombat' }); assert.equal(s.phase, 'combat-win');
  s = act(s, { type: 'passCombatWin' }); assert.equal(s.phase, 'effect-choice');
  s = choose(s, 'imperial-basin');
  assert.equal(s.round, 2); assert.equal(X.controller(s, 'imperial-basin'), id); X.assertConservation(s);
});

test('server placement reasons respect Kwisatz, Helena, Voice and actual resource costs', () => {
  let s = boot([]); const id = s.currentPlayerId, p = player(s), kh = card('kwisatz-haderach');
  p.hand = [kh]; p.resources.water = 0;
  let row = game.getView(s, id).agentPlacements.find(g => g.cardUid === kh.uid).spaces.find(space => space.spaceId === 'research-station');
  assert.equal(row.legal, false); assert.match(row.reason, /资源不足/); assert.equal(row.costs.water, 2);
  p.leaderId = 'leader-helena-richese'; const recon = card('reconnaissance'); p.hand = [recon];
  s.agentPositions.push({ playerId: s.players.find(p => p.id !== id).id, agentUid: 'enemy-agent', spaceId: 'arrakeen', kind: 'agent' });
  row = game.getView(s, id).agentPlacements.find(g => g.cardUid === recon.uid).spaces.find(space => space.spaceId === 'arrakeen');
  assert.equal(row.legal, true); assert.equal(row.reason, null);
  s.voiceBlocks.push({ playerId: s.players.find(p => p.id !== id).id, spaceId: 'arrakeen' });
  row = game.getView(s, id).agentPlacements.find(g => g.cardUid === recon.uid).spaces.find(space => space.spaceId === 'arrakeen');
  assert.equal(row.legal, false); assert.match(row.reason, /Voice/);
});
