'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('..');
let uid = 0;
const card = cardId => ({ uid: `test-${++uid}`, cardId });
// Keep the original suite as regression coverage for saved core-dev-v1 games.
// New games and v2 effects are covered separately in base.test.js.
const { createLegacy } = require('./fixtures');
const create = (count = 3) => createLegacy('core-dev-v1', count);
const active = s => s.players.find(p => p.id === s.currentPlayerId);
const act = (s, action) => game.applyAction(s, s.currentPlayerId, action);
function setupAgent(s, cardId, spaceId, fields = {}) {
  const p = active(s), c = card(cardId);
  p.hand = [c];
  return { type: 'agent', cardUid: c.uid, spaceId, ...fields };
}
function finishRound(s) {
  const initial = s.round;
  let n = 0;
  while (s.round === initial && !['endgame', 'finished'].includes(s.phase) && n++ < 100) {
    const actions = game.getLegalActions(s, s.currentPlayerId);
    const action = actions.find(a => ['reveal', 'endReveal', 'passCombat'].includes(a.type)) || actions[0];
    s = act(s, action);
  }
  assert.ok(n < 100);
  return s;
}

test('setup respects player count, starter composition, troops and initial score', () => {
  for (const count of [3, 4]) {
    const s = create(count);
    assert.equal(s.round, 1);
    assert.equal(s.conflict.level, 1);
    assert.deepEqual(s.conflictDeck.map(c => c.level), [2, 2, 2, 2, 2, 3, 3, 3, 3]);
    assert.equal(s.market.length, 5);
    for (const p of s.players) {
      assert.equal(p.hand.length, 5);
      assert.equal(p.deck.length, 5);
      assert.equal(p.vp, count === 4 ? 1 : 0);
      assert.deepEqual(p.resources, { spice: 0, solari: 0, water: 1 });
      assert.deepEqual(p.troops, { supply: 9, garrison: 3, conflict: 0 });
      assert.deepEqual([...p.hand, ...p.deck].map(c => c.cardId).sort(), [...game.getCatalog().starterCards].sort());
    }
  }
  assert.throws(() => create(2), { code: 'PLAYER_COUNT' });
  assert.throws(() => game.createGame({ players: [{ id: 'x', name: 'x' }, { id: 'x', name: 'x' }, { id: 'z', name: 'z' }] }), { code: 'DUPLICATE_PLAYER' });
});

test('commands are authoritative, immutable, and enforce ownership and phase', () => {
  const s = create(), original = JSON.stringify(s), id = s.currentPlayerId;
  assert.throws(() => game.applyAction(s, 'stranger', { type: 'reveal' }), { code: 'NOT_A_PLAYER' });
  assert.throws(() => game.applyAction(s, s.players.find(p => p.id !== id).id, { type: 'reveal' }), { code: 'NOT_YOUR_TURN' });
  assert.throws(() => act(s, { type: 'reveal', vp: 999 }), { code: 'INVALID_ACTION' });
  assert.throws(() => act(s, { type: '__proto__' }), { code: 'INVALID_ACTION' });
  assert.throws(() => act(s, { type: 'endReveal' }), { code: 'WRONG_PHASE' });
  const next = act(s, { type: 'reveal' });
  assert.equal(next.phase, 'reveal');
  assert.equal(JSON.stringify(s), original);
});

test('public projection hides hands, intrigue IDs, deck order and future conflicts', () => {
  const s = create(), me = s.players[0], opponent = s.players[1];
  opponent.intrigues = [card('dev-ambush')];
  const view = game.getView(s, me.id), spectator = game.getView(s, null);
  const raw = JSON.stringify(view);
  for (const hidden of [...opponent.hand, ...opponent.deck, ...opponent.intrigues, ...me.deck, ...s.marketDeck, ...s.intrigueDeck]) assert.ok(!raw.includes(hidden.uid));
  assert.equal(view.players[0].hand.length, 5);
  assert.equal(view.players[1].hand, undefined);
  assert.equal(view.players[1].intrigueCount, 1);
  assert.equal(spectator.players[0].hand, undefined);
  assert.deepEqual(spectator.legalActions, []);
  assert.equal(view.conflictDeck, undefined);
  view.players[0].resources.water = 999;
  assert.equal(me.resources.water, 1);
});

test('board placement checks matching icons, occupancy, requirements and upfront costs', () => {
  const s = create();
  let a = setupAgent(s, 'reconnaissance', 'wealth');
  assert.throws(() => act(s, a), { code: 'ILLEGAL_PLACEMENT' });
  a = setupAgent(s, 'reconnaissance', 'sietch-tabr');
  assert.throws(() => act(s, a), { code: 'ILLEGAL_PLACEMENT' });
  a = setupAgent(s, 'dev-water-carrier', 'research-station');
  assert.throws(() => act(s, a), { code: 'ILLEGAL_PLACEMENT' });
  a = setupAgent(s, 'reconnaissance', 'arrakeen');
  s.occupied.arrakeen = 'p-other';
  assert.throws(() => act(s, a), { code: 'ILLEGAL_PLACEMENT' });
});

test('combat deployment includes recruits plus at most two existing troops', () => {
  let s = create();
  const id = s.currentPlayerId, a = setupAgent(s, 'reconnaissance', 'arrakeen');
  s = act(s, a);
  let p = s.players.find(p => p.id === id);
  assert.equal(s.phase, 'agent-choice');
  assert.equal(p.troops.garrison, 4);
  assert.equal(s.pending.maxDeploy, 3);
  assert.throws(() => act(s, { type: 'deploy', count: 4 }), { code: 'INVALID_DEPLOYMENT' });
  s = act(s, { type: 'deploy', count: 3 });
  p = s.players.find(p => p.id === id);
  assert.deepEqual(p.troops, { supply: 8, garrison: 1, conflict: 3 });
  assert.notEqual(s.currentPlayerId, id);
});

test('troop recruiting is capped by the twelve-piece supply', () => {
  let s = create();
  const p = active(s), id = p.id;
  p.resources.solari = 4; p.troops = { supply: 1, garrison: 11, conflict: 0 };
  s = act(s, setupAgent(s, 'dagger', 'rally-troops'));
  assert.deepEqual(s.players.find(p => p.id === id).troops, { supply: 0, garrison: 12, conflict: 0 });
});

test('spice sale has precisely the four official exchanges and rejects fractional inputs', () => {
  for (const [spice, solari] of [[2, 6], [3, 8], [4, 10], [5, 12]]) {
    let s = create(); const p = active(s), id = p.id; p.resources.spice = spice;
    s = act(s, setupAgent(s, 'dune-desert-planet', 'sell-melange', { spice }));
    assert.deepEqual(s.players.find(p => p.id === id).resources, { water: 1, spice: 0, solari });
  }
  let s = create(); active(s).resources.spice = 10;
  assert.throws(() => act(s, setupAgent(s, 'dune-desert-planet', 'sell-melange', { spice: 1 })), { code: 'ILLEGAL_PLACEMENT' });
  assert.throws(() => act(s, setupAgent(s, 'dune-desert-planet', 'sell-melange', { spice: 2.5 })), { code: 'ILLEGAL_PLACEMENT' });
});

test('swordmaster is immediate and permanent; repeat acquisition is forbidden', () => {
  let s = create(); const id = s.currentPlayerId; active(s).resources.solari = 16;
  s = act(s, setupAgent(s, 'dagger', 'swordmaster'));
  let p = s.players.find(p => p.id === id);
  assert.equal(p.swordmaster, true);
  assert.equal(p.agentsAvailable, 2);
  s = finishRound(s); p = s.players.find(p => p.id === id);
  assert.equal(p.agentsAvailable, 3);
  s.currentPlayerId = id;
  assert.throws(() => act(s, setupAgent(s, 'dagger', 'swordmaster')), { code: 'ILLEGAL_PLACEMENT' });
});

test('mentat grants only a temporary extra action, and high council adds two on reveal', () => {
  let s = create(); const id = s.currentPlayerId; active(s).resources.solari = 10;
  s = act(s, setupAgent(s, 'dagger', 'mentat'));
  assert.equal(s.players.find(p => p.id === id).agentsAvailable, 2);
  assert.equal(s.mentatOwner, id);
  s = finishRound(s);
  assert.equal(s.mentatOwner, null);
  assert.equal(s.players.find(p => p.id === id).agentsAvailable, 2);
  s.currentPlayerId = id;
  s = act(s, setupAgent(s, 'dagger', 'high-council'));
  s.currentPlayerId = id; s.players.find(p => p.id === id).hand = [card('convincing-argument')];
  s = act(s, { type: 'reveal' });
  assert.equal(active(s).persuasion, 4);
});

test('influence thresholds, finite emperor troops and strict alliance overtake', () => {
  let s = create(); const id = s.currentPlayerId; active(s).influence.emperor = 1;
  s = act(s, setupAgent(s, 'diplomacy', 'wealth'));
  assert.equal(s.players.find(p => p.id === id).vp, 1);
  s.currentPlayerId = id; delete s.occupied.wealth; active(s).influence.emperor = 3;
  const beforeTroops = active(s).troops.garrison;
  s = act(s, setupAgent(s, 'diplomacy', 'wealth'));
  assert.equal(s.alliances.emperor, id);
  assert.equal(s.players.find(p => p.id === id).troops.garrison, beforeTroops + 2);
  const challenger = s.players.find(p => p.id !== id).id;
  s.currentPlayerId = challenger; delete s.occupied.wealth; active(s).influence.emperor = 3;
  s = act(s, setupAgent(s, 'diplomacy', 'wealth'));
  assert.equal(s.alliances.emperor, id);
  s.currentPlayerId = challenger; delete s.occupied.wealth;
  s = act(s, setupAgent(s, 'diplomacy', 'wealth'));
  assert.equal(s.alliances.emperor, challenger);
  assert.equal(s.players.find(p => p.id === id).vp, 1);
});

test('selective breeding supports skipping and trashes an in-play card before drawing', () => {
  let s = create(); const id = s.currentPlayerId; active(s).resources.spice = 2;
  const a = setupAgent(s, 'diplomacy', 'selective-breeding');
  s = act(s, a);
  assert.equal(s.pending.stage, 'trash');
  assert.throws(() => act(s, { type: 'chooseTrash', cardUid: 'unknown' }), { code: 'CARD_UNAVAILABLE' });
  s = act(s, { type: 'chooseTrash', cardUid: a.cardUid });
  const p = s.players.find(p => p.id === id);
  assert.equal(p.hand.length, 2);
  assert.equal(p.inPlay.length, 0);
  assert.ok(s.trashed.some(c => c.uid === a.cardUid));
});

test('Foldspace draws and returns itself to reserve; its reveal has no persuasion', () => {
  let s = create(); const id = s.currentPlayerId; s.reserve.foldspace = 5;
  s = act(s, setupAgent(s, 'foldspace', 'wealth'));
  let p = s.players.find(p => p.id === id);
  assert.equal(p.hand.length, 1);
  assert.equal(p.inPlay.length, 0);
  assert.equal(s.reserve.foldspace, 6);
  s.currentPlayerId = id; p.hand = [card('foldspace')];
  s = act(s, { type: 'reveal' });
  assert.equal(active(s).persuasion, 0);
});

test('reveal uses only unused hand cards, disallows further agents and expires persuasion', () => {
  let s = create(); const id = s.currentPlayerId, p = active(s);
  p.hand = [card('convincing-argument'), card('dagger')];
  p.inPlay = [card('convincing-argument')];
  s = act(s, { type: 'reveal' });
  assert.equal(active(s).persuasion, 2);
  assert.equal(active(s).swords, 1);
  assert.equal(game.getView(s, id).players.find(p => p.id === id).strength, 0);
  assert.throws(() => act(s, { type: 'agent', cardUid: 'x', spaceId: 'wealth' }), { code: 'WRONG_PHASE' });
  s = act(s, { type: 'endReveal' });
  const next = s.players.find(p => p.id === id);
  assert.equal(next.persuasion, 0);
  assert.equal(next.discard.length, 3);
  assert.equal(next.inPlay.length, 0);
});

test('purchases spend persuasion, refill market, put cards in discard and score acquire VP', () => {
  let s = create(); const id = s.currentPlayerId; active(s).hand = [];
  s = act(s, { type: 'reveal' }); active(s).persuasion = 20;
  const c = s.market[0], cost = game.getCatalog().cards[c.cardId].cost;
  s = act(s, { type: 'buy', source: 'market', cardUid: c.uid });
  assert.equal(active(s).persuasion, 20 - cost);
  assert.ok(active(s).discard.some(item => item.uid === c.uid));
  assert.equal(s.market.length, 5);
  assert.ok(!s.market.some(item => item.uid === c.uid));
  s = act(s, { type: 'buy', source: 'reserve', cardId: 'the-spice-must-flow' });
  assert.equal(active(s).vp, 1);
  assert.equal(s.reserve['the-spice-must-flow'], 9);
  assert.throws(() => act(s, { type: 'buy', source: 'reserve', cardId: 'foldspace' }), { code: 'CARD_UNAVAILABLE' });
  assert.equal(active(s).id, id);
});

test('empty personal deck reshuffles discards; played cards remain out until reveal cleanup', () => {
  let s = create(); const id = s.currentPlayerId, p = active(s);
  p.deck = []; p.discard = [card('dagger')];
  const used = card('diplomacy'); p.inPlay = [used];
  s = act(s, setupAgent(s, 'reconnaissance', 'arrakeen'));
  const after = s.players.find(p => p.id === id);
  assert.equal(after.hand.length, 1);
  assert.equal(after.hand[0].cardId, 'dagger');
  assert.ok(!after.hand.some(c => c.uid === used.uid));
});

test('combat requires consecutive passes; a card reopens the previous passer', () => {
  let s = create(); s.phase = 'combat'; s.firstPlayerIndex = 0; s.currentPlayerId = 'p0';
  for (const p of s.players.slice(0, 2)) { p.troops.conflict = 1; p.troops.supply = 8; }
  const c = card('dev-ambush'); s.players[1].intrigues = [c];
  s = act(s, { type: 'passCombat' });
  assert.equal(s.currentPlayerId, 'p1');
  s = act(s, { type: 'playIntrigue', cardUid: c.uid });
  assert.equal(s.combatPasses, 0);
  s = act(s, { type: 'passCombat' });
  assert.equal(s.currentPlayerId, 'p0');
  assert.equal(s.phase, 'combat');
  s = act(s, { type: 'passCombat' });
  assert.equal(s.round, 2);
  assert.equal(s.lastCombat.results[0].playerId, 'p1');
  assert.equal(s.players[0].troops.conflict, 0);
  assert.equal(s.players[0].troops.supply, 9);
});

test('combat ties downgrade rewards, third reward only exists with four players', () => {
  for (const count of [3, 4]) {
    let s = create(count); s.phase = 'combat'; s.currentPlayerId = 'p0';
    s.players.forEach((p, i) => { p.troops.conflict = i < 2 ? 2 : 1; p.troops.supply -= p.troops.conflict; });
    for (let i = 0; i < count; i++) s = act(s, { type: 'passCombat' });
    const results = s.lastCombat.results;
    assert.deepEqual(results.slice(0, 2).map(r => r.reward), [{ solari: 3 }, { solari: 3 }]);
    assert.equal(results[2].reward, null);
    assert.ok(Object.values(s.controls).every(v => v === null));
  }
  let s = create(4); s.phase = 'combat'; s.currentPlayerId = 'p0';
  [3, 3, 2, 1].forEach((n, i) => { s.players[i].troops.conflict = n; s.players[i].troops.supply -= n; });
  for (let i = 0; i < 4; i++) s = act(s, { type: 'passCombat' });
  assert.deepEqual(s.lastCombat.results[2].reward, { spice: 1 });
});

test('unoccupied spice fields accumulate and their next visitor harvests bonus spice', () => {
  let s = create(); s.occupied['imperial-basin'] = s.currentPlayerId;
  const first = s.firstPlayerIndex; s = finishRound(s);
  assert.equal(s.firstPlayerIndex, (first + 1) % 3);
  assert.deepEqual(s.bonusSpice, { 'imperial-basin': 0, 'hagga-basin': 1, 'great-flat': 1 });
  const id = s.currentPlayerId; s = act(s, setupAgent(s, 'dune-desert-planet', 'hagga-basin'));
  assert.equal(active(s).id, id);
  assert.equal(active(s).resources.spice, 3);
  assert.equal(s.bonusSpice['hagga-basin'], 0);
});

test('control grants resource to owner on any visit and optional supply defense next conflict', () => {
  let s = create(); const owner = s.players.find(p => p.id !== s.currentPlayerId);
  s.controls.arrakeen = owner.id;
  s = act(s, setupAgent(s, 'reconnaissance', 'arrakeen'));
  assert.equal(s.players.find(p => p.id === owner.id).resources.solari, 1);
  s.conflictDeck[0].control = 'arrakeen';
  s = act(s, { type: 'deploy', count: 0 }); s = finishRound(s);
  assert.equal(s.phase, 'round-start');
  assert.equal(s.currentPlayerId, owner.id);
  s = act(s, { type: 'defend', deploy: true });
  assert.equal(s.players.find(p => p.id === owner.id).troops.conflict, 1);
  assert.equal(s.players.find(p => p.id === owner.id).troops.supply, 8);
});

test('ten points only triggers endgame after combat; endgame cards precede tiebreakers', () => {
  let s = create(); const first = s.players[s.firstPlayerIndex].id;
  s.players.forEach(p => { p.vp = 10; p.resources.spice = 2; });
  s.players.find(p => p.id === first).intrigues = [card('dev-legacy')];
  s = finishRound(s);
  assert.equal(s.phase, 'endgame');
  assert.equal(s.currentPlayerId, first);
  s = act(s, { type: 'playIntrigue', cardUid: active(s).intrigues[0].uid });
  for (let i = 0; i < 3; i++) s = act(s, { type: 'passEndgame' });
  assert.equal(s.phase, 'finished');
  assert.deepEqual(s.result.winnerIds, [first]);
  assert.throws(() => act(s, { type: 'reveal' }), { code: 'GAME_FINISHED' });
});

test('a whole game can complete using only server-issued legal actions', () => {
  for (let run = 0; run < 6; run++) {
    let s = create(run % 2 ? 4 : 3), steps = 0;
    while (s.phase !== 'finished' && steps++ < 800) {
      const actions = game.getLegalActions(s, s.currentPlayerId);
      assert.ok(actions.length > 0, `stuck in ${s.phase}`);
      const agentAction = actions.find(a => a.type === 'agent');
      const purchase = actions.find(a => a.type === 'buy');
      const action = agentAction || purchase || actions[actions.length - 1];
      const before = JSON.stringify(s);
      const next = act(s, action);
      assert.equal(JSON.stringify(s), before);
      s = next;
      for (const p of s.players) {
        assert.equal(Object.values(p.troops).reduce((a, b) => a + b, 0), 12);
        assert.ok(Object.values(p.resources).every(n => Number.isInteger(n) && n >= 0));
      }
    }
    assert.equal(s.phase, 'finished');
    assert.ok(s.round <= 10);
    assert.ok(s.result.winnerIds.length > 0);
  }
});

test('FAQ final tie goes to the tied player who most recently revealed', () => {
  let s = create(); s.players.forEach(p => { p.vp = 10; });
  s = finishRound(s);
  const last = [...s.players].sort((a, b) => b.lastRevealSequence - a.lastRevealSequence)[0];
  for (let i = 0; i < 3; i++) s = act(s, { type: 'passEndgame' });
  assert.deepEqual(s.result.winnerIds, [last.id]);
  assert.equal(s.result.tiebreakers.at(-1), 'lastRevealSequence');
  assert.equal(s.result.rankings[0].score.at(-1), last.lastRevealSequence);
});

test('VP, spice, Solari, water and garrison take priority over reveal order in that order', () => {
  for (const key of ['vp', 'spice', 'solari', 'water', 'garrison']) {
    let s = create(); s.players.forEach(p => { p.vp = 10; });
    s = finishRound(s);
    const earliest = [...s.players].sort((a, b) => a.lastRevealSequence - b.lastRevealSequence)[0];
    if (key === 'vp') earliest.vp++;
    else if (key === 'garrison') { earliest.troops.garrison++; earliest.troops.supply--; }
    else earliest.resources[key]++;
    for (let i = 0; i < 3; i++) s = act(s, { type: 'passEndgame' });
    assert.deepEqual(s.result.winnerIds, [earliest.id]);
  }
});
