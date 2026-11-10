'use strict';

// Serializable effect interpreter. Choices contain server-generated effects;
// clients can submit only an option number, never costs or reward payloads.
module.exports = function createEffects({ CARDS, FACTIONS, SPACES, applyEffect, gainInfluence,
  trash, draw, shuffle, playerById, demand, full, onComplete }) {
  const affordable = (p, cost = {}) => Object.entries(cost).every(([key, n]) => (key === 'specimens' ? p.immortality?.specimens || 0 : p.resources[key]) >= n);
  const factionCards = (s, p, faction) => p.inPlay.filter(c => (full.cardFactions ? full.cardFactions(s, p, c) : CARDS[c.cardId].factions || []).includes(faction));
  function condition(s, p, rule, sourceUid) {
    if (!rule) return true;
    switch (rule.kind) {
      case 'bond': return factionCards(s, p, rule.faction).some(c => c.uid !== sourceUid);
      case 'alliance': return s.alliances[rule.faction] === p.id;
      case 'influence': return p.influence[rule.faction] >= rule.amount;
      case 'any-alliance': return Object.values(s.alliances).includes(p.id);
      case 'high-council': return p.highCouncil;
      case 'mentat-available': return !s.mentatOwner;
      case 'agent-turn': return s.phase === 'player-turns' && p.agentsAvailable > 0;
      case 'and': return rule.rules.every(r => condition(s, p, r, sourceUid));
      case 'or': return rule.rules.some(r => condition(s, p, r, sourceUid));
      default: return full.condition ? full.condition(s, p, rule, sourceUid) : false;
    }
  }
  function playable(s, p, card) {
    const effect = card.effect;
    const special = full.isFull(s) && ['turn-start', 'placed-agent'].includes(card.requirement?.kind);
    return (special || condition(s, p, card.requirement)) && (!full.isFull(s) || full.playable(s, p, card)) &&
      (!full.extraPlayable || full.extraPlayable(s, p, card)) && affordable(p, effect.cost) &&
      (!effect.loseConflictTroops || p.troops.conflict >= effect.loseConflictTroops) &&
      (!effect.doubleCrossChoice || s.players.some(x => x.id !== p.id && x.troops.conflict > 0));
  }
  function task(effect, source = {}) { return { effect: JSON.parse(JSON.stringify(effect || {})), ...source }; }
  function optionsFor(s, p, effect, sourceUid, context) {
    let options = null;
    if (effect.choice) options = effect.choice.filter(o => affordable(p, o.effect.cost));
    if (effect.chooseInfluence) {
      const { amount = 1, distinct = 1 } = effect.chooseInfluence;
      options = [];
      for (let i = 0; i < FACTIONS.length; i++) {
        const first = FACTIONS[i];
        if (distinct === 1) options.push({ label: `${first} 影响力 +${amount}`, effect: { influence: { [first]: amount } } });
        else for (const second of FACTIONS.slice(i + 1)) options.push({ label: `${first}、${second} 各 +${amount}`, effect: { influence: { [first]: amount, [second]: amount } } });
      }
    }
    if (effect.trashChoice || effect.trashSelfChoice) {
      const cards = [...p.hand, ...p.discard, ...p.inPlay].filter(c => !effect.trashSelfChoice || c.uid === sourceUid);
      options = [{ label: '不销毁', effect: {} }, ...cards.map(c => ({ label: `销毁：${CARDS[c.cardId].name}`,
        cardUid: c.uid, cardId: c.cardId, effect: { trashUid: c.uid, afterTrash: effect.afterTrash } }))];
    }
    if (effect.deployChoice !== undefined || effect.retreatChoice !== undefined) {
      const retreat = effect.retreatChoice !== undefined;
      const available = retreat ? p.troops.conflict : p.troops.garrison;
      const requested = retreat ? effect.retreatChoice : effect.deployChoice;
      const max = requested === 'all' ? available : Math.min(available, requested);
      options = Array.from({ length: max + 1 }, (_, n) => ({ label: `${retreat ? '撤回' : '部署'} ${n} 兵`, effect: retreat ? { retreat: n } : { deploy: n } }));
    }
    if (effect.doubleCrossChoice) options = s.players.filter(x => x.id !== p.id && x.troops.conflict > 0)
      .map(x => ({ label: `令 ${x.name} 损失 1 参战兵`, effect: { doubleCrossTarget: x.id } }));
    if (effect.drawDiscardFactionChoice) options = [{ label: '从牌库抽 1 张牌', effect: { draw: 1 } },
      ...p.discard.filter(c => (CARDS[c.cardId].factions || []).includes(effect.drawDiscardFactionChoice))
        .map(c => ({ label: `取回：${CARDS[c.cardId].name}`, cardUid: c.uid, cardId: c.cardId, effect: { drawDiscardUid: c.uid } }))];
    const extended = full.optionsFor(s, p, effect, context, { sourceUid });
    if (extended !== null) options = extended;
    if (effect.optional && options) options = [{ label: '跳过', effect: {} }, ...options];
    return options;
  }
  function start(s, p, tasks, continuation, { interrupt = false, intrigueUid, revealUid } = {}) {
    demand(!s.effectContext || (interrupt && full.isFull(s) && full.ownTurn(s, p)), 'EFFECT_IN_PROGRESS', '请先完成当前效果。', 409);
    const logicalPhase = full.isFull(s) ? full.logicalPhase(s, p) : s.phase;
    if (s.effectContext) {
      (s.effectStack ||= []).push({ context: s.effectContext, queue: s.effectQueue,
        pending: s.pending, phase: s.phase, currentPlayerId: s.currentPlayerId });
    }
    s.effectContext = { playerId: p.id, phase: s.phase, logicalPhase, pending: s.pending, continuation, ...(intrigueUid ? { intrigueUid } : {}), ...(revealUid ? { revealUid } : {}) };
    s.effectQueue = tasks;
    process(s);
  }
  function process(s) {
    const context = s.effectContext;
    while (s.effectQueue.length) {
      const current = s.effectQueue.shift();
      const p = playerById(s, current.playerId || context.playerId);
      s.currentPlayerId = p.id;
      let effect = current.effect || {};
      const source = { sourceUid: current.sourceUid, sourceCardId: current.sourceCardId, playerId: p.id };
      context.currentSourceUid = current.sourceUid;
      // JSON storage removes undefined fields; don't rely on them being present.
      if (effect.cost) {
        demand(affordable(p, effect.cost), 'INSUFFICIENT_RESOURCES', '无法支付卡牌费用。');
        for (const [key, n] of Object.entries(effect.cost)) {
          if (key === 'specimens') { p.immortality.specimens -= n; p.troops.supply += n; }
          else p.resources[key] -= n;
        }
        const { cost, ...rest } = effect; effect = rest;
      }
      if (effect.steps) {
        s.effectQueue.unshift(...effect.steps.map(e => task(e, source))); continue;
      }
      if (effect.condition) {
        if (condition(s, p, effect.condition, current.sourceUid)) s.effectQueue.unshift(task(effect.then, source));
        continue;
      }
      const options = optionsFor(s, p, effect, current.sourceUid, context);
      if (options) {
        // A choice can share a card box with unconditional rewards. Preserve
        // those rewards instead of dropping them when the selector suspends.
        const atomicKeys = ['spice', 'solari', 'water', 'vp', 'swords', 'persuasion', 'troops', 'draw', 'intrigue',
          'influence', 'specimens', 'negotiators', 'tleilaxu', 'roundPersuasion'];
        const remainder = Object.fromEntries(Object.entries(effect).filter(([key]) => atomicKeys.includes(key)));
        if (Object.keys(remainder).length) {
          const selector = Object.fromEntries(Object.entries(effect).filter(([key]) => !atomicKeys.includes(key)));
          s.effectQueue.unshift(task(remainder, source), task(selector, source)); continue;
        }
        // Mandatory effects with no possible target do as much as possible.
        if (!options.length && full.isFull(s)) continue;
        demand(options.length > 0, 'NO_EFFECT_OPTIONS', '当前无法执行此效果。');
        if (options.length === 1 && !full.isFull(s)) { s.effectQueue.unshift(task(options[0].effect, source)); continue; }
        s.phase = 'effect-choice';
        s.pending = { stage: 'effect', playerId: p.id, sourceCardId: current.sourceCardId || null, options, source,
          task: { effect, ...source } };
        return;
      }
      if (effect.trashUid) {
        demand(trash(s, p, effect.trashUid), 'CARD_UNAVAILABLE', '待销毁卡牌已不在可选区域。');
        if (effect.afterTrash) s.effectQueue.unshift(task(effect.afterTrash, source));
      }
      if (effect.trashSelf) trash(s, p, current.sourceUid);
      let recruited = applyEffect(s, p, effect);
      for (const [faction, amount] of Object.entries(effect.influence || {})) recruited += gainInfluence(s, p, faction, amount);
      if (context.continuation === 'agent' && p.id === context.playerId) context.pending.recruited += recruited;
      full.sync(s);
      if (effect.control) s.controls[effect.control] = p.id;
      if (effect.nextMentat) s.nextMentatOwner = p.id;
      if (effect.doubleHarvest && !full.isFull(s)) {
        const space = SPACES.find(x => x.id === context.pending?.spaceId);
        if (space?.maker) p.resources.spice += space.effect.spice;
      }
      if (effect.enemyGarrisonLoss) for (const opponent of s.players) {
        if (opponent.id === p.id) continue;
        const lost = Math.min(effect.enemyGarrisonLoss, opponent.troops.garrison);
        opponent.troops.garrison -= lost; opponent.troops.supply += lost;
      }
      if (effect.persuasionPerFaction) p.persuasion += factionCards(s, p, effect.persuasionPerFaction.faction).length * effect.persuasionPerFaction.amount;
      if (effect.spiceMustFlowDiscount) p.spiceMustFlowDiscount = (p.spiceMustFlowDiscount || 0) + effect.spiceMustFlowDiscount;
      if (effect.deploy !== undefined) {
        if (full.isFull(s)) full.deploy(s, p, effect.deploy);
        else { p.troops.garrison -= effect.deploy; p.troops.conflict += effect.deploy; }
      }
      if (effect.retreat !== undefined) {
        if (full.isFull(s)) full.retreat(s, p, effect.retreat);
        else { p.troops.conflict -= effect.retreat; p.troops.garrison += effect.retreat; }
      }
      if (effect.deployRecruits || (effect.deployOnReveal && (context.logicalPhase || context.phase) === 'reveal')) {
        s.effectQueue.unshift(task({ deployChoice: recruited }, source));
      }
      if (effect.roundPersuasion) {
        p.roundPersuasion = (p.roundPersuasion || 0) + effect.roundPersuasion;
        if ((context.logicalPhase || context.phase) === 'reveal') p.persuasion += effect.roundPersuasion;
      }
      if (effect.acquireTopdeck) p.acquireTopdeck = true;
      if (effect.nextAgentFactions) p.nextAgentFactions = true;
      if (effect.refocus) { p.deck = shuffle([...p.deck, ...p.discard.splice(0)]); draw(s, p, 1); }
      if (effect.drawDiscardUid) {
        const i = p.discard.findIndex(c => c.uid === effect.drawDiscardUid);
        demand(i >= 0, 'CARD_UNAVAILABLE', '这张卡已不在弃牌堆。');
        p.hand.push(p.discard.splice(i, 1)[0]);
      }
      if (effect.loseConflictTroops) {
        demand(p.troops.conflict >= effect.loseConflictTroops, 'INSUFFICIENT_TROOPS', '参战部队不足。');
        p.troops.conflict -= effect.loseConflictTroops; p.troops.supply += effect.loseConflictTroops;
      }
      if (effect.doubleCrossTarget) {
        const opponent = playerById(s, effect.doubleCrossTarget);
        demand(opponent && opponent.id !== p.id && opponent.troops.conflict > 0, 'INVALID_TARGET', '目标没有参战部队。');
        opponent.troops.conflict--; opponent.troops.supply++;
        if (p.troops.supply > 0) {
          p.troops.supply--; p.troops.conflict++;
          if (full.isFull(s) && s.turn?.playerId === p.id) s.turn.deployed++;
        }
      }
      if (effect.tiebreaker) {
        if (context.phase === 'endgame') p.resources.spice += 10;
        else p.swords += 2;
      }
      if (effect.plansWithinPlans) {
        const n = FACTIONS.filter(f => p.influence[f] >= 3).length;
        p.vp += n === 4 ? 2 : n === 3 ? 1 : 0;
      }
      if (effect.cornerTheMarket) {
        const count = x => [...x.deck, ...x.discard].filter(c => c.cardId === 'the-spice-must-flow').length;
        const mine = count(p);
        if (mine >= 2) p.vp++;
        if (s.players.every(x => x.id === p.id || mine > count(x))) p.vp++;
      }
      const extra = full.execute(s, p, effect, context, { ...source, recruited });
      if (extra.length) s.effectQueue.unshift(...extra.map(({ effect: nextEffect, ...metadata }) => task(nextEffect, { ...source, ...metadata })));
      if (s.triggeredEffects?.length) s.effectQueue.unshift(...s.triggeredEffects.splice(0));
      // Losing an alliance can require the losing player to choose a successor.
      if (s.allianceChoices?.length) {
        s.effectQueue.unshift(...s.allianceChoices.splice(0).map(c => task({ chooseAlliance: c }, { playerId: c.chooserId, sourceCardId: current.sourceCardId })));
        delete s.allianceChoices;
      }
      if (full.isFull(s)) {
        const mastery = full.masterstrokeEffect(s, p);
        if (mastery) s.effectQueue.unshift(task(mastery, { playerId: p.id, sourceCardId: p.leaderId }));
      }
    }
    s.phase = context.phase; s.pending = context.pending;
    s.currentPlayerId = context.playerId;
    delete s.effectQueue; delete s.effectContext;
    full.finishIntrigue(s, playerById(s, context.playerId), context.intrigueUid);
    if (s.effectStack?.length) {
      const previous = s.effectStack.pop();
      s.effectContext = previous.context; s.effectQueue = previous.queue;
      s.pending = previous.pending; s.phase = previous.phase; s.currentPlayerId = previous.currentPlayerId;
      if (!s.effectStack.length) delete s.effectStack;
      if (s.pending?.stage === 'effect' && s.pending.task) {
        s.effectQueue.unshift(s.pending.task); process(s);
      }
      return;
    }
    onComplete(s, playerById(s, context.playerId), context.continuation, context);
  }
  function choose(s, p, option) {
    demand(s.phase === 'effect-choice' && s.pending?.stage === 'effect' && s.pending.playerId === p.id, 'WRONG_PHASE', '当前没有卡牌效果选择。');
    demand(Number.isInteger(option) && option >= 0 && option < s.pending.options.length, 'INVALID_CHOICE', '效果选项无效。');
    const pending = s.pending;
    s.effectQueue.unshift(task(pending.options[option].effect, pending.source));
    process(s);
  }
  function refresh(s) {
    if (s.effectContext && s.pending?.stage === 'effect' && s.pending.task) {
      s.effectQueue.unshift(s.pending.task); process(s);
    }
  }
  return { start, choose, playable, task, condition, refresh };
};
