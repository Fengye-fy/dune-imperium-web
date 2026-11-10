'use strict';

const crypto = require('node:crypto');
const expansionData = require('./expansion-data');
const expansionContent = require('./expansion-cards');
const expansionState = require('./expansion-state');
let extensions;
const {
  manifest, FACTIONS, CARDS, STARTER, RESERVE, INTRIGUES, SPACES,
  SPACE_BY_ID, INFLUENCE_BONUS, developmentConflicts,
  BASE_MARKET, BASE_INTRIGUE_DECK, BASE_CONFLICTS, REFERENCE, PENDING_CONTENT, LEADERS,
} = require('./data');
const isFull = s => ['base-dev-v3', 'expansions-dev-v4'].includes(s.ruleset);
const isExpansion = s => s.ruleset === 'expansions-dev-v4';
const spacesFor = s => isExpansion(s) ? expansionData.spacesFor(SPACES, s.options.expansions) : SPACES;
const spaceAt = (s, id) => spacesFor(s).find(space => space.id === id);
const isBase = s => isFull(s) || s.ruleset === 'base-subset-v2';
const clone = value => JSON.parse(JSON.stringify(value));
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const demand = (condition, code, message, status) => { if (!condition) fail(code, message, status); };
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const instance = cardId => ({ uid: crypto.randomUUID(), cardId });
function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
const playerById = (s, id) => s.players.find(p => p.id === id);
const strength = (s, p) => expansionState.strength(s, p, extensions?.extraSwords(s, p) || 0);
const hasCombatUnits = p => p.troops.conflict + (p.ix?.dreadnoughts.conflict || 0) > 0;
const affordable = (p, costs) => Object.entries(costs).every(([key, count]) => p.resources[key] >= count);
function addLog(s, type, details = {}) {
  s.events.push({ sequence: ++s.eventSequence, round: s.round, type, ...details });
  if (s.events.length > 160) s.events.shift();
}
function draw(s, p, count) {
  for (let i = 0; i < count; i++) {
    if (!p.deck.length) p.deck = shuffle(p.discard.splice(0));
    if (!p.deck.length) return;
    const card = p.deck.pop();
    // FAQ: a card drawn during your Reveal turn is revealed immediately.
    if (isBase(s) && p.revealed && s.currentPlayerId === p.id &&
        (s.phase === 'reveal' || (s.effectContext?.logicalPhase || s.effectContext?.phase) === 'reveal')) {
      p.inPlay.push(card); p.unresolvedReveal.push(card);
      addLog(s, 'hand-revealed', { playerId: p.id, cards: [card] });
    } else p.hand.push(card);
  }
}
function drawIntrigue(s, p, count) {
  for (let i = 0; i < count; i++) {
    if (!s.intrigueDeck.length) s.intrigueDeck = shuffle(s.intrigueDiscard.splice(0));
    if (!s.intrigueDeck.length) return;
    p.intrigues.push(s.intrigueDeck.pop());
  }
}
function acquireReserve(s, p, cardId) {
  if (s.reserve[cardId] <= 0) return;
  s.reserve[cardId]--;
  p.discard.push(instance(cardId));
  applyEffect(s, p, CARDS[cardId].acquire || {});
}
function trash(s, p, uid) {
  for (const zone of ['hand', 'discard', 'inPlay']) {
    const index = p[zone].findIndex(c => c.uid === uid);
    if (index < 0) continue;
    const [removed] = p[zone].splice(index, 1);
    if (CARDS[removed.cardId].reserve) s.reserve[removed.cardId]++;
    else s.trashed.push(removed);
    if (isExpansion(s)) queueTrashTriggers(s, p, removed);
    else if (isBase(s) && CARDS[removed.cardId].onTrash) applyEffect(s, p, CARDS[removed.cardId].onTrash);
    addLog(s, 'card-trashed', { playerId: p.id, card: removed });
    return true;
  }
  if (isExpansion(s) && s.turn?.usurpedUid === uid) {
    for (const zone of [s.market, s.removedMarket, p.setAsideMarket, p.deck]) {
      const i = zone.findIndex(c => c.uid === uid);
      if (i < 0) continue;
      const [removed] = zone.splice(i, 1); s.trashed.push(removed);
      if (zone === s.market && s.marketDeck.length) s.market.splice(i, 0, s.marketDeck.pop());
      queueTrashTriggers(s, p, removed); addLog(s, 'card-trashed', { playerId: p.id, card: removed }); return true;
    }
  }
  return false;
}
function queueTrashTriggers(s, p, c) {
  const definition = CARDS[c.cardId], source = { playerId: p.id, sourceUid: c.uid, sourceCardId: c.cardId };
  const tasks = [];
  if (definition.onTrash) tasks.push(effects.task(definition.onTrash, source));
  if (definition.unload) tasks.push(effects.task(definition.reveal, source));
  (s.triggeredEffects ||= []).push(...tasks);
}
function applyEffect(s, p, effect) {
  let recruited = 0;
  for (const key of ['spice', 'water', 'solari']) p.resources[key] += effect[key] || 0;
  if (isExpansion(s)) {
    if (effect.solari > 0 && p.leaderId === 'leader-princess-yuna-moritani' && s.turn?.playerId === p.id) p.resources.solari++;
    if (effect.spice > 0 && s.turn?.playerId === p.id) s.turn.spiceGained = true;
    if (effect.swords > 0 && s.effectContext?.revealUid && s.effectContext.revealUid === s.effectContext.currentSourceUid &&
        !p.revealSwordCards.includes(s.effectContext.revealUid)) p.revealSwordCards.push(s.effectContext.revealUid);
  }
  p.vp += effect.vp || 0;
  p.swords += effect.swords || 0;
  p.persuasion += effect.persuasion || 0;
  if (effect.troops) {
    recruited = Math.min(effect.troops, p.troops.supply);
    p.troops.supply -= recruited;
    p.troops.garrison += recruited;
    if (isFull(s)) full.recruited(s, p, recruited);
  }
  if (effect.draw) draw(s, p, effect.draw);
  if (effect.intrigue) drawIntrigue(s, p, effect.intrigue);
  if (effect.reserve) acquireReserve(s, p, effect.reserve);
  if (effect.stealIntrigue) {
    for (const opponent of s.players) {
      if (opponent.id === p.id || opponent.intrigues.length < 4) continue;
      p.intrigues.push(opponent.intrigues.splice(crypto.randomInt(opponent.intrigues.length), 1)[0]);
      addLog(s, 'intrigue-stolen', { playerId: p.id, fromPlayerId: opponent.id });
    }
  }
  if (effect.highCouncil) p.highCouncil = true;
  if (effect.swordmaster) { p.swordmaster = true; p.agentsAvailable++; }
  if (effect.mentat && !s.mentatOwner) { s.mentatOwner = p.id; p.agentsAvailable++; }
  return recruited;
}
function gainInfluence(s, p, faction, amount = 1) {
  let recruited = 0;
  const before = p.influence[faction];
  const after = Math.max(0, Math.min(6, before + amount));
  p.influence[faction] = after;
  if (before < 2 && after >= 2) p.vp++;
  if (before >= 2 && after < 2) p.vp--;
  if (isExpansion(s) && before < 2 && after >= 2 && p.leaderState.snoopers?.includes(faction)) {
    (s.triggeredEffects ||= []).push(effects.task({ tessiaRecover: faction }, { playerId: p.id, sourceCardId: p.leaderId }));
  }
  if (before < 4 && after >= 4) recruited = applyEffect(s, p, INFLUENCE_BONUS[faction]);
  const owner = playerById(s, s.alliances[faction]);
  if (isFull(s) && amount < 0 && owner?.id === p.id) {
    const highest = Math.max(...s.players.map(x => x.influence[faction]));
    if (after < 4 || after < highest) {
      owner.vp--; s.alliances[faction] = null;
      const candidates = s.players.filter(x => x.influence[faction] === highest && highest >= 4);
      if (candidates.length === 1) { s.alliances[faction] = candidates[0].id; candidates[0].vp++; }
      else if (candidates.length > 1) (s.allianceChoices ||= []).push({ faction, chooserId: p.id, playerIds: candidates.map(x => x.id) });
    }
    return recruited;
  }
  if (after >= 4 && (!owner || after > owner.influence[faction])) {
    if (owner) owner.vp--;
    s.alliances[faction] = p.id;
    p.vp++;
  }
  return recruited;
}
function turnAfter(s, fromIndex, predicate) {
  for (let offset = 1; offset <= s.players.length; offset++) {
    const p = s.players[(fromIndex + offset) % s.players.length];
    if (predicate(p)) return p.id;
  }
  return null;
}
function fromFirst(s, predicate) {
  return turnAfter(s, (s.firstPlayerIndex + s.players.length - 1) % s.players.length, predicate);
}
function beginRound(s) {
  s.round++;
  s.conflict = s.conflictDeck.shift();
  s.occupied = {};
  s.mentatOwner = isBase(s) ? s.nextMentatOwner || null : null;
  delete s.nextMentatOwner;
  s.pending = null;
  s.combatPasses = 0;
  if (isFull(s)) { s.agentPositions = []; s.voiceBlocks = []; delete s.turn; s.combatWinnerId = null; }
  for (const p of s.players) {
    p.agentsAvailable = p.swordmaster ? 3 : 2;
    p.revealed = false;
    p.persuasion = 0;
    p.swords = 0;
    p.inPlay = [];
    if (isBase(s)) {
      p.unresolvedReveal = []; p.roundPersuasion = 0; p.spiceMustFlowDiscount = 0;
      p.acquireTopdeck = false; p.nextAgentFactions = false;
      if (s.mentatOwner === p.id) p.agentsAvailable++;
    }
    draw(s, p, 5);
  }
  s.phase = 'player-turns';
  s.currentPlayerId = s.players[s.firstPlayerIndex].id;
  const defender = playerById(s, isExpansion(s) ? expansionState.controller(s, s.conflict.control) : s.controls[s.conflict.control]);
  if (defender && defender.troops.supply > 0) {
    s.phase = 'round-start';
    s.currentPlayerId = defender.id;
    s.pending = { stage: 'defend', playerId: defender.id };
  }
  if (isFull(s)) { full.sync(s); if (s.phase === 'player-turns' && !isExpansion(s)) full.openTurn(s, playerById(s, s.currentPlayerId)); }
  addLog(s, 'round-started', { conflictId: s.conflict.id, firstPlayerId: s.players[s.firstPlayerIndex].id });
  if (isExpansion(s)) {
    const tasks = extensions.roundStart(s);
    if (tasks.length) effects.start(s, playerById(s, s.currentPlayerId), tasks, 'roundReady');
    else if (s.phase === 'player-turns') full.openTurn(s, playerById(s, s.currentPlayerId));
  }
}
function beginCombat(s) {
  if (isFull(s)) delete s.turn;
  s.phase = 'combat';
  s.combatPasses = 0;
  s.currentPlayerId = fromFirst(s, hasCombatUnits);
  addLog(s, 'combat-started');
  if (!s.currentPlayerId) resolveCombat(s);
}
function advanceTurns(s, previousPlayerId, afterCleanup = false) {
  if (isExpansion(s) && !afterCleanup) {
    const tasks = extensions.beforeAdvance(s, playerById(s, previousPlayerId));
    if (tasks.length) { effects.start(s, playerById(s, previousPlayerId), tasks, 'advanceCleanup'); return; }
  }
  if (isFull(s)) {
    const previous = playerById(s, previousPlayerId); previous.infiltrate = false; previous.nextAgentFactions = false;
  }
  s.pending = null;
  if (s.players.every(p => p.revealed)) return beginCombat(s);
  s.phase = 'player-turns';
  const previous = playerById(s, previousPlayerId);
  if (isExpansion(s) && previous.extraTurns > 0 && !previous.revealed) {
    previous.extraTurns--; s.currentPlayerId = previous.id; full.openTurn(s, previous); return;
  }
  s.currentPlayerId = turnAfter(s, s.players.findIndex(p => p.id === previousPlayerId), p => !p.revealed);
  if (isFull(s)) full.openTurn(s, playerById(s, s.currentPlayerId));
}
function finalScore(s) {
  if (isExpansion(s) && s.ix && !s.ix.endgameScored) for (const reward of expansionState.technologyEndgame(s)) {
    applyEffect(s, playerById(s, reward.playerId), reward.effect); playerById(s, reward.playerId).winsTiebreakers = reward.winsTiebreakers;
  }
  const score = p => [p.vp, ...(isExpansion(s) ? [p.winsTiebreakers ? 1 : 0] : []), p.resources.spice, p.resources.solari, p.resources.water, p.troops.garrison, p.lastRevealSequence];
  const compare = (a, b) => {
    const av = score(a), bv = score(b);
    for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return bv[i] - av[i];
    return 0;
  };
  const ranked = [...s.players].sort(compare);
  s.result = {
    winnerIds: ranked.filter(p => compare(p, ranked[0]) === 0).map(p => p.id),
    rankings: ranked.map(p => ({ playerId: p.id, score: score(p) })),
    tiebreakers: ['vp', ...(isExpansion(s) ? ['chaumurky'] : []), 'spice', 'solari', 'water', 'garrison', 'lastRevealSequence'],
  };
  s.phase = 'finished';
  s.currentPlayerId = null;
  addLog(s, 'game-finished', { winnerIds: s.result.winnerIds });
}
function resolveCombat(s) {
  const participants = s.players.filter(p => strength(s, p) > 0).sort((a, b) => strength(s, b) - strength(s, a));
  const maxRewardRank = s.players.length === 4 ? 3 : 2;
  const results = [];
  let at = 0;
  while (at < participants.length) {
    let end = at + 1;
    while (end < participants.length && strength(s, participants[end]) === strength(s, participants[at])) end++;
    const tied = end - at > 1;
    const rewardRank = at + 1 + (tied ? 1 : 0);
    for (const p of participants.slice(at, end)) {
      const reward = rewardRank <= maxRewardRank ? s.conflict.rewards[rewardRank - 1] : null;
      if (reward && !isBase(s)) {
        applyEffect(s, p, reward);
        if (reward.control) s.controls[reward.control] = p.id;
      }
      results.push({ playerId: p.id, strength: strength(s, p), place: at + 1, tied, reward: reward ? clone(reward) : null });
    }
    at = end;
  }
  s.lastCombat = { round: s.round, conflictId: s.conflict.id, results };
  addLog(s, 'combat-resolved', { results });
  if (isBase(s)) {
    if (isFull(s)) s.combatWinnerId = results[0]?.place === 1 && !results[0].tied ? results[0].playerId : null;
    s.combatRewards = results.filter(r => r.reward).map(r => ({ playerId: r.playerId, reward: r.reward }));
    return nextCombatReward(s);
  }
  finishCombat(s);
}
function nextCombatReward(s) {
  const next = s.combatRewards.shift();
  if (!next) {
    delete s.combatRewards;
    if (isFull(s) && s.combatWinnerId) { s.phase = 'combat-win'; s.pending = null; s.currentPlayerId = s.combatWinnerId; return; }
    return finishCombat(s);
  }
  s.currentPlayerId = next.playerId; s.phase = 'combat-rewards'; s.pending = null;
  effects.start(s, playerById(s, next.playerId), [effects.task(next.reward, { sourceCardId: s.conflict.id })], 'reward');
}
function finishCombat(s) {
  if (isExpansion(s) && !s.combatCleanupDone) {
    const tasks = extensions.cleanupTasks(s); s.combatCleanupDone = true;
    s.combatEndPending = s.players.filter(p => p.lostTroopsThisCombat >= 3 &&
      p.intrigues.some(c => c.cardId === 'intrigue-imm-harvest-cells')).map(p => p.id);
    if (s.combatEndPending.length) {
      s.phase = 'combat-end'; s.pending = null; s.currentPlayerId = s.combatEndPending[0];
      if (tasks.length) effects.start(s, playerById(s, s.currentPlayerId), tasks, 'combatEndReady');
      return;
    }
    if (tasks.length) { effects.start(s, playerById(s, s.currentPlayerId || s.players[s.firstPlayerIndex].id), tasks, 'finishCombat'); return; }
  }
  for (const p of s.players) { p.troops.supply += p.troops.conflict; p.troops.conflict = 0; p.swords = 0; }
  for (const space of SPACES.filter(item => item.maker)) if (!s.occupied[space.id]) s.bonusSpice[space.id]++;
  if (s.players.some(p => p.vp >= 10) || s.conflictDeck.length === 0) {
    s.phase = 'endgame';
    s.endgamePassed = [];
    s.currentPlayerId = s.players[s.firstPlayerIndex].id;
    addLog(s, 'endgame-started');
  } else {
    s.firstPlayerIndex = (s.firstPlayerIndex + 1) % s.players.length;
    beginRound(s);
  }
}
function createGame({ players, options = {} } = {}) {
  demand(Array.isArray(players) && players.length >= 3 && players.length <= 4, 'PLAYER_COUNT', '本规则集仅支持 3–4 人。');
  demand(players.every(p => p && typeof p.id === 'string' && p.id.length > 0 && p.id.length <= 128 && typeof p.name === 'string' && p.name.length <= 100), 'INVALID_PLAYERS', '玩家信息无效。');
  demand(new Set(players.map(p => p.id)).size === players.length, 'DUPLICATE_PLAYER', '同一账户不能占多个座位。');
  const normalizedOptions = expansionData.normalizeOptions(options);
  const plan = expansionData.setupPlan(require('./data'), normalizedOptions);
  const conflictCards = [...BASE_CONFLICTS, ...(normalizedOptions.expansions.includes('rise-of-ix') ? expansionContent.CONFLICTS : [])];
  const s = {
    schemaVersion: 1, gameId: manifest.id, ruleset: plan.ruleset, options: normalizedOptions, phase: 'player-turns', round: 0,
    firstPlayerIndex: crypto.randomInt(players.length), currentPlayerId: null, eventSequence: 0, events: [], revealSequence: 0,
    players: players.map(p => ({
      id: p.id, name: p.name, vp: players.length === 4 ? 1 : 0,
      resources: { spice: 0, solari: 0, water: 1 }, troops: { supply: 9, garrison: 3, conflict: 0 },
      influence: Object.fromEntries(FACTIONS.map(f => [f, 0])), swordmaster: false, highCouncil: false,
      agentsAvailable: 2, revealed: false, persuasion: 0, swords: 0, lastRevealSequence: 0,
      deck: shuffle(plan.starter.map(instance)), hand: [], discard: [], inPlay: [], intrigues: [],
      activeIntrigues: [], unresolvedReveal: [], roundPersuasion: 0, spiceMustFlowDiscount: 0,
      acquireTopdeck: false, nextAgentFactions: false,
    })),
    alliances: Object.fromEntries(FACTIONS.map(f => [f, null])),
    controls: { arrakeen: null, carthag: null, 'imperial-basin': null },
    bonusSpice: { 'imperial-basin': 0, 'hagga-basin': 0, 'great-flat': 0 },
    reserve: clone(RESERVE), marketDeck: shuffle(plan.market.map(instance)),
    market: [], intrigueDeck: shuffle(plan.intrigue.map(instance)),
    intrigueDiscard: [], trashed: [], conflictDeck: [
      ...shuffle(clone(conflictCards.filter(c => c.level === 1))).slice(0, 1),
      ...shuffle(clone(conflictCards.filter(c => c.level === 2))).slice(0, 5),
      ...shuffle(clone(conflictCards.filter(c => c.level === 3))).slice(0, 4),
    ], conflict: null,
    occupied: {}, pending: null, mentatOwner: null, combatPasses: 0, lastCombat: null, result: null,
  };
  for (let i = 0; i < 5; i++) s.market.push(s.marketDeck.pop());
  full.initialize(s);
  if (isExpansion(s)) { expansionState.initialize(s, normalizedOptions); s.allowedLeaders = plan.leaders; }
  return s;
}
function placementError(s, p, c, space, spice, agentUid) {
  const definition = c?.definition || CARDS[c?.cardId];
  if (!c || !space || !CARDS[c.cardId] ||
      !((isFull(s) && definition.moveAgent) || definition.icons.includes(space.icon) || (isBase(s) && p.nextAgentFactions && FACTIONS.includes(space.icon)))) return '卡牌图标不允许这个行动格。';
  if (isFull(s)) {
    const reason = full.placementError(s, p, c, space, agentUid);
    if (reason) return reason;
  } else {
    if (p.agentsAvailable <= 0) return '没有可用特工。';
    if (s.occupied[space.id]) return '行动格已被占用。';
  }
  if (space.oncePerGame && p[space.oncePerGame]) return '这项升级每局只能获取一次。';
  if (space.requirement && p.influence[space.requirement.faction] < space.requirement.influence) return '影响力未达到行动格要求。';
  const costs = isFull(s) ? full.costs(s, p, space, spice, c) : space.id === 'sell-melange' ? { spice } : space.cost;
  if (space.id === 'sell-melange' && (!Number.isInteger(spice) || spice < 2 || spice > 5)) return '必须选择出售 2–5 份香料。';
  if (!affordable(p, costs)) return '资源不足，必须先支付行动格费用。';
  return null;
}
function applyCardEffect(s, p, cardUid, cardId) {
  const effect = CARDS[cardId].agent;
  const recruited = applyEffect(s, p, effect);
  if (effect.trashSelf) trash(s, p, cardUid);
  return recruited;
}
function finishAgentEffects(s, p) {
  const pending = s.pending;
  if (pending.queuedCard) {
    pending.recruited += applyCardEffect(s, p, pending.queuedCard.uid, pending.queuedCard.cardId);
    delete pending.queuedCard;
  }
  if ((spaceAt(s, pending.spaceId).combat || (isExpansion(s) && s.turn.combatAccess)) && (isFull(s) || p.troops.garrison > 0)) {
    pending.stage = 'deploy';
    pending.maxDeploy = isFull(s) ? full.maxDeploy(s, p) : Math.min(p.troops.garrison, pending.recruited + 2);
    s.phase = 'agent-choice';
  } else if (isFull(s)) agentEnd(s, p);
  else advanceTurns(s, p.id);
}
function agentEnd(s, p) {
  s.phase = 'agent-end'; s.pending.stage = 'agent-end'; s.pending.playerId = p.id;
  s.pending.maxDeploy = full.maxDeploy(s, p);
}
const full = require('./rules-v3')({ CARDS, FACTIONS, SPACES, spacesFor, draw, trash, demand, addLog, playerById,
  acquisitionCandidates, takeAcquisition });
const effects = require('./effects')({
  CARDS, FACTIONS, SPACES, applyEffect, gainInfluence, trash, draw, shuffle, playerById, demand, full,
  onComplete(s, p, continuation, context) {
    if (isFull(s) && ['deploy', 'agent-end'].includes(context.pending?.stage)) context.pending.maxDeploy = full.maxDeploy(s, p);
    if (continuation === 'agent') finishAgentEffects(s, p);
    else if (continuation === 'roundReady' && s.phase === 'player-turns') full.openTurn(s, playerById(s, s.currentPlayerId));
    else if (continuation === 'advanceCleanup') advanceTurns(s, p.id, true);
    else if (continuation === 'finishCombat') finishCombat(s);
    else if (continuation === 'agentEnd') agentEnd(s, p);
    else if (continuation === 'advance' || continuation === 'bindu') advanceTurns(s, p.id);
    else if (continuation === 'setup') beginRound(s);
    else if (continuation === 'reward') nextCombatReward(s);
    else if (continuation === 'intrigue' && s.phase === 'combat' && !hasCombatUnits(p)) {
      s.combatPasses = 0;
      const next = turnAfter(s, s.players.findIndex(x => x.id === p.id), hasCombatUnits);
      if (next) s.currentPlayerId = next;
      else resolveCombat(s);
    }
    else if (continuation === 'intrigue' && isFull(s) && ['deploy', 'agent-end'].includes(context.pending?.stage)) {
      s.pending.maxDeploy = full.maxDeploy(s, p);
    }
  },
});
extensions = require('./expansion-runtime')({ CARDS, INTRIGUES, FACTIONS, full, getEffects: () => effects,
  demand, addLog, draw, drawIntrigue, trash, applyEffect, gainInfluence, playerById, spacesFor, placementError,
  acquisitionCandidates, takeAcquisition, shuffle });
const EFFECT_ORDERS = ['card-space-influence', 'card-influence-space', 'space-card-influence',
  'space-influence-card', 'influence-card-space', 'influence-space-card'];
function agent(s, p, a) {
  if (isExpansion(s)) return extensions.agent(s, p, a);
  demand(a.cardUids === undefined && a.graftMarketUid === undefined && a.dispatchCardUid === undefined, 'INVALID_ACTION', '旧基础规则不支持嫁接字段。');
  demand(s.phase === 'player-turns', 'WRONG_PHASE', '当前不能派遣特工。');
  const index = p.hand.findIndex(c => c.uid === a.cardUid);
  const c = p.hand[index];
  const space = own(SPACE_BY_ID, a.spaceId) ? SPACE_BY_ID[a.spaceId] : null;
  const agentUid = isFull(s) ? a.agentUid || full.available(s, p)[0] : undefined;
  const reason = placementError(s, p, c, space, a.spice, agentUid);
  demand(!reason, 'ILLEGAL_PLACEMENT', reason);
  demand(a.agentUid === undefined || isFull(s), 'INVALID_ACTION', '旧规则不接受 agentUid。');
  demand(a.effectOrder === undefined || ['card-first', 'space-first', ...(isBase(s) ? EFFECT_ORDERS : [])].includes(a.effectOrder), 'INVALID_ACTION', 'effectOrder 无效。');
  demand(a.leaderEffectAt === undefined || (isFull(s) && full.has(p, 'count-ilban-richese') && Number.isInteger(a.leaderEffectAt) && a.leaderEffectAt >= 0 && a.leaderEffectAt <= 3), 'INVALID_ACTION', '领袖效果顺序无效。');
  const costs = isFull(s) ? full.costs(s, p, space, a.spice) : space.id === 'sell-melange' ? { spice: a.spice } : space.cost;
  for (const [key, count] of Object.entries(costs)) p.resources[key] -= count;
  if (isFull(s)) s.turn.atStart = false;
  p.hand.splice(index, 1);
  p.inPlay.push(c);
  if (isFull(s)) full.place(s, p, space.id, agentUid);
  else { p.agentsAvailable--; s.occupied[space.id] = p.id; }
  s.pending = { stage: 'effects', playerId: p.id, spaceId: space.id, recruited: 0 };
  const controller = playerById(s, s.controls[space.id]);
  if (controller && space.controlBonus) applyEffect(s, controller, space.controlBonus);
  if (space.maker && !isFull(s)) { p.resources.spice += s.bonusSpice[space.id]; s.bonusSpice[space.id] = 0; }
  if (isBase(s)) {
    p.nextAgentFactions = false;
    const card = CARDS[c.cardId];
    const boardBase = { ...space.effect };
    if (isFull(s) && space.maker) { delete boardBase.spice; boardBase.harvest = { spaceId: space.id, multiplier: c.cardId === 'carryall' ? 2 : 1 }; }
    const boardEffect = { steps: [boardBase,
      ...(space.effect.sellMelange ? [{ solari: a.spice * 2 + 2 }] : []),
      ...(space.effect.selectiveBreeding ? [{ trashChoice: true, afterTrash: { draw: 2 } }] : []),
    ] };
    const tasks = {
      card: effects.task(isFull(s) && c.cardId === 'signet-ring' ? { leaderRing: true } : card.agent, { sourceUid: c.uid, sourceCardId: c.cardId }),
      space: effects.task(boardEffect),
      influence: effects.task(space.faction ? { influence: { [space.faction]: card.factionInfluence || 1 } } : {}),
    };
    const order = !a.effectOrder || a.effectOrder === 'card-first' ? EFFECT_ORDERS[0] : a.effectOrder === 'space-first' ? 'space-card-influence' : a.effectOrder;
    addLog(s, 'agent-placed', { playerId: p.id, spaceId: space.id, card: c, ...(isFull(s) ? { agentUid } : {}) });
    const ordered = order.split('-').map(key => tasks[key]);
    if (isFull(s) && full.has(p, 'count-ilban-richese') && costs.solari > 0) {
      ordered.splice(a.leaderEffectAt ?? 0, 0, effects.task({ draw: 1 }, { sourceCardId: p.leaderId }));
    }
    effects.start(s, p, ordered, 'agent');
    return;
  }
  if (space.faction) s.pending.recruited += gainInfluence(s, p, space.faction);
  const cardFirst = a.effectOrder !== 'space-first';
  if (cardFirst) s.pending.recruited += applyCardEffect(s, p, c.uid, c.cardId);
  else s.pending.queuedCard = c;
  s.pending.recruited += applyEffect(s, p, space.effect);
  if (space.effect.sellMelange) p.resources.solari += a.spice * 2 + 2;
  addLog(s, 'agent-placed', { playerId: p.id, spaceId: space.id, card: c });
  if (space.effect.selectiveBreeding) { s.phase = 'agent-choice'; s.pending.stage = 'trash'; }
  else finishAgentEffects(s, p);
}
function reveal(s, p) {
  demand(s.phase === 'player-turns', 'WRONG_PHASE', '当前不能展示手牌。');
  if (isExpansion(s)) extensions.beforeReveal(s, p);
  const revealed = p.hand.splice(0);
  if (isFull(s)) { s.turn.kind = 'reveal'; s.turn.atStart = false; }
  p.inPlay.push(...revealed);
  p.revealed = true;
  p.lastRevealSequence = ++s.revealSequence;
  p.persuasion = p.highCouncil ? 2 : 0;
  if (isBase(s)) p.persuasion += p.roundPersuasion || 0;
  for (const space of spacesFor(s)) if (isFull(s) ? s.agentPositions.some(a => a.spaceId === space.id && a.playerId === p.id) : s.occupied[space.id] === p.id) p.persuasion += space.revealPersuasion || 0;
  if (isBase(s)) p.unresolvedReveal = revealed;
  else for (const c of revealed) applyEffect(s, p, CARDS[c.cardId].reveal);
  s.phase = 'reveal';
  addLog(s, 'hand-revealed', { playerId: p.id, cards: revealed });
  if (isExpansion(s)) { const tasks = extensions.revealTasks(s, p); if (tasks.length) effects.start(s, p, tasks, 'resume'); }
}
const purchaseCost = (s, p, card, source) => Math.max(0, card.cost -
  (isBase(s) && card.id === 'the-spice-must-flow' ? p.spiceMustFlowDiscount || 0 : 0) -
  (isFull(s) && source === 'set-aside' ? 1 : 0));
function acquisitionCandidates(s, p) {
  return [...s.market.map(c => ({ source: 'market', cardUid: c.uid, cardId: c.cardId })),
    ...['arrakis-liaison', 'the-spice-must-flow'].filter(id => s.reserve[id] > 0).map(cardId => ({ source: 'reserve', cardId })),
    ...(isFull(s) ? p.setAsideMarket.map(c => ({ source: 'set-aside', cardUid: c.uid, cardId: c.cardId })) : [])];
}
function acquisitionCard(s, p, a) {
  if (a.source === 'market') return s.market.find(c => c.uid === a.cardUid);
  if (a.source === 'set-aside' && isFull(s)) return p.setAsideMarket.find(c => c.uid === a.cardUid);
  if (a.source === 'reserve' && ['arrakis-liaison', 'the-spice-must-flow'].includes(a.cardId) && s.reserve[a.cardId] > 0) return { cardId: a.cardId };
  return null;
}
function takeAcquisition(s, p, a) {
  const selected = acquisitionCard(s, p, a);
  demand(selected, 'CARD_UNAVAILABLE', '这张卡已不可获取。');
  let c;
  if (a.source === 'market') {
    const i = s.market.findIndex(c => c.uid === a.cardUid); [c] = s.market.splice(i, 1);
    if (s.marketDeck.length) s.market.splice(i, 0, s.marketDeck.pop());
  } else if (a.source === 'set-aside') {
    c = p.setAsideMarket.splice(p.setAsideMarket.findIndex(c => c.uid === a.cardUid), 1)[0];
  } else { s.reserve[selected.cardId]--; c = instance(selected.cardId); }
  (a.destination === 'deck' ? p.deck : a.destination === 'hand' ? p.hand : p.discard).push(c);
  addLog(s, 'card-acquired', { playerId: p.id, card: c, source: a.source });
  return c;
}
function buy(s, p, a) {
  demand(s.phase === 'reveal', 'WRONG_PHASE', '只能在自己的展示阶段购买卡牌。');
  if (isFull(s)) {
    const selected = acquisitionCard(s, p, a);
    demand(selected, 'CARD_UNAVAILABLE', '这张卡已不可购买。');
    demand(a.destination === undefined || a.destination === 'discard' || (a.destination === 'deck' && p.acquireTopdeck), 'INVALID_DESTINATION', '当前不能放到牌库顶。');
    const cost = purchaseCost(s, p, CARDS[selected.cardId], a.source);
    demand(p.persuasion >= cost, 'INSUFFICIENT_PERSUASION', '说服力不足。');
    p.persuasion -= cost;
    const c = takeAcquisition(s, p, a);
    effects.start(s, p, [effects.task(CARDS[c.cardId].acquire || {}, { sourceUid: c.uid, sourceCardId: c.cardId })], 'resume');
    return;
  }
  let c, index;
  if (a.source === 'market') {
    index = s.market.findIndex(item => item.uid === a.cardUid);
    c = s.market[index];
    demand(c, 'CARD_UNAVAILABLE', '这张市场卡已经不在市场。');
  } else if (a.source === 'reserve') {
    demand(['arrakis-liaison', 'the-spice-must-flow'].includes(a.cardId) && s.reserve[a.cardId] > 0, 'CARD_UNAVAILABLE', '这张保留牌不可购买。');
    c = instance(a.cardId);
  } else fail('INVALID_ACTION', '购买来源必须是 market 或 reserve。');
  const card = CARDS[c.cardId];
  demand(a.destination === undefined || a.destination === 'discard' ||
    (a.destination === 'deck' && isBase(s) && p.acquireTopdeck), 'INVALID_DESTINATION', '当前不能把购入卡放到牌库顶。');
  const cost = purchaseCost(s, p, card);
  demand(p.persuasion >= cost, 'INSUFFICIENT_PERSUASION', '说服力不足。');
  p.persuasion -= cost;
  if (a.source === 'market') {
    s.market.splice(index, 1);
    if (s.marketDeck.length) s.market.splice(index, 0, s.marketDeck.pop());
  } else s.reserve[c.cardId]--;
  (a.destination === 'deck' ? p.deck : p.discard).push(c);
  if (!isBase(s)) applyEffect(s, p, card.acquire || {});
  addLog(s, 'card-acquired', { playerId: p.id, card: c, source: a.source });
  if (isBase(s)) effects.start(s, p, [effects.task(card.acquire || {}, { sourceUid: c.uid, sourceCardId: c.cardId })], 'resume');
}
const ACTION_FIELDS = {
  agent: ['cardUid', 'cardUids', 'graftMarketUid', 'dispatchCardUid', 'spaceId', 'spice', 'effectOrder', 'agentUid', 'leaderEffectAt'], reveal: [], buy: ['source', 'cardUid', 'cardId', 'destination'],
  endReveal: [], playIntrigue: ['cardUid'], passCombat: [], passEndgame: [],
  chooseTrash: ['cardUid'], deploy: ['count', 'dreadnoughts'], defend: ['deploy'],
  resolveReveal: ['cardUid'], chooseEffect: ['option'],
  chooseLeader: ['leaderId'], passCombatWin: [],
  endAgent: [], useMasterstroke: [],
  passCombatEnd: [],
  familyAtomics: [], returnSpecimens: ['count'], useTech: ['techId', 'discardUid', 'trashUid'],
  buyTleilaxu: ['cardUid', 'cardId', 'destination', 'reclaimedChoice'],
};
function intrigueTiming(s, p) {
  if (isFull(s)) return full.ownTurn(s, p) ? 'plot' : ['combat', 'combat-win', 'combat-end', 'endgame'].includes(s.phase) ? s.phase : null;
  return ['player-turns', 'reveal'].includes(s.phase) ? 'plot' : ['combat', 'endgame'].includes(s.phase) ? s.phase : null;
}
function applyAction(state, playerId, action) {
  demand(state && manifest.supportedRulesets.includes(state.ruleset) && state.schemaVersion === 1, 'UNSUPPORTED_STATE', '不支持的规则存档。', 409);
  demand(action && typeof action === 'object' && !Array.isArray(action) && own(ACTION_FIELDS, action.type), 'INVALID_ACTION', '未知游戏命令。');
  demand(Object.keys(action).every(key => key === 'type' || ACTION_FIELDS[action.type].includes(key)), 'INVALID_ACTION', '命令含有不支持的字段。');
  demand(state.phase !== 'finished', 'GAME_FINISHED', '对局已经结束。', 409);
  demand(playerById(state, playerId), 'NOT_A_PLAYER', '你不是本局玩家。', 403);
  demand(state.currentPlayerId === playerId || (isExpansion(state) && action.type === 'returnSpecimens' &&
    expansionState.enabled(state, 'immortality')), 'NOT_YOUR_TURN', '尚未轮到你行动。', 409);
  const s = clone(state), p = playerById(s, playerId), a = action;
  if (extensions.action(s, p, a)) { expansionState.assertConservation(s); return s; }
  switch (a.type) {
    case 'chooseLeader': {
      demand(isFull(s), 'WRONG_PHASE', '旧规则不选择领袖。');
      demand((isExpansion(s) ? s.allowedLeaders : Object.keys(LEADERS).filter(id => !LEADERS[id].expansion)).includes(a.leaderId), 'LEADER_UNAVAILABLE', '该领袖不在本局启用的牌池中。');
      if (full.selectLeader(s, p, a.leaderId)) {
        delete s.leaderSelectionOrder;
        const baron = s.players.find(x => full.has(x, 'baron-vladimir-harkonnen'));
        const setupTasks = baron ? [effects.task({ masterstrokeSetupChoice: true }, { playerId: baron.id, sourceCardId: baron.leaderId })] : [];
        if (isExpansion(s)) for (const leaderPlayer of s.players) {
          if (full.has(leaderPlayer, 'viscount-hundro-moritani')) setupTasks.push(effects.task({ peekIntrigues: 2 }, { playerId: leaderPlayer.id, sourceCardId: leaderPlayer.leaderId }));
        }
        if (setupTasks.length) {
          s.phase = 'leader-setup'; s.currentPlayerId = setupTasks[0].playerId; s.pending = null;
          effects.start(s, playerById(s, s.currentPlayerId), setupTasks, 'setup');
        } else beginRound(s);
      }
      if (isExpansion(s) && full.has(p, 'princess-yuna-moritani')) p.resources.water = 0;
      if (isExpansion(s) && full.has(p, 'tessia-vernius') && !p.leaderState.snoopers) { p.leaderState.snoopers = [...FACTIONS]; p.leaderState.returnedSnoopers = 0; }
      break;
    }
    case 'agent': agent(s, p, a); break;
    case 'endAgent':
      demand(isFull(s) && ['agent-choice', 'agent-end'].includes(s.phase) && ['deploy', 'agent-end'].includes(s.pending?.stage), 'WRONG_PHASE', '当前不能结束特工回合。');
      advanceTurns(s, p.id); break;
    case 'useMasterstroke':
      demand(isFull(s) && full.ownTurn(s, p) && !s.effectContext && full.has(p, 'baron-vladimir-harkonnen') &&
        !p.leaderState.masterstrokeUsed && s.turn.deployed >= 4, 'LEADER_REQUIREMENTS', '当前不能使用男爵的秘密势力技能。');
      effects.start(s, p, [effects.task({ masterstroke: true }, { sourceCardId: p.leaderId })], 'resume'); break;
    case 'reveal': reveal(s, p); break;
    case 'resolveReveal': {
      demand(isBase(s) && s.phase === 'reveal', 'WRONG_PHASE', '当前不能结算展示效果。');
      const index = p.unresolvedReveal.findIndex(c => c.uid === a.cardUid);
      demand(index >= 0, 'CARD_UNAVAILABLE', '这张卡没有待结算的展示效果。');
      const [c] = p.unresolvedReveal.splice(index, 1);
      effects.start(s, p, [effects.task(CARDS[c.cardId].reveal, { sourceUid: c.uid, sourceCardId: c.cardId })], 'resume', { revealUid: c.uid });
      break;
    }
    case 'chooseEffect': demand(isBase(s), 'WRONG_PHASE', '旧规则不使用此命令。'); effects.choose(s, p, a.option); break;
    case 'buy': buy(s, p, a); break;
    case 'endReveal':
      demand(s.phase === 'reveal', 'WRONG_PHASE', '当前不在展示阶段。');
      demand(!isBase(s) || p.unresolvedReveal.length === 0, 'UNRESOLVED_REVEAL', '请先结算所有展示效果。');
      if (isBase(s)) s.intrigueDiscard.push(...p.activeIntrigues.splice(0));
      if (isFull(s)) s.removedMarket.push(...p.setAsideMarket.splice(0));
      p.discard.push(...p.inPlay.splice(0)); p.persuasion = 0; advanceTurns(s, p.id); break;
    case 'chooseTrash':
      demand(s.phase === 'agent-choice' && s.pending.stage === 'trash', 'WRONG_PHASE', '当前没有销毁卡牌选择。');
      demand(a.cardUid === null || typeof a.cardUid === 'string', 'INVALID_ACTION', 'cardUid 必须是卡牌实例 ID 或 null。');
      if (a.cardUid !== null) { demand(trash(s, p, a.cardUid), 'CARD_UNAVAILABLE', '只能销毁手牌、弃牌或已打出的卡。'); draw(s, p, 2); }
      finishAgentEffects(s, p); break;
    case 'deploy':
      demand((s.phase === 'agent-choice' && s.pending.stage === 'deploy') || (isFull(s) && s.phase === 'agent-end' &&
        (spaceAt(s, s.pending.spaceId).combat || (isExpansion(s) && s.turn.combatAccess))), 'WRONG_PHASE', '当前没有部署部队选择。');
      demand(a.dreadnoughts === undefined || (isExpansion(s) && !!p.ix && Number.isInteger(a.dreadnoughts) && a.dreadnoughts >= 0), 'INVALID_DEPLOYMENT', '无畏舰数量无效或本局未启用 Ix。');
      demand(Number.isInteger(a.count) && a.count >= 0 && a.count <= (isFull(s) ? full.maxDeploy(s, p) : s.pending.maxDeploy), 'INVALID_DEPLOYMENT', '部署数量超过本回合上限。');
      if (isFull(s)) {
        if (isExpansion(s) && p.ix) expansionState.deployUnits(s, p, a.count, a.dreadnoughts || 0, { board: true });
        else full.deploy(s, p, a.count, true);
        const mastery = full.masterstrokeEffect(s, p);
        const extraTasks = isExpansion(s) ? extensions.afterEffect(s, p) : [];
        if (mastery) extraTasks.push(effects.task(mastery, { sourceCardId: p.leaderId }));
        if (extraTasks.length) effects.start(s, p, extraTasks, 'agentEnd');
        else agentEnd(s, p);
      } else {
        p.troops.garrison -= a.count; p.troops.conflict += a.count;
        addLog(s, 'troops-deployed', { playerId: p.id, count: a.count }); advanceTurns(s, p.id);
      }
      break;
    case 'defend':
      demand(s.phase === 'round-start' && s.pending.stage === 'defend' && typeof a.deploy === 'boolean', 'WRONG_PHASE', '当前没有防守奖励选择。');
      if (a.deploy) { p.troops.supply--; p.troops.conflict++; }
      s.pending = null; s.phase = 'player-turns'; s.currentPlayerId = s.players[s.firstPlayerIndex].id;
      if (isFull(s)) full.openTurn(s, playerById(s, s.currentPlayerId));
      break;
    case 'playIntrigue': {
      const i = p.intrigues.findIndex(c => c.uid === a.cardUid), c = p.intrigues[i];
      demand(c, 'CARD_UNAVAILABLE', '没有这张阴谋牌。');
      const card = INTRIGUES[c.cardId];
      const timing = intrigueTiming(s, p);
      demand((Array.isArray(card.timing) ? card.timing : [card.timing]).includes(timing), 'WRONG_TIMING', '这张阴谋牌不能在当前时机使用。');
      demand(!isBase(s) || effects.playable(s, p, card), 'INTRIGUE_REQUIREMENTS', '不满足阴谋牌的费用或使用条件。');
      if (isFull(s) && s.turn?.playerId === p.id) s.turn.atStart = false;
      p.intrigues.splice(i, 1);
      // Delayed reveal bonuses stay face up until cleanup, outside the reshuffle pile.
      const delayed = isBase(s) && (card.effect.roundPersuasion || card.effect.acquireTopdeck ||
        (timing === 'plot' && card.effect.timed?.plot?.roundPersuasion));
      (delayed ? p.activeIntrigues : isFull(s) ? p.resolvingIntrigues : s.intrigueDiscard).push(c);
      if (timing === 'combat') s.combatPasses = 0;
      if (isExpansion(s) && timing === 'combat') (s.combatIntrigues ||= []).push(p.id);
      addLog(s, 'intrigue-played', { playerId: p.id, card: c });
      if (isBase(s)) effects.start(s, p, [effects.task(card.effect, { sourceUid: c.uid, sourceCardId: c.cardId })],
        isFull(s) && card.effect.bindu ? 'bindu' : 'intrigue', { interrupt: isFull(s) && !!s.effectContext, intrigueUid: isFull(s) ? c.uid : undefined });
      else applyEffect(s, p, card.effect);
      break;
    }
    case 'passCombatWin':
      demand(isFull(s) && s.phase === 'combat-win' && s.combatWinnerId === p.id, 'WRONG_PHASE', '当前没有获胜阴谋窗口。');
      if (isExpansion(s)) {
        const tasks = extensions.victoryTasks(s, p);
        if (tasks.length) { effects.start(s, p, tasks, 'finishCombat'); break; }
      }
      finishCombat(s); break;
    case 'passCombat': {
      demand(s.phase === 'combat', 'WRONG_PHASE', '当前不在战斗阶段。');
      s.combatPasses++;
      if (s.combatPasses >= s.players.filter(hasCombatUnits).length) resolveCombat(s);
      else s.currentPlayerId = turnAfter(s, s.players.findIndex(x => x.id === p.id), hasCombatUnits);
      break;
    }
    case 'passCombatEnd':
      demand(isExpansion(s) && s.phase === 'combat-end' && s.combatEndPending?.[0] === p.id, 'WRONG_PHASE', '当前没有战后阴谋窗口。');
      s.combatEndPending.shift();
      if (s.combatEndPending.length) s.currentPlayerId = s.combatEndPending[0];
      else { delete s.combatEndPending; finishCombat(s); }
      break;
    case 'passEndgame':
      demand(s.phase === 'endgame', 'WRONG_PHASE', '当前不在终局阶段。');
      s.endgamePassed.push(p.id);
      if (s.endgamePassed.length === s.players.length) finalScore(s);
      else s.currentPlayerId = turnAfter(s, s.players.findIndex(x => x.id === p.id), x => !s.endgamePassed.includes(x.id));
      break;
    default: fail('INVALID_ACTION', '未知命令。');
  }
  if (isExpansion(s)) expansionState.assertConservation(s);
  return s;
}
function getLegalActions(s, playerId) {
  if (!s || s.phase === 'finished') return [];
  const p = playerById(s, playerId);
  if (!p) return [];
  if (s.currentPlayerId !== playerId) return isExpansion(s) ? extensions.extraActions(s, p) : [];
  const actions = [];
  if (s.phase === 'leader-selection') return (isExpansion(s) ? s.allowedLeaders : Object.keys(LEADERS).filter(id => !LEADERS[id].expansion))
    .filter(id => !s.players.some(p => p.leaderId === id)).map(leaderId => ({ type: 'chooseLeader', leaderId }));
  const timing = intrigueTiming(s, p);
  const leaderActions = isFull(s) && full.ownTurn(s, p) && !s.effectContext && full.has(p, 'baron-vladimir-harkonnen') &&
    !p.leaderState.masterstrokeUsed && s.turn.deployed >= 4 ? [{ type: 'useMasterstroke' }] : [];
  const intrigues = p.intrigues.filter(c => {
    const card = INTRIGUES[c.cardId];
    return (Array.isArray(card.timing) ? card.timing : [card.timing]).includes(timing) && (!isBase(s) || effects.playable(s, p, card));
  }).map(c => ({ type: 'playIntrigue', cardUid: c.uid }));
  const expansionActions = isExpansion(s) ? extensions.extraActions(s, p) : [];
  if (s.phase === 'effect-choice') return [...s.pending.options.map((_, option) => ({ type: 'chooseEffect', option })), ...intrigues, ...expansionActions];
  if (s.phase === 'round-start') return [{ type: 'defend', deploy: false }, { type: 'defend', deploy: true }];
  if (isExpansion(s) && s.phase === 'player-turns') return [...extensions.agentActions(s, p), ...intrigues, ...leaderActions, ...expansionActions];
  if (isExpansion(s) && p.ix && ['agent-choice', 'agent-end'].includes(s.phase) && ['deploy', 'agent-end'].includes(s.pending?.stage)) {
    return [{ type: 'endAgent' }, ...((spaceAt(s, s.pending.spaceId).combat || s.turn.combatAccess) ? expansionState.deploymentOptions(s, p, { board: true })
      .map(o => ({ type: 'deploy', count: o.troops, dreadnoughts: o.dreadnoughts })) : []), ...intrigues, ...leaderActions, ...expansionActions];
  }
  if (s.phase === 'agent-choice') {
    if (s.pending.stage === 'trash') return [{ type: 'chooseTrash', cardUid: null }, ...[...p.hand, ...p.discard, ...p.inPlay].map(c => ({ type: 'chooseTrash', cardUid: c.uid }))];
    return [...Array.from({ length: s.pending.maxDeploy + 1 }, (_, count) => ({ type: 'deploy', count })),
      ...(isFull(s) ? [{ type: 'endAgent' }] : []), ...leaderActions, ...intrigues, ...expansionActions];
  }
  if (s.phase === 'agent-end') return [{ type: 'endAgent' },
    ...((spaceAt(s, s.pending.spaceId).combat || (isExpansion(s) && s.turn.combatAccess)) ? Array.from({ length: full.maxDeploy(s, p) }, (_, n) => ({ type: 'deploy', count: n + 1 })) : []), ...leaderActions, ...intrigues, ...expansionActions];
  if (s.phase === 'player-turns') {
    actions.push({ type: 'reveal' });
    for (const c of p.hand) for (const space of SPACES) {
      for (const spice of space.id === 'sell-melange' ? [2, 3, 4, 5] : [undefined]) {
        const tokens = isFull(s) ? CARDS[c.cardId].moveAgent ? full.tokens(s, p) : full.available(s, p).slice(0, 1) : [undefined];
        for (const agentUid of tokens) {
          if (placementError(s, p, c, space, spice, agentUid)) continue;
          const a = { type: 'agent', cardUid: c.uid, spaceId: space.id, ...(isFull(s) ? { agentUid } : {}) };
          if (spice !== undefined) a.spice = spice;
          const variants = [a];
          if (isBase(s)) for (const effectOrder of EFFECT_ORDERS.slice(1)) variants.push({ ...a, effectOrder });
          else if (space.id === 'selective-breeding') variants.push({ ...a, effectOrder: 'space-first' });
          for (const variant of variants) {
            actions.push(variant);
            if (isFull(s) && full.has(p, 'count-ilban-richese') && full.costs(s, p, space, spice).solari > 0) {
              for (const leaderEffectAt of [1, 2, 3]) actions.push({ ...variant, leaderEffectAt });
            }
          }
        }
      }
    }
  }
  if (s.phase === 'reveal') {
    if (isBase(s)) for (const c of p.unresolvedReveal) actions.push({ type: 'resolveReveal', cardUid: c.uid });
    if (!isBase(s) || !p.unresolvedReveal.length) actions.push({ type: 'endReveal' });
    const purchases = [];
    for (const c of s.market) if (p.persuasion >= purchaseCost(s, p, CARDS[c.cardId], 'market')) purchases.push({ type: 'buy', source: 'market', cardUid: c.uid });
    for (const id of ['arrakis-liaison', 'the-spice-must-flow']) if (s.reserve[id] > 0 && p.persuasion >= purchaseCost(s, p, CARDS[id], 'reserve')) purchases.push({ type: 'buy', source: 'reserve', cardId: id });
    if (isFull(s)) for (const c of p.setAsideMarket) if (p.persuasion >= purchaseCost(s, p, CARDS[c.cardId], 'set-aside')) purchases.push({ type: 'buy', source: 'set-aside', cardUid: c.uid });
    for (const action of purchases) {
      actions.push(action);
      if (isBase(s) && p.acquireTopdeck) actions.push({ ...action, destination: 'deck' });
    }
  }
  if (s.phase === 'combat') actions.push({ type: 'passCombat' });
  if (s.phase === 'combat-win') actions.push({ type: 'passCombatWin' });
  if (s.phase === 'combat-end') actions.push({ type: 'passCombatEnd' });
  if (s.phase === 'endgame') actions.push({ type: 'passEndgame' });
  actions.push(...intrigues);
  actions.push(...leaderActions);
  actions.push(...expansionActions);
  return actions;
}
function getAgentPlacements(s, viewerId) {
  const p = playerById(s, viewerId);
  if (!p || s.currentPlayerId !== viewerId || s.phase !== 'player-turns') return [];
  const inputs = isExpansion(s) ? [...p.hand.map(c => ({ cardUid: c.uid })), ...extensions.selections(s, p).filter(a => a.cardUids || a.graftMarketUid)] : p.hand.map(c => ({ cardUid: c.uid }));
  return inputs.map(input => {
    let selected, selectionReason;
    try { selected = isExpansion(s) ? extensions.selection(s, p, input) : p.hand.find(c => c.uid === input.cardUid); }
    catch (error) { selectionReason = error.message; }
    return { ...input, spaces: spacesFor(s).flatMap(space => (space.id === 'sell-melange' ? [2, 3, 4, 5] : [undefined]).map(spice => {
      const moving = selected?.definition?.moveAgent || CARDS[selected?.cardId]?.moveAgent;
      const tokens = isFull(s) ? moving ? full.tokens(s, p) : full.available(s, p) : [undefined];
      const reasons = selectionReason ? [selectionReason] : !tokens.length ? ['没有可用特工。'] : tokens.map(agentUid => placementError(s, p, selected, space, spice, agentUid));
      const valid = reasons.some(reason => !reason);
      return { spaceId: space.id, ...(spice !== undefined ? { spice } : {}), legal: valid, reason: valid ? null : reasons[0],
        costs: isFull(s) ? full.costs(s, p, space, spice, selected) : space.id === 'sell-melange' ? { spice } : space.cost,
        agentUids: isFull(s) && !selectionReason ? tokens.filter((uid, n) => !reasons[n]) : [] };
    })) };
  });
}
function getView(s, viewerId) {
  const view = {
    schemaVersion: s.schemaVersion, gameId: s.gameId, ruleset: s.ruleset, phase: s.phase, round: s.round,
    options: s.options || { expansions: [] },
    firstPlayerId: s.players[s.firstPlayerIndex].id, currentPlayerId: s.currentPlayerId,
    players: s.players.map(p => ({
      id: p.id, name: p.name, vp: p.vp, resources: p.resources, troops: p.troops, influence: p.influence,
      highCouncil: p.highCouncil, swordmaster: p.swordmaster, agentsAvailable: p.agentsAvailable,
      revealed: p.revealed, lastRevealSequence: p.lastRevealSequence, persuasion: p.persuasion, swords: p.swords + extensions.extraSwords(s, p), strength: strength(s, p),
      handCount: p.hand.length, deckCount: p.deck.length, intrigueCount: p.intrigues.length,
      discard: p.discard, inPlay: p.inPlay,
      ...(isBase(s) ? { activeIntrigues: p.activeIntrigues, unresolvedReveal: p.unresolvedReveal,
        roundPersuasion: p.roundPersuasion, spiceMustFlowDiscount: p.spiceMustFlowDiscount,
        acquireTopdeck: p.acquireTopdeck, nextAgentFactions: p.nextAgentFactions } : {}),
      ...(isFull(s) ? { leaderId: p.leaderId, leaderState: full.publicLeaderState(p, viewerId),
        setAsideMarket: p.setAsideMarket, resolvingIntrigues: p.resolvingIntrigues, infiltrate: p.infiltrate,
        ...(p.id === viewerId && full.has(p, 'paul-atreides') ? { deckTop: p.deck.at(-1) || null } : {}),
      } : {}),
      ...(isExpansion(s) ? { graftedCards: p.graftedCards || [], chairdogReturns: p.chairdogReturns || [],
        extraTurns: p.extraTurns || 0, lostTroopsThisCombat: p.lostTroopsThisCombat || 0 } : {}),
      ...(p.id === viewerId ? { hand: p.hand, intrigues: p.intrigues } : {}),
    })),
    alliances: s.alliances, controls: s.controls, bonusSpice: s.bonusSpice, reserve: s.reserve,
    market: s.market, marketDeckCount: s.marketDeck.length, intrigueDeckCount: s.intrigueDeck.length,
    intrigueDiscard: s.intrigueDiscard, trashed: s.trashed, conflict: s.conflict,
    conflictsRemaining: s.conflictDeck.length, occupied: s.occupied, mentatOwner: s.mentatOwner,
    ...(isFull(s) ? { agentPositions: s.agentPositions, voiceBlocks: s.voiceBlocks,
      turn: s.turn ? { playerId: s.turn.playerId, kind: s.turn.kind, atStart: s.turn.atStart,
        recruited: s.turn.recruited, deployed: s.turn.deployed } : null,
      combatWinnerId: s.combatWinnerId || null, removedMarket: s.removedMarket,
      ...(playerById(s, viewerId) ? { effectiveSpaceCosts: Object.fromEntries(spacesFor(s).filter(x => x.id !== 'sell-melange').map(space => [space.id, full.costs(s, playerById(s, viewerId), space)])) } : {}),
    } : {}),
    spaces: spacesFor(s),
    ...(isExpansion(s) ? { expansionState: expansionState.publicState(s), trashedIntrigues: s.trashedIntrigues || [] } : {}),
    agentPlacements: getAgentPlacements(s, viewerId),
    pending: s.pending ? { stage: s.pending.stage, playerId: s.pending.playerId,
      ...(s.pending.spaceId ? { spaceId: s.pending.spaceId } : {}),
      ...(s.pending.sourceCardId ? { sourceCardId: s.pending.sourceCardId } : {}),
      ...(s.pending.stage === 'effect' && s.pending.playerId === viewerId ? {
        options: s.pending.options.map((o, option) => ({ option, label: o.label,
          // Public presentation metadata only; commands still submit the option index.
          ...(o.effect?.researchStep ? { ui: { kind: 'research', target: o.effect.researchStep.target } } : {}),
          ...(o.effect?.moveShipping ? { ui: { kind: 'shipping', movement: o.effect.moveShipping } } : {}),
          ...(o.effect?.shippingReward ? { ui: { kind: 'shipping-reward', ...o.effect.shippingReward } } : {}),
          ...(o.effect?.purchaseTech ? { ui: { kind: 'tech', techId: o.effect.purchaseTech.techId,
            cost: o.effect.purchaseTech.cost, currency: o.effect.purchaseTech.currency,
            negotiators: o.effect.purchaseTech.negotiators } } : {}),
          ...(o.cardId ? { cardId: o.cardId } : {}), ...(o.cardUid ? { cardUid: o.cardUid } : {}),
          ...(o.spaceId ? { spaceId: o.spaceId } : {}), ...(o.agentUid ? { agentUid: o.agentUid } : {}),
          ...(o.targetPlayerId ? { targetPlayerId: o.targetPlayerId } : {}),
        })),
      } : {}),
    } : null,
    combatPasses: s.combatPasses, lastCombat: s.lastCombat, result: s.result,
    events: s.events, legalActions: getLegalActions(s, viewerId),
  };
  return clone(view);
}
function getCatalog() {
  const referenceCards = Object.fromEntries(REFERENCE.entries.map(c => [c.id, {
    id: c.id, englishName: c.englishName, category: c.category, copies: c.copies,
    sourceUrl: c.sourceUrl, implementation: (CARDS[c.id] || INTRIGUES[c.id] || LEADERS[c.id] || BASE_CONFLICTS.find(x => x.id === c.id)) ? 'playable' : 'catalog-only',
    ...(PENDING_CONTENT[c.id] ? { pendingReason: PENDING_CONTENT[c.id] } :
      c.category === 'location' ? { pendingReason: '行动格参考图片；规则由 catalog.spaces 提供。' } : {}),
  }]));
  return clone({ manifest, factions: FACTIONS, cards: CARDS, intrigues: INTRIGUES, spaces: SPACES,
    influenceBonuses: INFLUENCE_BONUS, starterCards: STARTER, reserveCounts: RESERVE,
    developmentConflicts: developmentConflicts(), actionTypes: Object.keys(ACTION_FIELDS),
    conflicts: BASE_CONFLICTS, leaders: LEADERS, effectOrders: EFFECT_ORDERS,
    playableDecks: { ruleset: manifest.ruleset, market: BASE_MARKET, intrigue: BASE_INTRIGUE_DECK },
    referenceCatalog: { edition: REFERENCE.edition, revision: REFERENCE.revision, cards: referenceCards },
    expansions: expansionData.catalog(require('./data')),
    phases: ['leader-selection', 'leader-setup', 'round-start', 'player-turns', 'agent-choice', 'agent-end', 'effect-choice', 'reveal', 'combat', 'combat-rewards', 'combat-win', 'combat-end', 'endgame', 'finished'] });
}
// Do not expose the internal allowUnavailable argument at the room boundary.
const validateOptions = options => expansionData.normalizeOptions(options);
const rulesetForOptions = options => validateOptions(options).expansions.length ? 'expansions-dev-v4' : manifest.ruleset;
module.exports = { manifest, validateOptions, rulesetForOptions, createGame, applyAction, getView, getLegalActions, getCatalog };
