'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { game, card, active, act, create, choose, place, forceTurn } = require('./full-fixtures');

test('Baron choices stay private until four deployments in one turn trigger the once-per-game reveal', () => {
  let s = create('baron-vladimir-harkonnen'); const id = s.currentPlayerId, other = s.players.find(p => p.id !== id).id;
  assert.equal(game.getView(s, other).players.find(p => p.id === id).leaderState.masterstrokeFactions, undefined);
  const reinforcement = card('intrigue-reinforcements'); active(s).intrigues = [reinforcement]; active(s).resources.solari = 3;
  s = act(s, { type: 'playIntrigue', cardUid: reinforcement.uid });
  s = place(s, 'reconnaissance', 'arrakeen');
  s = act(s, { type: 'deploy', count: 2 }); assert.equal(s.phase, 'agent-end');
  s = JSON.parse(JSON.stringify(s)); s = act(s, { type: 'deploy', count: 2 });
  assert.equal(s.phase, 'effect-choice'); s = choose(s, '揭示秘密势力并');
  assert.equal(active(s).leaderState.masterstrokeUsed, true);
  assert.equal(active(s).influence.emperor, 1); assert.equal(active(s).influence['spacing-guild'], 1);
  assert.deepEqual(game.getView(s, other).players.find(p => p.id === id).leaderState.masterstrokeFactions, ['emperor', 'spacing-guild']);
  s = act(s, { type: 'deploy', count: 1 }); assert.equal(s.phase, 'agent-end');
  assert.equal(active(s).influence.emperor, 1);
});

test('Ilban draws for a board Solari payment and allows the draw to be ordered with other effects', () => {
  let s = create('count-ilban-richese'); active(s).resources.solari = 2;
  const before = active(s).deck.length;
  s = place(s, 'dagger', 'mentat', { leaderEffectAt: 3 });
  assert.equal(active(s).resources.solari, 0); assert.equal(active(s).deck.length, before - 2);
  assert.equal(active(s).hand.length, 2); assert.equal(active(s).agentsAvailable, 2);
  s = create('count-ilban-richese'); active(s).resources.solari = 3; active(s).hand = [card('gurney-halleck')];
  const deck = active(s).deck.length; s = act(s, { type: 'reveal' });
  s = act(s, { type: 'resolveReveal', cardUid: active(s).unresolvedReveal[0].uid });
  s = choose(s, '支付 3 索拉里'); s = choose(s, '部署 0');
  assert.equal(active(s).deck.length, deck); // Intrinsic card fees do not trigger Ilban.
});

test('Ariana applies one harvest penalty to Carryall base plus bonus spice and draws once', () => {
  let s = create('countess-ariana-thorvald'); active(s).resources.water = 2; s.bonusSpice['great-flat'] = 2;
  const deck = active(s).deck.length;
  s = place(s, 'carryall', 'great-flat');
  assert.equal(active(s).resources.spice, 7); assert.equal(active(s).deck.length, deck - 1);
  s = create('countess-ariana-thorvald'); s = place(s, 'signet-ring', 'secure-contract');
  assert.equal(active(s).resources.water, 2);
});

test('Leto discounts Landsraad board costs and his signet can select only a faction where an opponent leads', () => {
  let s = create('duke-leto-atreides'); active(s).resources.solari = 1;
  assert.equal(game.getView(s, s.currentPlayerId).effectiveSpaceCosts.mentat.solari, 1);
  s = place(s, 'dagger', 'mentat'); assert.equal(active(s).resources.solari, 0);
  s = create('duke-leto-atreides'); active(s).resources.spice = 1;
  s.players.find(p => p.id !== s.currentPlayerId).influence.fremen = 1;
  s = place(s, 'signet-ring', 'secure-contract');
  const labels = game.getView(s, s.currentPlayerId).pending.options.map(o => o.label);
  assert.equal(labels.length, 2); assert.ok(labels.some(x => x.includes('fremen')));
  s = choose(s, '提升 fremen'); assert.equal(active(s).resources.spice, 0); assert.equal(active(s).influence.fremen, 1);
});

test('Memnon gets an influence choice with High Council and spice from the signet', () => {
  let s = create('earl-memnon-thorvald'); active(s).resources.solari = 5; active(s).influence.emperor = 1;
  s = place(s, 'dagger', 'high-council'); assert.equal(active(s).highCouncil, true);
  s = choose(s, 'emperor'); assert.equal(active(s).influence.emperor, 2); assert.equal(active(s).vp, 1);
  s = create('earl-memnon-thorvald'); s = place(s, 'signet-ring', 'secure-contract'); assert.equal(active(s).resources.spice, 1);
});

test('Rabban receives the starting resources and upgrades the signet recruitment with any alliance', () => {
  let s = create('glossu-the-beast-rabban');
  assert.deepEqual(active(s).resources, { spice: 1, solari: 1, water: 1 });
  s = place(s, 'signet-ring', 'secure-contract'); assert.equal(active(s).troops.garrison, 4);
  s = create('glossu-the-beast-rabban'); s.alliances.fremen = s.currentPlayerId; active(s).influence.fremen = 4;
  s = place(s, 'signet-ring', 'secure-contract'); assert.equal(active(s).troops.garrison, 5);
});

test('Helena ignores enemy city occupancy but protects manipulated cards from other players', () => {
  let s = create('helena-richese'); const id = s.currentPlayerId, other = s.players.find(p => p.id !== id).id;
  s.agentPositions.push({ agentUid: other + ':agent-1', playerId: other, spaceId: 'arrakeen', kind: 'agent' }); s.occupied.arrakeen = other;
  s = place(s, 'reconnaissance', 'arrakeen'); assert.equal(s.agentPositions.filter(a => a.spaceId === 'arrakeen').length, 2);
  s = create('helena-richese'); const owner = s.currentPlayerId, opponent = s.players.find(p => p.id !== owner).id;
  const selected = card('dr-yueh'); s.market[0] = selected;
  s = place(s, 'signet-ring', 'secure-contract'); s = choose(s, '移走并补充：岳医生');
  assert.ok(!s.market.some(c => c.uid === selected.uid)); assert.equal(active(s).setAsideMarket[0].uid, selected.uid);
  s = forceTurn(s, opponent); active(s).hand = []; s = act(s, { type: 'reveal' }); active(s).persuasion = 99;
  assert.throws(() => act(s, { type: 'buy', source: 'set-aside', cardUid: selected.uid }), { code: 'CARD_UNAVAILABLE' });
  s = forceTurn(s, owner); active(s).hand = []; s = act(s, { type: 'reveal' });
  s = act(s, { type: 'buy', source: 'set-aside', cardUid: selected.uid });
  assert.equal(active(s).persuasion, 0); assert.ok(active(s).discard.some(c => c.uid === selected.uid));
});

test('Helena removes an unbought set-aside card at reveal cleanup without triggering trash effects', () => {
  let s = create('helena-richese'); const id = s.currentPlayerId, selected = card('assassination-mission'); s.market[0] = selected;
  s = place(s, 'signet-ring', 'secure-contract'); s = choose(s, '暗杀任务');
  s = forceTurn(s, id); active(s).hand = []; s = act(s, { type: 'reveal' }); const before = active(s).resources.solari;
  s = act(s, { type: 'endReveal' });
  assert.ok(s.removedMarket.some(c => c.uid === selected.uid)); assert.ok(!s.trashed.some(c => c.uid === selected.uid));
  assert.equal(s.players.find(p => p.id === id).resources.solari, before);
});

test('Paul alone sees his own deck top; looking never changes or reshuffles the game', () => {
  let s = create('paul-atreides'); const id = s.currentPlayerId, other = s.players.find(p => p.id !== id).id;
  const before = JSON.stringify(s), top = active(s).deck.at(-1);
  assert.equal(game.getView(s, id).players.find(p => p.id === id).deckTop.uid, top.uid);
  assert.ok(!JSON.stringify(game.getView(s, other)).includes(top.uid)); assert.equal(JSON.stringify(s), before);
  s = place(s, 'signet-ring', 'secure-contract'); assert.equal(active(s).hand.length, 1);
  active(s).deck = []; active(s).discard = [card('dagger')];
  assert.equal(game.getView(s, id).players.find(p => p.id === id).deckTop, null); assert.equal(active(s).deck.length, 0);
});

test('full games advertise a way forward through setup, responses, agent endings and victory windows', () => {
  for (const count of [3, 4]) {
    let s = create('baron-vladimir-harkonnen', count), steps = 0;
    while (s.phase !== 'finished' && steps++ < 2500) {
      const actions = game.getLegalActions(s, s.currentPlayerId); assert.ok(actions.length, `stuck: ${s.phase}`);
      const next = actions.find(a => a.type === 'agent') || actions.find(a => a.type === 'playIntrigue') ||
        actions.find(a => a.type === 'resolveReveal') || actions.filter(a => a.type === 'deploy').at(-1) ||
        actions.find(a => a.type === 'buy') || actions[0];
      const before = JSON.stringify(s); const after = act(s, next); assert.equal(JSON.stringify(s), before); s = after;
      for (const p of s.players) {
        assert.equal(p.troops.supply + p.troops.garrison + p.troops.conflict, 12);
        assert.ok(Object.values(p.troops).every(n => Number.isInteger(n) && n >= 0));
        assert.ok(Object.values(p.resources).every(n => Number.isInteger(n) && n >= 0));
      }
      assert.equal(new Set(s.agentPositions.map(a => a.agentUid)).size, s.agentPositions.length);
    }
    assert.equal(s.phase, 'finished'); assert.ok(s.round <= 10); assert.ok(s.result.winnerIds.length > 0);
  }
});
