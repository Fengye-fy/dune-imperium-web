'use strict';
// Prepared for the user's manual verification pass. Not executed by the author.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const data = require('../data');
const expansion = require('../expansion-data');
const rules = require('../expansion-state');
const game = require('..');
const clone = value => JSON.parse(JSON.stringify(value));
const card = (cardId, uid = crypto.randomUUID()) => ({ cardId, uid });
function fixture(expansions = ['rise-of-ix', 'immortality']) {
  const s = { round: 1, phase: 'player-turns', currentPlayerId: 'p0', controls: { arrakeen: 'p1', carthag: null, 'imperial-basin': null },
    market: Array.from({ length: 5 }, (_, n) => card('old-' + n)),
    marketDeck: Array.from({ length: 8 }, (_, n) => card('new-' + n)), removedMarket: [], intrigueDeck: [],
    players: Array.from({ length: 3 }, (_, n) => ({ id: 'p' + n, vp: 0, resources: { spice: 10, water: 1, solari: 10 },
      troops: { supply: 9, garrison: 3, conflict: 0 }, influence: { emperor: 0, 'spacing-guild': 0, 'bene-gesserit': 0, fremen: 0 },
      deck: [], hand: [], discard: [], inPlay: [], intrigues: [], swords: 0, persuasion: 0 })),
    turn: { playerId: 'p0', freshGarrison: 0, freshConflict: 0, boardOldDeployed: 0, deployed: 0 } };
  rules.initialize(s, { expansions }); return s;
}

test('both expansions reach real setup through validated room options', () => {
  assert.deepEqual(game.validateOptions({ expansions: [] }), { expansions: [] });
  for (const id of ['rise-of-ix', 'immortality']) {
    assert.deepEqual(game.validateOptions({ expansions: [id] }), { expansions: [id] });
    const s = game.createGame({ players: ['a', 'b', 'c'].map(id => ({ id, name: id })), options: { expansions: [id] } });
    assert.equal(s.ruleset, 'expansions-dev-v4');
    assert.equal(s.phase, 'leader-selection');
    assert.deepEqual(s.expansions, [id]);
  }
  for (const options of [null, [], { epic: true }, { expansions: 'immortality' }, { expansions: ['unknown'] },
    { expansions: ['immortality', 'immortality'] }]) assert.throws(() => expansion.normalizeOptions(options));
  assert.deepEqual(expansion.normalizeOptions({ expansions: ['immortality', 'rise-of-ix'] }, { allowUnavailable: true }),
    { expansions: ['rise-of-ix', 'immortality'] });
  const catalog = game.getCatalog();
  assert.deepEqual(catalog.manifest.supportedExpansions, ['rise-of-ix', 'immortality']);
  assert.equal(catalog.expansions.plans.filter(p => !p.previewOnly).length, 4);
});

test('setup recipes preserve exact physical decks and replace overlays without duplicate spaces', () => {
  for (const selected of [[], ['rise-of-ix'], ['immortality'], ['rise-of-ix', 'immortality']]) {
    const ix = selected.includes('rise-of-ix'), imm = selected.includes('immortality');
    const plan = expansion.setupPlan(data, { expansions: selected });
    assert.equal(plan.market.length, 67 + (ix ? 35 : 0) + (imm ? 30 : 0));
    assert.equal(plan.intrigue.length, 40 + (ix ? 17 : 0) + (imm ? 15 : 0));
    assert.equal(plan.conflictPool.length, ix ? 22 : 18);
    assert.equal(plan.leaders.length, ix ? 14 : 8);
    assert.equal(plan.starter.length, 10);
    assert.equal(plan.starter.filter(id => id === 'experimentation').length, imm ? 2 : 0);
    assert.equal(plan.starter.filter(id => id === 'dune-desert-planet').length, imm ? 0 : 2);
    assert.equal(plan.tleilaxu.length, imm ? 18 : 0);
    assert.deepEqual(plan.fixedTleilaxu, imm ? ['reclaimed-forces'] : []);
    assert.equal(new Set(plan.spaces.map(s => s.id)).size, plan.spaces.length);
    assert.equal(plan.spaces.length, data.SPACES.length);
    assert.equal(plan.spaces.some(s => s.id === 'sell-melange'), !ix);
    assert.equal(plan.spaces.some(s => s.id === 'tech-negotiation'), ix);
    assert.equal(plan.spaces.find(s => s.id === 'research-station').effect.draw, imm ? 2 : 3);
    assert.deepEqual(plan.conflictSelection.map(c => c.count), [1, 5, 4]);
    assert.ok(!plan.market.includes('ix-control-the-spice'));
  }
  assert.equal(data.SPACES.find(s => s.id === 'research-station').effect.draw, 3);
});

test('all expansion faces have local files matching recorded hashes and dimensions', () => {
  const assets = path.resolve(__dirname, '../../../../apps/site/public/board-games/assets/dune-imperium');
  const manifest = JSON.parse(fs.readFileSync(path.join(assets, 'manifest.json'), 'utf8'));
  assert.equal(expansion.REFERENCE.entries.length, 135);
  for (const c of expansion.REFERENCE.entries) {
    const bytes = fs.readFileSync(path.join(assets, c.image.src));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), c.image.sha256, c.id);
    assert.equal(bytes.length, c.image.bytes, c.id);
    assert.equal(manifest.images[c.id].src, c.image.src, c.id);
    assert.ok(c.image.width > 0 && c.image.height > 0, c.id);
  }
});

test('research follows directed branches, unlocks genetic markers, and ends in repeatable draws', () => {
  const s = fixture(), p = s.players[0];
  assert.deepEqual(rules.advanceResearch(s, p, '1:0'), { specimens: 1 });
  assert.deepEqual(rules.researchOptions(s, p).map(o => o.target), ['2:1', '2:-1']);
  assert.throws(() => rules.advanceResearch(s, p, '0:0'), { code: 'INVALID_RESEARCH_MOVE' });
  for (const id of ['2:1', '3:0', '4:1']) rules.advanceResearch(s, p, id);
  assert.equal(rules.geneticMarker(p), 1);
  for (const id of ['5:0', '6:1', '7:0', '8:1']) rules.advanceResearch(s, p, id);
  assert.equal(rules.geneticMarker(p), 2);
  assert.deepEqual(rules.advanceResearch(s, p, 'draw'), { draw: 1 });
  assert.deepEqual(rules.advanceResearch(s, p, 'draw'), { draw: 1 });
  assert.equal(p.immortality.research, '8:1');
  assert.equal(rules.assertConservation(s), undefined);
});

test('Tleilaxu first-claim spice survives serialization and track cannot farm repeated VP', () => {
  let s = fixture();
  assert.deepEqual(rules.advanceTleilaxu(s, s.players[0], 4), [{ intrigue: 1 }, { vp: 1, spice: 2 }]);
  s = clone(s);
  assert.deepEqual(rules.advanceTleilaxu(s, s.players[1], 4), [{ intrigue: 1 }, { vp: 1 }]);
  assert.deepEqual(rules.advanceTleilaxu(s, s.players[0], 100), [{ intrigue: 1 }, { vp: 1 }]);
  assert.deepEqual(rules.advanceTleilaxu(s, s.players[0], 1), []);
});

test('specimens and negotiators consume the same supply as ordinary troops', () => {
  const s = fixture(), p = s.players[0];
  assert.equal(rules.generateSpecimens(s, p, 6), 6);
  assert.equal(rules.sendNegotiators(s, p, 6), 3);
  assert.equal(rules.generateSpecimens(s, p, 1), 0);
  rules.assertConservation(s);
  rules.returnSpecimens(s, p, 2);
  assert.equal(p.troops.supply, 2);
  assert.throws(() => rules.returnSpecimens(s, p, 5), { code: 'INSUFFICIENT_UNITS' });
  assert.throws(() => rules.generateSpecimens(s, p, -1), { code: 'INVALID_COUNT' });
  rules.assertConservation(s);
});

test('Reclaimed Forces pays specimens repeatedly without leaving the row or entering a deck', () => {
  const s = fixture(), p = s.players[0]; s.phase = 'reveal';
  rules.generateSpecimens(s, p, 9);
  const row = clone(s.immortality.tleilaxuRow);
  assert.deepEqual(rules.acquireTleilaxu(s, p, { cardId: 'reclaimed-forces', reclaimedChoice: 'troops' }), { card: null, effect: { troops: 2 } });
  assert.deepEqual(rules.acquireTleilaxu(s, p, { cardId: 'reclaimed-forces', reclaimedChoice: 'tleilaxu' }), { card: null, effect: { tleilaxu: 1 } });
  assert.equal(p.immortality.specimens, 3); assert.equal(p.troops.supply, 6);
  assert.deepEqual(s.immortality.tleilaxuRow, row); assert.equal(p.discard.length, 0);
  assert.throws(() => rules.acquireTleilaxu(s, p, { cardId: 'reclaimed-forces', destination: 'deck', reclaimedChoice: 'troops' }));
  rules.assertConservation(s);
});

test('Tleilaxu acquisition rejects Imperium targets and unlocks topdeck only after research', () => {
  const s = fixture(), p = s.players[0]; s.phase = 'reveal'; rules.generateSpecimens(s, p, 9);
  s.immortality.tleilaxuRow = [card('tleilaxu-corrino-genes'), card('tleilaxu-ghola')];
  const target = s.immortality.tleilaxuRow[0];
  assert.throws(() => rules.acquireTleilaxu(s, p, { cardUid: target.uid, destination: 'deck' }), { code: 'INVALID_DESTINATION' });
  assert.throws(() => rules.acquireTleilaxu(s, p, { cardUid: s.market[0].uid }), { code: 'CARD_UNAVAILABLE' });
  p.immortality.research = '4:1';
  assert.deepEqual(rules.acquireTleilaxu(s, p, { cardUid: target.uid, destination: 'deck' }).effect, { solari: 2 });
  assert.equal(p.deck.at(-1).uid, target.uid); assert.equal(s.immortality.tleilaxuRow.length, 2);
  rules.assertConservation(s);
});

test('shipping recall permits chosen reward order, prevents duplicates and blocks movement while pending', () => {
  const s = fixture(), p = s.players[0];
  for (let i = 0; i < 3; i++) rules.moveShipping(s, p, 'advance');
  assert.throws(() => rules.moveShipping(s, p, 'advance'), { code: 'INVALID_SHIPPING_MOVE' });
  rules.moveShipping(s, p, 'recall');
  assert.equal(p.ix.shipping, 0);
  assert.throws(() => rules.moveShipping(s, p, 'advance'), { code: 'SHIPPING_REWARDS_PENDING' });
  assert.deepEqual(rules.shippingReward(s, p, 3), { acquireTech: { discount: 2 } });
  assert.deepEqual(rules.shippingReward(s, p, 1, 'spice'), { spice: 2 });
  assert.throws(() => rules.shippingReward(s, p, 1, 'solari'), { code: 'INVALID_SHIPPING_REWARD' });
  assert.ok(rules.shippingReward(s, p, 2).steps);
  rules.moveShipping(s, p, 'advance'); assert.equal(p.ix.shipping, 1);
});

test('tech uses one server grant, does not stack discounts and returns spent negotiators', () => {
  const s = fixture(), p = s.players[0]; s.ix.techStacks = [['tech-holtzman-engine'], [], []];
  rules.sendNegotiators(s, p, 2);
  const grantId = rules.grantTechAcquisition(s, p, { discount: 2 });
  const otherGrant = rules.grantTechAcquisition(s, p, { discount: 1 });
  const purchase = { grantId, stack: 0, techId: 'tech-holtzman-engine', negotiators: 2 };
  const before = clone(s);
  assert.throws(() => rules.acquireTech(s, p, { ...purchase, currency: 'solari' }), { code: 'INVALID_TECH_PURCHASE' });
  assert.deepEqual(s, before);
  assert.deepEqual(rules.acquireTech(s, p, purchase), {});
  assert.equal(p.resources.spice, 8); assert.equal(p.ix.negotiators, 0); assert.equal(p.troops.supply, 9);
  assert.equal(s.ix.techGrants[0].id, otherGrant);
  assert.throws(() => rules.acquireTech(s, p, purchase), { code: 'TECH_PERMISSION_REQUIRED' });
  rules.assertConservation(s);
});

test('exhausted tech can be used again only after round start', () => {
  const s = fixture(), p = s.players[0]; p.ix.tech.push({ techId: 'tech-training-drones', exhausted: false });
  assert.deepEqual(rules.activateTech(s, p, 'tech-training-drones'), { troops: 1 });
  assert.throws(() => rules.activateTech(s, p, 'tech-training-drones'), { code: 'TECH_EXHAUSTED' });
  rules.roundStart(s);
  assert.deepEqual(rules.activateTech(s, p, 'tech-training-drones'), { troops: 1 });
});

test('troops and ships share two old-unit slots while Baron counts only troops', () => {
  const s = fixture(), p = s.players[0];
  p.troops.supply--; p.troops.garrison++; s.turn.freshGarrison = 1;
  rules.commissionDreadnought(s, p);
  assert.ok(rules.deploymentOptions(s, p, { board: true }).some(o => o.troops === 3 && o.dreadnoughts === 1));
  assert.ok(!rules.deploymentOptions(s, p, { board: true }).some(o => o.troops === 4 && o.dreadnoughts === 1));
  rules.deployUnits(s, p, 3, 1, { board: true });
  assert.equal(s.turn.boardOldDeployed, 2); assert.equal(s.turn.deployed, 3); assert.equal(s.turn.deployedUnits, 4);
  assert.throws(() => rules.deployUnits(s, p, 1, 0, { board: true }), { code: 'INVALID_DEPLOYMENT' });
  rules.retreatUnits(s, p, 1, 1); rules.deployUnits(s, p, 1, 1, { board: true });
  rules.assertConservation(s);
});

test('ship-only conflicts retain swords; occupation blocks a second placement and restores covered control', () => {
  const s = fixture(), p = s.players[0]; p.swords = 2;
  rules.commissionDreadnought(s, p, 2); rules.deployUnits(s, p, 0, 2);
  assert.equal(rules.strength(s, p), 8);
  s.combatWinnerId = p.id;
  rules.occupyWithDreadnought(s, p, { spaceId: 'arrakeen' });
  assert.equal(rules.controller(s, 'arrakeen'), p.id);
  assert.throws(() => rules.occupyWithDreadnought(s, p, { spaceId: 'carthag' }), { code: 'INVALID_OCCUPATION' });
  rules.combatCleanup(s); rules.assertConservation(s);
  assert.equal(p.ix.dreadnoughts.garrison, 1);
  s.round = 2; rules.deployUnits(s, p, 0, 1);
  assert.ok(!rules.occupationOptions(s, p).some(o => o.spaceId === 'arrakeen'));
  rules.occupyWithDreadnought(s, p, { spaceId: 'carthag' }); rules.combatCleanup(s);
  assert.equal(rules.controller(s, 'arrakeen'), 'p1'); assert.equal(rules.controller(s, 'carthag'), p.id);
  assert.equal(s.controls.arrakeen, 'p1'); rules.assertConservation(s);
});

test('family atomics affects only Imperium row and only once on the owner turn', () => {
  const s = fixture(), p = s.players[0], tleilaxu = clone(s.immortality.tleilaxuRow);
  rules.familyAtomics(s, p);
  assert.equal(s.removedMarket.length, 5); assert.equal(s.market.length, 5);
  assert.ok(s.market.every(c => c.cardId.startsWith('new-')));
  assert.deepEqual(s.immortality.tleilaxuRow, tleilaxu);
  assert.throws(() => rules.familyAtomics(s, p), { code: 'ATOMICS_USED' });
  assert.throws(() => rules.familyAtomics(s, s.players[1]), { code: 'WRONG_TIMING' });
});

test('public expansion projection omits hidden stack order, grants and future private player fields', () => {
  const s = fixture(), p = s.players[0];
  const grantId = rules.grantTechAcquisition(s, p);
  p.ix.secretCard = 'private-ix'; p.immortality.secretCard = 'private-imm';
  const view = rules.publicState(s), serialized = JSON.stringify(view);
  assert.ok(!serialized.includes(grantId)); assert.ok(!serialized.includes('private-ix')); assert.ok(!serialized.includes('private-imm'));
  assert.equal(view.ix.techStacks[0].remaining, 6);
  assert.equal(view.ix.techStacks[0].top, s.ix.techStacks[0].at(-1));
  assert.equal(view.immortality.tleilaxuDeckCount, 16);
  assert.equal(view.immortality.tleilaxuDeck, undefined);
  view.ix.players[0].dreadnoughts.supply = 0; assert.equal(p.ix.dreadnoughts.supply, 2);
  assert.throws(() => rules.initialize(s, { expansions: [] }), { code: 'ALREADY_INITIALIZED' });
});
