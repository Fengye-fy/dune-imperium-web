'use strict';
const crypto = require('node:crypto');
const X = require('./expansion-state');
const XD = require('./expansion-data');
const clone = value => JSON.parse(JSON.stringify(value));
const active = s => s.ruleset === 'expansions-dev-v4';
const permutations = values => values.length ? values.flatMap((v, i) => permutations(values.filter((_, n) => n !== i)).map(rest => [v, ...rest])) : [[]];
module.exports = function runtime({ CARDS, INTRIGUES, FACTIONS, full, getEffects, demand, addLog, draw, drawIntrigue,
  trash, applyEffect, gainInfluence, playerById, spacesFor, placementError, acquisitionCandidates, takeAcquisition, shuffle }) {
  const fx = () => getEffects();
  const t = (effect, source = {}) => ({ effect, ...source });
  const skip = () => ({ label: '跳过', effect: {} });
  const options = effects => effects.map((effect, i) => ({ label: `选择 ${i + 1}`, effect }));
  const phase = (s, p) => ['combat', 'combat-win', 'endgame'].includes(s.effectContext?.phase || s.phase) ? s.effectContext?.phase || s.phase : 'plot';
  const has = (p, id) => p.leaderId === 'leader-' + id;
  const cardsInPair = (s, p) => s.turn?.playerId === p.id ? s.turn.agentCards || [] : [];
  const otherCard = (s, p, sourceUid) => cardsInPair(s, p).find(c => c.uid !== sourceUid);
  const tags = (s, p, c) => (CARDS[c.cardId]?.graftFactions && p.graftedCards?.includes(c.uid)) ?
    CARDS[c.cardId].graftFactions : CARDS[c.cardId]?.factions || [];
  const sentFaction = s => spacesFor(s).find(x => x.id === s.turn?.spaceId)?.faction;
  function condition(s, p, rule, uid) {
    switch (rule.kind) {
      case 'genetic': return X.geneticMarker(p) >= rule.amount;
      case 'grafted': return p.graftedCards?.includes(uid) === true;
      case 'grafted-faction': { const other = otherCard(s, p, uid); return Boolean(other && tags(s, p, other).some(f => rule.factions.includes(f))); }
      case 'sent-faction': return Boolean(sentFaction(s));
      case 'enemy-occupied': return s.turn?.enemyOccupied === true;
      case 'tech-count': return (p.ix?.tech.length || 0) >= rule.amount;
      case 'agent-at-faction': return s.agentPositions.some(a => a.playerId === p.id && spacesFor(s).find(x => x.id === a.spaceId)?.faction === rule.faction);
      case 'deployed-units': return s.turn?.playerId === p.id && (s.turn.deployedUnits || s.turn.deployed) >= rule.amount;
      case 'hand-count': return p.hand.length >= rule.amount;
      case 'resource': return p.resources[rule.resource] >= rule.amount;
      case 'any-influence': return FACTIONS.some(f => p.influence[f] > 0);
      case 'opponent-combat-intrigue': return (s.combatIntrigues || []).some(id => id !== p.id);
      case 'strongarm': return Boolean(sentFaction(s) && s.turn?.playerId === p.id && p.troops.garrison + p.troops.conflict > 0);
      case 'combat-losses': return (p.lostTroopsThisCombat || 0) >= rule.amount;
      default: return false;
    }
  }
  function extraPlayable(s, p, card) {
    if (!active(s)) return true;
    const e = card.effect, currentPhase = phase(s, p), timed = e.timed?.[currentPhase];
    if (timed?.cost && !Object.entries(timed.cost).every(([k, n]) => p.resources[k] >= n)) return false;
    let required = timed;
    while (required?.condition) {
      if (!fx().condition(s, p, required.condition)) return false;
      required = required.then;
    }
    if (timed?.retreatTroopsFor && p.troops.conflict < timed.retreatTroopsFor.count) return false;
    if (card.id === 'intrigue-imm-disguised-bureaucrat' && X.geneticMarker(p) < 1) return false;
    if (card.id === 'intrigue-ix-secret-forces' && !p.highCouncil) return false;
    if (card.id === 'intrigue-ix-finesse' && currentPhase === 'plot' && !FACTIONS.some(f => p.influence[f] > 0)) return false;
    return true;
  }
  function costOptions(p, count, fromConflictOnly = false, retreat = false, reward = {}) {
    const result = [];
    for (let conflict = 0; conflict <= count; conflict++) {
      const garrison = count - conflict;
      if (conflict > p.troops.conflict || garrison > p.troops.garrison || (fromConflictOnly && garrison)) continue;
      result.push({ label: `${retreat ? '撤回' : '失去'}参战兵 ${conflict}、驻军 ${garrison}`, effect: { payTroops: { conflict, garrison, retreat, reward } } });
    }
    return result;
  }
  function optionsFor(s, p, e, context, source) {
    if (!active(s)) return null;
    const uid = source?.sourceUid, other = otherCard(s, p, uid);
    if (e.reserve && X.hasTech(p, 'tech-spaceport') && s.reserve[e.reserve] > 0) return ['discard', 'deck'].map(destination => ({
      label: `获取 ${CARDS[e.reserve].name} → ${destination}`, cardId: e.reserve, effect: { reserveAcquire: { cardId: e.reserve, destination } },
    }));
    if (e.orderAgentTasks) return permutations(e.orderAgentTasks).map(order => ({
      label: order.map(task => task.label).join(' → '), effect: { orderedTasks: order.map(({ label, ...task }) => task) },
    }));
    if (e.research) return X.researchOptions(s, p).map(o => ({ label: o.target === 'draw' ? '研究终点：抽 1 张牌' : `研究至 ${o.target}`,
      effect: { researchStep: { target: o.target, remaining: e.research - 1 } } }));
    if (e.commissionDreadnought) return [skip(), ...(p.ix.dreadnoughts.supply ? [{ label: '建造一艘无畏舰', effect: { commissionShip: 1 } }] : [])];
    if (e.shipping) return X.shippingOptions(s, p).map(o => ({ label: o.movement === 'advance' ? '运输推进一格' : '召回运输并领取累计奖励', effect: { moveShipping: o.movement } }));
    if (e.chooseShippingReward) return p.ix.recallRewards.flatMap(level => level === 1 ? ['solari', 'spice'].map(choice => ({
      label: choice === 'solari' ? '第 1 级：5 索拉里，对手各 1' : '第 1 级：2 香料', effect: { shippingReward: { level, choice } },
    })) : [{ label: level === 2 ? '第 2 级：征兵并提升任一影响力' : '第 3 级：以 2 香料折扣获取科技', effect: { shippingReward: { level } } }]);
    if (e.acquireTech) {
      if (!e.acquireTech.grantId) e.acquireTech.grantId = X.grantTechAcquisition(s, p, e.acquireTech);
      const grantId = e.acquireTech.grantId;
      return [{ label: '不获取科技', effect: { passTechGrant: grantId } }, ...X.techPurchaseOptions(s, p, grantId).map(o => ({
        label: `${XD.TECH[o.techId].name}：${o.cost} ${o.currency}，返还 ${o.negotiators} 谈判员`, cardId: o.techId,
        effect: { purchaseTech: { grantId, ...o } },
      }))];
    }
    if (e.discardFor) {
      const d = e.discardFor;
      const selected = (d.selected || []).filter(uid => p.hand.some(c => c.uid === uid));
      const choices = d.count > p.hand.length ? [] : p.hand.filter(c => !selected.includes(c.uid)).map(c => {
        const uids = [...selected, c.uid];
        return { label: `弃掉 ${CARDS[c.cardId].name}（${uids.length}/${d.count}）`, cardId: c.cardId, cardUid: c.uid,
          effect: uids.length === d.count ? { payDiscard: { uids, reward: d.reward } } : { discardFor: { ...d, selected: uids, optional: false } } };
      });
      return d.optional ? [skip(), ...choices] : choices;
    }
    if (e.influenceExcept) return FACTIONS.filter(f => f !== e.influenceExcept).map(f => ({ label: `${f} 影响力 +1`, effect: { influence: { [f]: 1 } } }));
    if (e.loseInfluenceForVP || e.loseInfluenceForSwords || e.shiftOneInfluence || e.hundroRing) {
      const n = e.loseInfluenceForVP || 1, choices = [];
      for (const f of FACTIONS.filter(f => p.influence[f] >= n)) {
        const reward = e.loseInfluenceForVP ? { vp: 1 } : e.loseInfluenceForSwords ? { swords: e.loseInfluenceForSwords } : e.hundroRing ? { shipping: 1 } : { chooseInfluence: { amount: 1 } };
        choices.push({ label: `${f} 影响力 -${n}`, effect: { steps: [{ influence: { [f]: -n } }, reward] } });
      }
      return e.loseInfluenceForVP || e.hundroRing ? [skip(), ...choices] : choices;
    }
    if (e.loseTroopsFor || e.retreatTroopsFor) {
      const d = e.loseTroopsFor || e.retreatTroopsFor;
      const choices = costOptions(p, d.count, Boolean(e.retreatTroopsFor), Boolean(e.retreatTroopsFor), d.reward);
      return d.optional === false ? choices : [skip(), ...choices];
    }
    if (e.retreatUnitsFor) {
      const d = e.retreatUnitsFor, choices = [skip()];
      for (let troops = 0; troops <= d.count; troops++) {
        const ships = d.count - troops;
        if (troops <= p.troops.conflict && ships <= p.ix.dreadnoughts.conflict) choices.push({ label: `撤回 ${troops} 兵、${ships} 舰`,
          effect: { retreatUnits: { troops, dreadnoughts: ships }, afterUnits: d.reward } });
      }
      return choices;
    }
    if (e.deployUnitsChoice !== undefined) return X.deploymentOptions(s, p, { limit: e.deployUnitsChoice }).map(o => ({ label: `部署 ${o.troops} 兵、${o.dreadnoughts} 舰`, effect: { deployUnits: o } }));
    if (e.occupationChoice) return X.occupationOptions(s, p).map(o => ({ label: o.detonate ? '引爆无畏舰：获得 1 胜利点' : `舰队控制 ${o.spaceId}`, spaceId: o.spaceId, effect: { occupy: o } }));
    if (e.acquireUpTo !== undefined) {
      const result = [skip()];
      for (const candidate of acquisitionCandidates(s, p).filter(c => CARDS[c.cardId].cost <= e.acquireUpTo)) {
        const destinations = X.geneticMarker(p) >= 2 && e.geneticDestination ? ['hand'] :
          X.hasTech(p, 'tech-spaceport') || (context.logicalPhase === 'reveal' && p.acquireTopdeck) ? ['discard', 'deck'] : ['discard'];
        for (const destination of destinations) result.push({ label: `获取 ${CARDS[candidate.cardId].name} → ${destination}`, cardId: candidate.cardId,
          effect: { acquireCard: { ...candidate, destination } } });
      }
      return result;
    }
    if (e.trashOtherGraftFor || e.trashGraftForInfluence) {
      const candidates = (e.trashOtherGraftFor ? [other] : cardsInPair(s, p)).filter(c => c &&
        [...p.inPlay, ...p.hand, ...p.discard, ...p.deck, ...s.market, ...s.removedMarket, ...p.setAsideMarket].some(x => x.uid === c.uid));
      return [skip(), ...candidates.map(c => ({ label: `销毁 ${CARDS[c.cardId].name}`, cardId: c.cardId, cardUid: c.uid,
        effect: { trashGraftedUid: c.uid, graftTrashReward: e.trashOtherGraftFor || { influence: { [sentFaction(s)]: 1 } } } }))];
    }
    if (e.chooseTwo) return e.chooseTwo.flatMap((first, i) => e.chooseTwo.slice(i + 1).map((second, j) => ({
      label: `选项 ${i + 1} 与 ${i + j + 2}`, effect: { chooseTwoOrder: [first, second] },
    })));
    if (e.chooseTwoOrder) return [e.chooseTwoOrder, [...e.chooseTwoOrder].reverse()].map((steps, i) => ({ label: i ? '先执行第二项' : '先执行第一项', effect: { steps } }));
    if (e.peekIntrigues) {
      if (!e.peeked) {
        e.peeked = [];
        for (let n = 0; n < e.peekIntrigues; n++) {
          if (!s.intrigueDeck.length) s.intrigueDeck = shuffle(s.intrigueDiscard.splice(0));
          if (s.intrigueDeck.length) e.peeked.push(s.intrigueDeck.pop());
        }
      }
      return e.peeked.map(c => ({ label: `保留阴谋 ${INTRIGUES[c.cardId].name}`, cardId: c.cardId, cardUid: c.uid, effect: { keepPeekedIntrigue: { selected: c.uid, cards: e.peeked } } }));
    }
    if (e.cycleIntrigueChoice) return [skip(), ...p.intrigues.map(c => ({ label: `将 ${INTRIGUES[c.cardId].name} 放至牌底并抽 1 阴谋`, cardId: c.cardId, cardUid: c.uid, effect: { cycleIntrigueUid: c.uid } }))];
    if (e.trashIntrigueFor) return [skip(), ...p.intrigues.map(c => ({ label: `销毁 ${INTRIGUES[c.cardId].name}`, cardId: c.cardId, cardUid: c.uid,
      effect: { trashIntrigueUid: c.uid, intrigueTrashReward: e.trashIntrigueFor } }))];
    if (e.tessiaRing) return (p.leaderState.snoopers || []).map(f => ({ label: `${f} 影响力 +1`, effect: { influence: { [f]: 1 } } }));
    if (e.ilesaSetAside) return p.hand.map(c => ({ label: `秘密留置 ${CARDS[c.cardId].name}`, cardId: c.cardId, cardUid: c.uid, effect: { ilesaSetAsideUid: c.uid } }));
    if (e.enemyRetreatChoice) return [skip(), ...s.players.filter(o => o.id !== p.id).flatMap(o => [
      ...(o.troops.conflict ? [{ label: `撤回 ${o.name} 的 1 普通兵`, targetPlayerId: o.id, effect: { enemyRetreat: { playerId: o.id, troop: true } } }] : []),
      ...(o.ix?.dreadnoughts.conflict ? [{ label: `撤回 ${o.name} 的 1 无畏舰`, targetPlayerId: o.id, effect: { enemyRetreat: { playerId: o.id, troop: false } } }] : []),
    ])];
    if (e.acquireTleilaxuChoice) return [skip(), ...tleilaxuActions(s, p, true).map(a => ({ label: `获取 ${a.cardId || '特莱拉牌'} → ${a.destination || 'discard'} ${a.reclaimedChoice || ''}`,
      cardId: a.cardId, cardUid: a.cardUid, effect: { takeTleilaxu: a } }))];
    if (e.sonicSelection) {
      const chosen = e.sonicSelection;
      return [{ label: `完成：更换 ${chosen.length} 张阴谋并销毁科技`, effect: { useTechnology: { techId: 'tech-sonic-snoopers', intrigueUids: chosen } } },
        ...p.intrigues.filter(c => !chosen.includes(c.uid)).map(c => ({ label: `选择 ${INTRIGUES[c.cardId].name}`, cardId: c.cardId, cardUid: c.uid, effect: { sonicSelection: [...chosen, c.uid] } }))];
    }
    return null;
  }

  function discardTriggers(s, p, card) {
    return CARDS[card.cardId]?.unload ? [t(CARDS[card.cardId].reveal, { playerId: p.id, sourceUid: card.uid, sourceCardId: card.cardId })] : [];
  }
  function execute(s, p, e, context, source = {}) {
    const tasks = [], uid = source.sourceUid, other = otherCard(s, p, uid);
    if (e.payDiscard) {
      const cards = e.payDiscard.uids.map(id => p.hand.find(c => c.uid === id));
      demand(cards.every(Boolean) && new Set(e.payDiscard.uids).size === cards.length, 'CARD_UNAVAILABLE', '支付费用的手牌已改变。');
      for (const c of cards) { p.hand.splice(p.hand.findIndex(card => card.uid === c.uid), 1); p.discard.push(c); addLog(s, 'card-discarded', { playerId: p.id, card: c }); }
      for (const c of cards) tasks.push(...discardTriggers(s, p, c));
      tasks.push(t(e.payDiscard.reward));
    }
    if (e.reserveAcquire) {
      const { cardId, destination } = e.reserveAcquire;
      demand(s.reserve[cardId] > 0 && ['deck', 'discard'].includes(destination), 'CARD_UNAVAILABLE', '储备牌已不可获取。');
      s.reserve[cardId]--; const c = { uid: crypto.randomUUID(), cardId }; p[destination].push(c);
      tasks.push(t(CARDS[cardId].acquire || {}, { sourceUid: c.uid, sourceCardId: cardId }));
      addLog(s, 'card-acquired', { playerId: p.id, card: c, source: 'reserve' });
    }
    if (e.timed) tasks.push(t(e.timed[phase(s, p)] || {}));
    if (e.orderedTasks) tasks.push(...e.orderedTasks);
    if (e.researchStep) {
      tasks.push(t(X.advanceResearch(s, p, e.researchStep.target)));
      if (e.researchStep.remaining) tasks.push(t({ research: e.researchStep.remaining }));
    }
    if (e.specimens) X.generateSpecimens(s, p, e.specimens);
    if (e.tleilaxu) tasks.push(...X.advanceTleilaxu(s, p, e.tleilaxu).map(effect => t(effect)));
    if (e.negotiators) X.sendNegotiators(s, p, e.negotiators);
    if (e.commissionShip) X.commissionDreadnought(s, p, e.commissionShip);
    if (e.moveShipping) { X.moveShipping(s, p, e.moveShipping); if (p.ix.recallRewards.length) tasks.push(t({ chooseShippingReward: true })); }
    if (e.shippingReward) {
      tasks.push(t(X.shippingReward(s, p, e.shippingReward.level, e.shippingReward.choice)));
      if (p.ix.recallRewards.length) tasks.push(t({ chooseShippingReward: true }));
    }
    if (e.purchaseTech) {
      tasks.push(t(X.acquireTech(s, p, e.purchaseTech), { sourceCardId: e.purchaseTech.techId }));
      if (context.logicalPhase === 'reveal' && typeof XD.TECH[e.purchaseTech.techId].reveal === 'object') tasks.push(t(XD.TECH[e.purchaseTech.techId].reveal, { sourceCardId: e.purchaseTech.techId }));
      if (e.purchaseTech.techId === 'tech-spaceport') p.acquireTopdeck = true;
      addLog(s, 'tech-acquired', { playerId: p.id, techId: e.purchaseTech.techId });
    }
    if (e.passTechGrant) X.passTechAcquisition(s, p, e.passTechGrant);
    if (e.deployUnits) X.deployUnits(s, p, e.deployUnits.troops, e.deployUnits.dreadnoughts);
    if (e.retreatUnits) { X.retreatUnits(s, p, e.retreatUnits.troops, e.retreatUnits.dreadnoughts); if (e.afterUnits) tasks.push(t(e.afterUnits)); }
    if (e.occupy) { tasks.push(t(X.occupyWithDreadnought(s, p, e.occupy))); addLog(s, 'dreadnought-victory', { playerId: p.id, ...e.occupy }); }
    if (e.payTroops) {
      const { conflict, garrison, retreat, reward } = e.payTroops;
      demand(p.troops.conflict >= conflict && p.troops.garrison >= garrison, 'INSUFFICIENT_TROOPS', '支付费用的普通兵已不足。');
      if (retreat) full.retreat(s, p, conflict);
      else { p.troops.conflict -= conflict; p.troops.garrison -= garrison; p.troops.supply += conflict + garrison; }
      tasks.push(t(reward));
    }
    if (e.influenceSentFaction && sentFaction(s)) tasks.push(t({ influence: { [sentFaction(s)]: 1 } }));
    if (e.influenceAtAgents) tasks.push(t({ influence: Object.fromEntries(FACTIONS.filter(f => condition(s, p, { kind: 'agent-at-faction', faction: f })).map(f => [f, 1])) }));
    if (e.trashGraftedUid) {
      demand(trash(s, p, e.trashGraftedUid), 'CARD_UNAVAILABLE', '嫁接目标已不在可销毁区域。');
      tasks.push(t(e.graftTrashReward));
    }
    if (e.copyGraft && other && !CARDS[other.cardId].agent.copyGraft) tasks.push(t(other.cardId === 'signet-ring' ? { leaderRing: true } : CARDS[other.cardId].agent));
    if (e.chairdog && other) (p.chairdogReturns ||= []).push(other.uid);
    if (e.returnSelf) {
      const i = p.inPlay.findIndex(c => c.uid === uid); if (i >= 0) p.hand.push(p.inPlay.splice(i, 1)[0]);
    }
    if (e.recallThisAgent && s.turn?.agentUid && s.agentPositions.some(a => a.agentUid === s.turn.agentUid && a.playerId === p.id)) full.recall(s, p, s.turn.agentUid);
    if (e.solariPerOtherIcon && other) tasks.push(t({ solari: icons(s, p, other, cardsInPair(s, p)).length }));
    if (e.combatAccess && s.turn?.playerId === p.id) s.turn.combatAccess = true;
    if (e.extraTurn) p.extraTurns = (p.extraTurns || 0) + e.extraTurn;
    if (e.onSpiceGainGuild) (s.turn.guildImpersonators ||= []).push(uid);
    if (e.desertAmbush) s.turn.desertAmbushes = (s.turn.desertAmbushes || 0) + 1;
    if (e.enemyRetreat) {
      const opponent = playerById(s, e.enemyRetreat.playerId);
      if (e.enemyRetreat.troop && opponent.troops.conflict) full.retreat(s, opponent, 1);
      else if (!e.enemyRetreat.troop && opponent.ix?.dreadnoughts.conflict) X.retreatUnits(s, opponent, 0, 1);
    }
    if (e.opponentsRetreatDreadnought) for (const opponent of s.players.filter(o => o.id !== p.id && o.ix?.dreadnoughts.conflict)) X.retreatUnits(s, opponent, 0, 1);
    if (e.forceDeployRecruits && source.recruited) full.deploy(s, p, Math.min(source.recruited, p.troops.garrison));
    if (e.swordsPerDreadnought) tasks.push(t({ swords: p.ix.dreadnoughts.conflict * e.swordsPerDreadnought }));
    if (e.bashar) p.basharUid = uid;
    if (e.winSolari) p.winSolari = (p.winSolari || 0) + e.winSolari;
    if (e.takeTleilaxu) {
      const acquired = X.acquireTleilaxu(s, p, e.takeTleilaxu, { granted: true });
      tasks.push(t(acquired.effect, { sourceCardId: acquired.card?.cardId || 'reclaimed-forces', sourceUid: acquired.card?.uid }));
      addLog(s, 'tleilaxu-acquired', { playerId: p.id, card: acquired.card, fixedCard: acquired.card ? null : 'reclaimed-forces' });
    }
    if (e.keepPeekedIntrigue) {
      const { selected, cards } = e.keepPeekedIntrigue, chosen = cards.find(c => c.uid === selected);
      demand(chosen, 'INVALID_CHOICE', '阴谋选择无效。'); p.intrigues.push(chosen);
      s.intrigueDeck.push(...cards.filter(c => c.uid !== selected));
    }
    if (e.cycleIntrigueUid || e.trashIntrigueUid) {
      const id = e.cycleIntrigueUid || e.trashIntrigueUid, i = p.intrigues.findIndex(c => c.uid === id);
      demand(i >= 0, 'CARD_UNAVAILABLE', '没有这张阴谋。'); const [c] = p.intrigues.splice(i, 1);
      if (e.cycleIntrigueUid) { s.intrigueDeck.unshift(c); tasks.push(t({ intrigue: 1 })); }
      else { (s.trashedIntrigues ||= []).push(c); tasks.push(t(e.intrigueTrashReward)); }
    }
    if (e.grandConspiracy) {
      const cards = [...p.deck, ...p.hand, ...p.discard, ...p.inPlay];
      const n = [p.ix.dreadnoughts.supply === 0, cards.some(c => c.cardId === 'the-spice-must-flow'),
        FACTIONS.filter(f => p.influence[f] >= 4).length >= 2, p.highCouncil].filter(Boolean).length;
      tasks.push(t({ vp: n === 4 ? 2 : n === 3 ? 1 : 0 }));
    }
    if (e.opponents) tasks.push(...s.players.filter(o => o.id !== p.id).map(o => t(e.opponents, { playerId: o.id })));
    if (e.ilesaSetAsideUid) {
      const i = p.hand.findIndex(c => c.uid === e.ilesaSetAsideUid); demand(i >= 0, 'CARD_UNAVAILABLE', '留置牌已不在手中。');
      p.leaderState.setAside = p.hand.splice(i, 1)[0];
    }
    if (e.tessiaRecover) {
      const f = e.tessiaRecover, i = p.leaderState.snoopers.indexOf(f);
      if (i >= 0) {
        p.leaderState.snoopers.splice(i, 1); const n = ++p.leaderState.returnedSnoopers;
        if (n === 1) tasks.push(t({ spice: 1 }));
        if (n === 2 || n === 4) tasks.push(t({ factionBonus: f }));
        if (n === 3 || n === 4) tasks.push(t({ influence: { [f]: 1 } }));
      }
    }
    if (e.factionBonus) tasks.push(t({ emperor: { troops: 2 }, 'spacing-guild': { solari: 3 }, 'bene-gesserit': { intrigue: 1 }, fremen: { water: 1 } }[e.factionBonus]));
    if (e.useTechnology) tasks.push(t(X.activateTech(s, p, e.useTechnology.techId, e.useTechnology, { insideEffect: true }), { sourceCardId: e.useTechnology.techId }));
    if (e.onDiscard) tasks.push(...discardTriggers(s, p, e.onDiscard));
    return tasks;
  }
  function afterEffect(s, p) {
    if (!active(s) || s.turn?.playerId !== p.id) return [];
    const tasks = [], ledger = s.turn;
    if (ledger.spiceGained && ledger.guildImpersonators?.length) tasks.push(...ledger.guildImpersonators.splice(0).map(() => t({ influence: { 'spacing-guild': 1 } })));
    const ambushes = (ledger.desertAmbushes || 0) * ledger.deployed;
    while ((ledger.ambushResolved || 0) < ambushes) { ledger.ambushResolved = (ledger.ambushResolved || 0) + 1; tasks.push(t({ enemyRetreatChoice: true })); }
    return tasks;
  }
  function icons(s, p, c, pair = []) {
    const definition = CARDS[c.cardId]; let result = [...definition.icons];
    if (definition.conditionalIcons === 'bene-gesserit-bond' && [...p.inPlay, ...pair].some(other => other.uid !== c.uid &&
      ((CARDS[other.cardId].graftFactions && pair.length === 2) ? CARDS[other.cardId].graftFactions : tags(s, p, other)).includes('bene-gesserit'))) result = ['landsraad', 'city', 'spice-trade'];
    if (definition.conditionalIcons === 'most-conflict-troops' && s.players.every(other => other.id === p.id || p.troops.conflict > other.troops.conflict)) result = ['landsraad', 'spice-trade'];
    if ((p.nextAgentFactions && (!s.turn?.dispatchCardUid || s.turn.dispatchCardUid === c.uid)) || s.turn?.dispatchedUid === c.uid) result.push(...FACTIONS);
    return [...new Set(result)];
  }
  function selection(s, p, a) {
    const uids = a.cardUids || (a.cardUid ? [a.cardUid] : []);
    demand(Array.isArray(uids) && uids.length >= 1 && uids.length <= 2 && new Set(uids).size === uids.length &&
      !(a.cardUids && a.cardUid), 'INVALID_GRAFT', '派遣须选择一张牌，或恰好两张不同牌嫁接。');
    const cards = uids.map(uid => p.hand.find(c => c.uid === uid));
    demand(cards.every(Boolean), 'CARD_UNAVAILABLE', '所选派遣牌已不在手中。');
    if (a.graftMarketUid) {
      demand(cards.length === 1 && CARDS[cards[0].cardId].graftMarket, 'INVALID_GRAFT', '只有 Usurp 可以嫁接帝国牌市。');
      const market = s.market.find(c => c.uid === a.graftMarketUid); demand(market, 'CARD_UNAVAILABLE', '嫁接牌已不在帝国牌市。'); cards.push(market);
    }
    demand(cards.length === 2 ? cards.some(c => CARDS[c.cardId].graft) : !CARDS[cards[0].cardId].graft,
      'INVALID_GRAFT', '嫁接牌不能单独派遣；双牌派遣至少须含一张嫁接牌。');
    demand(a.dispatchCardUid === undefined || (p.nextAgentFactions && cards.some(c => c.uid === a.dispatchCardUid)), 'INVALID_GRAFT', 'Dispatch 图标必须分配给所选派遣牌。');
    const dispatchedUid = a.dispatchCardUid || cards[0].uid;
    const definition = { ...CARDS[cards[0].cardId], icons: [...new Set(cards.flatMap(c => [
      ...icons(s, { ...p, nextAgentFactions: false }, c, cards), ...(p.nextAgentFactions && c.uid === dispatchedUid ? FACTIONS : []),
    ]))], moveAgent: cards.some(c => CARDS[c.cardId].moveAgent), infiltration: cards.flatMap(c => CARDS[c.cardId].infiltration || []),
    infiltrateAll: cards.some(c => CARDS[c.cardId].infiltrateAll), heighlinerDiscount: Math.max(...cards.map(c => CARDS[c.cardId].heighlinerDiscount || 0)) };
    return { cards, definition, dispatchedUid, cardId: cards[0].cardId, uid: cards[0].uid, moveAgentOverride: definition.moveAgent };
  }
  function agent(s, p, a) {
    demand(s.phase === 'player-turns', 'WRONG_PHASE', '当前不能派遣特工。');
    const selected = selection(s, p, a), space = spacesFor(s).find(x => x.id === a.spaceId);
    const agentUid = a.agentUid || (selected.definition.moveAgent ? full.tokens(s, p)[0] : full.available(s, p)[0]);
    const reason = placementError(s, p, selected, space, a.spice, agentUid); demand(!reason, 'ILLEGAL_PLACEMENT', reason);
    demand(a.effectOrder === undefined || ['card-first', 'space-first', 'card-space-influence', 'card-influence-space', 'space-card-influence',
      'space-influence-card', 'influence-card-space', 'influence-space-card'].includes(a.effectOrder), 'INVALID_ACTION', '效果顺序无效。');
    demand(selected.cards.length === 1 || a.effectOrder === undefined, 'INVALID_ACTION', '嫁接效果顺序须在后端的选择窗口中确定。');
    const costs = full.costs(s, p, space, a.spice, selected);
    for (const [key, amount] of Object.entries(costs)) p.resources[key] -= amount;
    Object.assign(s.turn, { atStart: false, spaceId: space.id, agentUid, agentCards: clone(selected.cards), dispatchedUid: p.nextAgentFactions ? selected.dispatchedUid : null,
      enemyOccupied: s.agentPositions.some(pos => pos.spaceId === space.id && pos.playerId !== p.id),
      ...(a.graftMarketUid ? { usurpedUid: a.graftMarketUid } : {}) });
    if (selected.cards.length === 2) p.graftedCards.push(...selected.cards.map(c => c.uid));
    for (const c of selected.cards.filter(c => c.uid !== a.graftMarketUid)) { p.hand.splice(p.hand.findIndex(x => x.uid === c.uid), 1); p.inPlay.push(c); }
    full.place(s, p, space.id, agentUid); s.pending = { stage: 'effects', playerId: p.id, spaceId: space.id, recruited: 0 };
    const owner = playerById(s, X.controller(s, space.id)); if (owner && space.controlBonus) applyEffect(s, owner, space.controlBonus);
    let multiplier = selected.cards.some(c => c.cardId === 'carryall') ? 2 : 1;
    if (multiplier === 2 && selected.cards.some(c => c.cardId === 'tleilaxu-ghola')) multiplier = 4;
    const board = space.maker ? { ...space.effect, spice: 0, harvest: { spaceId: space.id, multiplier } } : space.effect;
    const influence = space.faction ? { influence: { [space.faction]: Math.max(1, ...selected.cards.map(c => CARDS[c.cardId].factionInfluence || 1)) } } : {};
    const cardTasks = selected.cards.map(c => ({ ...t(c.cardId === 'signet-ring' ? { leaderRing: true } : CARDS[c.cardId].agent,
      { sourceUid: c.uid, sourceCardId: c.cardId }), label: CARDS[c.cardId].name }));
    const boardTasks = [{ ...t(board), label: space.name }, { ...t(influence), label: '势力影响力' }];
    const tasks = [];
    const ilban = has(p, 'count-ilban-richese') && costs.solari > 0 ? { ...t({ draw: 1 }, { sourceCardId: p.leaderId }), label: '伊尔班抽牌' } : null;
    demand(a.leaderEffectAt === undefined || (ilban && selected.cards.length === 1 && Number.isInteger(a.leaderEffectAt) && a.leaderEffectAt >= 0 && a.leaderEffectAt <= 3), 'INVALID_ACTION', '领袖效果插入位置无效；嫁接时在效果顺序中选择。');
    if (has(p, 'ilesa-ecaz') && selected.cards.some(c => c.uid === p.leaderState.bonusUid)) {
      const c = selected.cards.find(c => c.uid === p.leaderState.bonusUid);
      tasks.push(t(icons(s, p, c, selected.cards).length === 1 ? { spice: 1 } : { solari: 1 })); delete p.leaderState.bonusUid;
    }
    if (selected.cards.length === 2) tasks.push(t({ orderAgentTasks: [...cardTasks, ...boardTasks, ...(ilban ? [ilban] : [])] }));
    else {
      const map = { card: cardTasks[0], space: boardTasks[0], influence: boardTasks[1] };
      const order = !a.effectOrder || a.effectOrder === 'card-first' ? 'card-space-influence' : a.effectOrder === 'space-first' ? 'space-card-influence' : a.effectOrder;
      const ordered = order.split('-').map(k => map[k]);
      if (ilban) ordered.splice(a.leaderEffectAt || 0, 0, ilban);
      tasks.push(...ordered);
    }
    addLog(s, 'agent-placed', { playerId: p.id, spaceId: space.id, cards: selected.cards, agentUid, grafted: selected.cards.length === 2 });
    fx().start(s, p, tasks, 'agent');
  }
  function selections(s, p) {
    const result = p.hand.filter(c => !CARDS[c.cardId].graft).map(c => ({ cardUid: c.uid }));
    for (let i = 0; i < p.hand.length; i++) for (let j = i + 1; j < p.hand.length; j++) {
      if (CARDS[p.hand[i].cardId].graft || CARDS[p.hand[j].cardId].graft) result.push({ cardUids: [p.hand[i].uid, p.hand[j].uid] });
    }
    for (const c of p.hand.filter(c => CARDS[c.cardId].graftMarket)) for (const row of s.market) result.push({ cardUid: c.uid, graftMarketUid: row.uid });
    return result;
  }
  function agentActions(s, p) {
    const actions = [{ type: 'reveal' }];
    for (const input of selections(s, p)) {
      const selected = selection(s, p, input);
      for (const space of spacesFor(s)) {
        const tokens = selected.definition.moveAgent ? full.tokens(s, p) : full.available(s, p).slice(0, 1);
        for (const agentUid of tokens) if (!placementError(s, p, selected, space, undefined, agentUid)) {
          const startIndex = actions.length;
          actions.push({ type: 'agent', ...input, spaceId: space.id, agentUid });
          if (p.nextAgentFactions && selected.cards.length === 2) actions.push({ type: 'agent', ...input, spaceId: space.id, agentUid, dispatchCardUid: selected.cards[1].uid });
          if (selected.cards.length === 1) for (const effectOrder of ['card-influence-space', 'space-card-influence', 'space-influence-card', 'influence-card-space', 'influence-space-card'])
            actions.push({ type: 'agent', ...input, spaceId: space.id, agentUid, effectOrder });
          if (selected.cards.length === 1 && has(p, 'count-ilban-richese') && full.costs(s, p, space, undefined, selected).solari > 0) {
            for (const variant of actions.slice(startIndex)) for (const leaderEffectAt of [1, 2, 3]) actions.push({ ...variant, leaderEffectAt });
          }
        }
      }
    }
    return actions;
  }
  function tleilaxuActions(s, p, granted = false) {
    if (!p.immortality || (!granted && s.phase !== 'reveal')) return [];
    const actions = [];
    for (const c of s.immortality.tleilaxuRow) if (p.immortality.specimens >= X.TLEILAXU_COSTS[c.cardId]) {
      const a = { type: 'buyTleilaxu', cardUid: c.uid, cardId: c.cardId }; actions.push(a);
      if (X.geneticMarker(p) || X.hasTech(p, 'tech-spaceport')) actions.push({ ...a, destination: 'deck' });
    }
    if (p.immortality.specimens >= 3) for (const reclaimedChoice of ['troops', 'tleilaxu']) actions.push({ type: 'buyTleilaxu', cardId: 'reclaimed-forces', reclaimedChoice });
    return actions;
  }
  function extraActions(s, p) {
    if (!active(s)) return [];
    const actions = p.immortality ? Array.from({ length: p.immortality.specimens }, (_, n) => ({ type: 'returnSpecimens', count: n + 1 })) : [];
    if (s.currentPlayerId !== p.id || !full.ownTurn(s, p)) return actions;
    if (p.immortality && !p.immortality.familyAtomicsUsed) actions.push({ type: 'familyAtomics' });
    actions.push(...tleilaxuActions(s, p));
    for (const owned of p.ix?.tech || []) {
      const def = XD.TECH[owned.techId];
      if (def.activate && !owned.exhausted && Object.entries(def.activate.cost || {}).every(([k, n]) => p.resources[k] >= n)) {
        if (def.activate.discardFor) for (const c of p.hand) actions.push({ type: 'useTech', techId: owned.techId, discardUid: c.uid });
        else actions.push({ type: 'useTech', techId: owned.techId });
      }
      if (owned.techId === 'tech-spy-satellites' && p.resources.spice >= 3) actions.push({ type: 'useTech', techId: owned.techId });
      if (owned.techId === 'tech-sonic-snoopers') actions.push({ type: 'useTech', techId: owned.techId });
      if (owned.techId === 'tech-disposal-facility' && full.logicalPhase(s, p) === 'reveal' && p.persuasion >= 6 && !p.ix.revealTechUsed.includes(owned.techId)) {
        for (const c of p.inPlay) actions.push({ type: 'useTech', techId: owned.techId, trashUid: c.uid });
      }
    }
    return actions;
  }
  function action(s, p, a) {
    if (!active(s)) return false;
    if (a.type === 'returnSpecimens') {
      demand(Number.isSafeInteger(a.count) && a.count > 0, 'INVALID_COUNT', '请选择正整数个标本返还。');
      X.returnSpecimens(s, p, a.count); fx().refresh(s); return true;
    }
    if (a.type === 'familyAtomics') {
      demand(full.ownTurn(s, p), 'WRONG_TIMING', '只能在本人回合使用家族原子弹。');
      X.familyAtomics(s, p, { insideEffect: true }); fx().refresh(s); addLog(s, 'family-atomics', { playerId: p.id }); return true;
    }
    if (a.type === 'buyTleilaxu') {
      demand(s.phase === 'reveal' && !s.effectContext, 'WRONG_PHASE', '只能在自己的展示回合获取特莱拉牌。');
      fx().start(s, p, [t({ takeTleilaxu: a })], 'resume'); return true;
    }
    if (a.type === 'useTech') {
      demand(extraActions(s, p).some(candidate => candidate.type === 'useTech' && candidate.techId === a.techId &&
        candidate.discardUid === a.discardUid && candidate.trashUid === a.trashUid), 'TECH_REQUIREMENTS', '科技未持有、已耗尽、时机或费用不满足。');
      fx().start(s, p, [t(a.techId === 'tech-sonic-snoopers' ? { sonicSelection: [] } : { useTechnology: a })], 'resume', { interrupt: !!s.effectContext }); return true;
    }
    return false;
  }
  function beforeAdvance(s, p) {
    if (!active(s)) return [];
    const uid = s.turn?.usurpedUid;
    if (!uid) return [];
    trash(s, p, uid);
    delete s.turn.usurpedUid;
    return (s.triggeredEffects || []).splice(0);
  }
  function beforeReveal(s, p) {
    for (const uid of p.chairdogReturns || []) {
      const i = p.inPlay.findIndex(c => c.uid === uid); if (i >= 0) p.hand.push(p.inPlay.splice(i, 1)[0]);
    }
    p.chairdogReturns = [];
    // If Ilesa reveals on her first turn, the reserved card has not been used.
    if (has(p, 'ilesa-ecaz') && p.leaderState.setAside) { p.discard.push(p.leaderState.setAside); delete p.leaderState.setAside; }
  }
  function roundStart(s) {
    if (!active(s)) return [];
    s.combatIntrigues = []; delete s.combatCleanupDone;
    const tasks = X.roundStart(s);
    for (const p of s.players) {
      p.graftedCards = []; p.chairdogReturns = []; p.revealSwordCards = []; delete p.basharUid;
      p.winSolari = 0; p.harvestCells = 0; p.extraTurns = 0;
      p.lostTroopsThisCombat = 0;
      if (X.hasTech(p, 'tech-spaceport')) p.acquireTopdeck = true;
      if (has(p, 'ilesa-ecaz')) {
        p.leaderState.turnsThisRound = 0; delete p.leaderState.bonusUid;
        const ownTasks = tasks.filter(task => task.playerId === p.id);
        if (ownTasks.length) {
          for (const task of ownTasks) tasks.splice(tasks.indexOf(task), 1);
          tasks.push(t({ orderAgentTasks: [...ownTasks.map(task => ({ ...task, label: '轮开始科技效果' })),
            { ...t({ ilesaSetAside: true }, { playerId: p.id, sourceCardId: p.leaderId }), label: '伊莱莎秘密留置' }] }, { playerId: p.id }));
        } else tasks.push(t({ ilesaSetAside: true }, { playerId: p.id, sourceCardId: p.leaderId }));
      }
    }
    return tasks;
  }
  function revealTasks(s, p) {
    const tasks = [];
    for (const owned of p.ix?.tech || []) if (typeof XD.TECH[owned.techId].reveal === 'object') tasks.push(t(XD.TECH[owned.techId].reveal, { sourceCardId: owned.techId }));
    if (has(p, 'archduke-armand-ecaz') && s.agentPositions.filter(a => a.playerId === p.id &&
      ['landsraad', 'city', 'spice-trade'].includes(spacesFor(s).find(x => x.id === a.spaceId)?.icon)).length >= 2) tasks.push(t({ trashInPlayChoice: true }, { sourceCardId: p.leaderId }));
    return tasks;
  }
  function victoryTasks(s, p) {
    const tasks = [];
    if (p.winSolari) tasks.push(t({ solari: p.winSolari }));
    if (X.hasTech(p, 'tech-windtraps')) tasks.push(t({ water: 1 }, { sourceCardId: 'tech-windtraps' }));
    if (p.ix?.dreadnoughts.conflict) tasks.push(t({ occupationChoice: true }));
    return tasks;
  }
  function cleanupTasks(s) {
    const tasks = [];
    for (const p of s.players) {
      p.lostTroopsThisCombat = p.troops.conflict;
      p.troops.supply += p.troops.conflict; p.troops.conflict = 0; p.swords = 0; p.harvestCells = 0;
    }
    X.combatCleanup(s); return tasks;
  }
  function extraSwords(s, p) {
    if (!active(s)) return 0;
    return (X.hasTech(p, 'tech-artillery') ? p.revealSwordCards.length : 0) +
      (p.basharUid ? p.revealSwordCards.filter(uid => uid !== p.basharUid).length : 0);
  }
  const original = { optionsFor: full.optionsFor, execute: full.execute, costs: full.costs, placementError: full.placementError,
    openTurn: full.openTurn, publicLeaderState: full.publicLeaderState, deploy: full.deploy, retreat: full.retreat };
  full.condition = condition; full.extraPlayable = extraPlayable; full.cardFactions = tags;
  full.optionsFor = (s, p, e, context, source) => {
    if (active(s) && e.trashInPlayChoice) return [skip(), ...p.inPlay.map(c => ({ label: `销毁 ${CARDS[c.cardId].name}`, cardId: c.cardId, cardUid: c.uid, effect: { trashUid: c.uid } }))];
    if (active(s) && e.trashSelfChoice && source?.sourceUid === s.turn?.usurpedUid) {
      const card = [...s.market, ...s.removedMarket, ...p.setAsideMarket, ...p.deck, ...p.hand, ...p.discard, ...p.inPlay].find(c => c.uid === source.sourceUid);
      return [skip(), ...(card ? [{ label: `销毁 ${CARDS[card.cardId].name}`, cardId: card.cardId, cardUid: card.uid,
        effect: { trashUid: card.uid, afterTrash: e.afterTrash } }] : [])];
    }
    const result = optionsFor(s, p, e, context, source);
    if (result !== null) return result;
    const fallback = original.optionsFor(s, p, e, context);
    if (active(s) && e.bypassChoice && X.hasTech(p, 'tech-spaceport')) return [...fallback,
      ...fallback.filter(o => o.effect.acquireCard?.destination === 'discard').map(o => ({ ...o,
        label: o.label + ' → 牌库顶', effect: { ...o.effect, acquireCard: { ...o.effect.acquireCard, destination: 'deck' } } }))];
    return fallback;
  };
  full.execute = (s, p, e, context, source) => {
    const discarded = active(s) && e.discardUid ? p.hand.find(c => c.uid === e.discardUid) : null;
    const beforeSpice = p.resources.spice;
    const tasks = original.execute(s, p, e, context);
    if (!active(s)) return tasks;
    if (s.turn) {
      const owner = playerById(s, s.turn.playerId);
      s.turn.freshGarrison = Math.min(s.turn.freshGarrison, owner.troops.garrison);
      s.turn.freshConflict = Math.min(s.turn.freshConflict, owner.troops.conflict);
      s.turn.deployedUnits = s.turn.deployed + (s.turn.deployedDreadnoughts || 0);
    }
    if (s.turn?.playerId === p.id && p.resources.spice > beforeSpice) s.turn.spiceGained = true;
    if (discarded) tasks.push(...discardTriggers(s, p, discarded));
    tasks.push(...execute(s, p, e, context, source), ...afterEffect(s, p)); return tasks;
  };
  full.costs = (s, p, space, spice, selected) => {
    const costs = original.costs(s, p, space, spice);
    if (active(s) && space.id === 'heighliner' && selected?.definition.heighlinerDiscount) costs.spice = Math.max(0, costs.spice - selected.definition.heighlinerDiscount);
    return costs;
  };
  full.placementError = (s, p, c, space, agentUid) => {
    const allowed = active(s) && (c.definition?.infiltrateAll || c.definition?.infiltration.includes(space.icon));
    return original.placementError(s, allowed ? { ...p, infiltrate: true } : p, c, space, agentUid);
  };
  full.deploy = (s, p, n, board = false) => active(s) && p.ix ? X.deployUnits(s, p, n, 0, { board }) : original.deploy(s, p, n, board);
  full.retreat = (s, p, n) => active(s) && p.ix ? X.retreatUnits(s, p, n, 0) : original.retreat(s, p, n);
  full.openTurn = (s, p) => {
    original.openTurn(s, p);
    if (active(s) && has(p, 'ilesa-ecaz')) {
      p.leaderState.turnsThisRound = (p.leaderState.turnsThisRound || 0) + 1;
      if (p.leaderState.turnsThisRound === 2 && p.leaderState.setAside) {
        const c = p.leaderState.setAside; p.hand.push(c); p.leaderState.bonusUid = c.uid; delete p.leaderState.setAside;
        addLog(s, 'ilesa-card-returned', { playerId: p.id, card: c });
      }
    }
  };
  full.publicLeaderState = (p, viewerId) => ({ ...original.publicLeaderState(p, viewerId),
    ...(p.leaderState.snoopers ? { snoopers: p.leaderState.snoopers, returnedSnoopers: p.leaderState.returnedSnoopers } : {}),
    ...(p.leaderState.setAside ? { setAsideCount: 1, ...(viewerId === p.id ? { setAside: p.leaderState.setAside } : {}) } : {}),
    ...(viewerId === p.id && p.leaderState.bonusUid ? { bonusUid: p.leaderState.bonusUid } : {}) });
  return { active, condition, extraPlayable, optionsFor, tags, agent, selection, selections, agentActions, extraActions, action,
    beforeAdvance, beforeReveal, roundStart, revealTasks, victoryTasks, cleanupTasks, extraSwords, afterEffect, discardTriggers };
};
