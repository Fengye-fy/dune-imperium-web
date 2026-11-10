'use strict';
// Added for the user's next verification pass; not automatically executed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const game = require('..');
const { BASE_CONFLICTS } = require('../data');
let sequence = 0;
const card = cardId => ({ uid: `base-test-${++sequence}`, cardId });
const { createLegacy } = require('./fixtures');
const create = (count = 3) => createLegacy('base-subset-v2', count);
const active = s => s.players.find(p => p.id === s.currentPlayerId);
const act = (s, action) => game.applyAction(s, s.currentPlayerId, action);
function choose(s, label) {
  const pending = game.getView(s, s.currentPlayerId).pending;
  const option = pending.options.find(o => o.label.includes(label));
  assert.ok(option, `missing option: ${label}`);
  return act(s, { type: 'chooseEffect', option: option.option });
}
function agent(s, cardId, spaceId, extra = {}) {
  const c = card(cardId); active(s).hand = [c];
  return act(s, { type: 'agent', cardUid: c.uid, spaceId, ...extra });
}
function resolve(s, cardId) {
  const c = active(s).unresolvedReveal.find(c => c.cardId === cardId);
  return act(s, { type: 'resolveReveal', cardUid: c.uid });
}
function combat(conflictId, count = 3) {
  const s = create(count); s.phase = 'combat'; s.currentPlayerId = 'p0'; s.firstPlayerIndex = 0;
  s.conflict = structuredClone(BASE_CONFLICTS.find(c => c.id === conflictId));
  s.players.forEach(p => { p.revealed = true; p.hand = []; p.inPlay = []; });
  return s;
}

test('saved v2 decks retain their subset while the current catalog exposes complete v3 content', () => {
  const catalog = game.getCatalog(), s = create();
  assert.equal(s.ruleset, 'base-subset-v2');
  assert.equal(catalog.manifest.content.market.implemented, 43);
  assert.equal(catalog.manifest.content.market.copies, 67);
  assert.equal(catalog.manifest.content.intrigue.implemented, 34);
  assert.equal(catalog.manifest.content.intrigue.copies, 40);
  assert.equal(Object.keys(catalog.referenceCatalog.cards).length, 135);
  assert.deepEqual([s.conflict, ...s.conflictDeck].map(c => c.level), [1, 2, 2, 2, 2, 2, 3, 3, 3, 3]);
  const market = [...s.market, ...s.marketDeck];
  assert.equal(market.length, 60);
  assert.equal(market.filter(c => c.cardId === 'bene-gesserit-sister').length, 3);
  assert.equal(market.filter(c => c.cardId === 'arrakis-recruiter').length, 2);
  assert.ok(market.every(c => catalog.cards[c.cardId].implementation === 'playable'));
  assert.equal(catalog.referenceCatalog.cards['kwisatz-haderach'].implementation, 'playable');
  assert.ok(!market.some(c => c.cardId === 'kwisatz-haderach' || c.cardId.startsWith('dev-')));
});

test('all reference images are local WebP files matching the recorded content hashes', () => {
  const directory = path.resolve(__dirname, '../../../../apps/site/public/board-games/assets/dune-imperium');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(Object.keys(manifest.images).length, 270);   // 基础版 135 + 两款扩展 135
  for (const record of Object.values(manifest.images)) {
    assert.match(record.src, /^cards\/[a-z-]+\/[a-z0-9-]+\.[a-f0-9]{12}\.webp$/);
    const data = fs.readFileSync(path.join(directory, record.src));
    assert.equal(data.subarray(0, 4).toString(), 'RIFF');
    assert.equal(data.subarray(8, 12).toString(), 'WEBP');
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), record.sha256);
    assert.equal(data.length, record.bytes);
  }
});

test('reveal effects resolve once in chosen order and can be interleaved with purchases', () => {
  let s = create(); const id = s.currentPlayerId;
  active(s).hand = [card('guild-bankers'), card('convincing-argument'), card('bene-gesserit-sister')];
  s = act(s, { type: 'reveal' });
  assert.equal(active(s).persuasion, 0);
  assert.throws(() => act(s, { type: 'endReveal' }), { code: 'UNRESOLVED_REVEAL' });
  const uid = active(s).unresolvedReveal.find(c => c.cardId === 'convincing-argument').uid;
  s = act(s, { type: 'resolveReveal', cardUid: uid });
  assert.equal(active(s).persuasion, 2);
  assert.throws(() => act(s, { type: 'resolveReveal', cardUid: uid }), { code: 'CARD_UNAVAILABLE' });
  s = act(s, { type: 'buy', source: 'reserve', cardId: 'arrakis-liaison' });
  assert.equal(active(s).persuasion, 0);
  s = resolve(s, 'bene-gesserit-sister'); s = choose(s, '2 剑');
  assert.equal(active(s).swords, 2);
  s = resolve(s, 'guild-bankers'); active(s).persuasion = 6;
  s = act(s, { type: 'buy', source: 'reserve', cardId: 'the-spice-must-flow' });
  assert.equal(active(s).persuasion, 0);
  assert.equal(active(s).vp, 1);
  assert.equal(active(s).id, id);
});

test('paid optional effects charge once and survive save/reload; invalid choices leave input unchanged', () => {
  let s = create(); const id = s.currentPlayerId;
  s = agent(s, 'duncan-idaho', 'arrakeen');
  assert.equal(s.phase, 'effect-choice');
  const original = JSON.stringify(s);
  assert.throws(() => act(s, { type: 'chooseEffect', option: 9999 }), { code: 'INVALID_CHOICE' });
  assert.equal(JSON.stringify(s), original);
  s = JSON.parse(original); s = choose(s, '支付 1 水');
  assert.equal(active(s).resources.water, 0);
  assert.equal(active(s).troops.garrison, 5);
  assert.equal(s.pending.maxDeploy, 4); // two new troops plus two old garrison troops
  s = act(s, { type: 'deploy', count: 4 });
  const p = s.players.find(p => p.id === id);
  assert.equal(p.troops.conflict, 4);
  assert.equal(p.hand.length, 2);
});

test('trash choices hide unselected private cards; Assassination Mission pays its trash bonus', () => {
  let s = create(); const id = s.currentPlayerId, secret = card('assassination-mission');
  active(s).hand = [card('guild-administrator'), secret];
  const uid = active(s).hand[0].uid;
  s = act(s, { type: 'agent', cardUid: uid, spaceId: 'secure-contract' });
  const outsider = game.getView(s, s.players.find(p => p.id !== id).id);
  assert.equal(outsider.pending.options, undefined);
  assert.ok(!JSON.stringify(outsider).includes(secret.uid));
  assert.equal(outsider.effectQueue, undefined);
  assert.equal(outsider.effectContext, undefined);
  s = choose(s, '暗杀任务');
  assert.equal(s.players.find(p => p.id === id).resources.solari, 7);
  assert.ok(s.trashed.some(c => c.uid === secret.uid));
});

test('Carryall doubles only base harvest and Power Play grants two faction influence', () => {
  let s = create(); active(s).resources.water = 2; s.bonusSpice['great-flat'] = 2;
  s = agent(s, 'carryall', 'great-flat');
  assert.equal(active(s).resources.spice, 8);
  assert.equal(s.bonusSpice['great-flat'], 0);
  s = create(); const id = s.currentPlayerId; active(s).influence.emperor = 1;
  s = agent(s, 'power-play', 'wealth', { effectOrder: 'influence-space-card' });
  assert.equal(s.players.find(p => p.id === id).influence.emperor, 3);
  assert.equal(s.players.find(p => p.id === id).vp, 1);
  assert.ok(s.trashed.some(c => c.cardId === 'power-play'));
});

test('Fremen Bond includes Agent-turn and Reveal-turn cards; arbitrary influence acquisition is a choice', () => {
  let s = create(); active(s).inPlay = [card('arrakis-liaison')]; active(s).hand = [card('crysknife')];
  s = act(s, { type: 'reveal' }); s = resolve(s, 'crysknife');
  assert.equal(active(s).influence.fremen, 1);
  s = create(); active(s).hand = []; s = act(s, { type: 'reveal' }); active(s).persuasion = 7;
  s.market[0] = card('lady-jessica');
  s = act(s, { type: 'buy', source: 'market', cardUid: s.market[0].uid });
  assert.equal(s.phase, 'effect-choice');
  s = choose(s, 'fremen'); assert.equal(active(s).influence.fremen, 1);
});

test('delayed intrigue bonuses stay outside the discard pile; Refocus reveals draws immediately', () => {
  let s = create(); const bonus = card('intrigue-charisma'); active(s).intrigues = [bonus];
  s = act(s, { type: 'playIntrigue', cardUid: bonus.uid });
  assert.ok(active(s).activeIntrigues.some(c => c.uid === bonus.uid));
  assert.ok(!s.intrigueDiscard.some(c => c.uid === bonus.uid));
  active(s).hand = []; s = act(s, { type: 'reveal' });
  assert.equal(active(s).persuasion, 2);
  const refocus = card('intrigue-refocus'); active(s).intrigues = [refocus];
  active(s).deck = [card('dagger')]; active(s).discard = [];
  s = act(s, { type: 'playIntrigue', cardUid: refocus.uid });
  assert.equal(active(s).hand.length, 0);
  assert.equal(active(s).unresolvedReveal[0].cardId, 'dagger');
  s = resolve(s, 'dagger'); s = act(s, { type: 'endReveal' });
  assert.ok(s.intrigueDiscard.some(c => c.uid === bonus.uid));
});

test('intrigues enforce resource costs, alliance conditions and target requirements', () => {
  let s = create(); const bribery = card('intrigue-bribery'); active(s).intrigues = [bribery];
  assert.throws(() => act(s, { type: 'playIntrigue', cardUid: bribery.uid }), { code: 'INTRIGUE_REQUIREMENTS' });
  assert.ok(!game.getLegalActions(s, s.currentPlayerId).some(a => a.type === 'playIntrigue'));
  active(s).resources.solari = 2;
  s = act(s, { type: 'playIntrigue', cardUid: bribery.uid });
  assert.equal(active(s).resources.solari, 0); s = choose(s, 'emperor');
  assert.equal(active(s).influence.emperor, 1);
  const cross = card('intrigue-double-cross'); active(s).intrigues = [cross]; active(s).resources.solari = 1;
  assert.throws(() => act(s, { type: 'playIntrigue', cardUid: cross.uid }), { code: 'INTRIGUE_REQUIREMENTS' });
});

test('conflict reward choices use distinct factions and are resolved before cleanup', () => {
  let s = combat('conflict-machinations');
  s.players[0].troops.conflict = 1; s.players[0].troops.supply--;
  s = act(s, { type: 'passCombat' });
  assert.equal(s.phase, 'effect-choice');
  assert.equal(s.pending.options.length, 6);
  assert.equal(s.players[0].troops.conflict, 1);
  s = choose(s, 'emperor、spacing-guild');
  assert.equal(s.players[0].influence.emperor, 1);
  assert.equal(s.players[0].influence['spacing-guild'], 1);
  assert.equal(s.round, 2);
  assert.equal(s.players[0].troops.conflict, 0);
  s = combat('conflict-grand-vision'); s.players[0].troops.conflict = 1; s.players[0].troops.supply--;
  s = act(s, { type: 'passCombat' }); s = choose(s, 'fremen');
  assert.equal(s.players[0].influence.fremen, 2);
  assert.equal(s.players[0].vp, 1);
});

test('Sort Through the Chaos awards the Mentat at next-round start, and the bonus expires', () => {
  let s = combat('conflict-sort-through-the-chaos');
  s.players[0].troops.conflict = 1; s.players[0].troops.supply--;
  s = act(s, { type: 'passCombat' });
  assert.equal(s.round, 2); assert.equal(s.mentatOwner, 'p0'); assert.equal(s.players[0].agentsAvailable, 3);
  s.players.forEach(p => { p.revealed = true; p.hand = []; p.inPlay = []; });
  s.phase = 'combat'; s.currentPlayerId = 'p0'; s.players[0].troops.conflict = 1; s.players[0].troops.supply--;
  s.conflict = structuredClone(BASE_CONFLICTS.find(c => c.id === 'conflict-guild-bank-raid'));
  s = act(s, { type: 'passCombat' });
  assert.equal(s.round, 3); assert.equal(s.mentatOwner, null); assert.equal(s.players[0].agentsAvailable, 2);
});

test('retreating all troops removes that player from further combat intrigue turns', () => {
  let s = combat('conflict-guild-bank-raid');
  for (const p of s.players.slice(0, 2)) { p.troops.conflict = 1; p.troops.supply--; }
  const c = card('intrigue-master-tactician'); s.players[0].intrigues = [c];
  s = act(s, { type: 'playIntrigue', cardUid: c.uid }); s = choose(s, '撤回至多'); s = choose(s, '撤回 1');
  assert.equal(s.phase, 'combat'); assert.equal(s.currentPlayerId, 'p1');
  assert.equal(s.players[0].troops.conflict, 0);
  s = act(s, { type: 'passCombat' });
  assert.equal(s.lastCombat.results[0].playerId, 'p1');
});

test('new games finish using only advertised actions and retain troop/resource invariants', () => {
  for (const count of [3, 4]) {
    let s = create(count), steps = 0;
    while (s.phase !== 'finished' && steps++ < 1400) {
      const actions = game.getLegalActions(s, s.currentPlayerId);
      assert.ok(actions.length > 0, `stuck in ${s.phase}`);
      const action = actions.find(a => a.type === 'agent') || actions.find(a => a.type === 'resolveReveal') ||
        actions.find(a => a.type === 'playIntrigue') || actions.filter(a => a.type === 'deploy').at(-1) ||
        actions.find(a => a.type === 'buy') || actions[0];
      const before = JSON.stringify(s); const next = act(s, action);
      assert.equal(JSON.stringify(s), before); s = next;
      for (const p of s.players) {
        assert.equal(Object.values(p.troops).reduce((sum, n) => sum + n, 0), 12);
        assert.ok(Object.values(p.troops).every(n => Number.isInteger(n) && n >= 0));
        assert.ok(Object.values(p.resources).every(n => Number.isInteger(n) && n >= 0));
      }
    }
    assert.equal(s.phase, 'finished'); assert.ok(s.result.winnerIds.length > 0);
  }
});
