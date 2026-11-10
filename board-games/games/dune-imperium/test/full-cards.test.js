'use strict';
// User-run regression cases. No test command is invoked by the implementation task.
const test = require('node:test');
const assert = require('node:assert/strict');
const { game, card, active, act, create, choose, place, forceTurn, finishReveal } = require('./full-fixtures');

test('v3 restores the complete 67/40/18 inventory and selects distinct leaders before drawing', () => {
  let s = game.createGame({ players: ['a', 'b', 'c'].map(id => ({ id, name: id })) });
  assert.equal(s.ruleset, 'base-dev-v3'); assert.equal(s.round, 0);
  assert.equal(s.market.length + s.marketDeck.length, 67); assert.equal(s.intrigueDeck.length, 40);
  assert.equal(s.conflictDeck.length, 10); assert.ok(s.players.every(p => p.hand.length === 0 && p.deck.length === 10));
  assert.equal(game.getLegalActions(s, s.currentPlayerId).filter(a => a.type === 'chooseLeader').length, 8);
  const selected = 'leader-paul-atreides'; s = act(s, { type: 'chooseLeader', leaderId: selected });
  assert.throws(() => act(s, { type: 'chooseLeader', leaderId: selected }), { code: 'LEADER_UNAVAILABLE' });
  while (s.phase === 'leader-selection') s = act(s, game.getLegalActions(s, s.currentPlayerId)[0]);
  if (s.phase === 'effect-choice') s = act(s, { type: 'chooseEffect', option: 0 });
  assert.equal(s.round, 1); assert.ok(s.players.every(p => p.hand.length === 5));
  assert.equal(Object.values(game.getCatalog().leaders).filter(leader => !leader.expansion).length, 8);
  assert.ok(game.getLegalActions(s, s.currentPlayerId).every(a => a.type !== 'chooseLeader' || !game.getCatalog().leaders[a.leaderId].expansion));
  assert.ok(Object.values(game.getCatalog().referenceCatalog.cards).filter(c => c.category !== 'location').every(c => c.implementation === 'playable'));
});

test('Kwisatz moves a deployed agent with no spare agents and removes the vacated occupancy', () => {
  let s = create(); const p = active(s), id = p.id;
  s.agentPositions = [{ agentUid: id + ':agent-1', playerId: id, spaceId: 'wealth', kind: 'agent' },
    { agentUid: id + ':agent-2', playerId: id, spaceId: 'imperial-basin', kind: 'agent' }];
  s.occupied = { wealth: id, 'imperial-basin': id }; p.agentsAvailable = 0;
  p.hand = [card('kwisatz-haderach')]; const beforeDeck = p.deck.length;
  const action = game.getLegalActions(s, id).find(a => a.type === 'agent' && a.spaceId === 'carthag' && a.agentUid === id + ':agent-1' && !a.effectOrder);
  assert.ok(action); s = act(s, action);
  assert.equal(s.agentPositions.length, 2); assert.equal(s.occupied.wealth, undefined);
  assert.equal(s.agentPositions.find(a => a.agentUid === id + ':agent-1').spaceId, 'carthag');
  assert.equal(active(s).agentsAvailable, 0); assert.equal(active(s).deck.length, beforeDeck - 1);
});

test('Voice blocks Infiltrate and Kwisatz until the caster next takes a turn', () => {
  let s = create('earl-memnon-thorvald'); const caster = s.currentPlayerId;
  s = place(s, 'the-voice', 'secure-contract'); s = choose(s, '封锁：财富'); s = act(s, { type: 'endAgent' });
  const p = active(s); p.hand = [card('kwisatz-haderach')]; p.infiltrate = true;
  assert.ok(!game.getLegalActions(s, p.id).some(a => a.type === 'agent' && a.spaceId === 'wealth'));
  while (s.currentPlayerId !== caster) s = finishReveal(s);
  assert.equal(s.voiceBlocks.length, 0);
});

test('Mohiam asks opponents clockwise for their own discards, survives reload, and resumes the caster', () => {
  let s = create('earl-memnon-thorvald'); const caster = s.currentPlayerId;
  const order = Array.from({ length: 2 }, (_, n) => s.players[(s.firstPlayerIndex + n + 1) % 3].id);
  active(s).inPlay = [card('bene-gesserit-initiate')];
  for (const p of s.players.filter(p => p.id !== caster)) p.hand = [card('dagger'), card('convincing-argument'), card('diplomacy')];
  s = place(s, 'reverend-mother-mohiam', 'wealth');
  assert.equal(s.currentPlayerId, order[0]);
  const secret = active(s).hand[0].uid;
  assert.ok(!JSON.stringify(game.getView(s, caster)).includes(secret));
  s = choose(s, '弃掉：匕首'); s = JSON.parse(JSON.stringify(s)); s = choose(s, '弃掉：有力论证');
  assert.equal(s.currentPlayerId, order[1]); s = choose(s, '弃掉：匕首'); s = choose(s, '弃掉：有力论证');
  assert.equal(s.currentPlayerId, caster); assert.equal(s.phase, 'agent-end');
  assert.equal(active(s).resources.solari, 2);
  assert.ok(order.every(id => s.players.find(p => p.id === id).hand.length === 1));
});

test('Test of Humanity offers only possible discard/troop-loss responses', () => {
  let s = create(); const caster = s.currentPlayerId;
  const opponents = s.players.filter(p => p.id !== caster);
  opponents[0].hand = []; opponents[0].troops.conflict = 1; opponents[0].troops.supply--;
  opponents[1].hand = [card('dagger')];
  s = place(s, 'test-of-humanity', 'hall-of-oratory');
  while (s.phase === 'effect-choice') {
    const p = active(s), options = game.getView(s, p.id).pending.options;
    if (p.hand.length === 0) { assert.equal(options.length, 1); assert.match(options[0].label, /损失/); }
    else assert.ok(options.every(o => o.label.startsWith('弃掉')));
    s = act(s, { type: 'chooseEffect', option: 0 });
  }
  assert.equal(s.currentPlayerId, caster);
  assert.equal(s.players.find(p => p.id === opponents[0].id).troops.conflict, 0);
});

test('Shifting Allegiances pays a real influence loss, resolves tied alliance successors, then gains influence', () => {
  let s = create('earl-memnon-thorvald', 4); const p = active(s), id = p.id;
  p.resources.spice = 2; p.influence.emperor = 4; p.vp += 2; s.alliances.emperor = id;
  const opponents = s.players.filter(p => p.id !== id).slice(0, 2);
  opponents.forEach(p => { p.influence.emperor = 4; p.vp++; });
  s = place(s, 'shifting-allegiances', 'secure-contract');
  s = choose(s, 'emperor -1，spacing-guild +2');
  assert.equal(active(s).resources.spice, 0); assert.equal(active(s).influence['spacing-guild'], 0);
  assert.equal(s.pending.options.length, 2);
  const chosen = game.getView(s, id).pending.options.find(o => o.targetPlayerId === opponents[1].id);
  s = act(s, { type: 'chooseEffect', option: chosen.option });
  assert.equal(s.alliances.emperor, opponents[1].id);
  assert.equal(active(s).influence.emperor, 3); assert.equal(active(s).influence['spacing-guild'], 2);
});

test('Bindu is restricted to turn start, draws once, passes, and spends no agent', () => {
  let s = create(); const id = s.currentPlayerId, c = card('intrigue-bindu-suspension'); active(s).intrigues = [c];
  s = act(s, { type: 'playIntrigue', cardUid: c.uid });
  assert.notEqual(s.currentPlayerId, id); assert.equal(s.players.find(p => p.id === id).hand.length, 6);
  assert.equal(s.players.find(p => p.id === id).agentsAvailable, 2);
  s = create(); const bindu = card('intrigue-bindu-suspension'), windfall = card('intrigue-windfall'); active(s).intrigues = [bindu, windfall];
  s = act(s, { type: 'playIntrigue', cardUid: windfall.uid });
  assert.throws(() => act(s, { type: 'playIntrigue', cardUid: bindu.uid }), { code: 'INTRIGUE_REQUIREMENTS' });
});

test('Bypass uses printed cost limits, pays two spice once, and resolves acquisition bonuses', () => {
  let s = create(); active(s).resources.spice = 2; const c = card('intrigue-bypass-protocol'); active(s).intrigues = [c];
  s.market = [card('chani'), card('kwisatz-haderach')];
  s = act(s, { type: 'playIntrigue', cardUid: c.uid });
  const options = game.getView(s, s.currentPlayerId).pending.options;
  assert.ok(!options.some(o => o.cardId === 'kwisatz-haderach'));
  s = choose(s, '支付 2 香料获得并置于牌库顶：契妮');
  assert.equal(active(s).resources.spice, 0); assert.equal(active(s).resources.water, 2);
  assert.equal(active(s).deck.at(-1).cardId, 'chani');
});

test('Infiltrate permits enemy co-occupancy, is consumed by placement, and never bypasses own occupancy', () => {
  let s = create(); const id = s.currentPlayerId, opponent = s.players.find(p => p.id !== id).id;
  s.agentPositions.push({ agentUid: opponent + ':agent-1', playerId: opponent, spaceId: 'arrakeen', kind: 'agent' }); s.occupied.arrakeen = opponent;
  active(s).hand = [card('reconnaissance')];
  assert.ok(!game.getLegalActions(s, id).some(a => a.type === 'agent' && a.spaceId === 'arrakeen'));
  const c = card('intrigue-infiltrate'); active(s).intrigues = [c]; s = act(s, { type: 'playIntrigue', cardUid: c.uid });
  s = act(s, game.getLegalActions(s, id).find(a => a.type === 'agent' && a.spaceId === 'arrakeen' && !a.effectOrder));
  assert.equal(s.agentPositions.filter(a => a.spaceId === 'arrakeen').length, 2); assert.equal(active(s).infiltrate, false);
  s = forceTurn(s, id); active(s).infiltrate = true; active(s).hand = [card('reconnaissance')];
  assert.ok(!game.getLegalActions(s, id).some(a => a.type === 'agent' && a.spaceId === 'arrakeen'));
});

test('Poison Snooper keeps its viewed card private, triggers trash bonuses, and cannot reshuffle for a peek', () => {
  let s = create('earl-memnon-thorvald'); const id = s.currentPlayerId, top = card('assassination-mission'), c = card('intrigue-poison-snooper');
  active(s).deck = [top]; active(s).intrigues = [c]; s = act(s, { type: 'playIntrigue', cardUid: c.uid });
  const other = s.players.find(p => p.id !== id).id;
  assert.ok(!JSON.stringify(game.getView(s, other)).includes(top.uid));
  assert.ok(!s.intrigueDiscard.some(x => x.uid === c.uid));
  s = JSON.parse(JSON.stringify(s)); s = choose(s, '销毁牌库顶');
  assert.equal(active(s).deck.length, 0); assert.equal(active(s).resources.solari, 4);
  assert.ok(s.trashed.some(x => x.uid === top.uid));
  s = create(); active(s).deck = []; active(s).discard = [card('dagger')];
  const empty = card('intrigue-poison-snooper'); active(s).intrigues = [empty]; s = act(s, { type: 'playIntrigue', cardUid: empty.uid });
  assert.equal(active(s).deck.length, 0); assert.equal(active(s).discard.length, 1);
});

test('Urgent Mission recalls the selected own agent and clears only its occupancy', () => {
  let s = create(); const id = s.currentPlayerId;
  s.agentPositions = [{ agentUid: id + ':agent-1', playerId: id, spaceId: 'wealth', kind: 'agent' }]; s.occupied.wealth = id; active(s).agentsAvailable = 1;
  const c = card('intrigue-urgent-mission'); active(s).intrigues = [c]; s = act(s, { type: 'playIntrigue', cardUid: c.uid }); s = choose(s, '召回：财富');
  assert.equal(s.agentPositions.length, 0); assert.equal(s.occupied.wealth, undefined); assert.equal(active(s).agentsAvailable, 2);
});

test('only an untied winner can use To the Victor then fund Demand Respect before cleanup', () => {
  let s = create(); const id = s.currentPlayerId; delete s.turn; s.phase = 'combat';
  s.players.forEach(p => { p.hand = []; p.revealed = true; }); active(s).troops.conflict = 1; active(s).troops.supply--;
  s.conflict = structuredClone(game.getCatalog().conflicts.find(c => c.id === 'conflict-guild-bank-raid'));
  const victor = card('intrigue-to-the-victory'), respect = card('intrigue-demand-respect'); active(s).intrigues = [victor, respect];
  s = act(s, { type: 'passCombat' }); assert.equal(s.phase, 'combat-win');
  s = act(s, { type: 'playIntrigue', cardUid: victor.uid });
  s = act(s, { type: 'playIntrigue', cardUid: respect.uid }); s = choose(s, '支付 2 香料'); s = choose(s, 'fremen');
  assert.equal(active(s).influence.fremen, 2); assert.equal(active(s).resources.spice, 1);
  s = act(s, { type: 'passCombatWin' }); assert.equal(s.round, 2); assert.equal(s.players.find(p => p.id === id).troops.conflict, 0);
});

test('Plot interruptions re-evaluate optional costs without charging twice or exposing suspended queues', () => {
  let s = create('baron-vladimir-harkonnen');
  const windfall = card('intrigue-windfall'); active(s).intrigues = [windfall];
  s = place(s, 'signet-ring', 'secure-contract'); // Scheme initially has no payable option.
  assert.equal(s.phase, 'effect-choice'); assert.equal(s.pending.options.length, 1);
  s = act(s, { type: 'playIntrigue', cardUid: windfall.uid });
  assert.equal(active(s).resources.solari, 2); assert.equal(s.pending.options.length, 2);
  s = choose(s, '支付 1 索拉里');
  assert.equal(active(s).resources.solari, 4); // 2 - 1 + Secure Contract's 3
  const view = game.getView(s, s.currentPlayerId); assert.equal(view.effectStack, undefined); assert.equal(view.effectContext, undefined);
});
