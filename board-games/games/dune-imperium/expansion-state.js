'use strict';

// Internal state operations used by the v4 adapter, not HTTP commands.
// Existing v3 saves retain their original rules. Operations return reward
// descriptors which the adapter adds to the serializable effect queue.
const crypto = require('node:crypto');
const { REFERENCE, RESEARCH, TLEILAXU, TECH, normalizeOptions } = require('./expansion-data');
const clone = value => JSON.parse(JSON.stringify(value));
function demand(condition, code, message) {
  if (!condition) throw Object.assign(new Error(message), { code, status: 400 });
}
function integer(n, max = Number.MAX_SAFE_INTEGER) { return Number.isSafeInteger(n) && n >= 0 && n <= max; }
function enabled(s, id) { return Array.isArray(s.expansions) && s.expansions.includes(id); }
function requireExpansion(s, id) { demand(enabled(s, id), 'EXPANSION_DISABLED', '本局未启用该扩展。'); }
function requirePlayer(s, p) { demand(p && s.players.includes(p), 'INVALID_PLAYER', '需要当前存档中的玩家对象。'); }
function requireOwnTurn(s, p, insideEffect = false) {
  requirePlayer(s, p);
  demand(s.currentPlayerId === p.id && s.turn?.playerId === p.id && (!s.effectContext || (insideEffect && s.effectContext.playerId === p.id)) &&
    ['player-turns', 'agent-choice', 'agent-end', 'reveal', ...(insideEffect ? ['effect-choice'] : [])].includes(s.phase), 'WRONG_TIMING', '请在本人回合的效果结算间隙使用。');
}
function shuffled(values) {
  const cards = [...values];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
const instance = cardId => ({ uid: crypto.randomUUID(), cardId });
const CONTROLS = ['arrakeen', 'carthag', 'imperial-basin'];
const TLEILAXU_COSTS = {
  'tleilaxu-beguiling-pheromones': 2, 'tleilaxu-chairdog': 2, 'tleilaxu-contaminator': 1,
  'tleilaxu-corrino-genes': 1, 'tleilaxu-face-dancer': 2, 'tleilaxu-face-dancer-initiate': 1,
  'tleilaxu-from-the-tanks': 1, 'tleilaxu-ghola': 3, 'tleilaxu-guild-impersonator': 2,
  'tleilaxu-industrial-espionage': 1, 'reclaimed-forces': 3, 'tleilaxu-scientific-breakthrough': 3,
  'tleilaxu-slig-farmer': 2, 'tleilaxu-stitched-horror': 3, 'tleilaxu-subject-x-137': 2,
  'tleilaxu-tleilaxu-infiltrator': 2, 'tleilaxu-twisted-mentat': 3,
  'tleilaxu-unnatural-reflexes': 3, 'tleilaxu-usurp': 3,
};
const TLEILAXU_ACQUIRE = {
  'tleilaxu-corrino-genes': { solari: 2 }, 'tleilaxu-subject-x-137': { tleilaxu: 1 },
};
function initialize(s, options) {
  const { expansions } = normalizeOptions(options, { allowUnavailable: true });
  demand(!s.ix && !s.immortality && !s.expansions, 'ALREADY_INITIALIZED', '不能给既有对局追加扩展。');
  s.expansions = expansions;
  if (enabled(s, 'rise-of-ix')) {
    const tiles = shuffled(Object.keys(TECH));
    s.ix = { techStacks: [tiles.slice(0, 6), tiles.slice(6, 12), tiles.slice(12)],
      techGrants: [], trashedTech: [], occupations: [] };
    for (const p of s.players) p.ix = { shipping: 0, recallRewards: [], negotiators: 0,
      dreadnoughts: { supply: 2, garrison: 0, conflict: 0 }, tech: [], revealTechUsed: [], lastOccupationRound: null };
  }
  if (enabled(s, 'immortality')) {
    const cards = REFERENCE.entries.filter(c => c.expansion === 'immortality' && c.category === 'tleilaxu' && !c.fixed);
    s.immortality = { tleilaxuDeck: shuffled(cards.flatMap(c => Array.from({ length: c.copies }, () => instance(c.id)))),
      tleilaxuRow: [], firstSpice: 2 };
    refillTleilaxu(s);
    for (const p of s.players) p.immortality = { research: '0:0', tleilaxu: 0, specimens: 0, familyAtomicsUsed: false };
  }
}
function refillTleilaxu(s) {
  while (s.immortality.tleilaxuRow.length < 2 && s.immortality.tleilaxuDeck.length) {
    s.immortality.tleilaxuRow.push(s.immortality.tleilaxuDeck.pop());
  }
}
function moveSupply(s, p, zone, count, returning = false) {
  requirePlayer(s, p);
  const expansion = zone === 'specimens' ? 'immortality' : 'rise-of-ix';
  requireExpansion(s, expansion);
  demand(integer(count), 'INVALID_COUNT', '数量必须是非负整数。');
  const holder = zone === 'specimens' ? p.immortality : p.ix;
  if (returning) {
    demand(count <= holder[zone], 'INSUFFICIENT_UNITS', '可返还的普通兵不足。');
    holder[zone] -= count; p.troops.supply += count;
    return count;
  }
  const actual = Math.min(count, p.troops.supply);
  p.troops.supply -= actual; holder[zone] += actual;
  return actual;
}
const generateSpecimens = (s, p, n) => moveSupply(s, p, 'specimens', n);
const returnSpecimens = (s, p, n) => moveSupply(s, p, 'specimens', n, true);
const sendNegotiators = (s, p, n) => moveSupply(s, p, 'negotiators', n);
function geneticMarker(p) { return RESEARCH[p.immortality?.research]?.geneticMarker || 0; }
function researchOptions(s, p) {
  requirePlayer(s, p); requireExpansion(s, 'immortality');
  const cell = RESEARCH[p.immortality.research];
  demand(cell, 'INVALID_RESEARCH_STATE', '研究位置无效。');
  return cell.geneticMarker === 2 ? [{ target: 'draw', effect: { draw: 1 } }] :
    cell.next.map(id => ({ target: id, effect: clone(RESEARCH[id].effect) }));
}
function advanceResearch(s, p, target) {
  const choice = researchOptions(s, p).find(o => o.target === target);
  demand(choice, 'INVALID_RESEARCH_MOVE', '只能沿研究路径向右移动一格。');
  if (target !== 'draw') p.immortality.research = target;
  return choice.effect;
}
function advanceTleilaxu(s, p, count = 1) {
  requirePlayer(s, p); requireExpansion(s, 'immortality');
  demand(integer(count), 'INVALID_COUNT', '特莱拉前进数量必须是非负整数。');
  const rewards = [];
  const steps = Math.min(count, TLEILAXU.length - 1 - p.immortality.tleilaxu);
  for (let i = 0; i < steps; i++) {
    const { firstSpice, ...reward } = TLEILAXU[++p.immortality.tleilaxu];
    if (firstSpice && s.immortality.firstSpice > 0) {
      reward.spice = s.immortality.firstSpice; s.immortality.firstSpice = 0;
    }
    if (Object.keys(reward).length) rewards.push(reward);
  }
  return rewards;
}
function acquireTleilaxu(s, p, { cardUid, cardId, destination = 'discard', reclaimedChoice }, { granted = false } = {}) {
  requirePlayer(s, p); requireExpansion(s, 'immortality');
  demand(granted || (s.phase === 'reveal' && s.currentPlayerId === p.id && !s.effectContext), 'WRONG_TIMING', '只能在展示回合或指定效果中获取特莱拉牌。');
  const fixed = cardId === 'reclaimed-forces';
  const row = s.immortality.tleilaxuRow;
  const index = fixed ? -1 : row.findIndex(c => c.uid === cardUid && (!cardId || c.cardId === cardId));
  const selected = fixed ? { cardId: 'reclaimed-forces' } : row[index];
  demand(selected && Object.hasOwn(TLEILAXU_COSTS, selected.cardId), 'CARD_UNAVAILABLE', '这张牌不在特莱拉牌市。');
  demand(destination === 'discard' || (destination === 'deck' && (geneticMarker(p) >= 1 || hasTech(p, 'tech-spaceport'))),
    'INVALID_DESTINATION', '尚未解锁特莱拉牌置于牌库顶。');
  if (fixed) demand(['troops', 'tleilaxu'].includes(reclaimedChoice) && !cardUid && destination === 'discard',
    'INVALID_CHOICE', 'Reclaimed Forces 必须选择征募两兵或前进一格，不进入个人牌库。');
  const cost = TLEILAXU_COSTS[selected.cardId];
  demand(p.immortality.specimens >= cost, 'INSUFFICIENT_SPECIMENS', '标本不足。');
  returnSpecimens(s, p, cost);
  if (fixed) return { card: null, effect: reclaimedChoice === 'troops' ? { troops: 2 } : { tleilaxu: 1 } };
  const [card] = row.splice(index, 1); p[destination].push(card); refillTleilaxu(s);
  return { card: clone(card), effect: clone(TLEILAXU_ACQUIRE[card.cardId] || {}) };
}
function familyAtomics(s, p, { insideEffect = false } = {}) {
  requireExpansion(s, 'immortality'); requireOwnTurn(s, p, insideEffect);
  demand(!p.immortality.familyAtomicsUsed, 'ATOMICS_USED', '家族原子弹每局只能使用一次。');
  p.immortality.familyAtomicsUsed = true;
  (s.removedMarket ||= []).push(...s.market.splice(0));
  while (s.market.length < 5 && s.marketDeck.length) s.market.push(s.marketDeck.pop());
}
function shippingOptions(s, p) {
  requirePlayer(s, p); requireExpansion(s, 'rise-of-ix');
  demand(!p.ix.recallRewards.length, 'SHIPPING_REWARDS_PENDING', '请先领完运输召回奖励。');
  return [...(p.ix.shipping < 3 ? [{ movement: 'advance' }] : []), { movement: 'recall' }];
}
function moveShipping(s, p, movement) {
  demand(shippingOptions(s, p).some(o => o.movement === movement), 'INVALID_SHIPPING_MOVE', '运输轨已到顶，或动作无效。');
  if (movement === 'advance') { p.ix.shipping++; return; }
  p.ix.recallRewards = Array.from({ length: p.ix.shipping }, (_, i) => i + 1);
  p.ix.shipping = 0;
}
function shippingReward(s, p, level, choice) {
  requirePlayer(s, p); requireExpansion(s, 'rise-of-ix');
  demand(integer(level, 3) && p.ix.recallRewards.includes(level), 'INVALID_SHIPPING_REWARD', '该级奖励不在本次召回中或已领取。');
  if (level === 1) demand(['solari', 'spice'].includes(choice), 'INVALID_CHOICE', '请选择索拉里分红或香料。');
  else demand(choice === undefined, 'INVALID_CHOICE', '该级奖励不接受额外选择。');
  p.ix.recallRewards.splice(p.ix.recallRewards.indexOf(level), 1);
  if (level === 1) return choice === 'spice' ? { spice: 2 } : { solari: 5, opponents: { solari: 1 } };
  if (level === 2) return { steps: [{ troops: hasTech(p, 'tech-troop-transports') ? 3 : 2,
    ...(hasTech(p, 'tech-troop-transports') ? { deployRecruits: true } : {}) }, { chooseInfluence: { amount: 1 } }] };
  return { acquireTech: { discount: 2 } };
}
function hasTech(p, id) { return Boolean(p.ix?.tech.some(t => t.techId === id)); }
function grantTechAcquisition(s, p, { discount = 0, allowSolari = false } = {}) {
  requirePlayer(s, p); requireExpansion(s, 'rise-of-ix');
  demand(integer(discount) && typeof allowSolari === 'boolean', 'INVALID_TECH_GRANT', '科技获取许可无效。');
  const grant = { id: crypto.randomUUID(), playerId: p.id, discount, allowSolari };
  s.ix.techGrants.push(grant); return grant.id;
}
function techGrant(s, p, grantId) {
  requirePlayer(s, p); requireExpansion(s, 'rise-of-ix');
  const grant = s.ix.techGrants.find(g => g.id === grantId && g.playerId === p.id);
  demand(grant, 'TECH_PERMISSION_REQUIRED', '只能使用当前效果授予的一次科技获取许可。');
  return grant;
}
function techPurchaseOptions(s, p, grantId) {
  const grant = techGrant(s, p, grantId), options = [];
  for (let stack = 0; stack < s.ix.techStacks.length; stack++) {
    const techId = s.ix.techStacks[stack].at(-1);
    if (!techId) continue;
    const currencies = grant.allowSolari ? ['spice', 'solari'] : ['spice'];
    // Returning more negotiators than the tile costs is allowed but never required.
    for (const currency of currencies) for (let negotiators = 0; negotiators <= p.ix.negotiators; negotiators++) {
      const cost = Math.max(0, TECH[techId].cost - grant.discount - negotiators);
      if (p.resources[currency] >= cost) options.push({ stack, techId, currency, negotiators, cost });
    }
  }
  return options;
}
function acquireTech(s, p, { grantId, stack, techId, currency = 'spice', negotiators = 0 }) {
  const option = techPurchaseOptions(s, p, grantId).find(o => o.stack === stack && o.techId === techId &&
    o.currency === currency && o.negotiators === negotiators);
  demand(option, 'INVALID_TECH_PURCHASE', '科技、支付货币、谈判员数量或资源不足。');
  p.resources[currency] -= option.cost;
  moveSupply(s, p, 'negotiators', negotiators, true);
  s.ix.techStacks[stack].pop(); p.ix.tech.push({ techId, exhausted: false });
  s.ix.techGrants = s.ix.techGrants.filter(g => g.id !== grantId);
  return clone(TECH[techId].acquire);
}
function passTechAcquisition(s, p, grantId) {
  techGrant(s, p, grantId); s.ix.techGrants = s.ix.techGrants.filter(g => g.id !== grantId);
}
function activateTech(s, p, techId, { discardUid, intrigueUids = [], trashUid } = {}, { insideEffect = false } = {}) {
  requireExpansion(s, 'rise-of-ix'); requireOwnTurn(s, p, insideEffect);
  const owned = p.ix.tech.find(t => t.techId === techId), definition = TECH[techId];
  demand(owned && definition, 'TECH_UNAVAILABLE', '你未持有这项科技。');
  let effect;
  if (techId === 'tech-disposal-facility') {
    demand((s.phase === 'reveal' || (insideEffect && s.effectContext?.logicalPhase === 'reveal')) && p.persuasion >= 6 && !p.ix.revealTechUsed.includes(techId) &&
      p.inPlay.some(c => c.uid === trashUid), 'TECH_REQUIREMENTS', '展示时须有至少 6 说服力，并选择场上的牌；每次展示限一张。');
    p.ix.revealTechUsed.push(techId); return { trashUid };
  }
  demand(definition.activate || definition.consume, 'TECH_NOT_ACTIVATED', '这项科技由指定时机触发。');
  demand(!definition.activate || !owned.exhausted, 'TECH_EXHAUSTED', '本轮已经使用过该科技。');
  effect = clone(definition.activate || (typeof definition.consume === 'object' ? definition.consume : {}));
  for (const [key, cost] of Object.entries(effect.cost || {})) demand(p.resources[key] >= cost, 'INSUFFICIENT_RESOURCES', '无法支付科技费用。');
  if (effect.discardFor) demand(p.hand.some(c => c.uid === discardUid), 'DISCARD_REQUIRED', '请选择一张手牌支付弃牌费用。');
  if (definition.consume === 'cycle-intrigues') {
    demand(Array.isArray(intrigueUids) && new Set(intrigueUids).size === intrigueUids.length &&
      intrigueUids.every(uid => p.intrigues.some(c => c.uid === uid)), 'INVALID_INTRIGUES', '只能选择本人持有且不重复的阴谋实例。');
  }
  for (const [key, cost] of Object.entries(effect.cost || {})) p.resources[key] -= cost;
  delete effect.cost;
  if (effect.discardFor) {
    const [card] = p.hand.splice(p.hand.findIndex(c => c.uid === discardUid), 1); p.discard.push(card);
    const reward = effect.discardFor; delete effect.discardFor;
    effect = { steps: [{ onDiscard: clone(card) }, reward] };
  }
  if (definition.consume === 'cycle-intrigues') {
    const cards = intrigueUids.map(uid => p.intrigues.find(c => c.uid === uid));
    p.intrigues = p.intrigues.filter(c => !intrigueUids.includes(c.uid));
    s.intrigueDeck.unshift(...cards); effect = { intrigue: cards.length };
  }
  if (definition.activate) owned.exhausted = true;
  else { p.ix.tech.splice(p.ix.tech.indexOf(owned), 1); s.ix.trashedTech.push(techId); }
  return effect;
}
function roundStart(s) {
  if (!enabled(s, 'rise-of-ix')) return [];
  s.ix.techGrants = [];
  return s.players.flatMap(p => {
    p.ix.revealTechUsed = [];
    return p.ix.tech.flatMap(owned => {
      owned.exhausted = false;
      return TECH[owned.techId].roundStart ? [{ playerId: p.id, effect: clone(TECH[owned.techId].roundStart) }] : [];
    });
  });
}
function commissionDreadnought(s, p, count = 1) {
  requirePlayer(s, p); requireExpansion(s, 'rise-of-ix');
  demand(integer(count), 'INVALID_COUNT', '无畏舰数量必须是非负整数。');
  const actual = Math.min(count, p.ix.dreadnoughts.supply);
  p.ix.dreadnoughts.supply -= actual; p.ix.dreadnoughts.garrison += actual;
  if (s.turn?.playerId === p.id) s.turn.freshDreadnoughts = (s.turn.freshDreadnoughts || 0) + actual;
  return actual;
}
function deploymentOptions(s, p, { board = false, limit } = {}) {
  requirePlayer(s, p); requireExpansion(s, 'rise-of-ix');
  demand(limit === undefined || integer(limit), 'INVALID_COUNT', '部署上限无效。');
  demand(typeof board === 'boolean', 'INVALID_DEPLOYMENT', '部署许可无效。');
  if (board) demand(s.turn?.playerId === p.id, 'WRONG_TIMING', '没有本人的部署额度。');
  const options = [], ledger = s.turn?.playerId === p.id ? s.turn : {};
  const oldAllowance = Math.max(0, 2 - (ledger.boardOldDeployed || 0));
  for (let troops = 0; troops <= p.troops.garrison; troops++) for (let dreadnoughts = 0; dreadnoughts <= p.ix.dreadnoughts.garrison; dreadnoughts++) {
    const old = Math.max(0, troops - (ledger.freshGarrison || 0)) + Math.max(0, dreadnoughts - (ledger.freshDreadnoughts || 0));
    if ((limit === undefined || troops + dreadnoughts <= limit) && (!board || old <= oldAllowance)) options.push({ troops, dreadnoughts });
  }
  return options;
}
function deployUnits(s, p, troops, dreadnoughts, permissions = {}) {
  demand(deploymentOptions(s, p, permissions).some(o => o.troops === troops && o.dreadnoughts === dreadnoughts),
    'INVALID_DEPLOYMENT', '普通兵与无畏舰共享本回合的部署额度。');
  p.troops.garrison -= troops; p.troops.conflict += troops;
  p.ix.dreadnoughts.garrison -= dreadnoughts; p.ix.dreadnoughts.conflict += dreadnoughts;
  if (s.turn?.playerId === p.id) {
    const ledger = s.turn, freshTroops = Math.min(ledger.freshGarrison || 0, troops);
    const freshShips = Math.min(ledger.freshDreadnoughts || 0, dreadnoughts);
    ledger.freshGarrison = (ledger.freshGarrison || 0) - freshTroops;
    ledger.freshConflict = (ledger.freshConflict || 0) + freshTroops;
    ledger.freshDreadnoughts = (ledger.freshDreadnoughts || 0) - freshShips;
    ledger.freshConflictDreadnoughts = (ledger.freshConflictDreadnoughts || 0) + freshShips;
    ledger.deployed = (ledger.deployed || 0) + troops; // Baron still requires troops.
    ledger.deployedDreadnoughts = (ledger.deployedDreadnoughts || 0) + dreadnoughts;
    ledger.deployedUnits = (ledger.deployedUnits || 0) + troops + dreadnoughts;
    if (permissions.board) ledger.boardOldDeployed = (ledger.boardOldDeployed || 0) + troops + dreadnoughts - freshTroops - freshShips;
  }
}
function retreatUnits(s, p, troops, dreadnoughts) {
  requirePlayer(s, p); requireExpansion(s, 'rise-of-ix');
  demand(integer(troops, p.troops.conflict) && integer(dreadnoughts, p.ix.dreadnoughts.conflict), 'INVALID_RETREAT', '撤回单位数量无效。');
  p.troops.conflict -= troops; p.troops.garrison += troops;
  p.ix.dreadnoughts.conflict -= dreadnoughts; p.ix.dreadnoughts.garrison += dreadnoughts;
  if (s.turn?.playerId === p.id) {
    const ledger = s.turn, freshTroops = Math.min(ledger.freshConflict || 0, troops);
    const freshShips = Math.min(ledger.freshConflictDreadnoughts || 0, dreadnoughts);
    ledger.freshConflict = (ledger.freshConflict || 0) - freshTroops;
    ledger.freshGarrison = (ledger.freshGarrison || 0) + freshTroops;
    ledger.freshConflictDreadnoughts = (ledger.freshConflictDreadnoughts || 0) - freshShips;
    ledger.freshDreadnoughts = (ledger.freshDreadnoughts || 0) + freshShips;
  }
}
function strength(s, p, extraSwords = 0) {
  const ships = enabled(s, 'rise-of-ix') ? p.ix.dreadnoughts.conflict : 0;
  return p.troops.conflict + ships > 0 ? p.troops.conflict * 2 + ships *
    (p.leaderId === 'leader-prince-rhombur-vernius' ? 4 : 3) + p.swords + extraSwords : 0;
}
function controller(s, spaceId) { return s.ix?.occupations.find(o => o.spaceId === spaceId)?.playerId || s.controls[spaceId] || null; }
function occupationOptions(s, p) {
  requirePlayer(s, p); requireExpansion(s, 'rise-of-ix');
  if (s.combatWinnerId !== p.id || !p.ix.dreadnoughts.conflict || p.ix.lastOccupationRound === s.round) return [];
  return [...CONTROLS.filter(id => !s.ix.occupations.some(o => o.spaceId === id)).map(spaceId => ({ spaceId })),
    ...(hasTech(p, 'tech-detonation-devices') ? [{ detonate: true }] : [])];
}
function occupyWithDreadnought(s, p, { spaceId, detonate = false }) {
  demand(occupationOptions(s, p).some(o => detonate ? o.detonate && !spaceId : o.spaceId === spaceId),
    'INVALID_OCCUPATION', '获胜舰只能占据未被其他无畏舰控制的地点，或使用引爆装置。');
  p.ix.dreadnoughts.conflict--;
  p.ix.lastOccupationRound = s.round;
  if (detonate) { p.ix.dreadnoughts.supply++; return { vp: 1 }; }
  s.ix.occupations.push({ playerId: p.id, spaceId, expiresAfterRound: s.round + 1 });
  return {};
}
// Call AFTER the winner chooses a location, BEFORE normal troop cleanup.
// A location occupied last round is still blocked during this round's choice.
function combatCleanup(s) {
  if (!enabled(s, 'rise-of-ix')) return;
  for (const p of s.players) { p.ix.dreadnoughts.garrison += p.ix.dreadnoughts.conflict; p.ix.dreadnoughts.conflict = 0; }
  for (const occupation of s.ix.occupations.filter(o => o.expiresAfterRound <= s.round)) {
    s.players.find(p => p.id === occupation.playerId).ix.dreadnoughts.garrison++;
  }
  s.ix.occupations = s.ix.occupations.filter(o => o.expiresAfterRound > s.round);
}
function technologyEndgame(s) {
  if (!enabled(s, 'rise-of-ix')) return [];
  demand(!s.ix.endgameScored, 'ALREADY_SCORED', '科技终局奖励不能重复结算。');
  s.ix.endgameScored = true;
  return s.players.map(p => {
    const cards = [...p.deck, ...p.discard, ...p.hand, ...p.inPlay];
    const vp = (hasTech(p, 'tech-holtzman-engine') && cards.filter(c => c.cardId === 'the-spice-must-flow').length >= 2 ? 1 : 0) +
      (hasTech(p, 'tech-memocorders') && Object.values(p.influence).every(n => n >= 3) ? 1 : 0) +
      (hasTech(p, 'tech-spy-satellites') ? Object.values(p.influence).filter(n => n <= 1).length : 0);
    return { playerId: p.id, effect: { vp }, winsTiebreakers: hasTech(p, 'tech-chaumurky') };
  });
}
function assertConservation(s) {
  for (const p of s.players) {
    const ordinary = Object.values(p.troops).reduce((a, b) => a + b, 0) + (p.immortality?.specimens || 0) + (p.ix?.negotiators || 0);
    demand(Object.values(p.troops).every(n => integer(n)) && integer(p.immortality?.specimens || 0) &&
      integer(p.ix?.negotiators || 0) && ordinary === 12, 'UNIT_CONSERVATION', `${p.id} 的普通兵总数必须为 12。`);
    if (enabled(s, 'rise-of-ix')) {
      const ships = Object.values(p.ix.dreadnoughts).reduce((a, b) => a + b, 0) + s.ix.occupations.filter(o => o.playerId === p.id).length;
      demand(Object.values(p.ix.dreadnoughts).every(n => integer(n)) && ships === 2, 'UNIT_CONSERVATION', `${p.id} 的无畏舰总数必须为 2。`);
    }
  }
}
function publicState(s) {
  const state = { expansions: [...(s.expansions || [])] };
  if (enabled(s, 'rise-of-ix')) state.ix = {
    techStacks: s.ix.techStacks.map(stack => ({ top: stack.at(-1) || null, remaining: stack.length })),
    occupations: clone(s.ix.occupations), trashedTech: [...s.ix.trashedTech],
    players: s.players.map(p => ({ playerId: p.id, shipping: p.ix.shipping,
      recallRewards: [...p.ix.recallRewards], negotiators: p.ix.negotiators,
      dreadnoughts: clone(p.ix.dreadnoughts), tech: clone(p.ix.tech), revealTechUsed: [...p.ix.revealTechUsed] })),
  };
  if (enabled(s, 'immortality')) state.immortality = {
    tleilaxuRow: clone(s.immortality.tleilaxuRow), fixedCard: 'reclaimed-forces',
    tleilaxuDeckCount: s.immortality.tleilaxuDeck.length, firstSpice: s.immortality.firstSpice,
    players: s.players.map(p => ({ playerId: p.id, research: p.immortality.research,
      tleilaxu: p.immortality.tleilaxu, specimens: p.immortality.specimens,
      familyAtomicsUsed: p.immortality.familyAtomicsUsed, geneticMarker: geneticMarker(p) })),
  };
  return state;
}
module.exports = { initialize, enabled, generateSpecimens, returnSpecimens, sendNegotiators, geneticMarker,
  researchOptions, advanceResearch, advanceTleilaxu, acquireTleilaxu, familyAtomics,
  shippingOptions, moveShipping, shippingReward, hasTech, grantTechAcquisition, techPurchaseOptions,
  acquireTech, passTechAcquisition, activateTech, roundStart, commissionDreadnought, deploymentOptions,
  deployUnits, retreatUnits, strength, controller, occupationOptions, occupyWithDreadnought, combatCleanup,
  technologyEndgame, assertConservation, publicState, TLEILAXU_COSTS };
