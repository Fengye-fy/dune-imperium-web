'use strict';

const { LEADERS } = require('./leaders');
const isFull = s => ['base-dev-v3', 'expansions-dev-v4'].includes(s.ruleset);
const has = (p, slug) => p.leaderId === 'leader-' + slug;

module.exports = function createFullRules({ CARDS, FACTIONS, SPACES, spacesFor = () => SPACES, draw, trash,
  demand, addLog, playerById, acquisitionCandidates, takeAcquisition }) {
  const affordable = (p, cost) => Object.entries(cost || {}).every(([key, n]) => p.resources[key] >= n);
  function tokens(s, p) {
    return [p.id + ':agent-1', p.id + ':agent-2', ...(p.swordmaster ? [p.id + ':agent-3'] : []),
      ...(s.mentatOwner === p.id ? ['mentat'] : [])];
  }
  function available(s, p) { return tokens(s, p).filter(uid => !s.agentPositions.some(a => a.agentUid === uid)); }
  function sync(s) {
    if (!isFull(s)) return;
    s.occupied = {};
    for (const a of s.agentPositions) if (!s.occupied[a.spaceId]) s.occupied[a.spaceId] = a.playerId;
    for (const p of s.players) p.agentsAvailable = available(s, p).length;
  }
  function initialize(s) {
    s.agentPositions = []; s.voiceBlocks = []; s.removedMarket = [];
    s.leaderSelectionOrder = Array.from({ length: s.players.length }, (_, n) =>
      s.players[(s.firstPlayerIndex + s.players.length - 1 - n) % s.players.length].id);
    for (const p of s.players) { p.leaderId = null; p.leaderState = {}; p.setAsideMarket = []; p.infiltrate = false; p.resolvingIntrigues = []; }
    s.phase = 'leader-selection'; s.currentPlayerId = s.leaderSelectionOrder[0];
  }
  function selectLeader(s, p, leaderId) {
    demand(s.phase === 'leader-selection' && Object.hasOwn(LEADERS, leaderId) &&
      !s.players.some(x => x.leaderId === leaderId), 'LEADER_UNAVAILABLE', '请选择本局尚未被选择的领袖。');
    p.leaderId = leaderId;
    if (has(p, 'glossu-the-beast-rabban')) { p.resources.spice++; p.resources.solari++; }
    addLog(s, 'leader-selected', { playerId: p.id, leaderId });
    s.leaderSelectionOrder.shift();
    s.currentPlayerId = s.leaderSelectionOrder[0] || null;
    return !s.leaderSelectionOrder.length;
  }
  function openTurn(s, p) {
    if (!isFull(s)) return;
    s.voiceBlocks = s.voiceBlocks.filter(b => b.playerId !== p.id);
    s.turn = { playerId: p.id, kind: 'agent', atStart: true, recruited: 0, deployed: 0,
      freshGarrison: 0, freshConflict: 0, boardOldDeployed: 0, masterstrokeOffered: false };
    p.nextAgentFactions = false; p.infiltrate = false;
  }
  function logicalPhase(s, p) {
    if (s.turn?.playerId === p.id) return s.turn.kind === 'reveal' ? 'reveal' : 'player-turns';
    return s.phase;
  }
  function ownTurn(s, p) {
    return isFull(s) && s.turn?.playerId === p.id &&
      ['player-turns', 'reveal', 'agent-choice', 'agent-end', 'effect-choice'].includes(s.phase) &&
      (!s.effectContext || s.effectContext.playerId === p.id) &&
      // Settle a paid influence loss and its alliance successor atomically.
      !(s.pending?.stage === 'effect' && s.pending.task?.effect.chooseAlliance);
  }
  function costs(s, p, space, spice) {
    const result = { ...(space.id === 'sell-melange' ? { spice } : space.cost) };
    if (has(p, 'duke-leto-atreides') && space.icon === 'landsraad' && result.solari) result.solari = Math.max(0, result.solari - 1);
    return result;
  }
  function placementError(s, p, c, space, agentUid) {
    const moving = c.moveAgentOverride ?? CARDS[c.cardId].moveAgent;
    const legalTokens = moving ? tokens(s, p) : available(s, p);
    if (!legalTokens.includes(agentUid)) return '没有这名可用特工；移动只能选择自己的特工。';
    if (s.voiceBlocks.some(b => b.spaceId === space.id && b.playerId !== p.id)) return '这个行动格正被对手的 Voice 封锁。';
    const occupants = s.agentPositions.filter(a => a.spaceId === space.id && a.agentUid !== agentUid);
    if (!moving && occupants.length) {
      if (occupants.some(a => a.playerId === p.id)) return '不能忽略自己的特工占位。';
      if (!p.infiltrate && !(has(p, 'helena-richese') && ['landsraad', 'city'].includes(space.icon))) return '行动格已被敌方特工占用。';
    }
    return null;
  }
  function place(s, p, spaceId, agentUid) {
    s.agentPositions = s.agentPositions.filter(a => a.agentUid !== agentUid);
    s.agentPositions.push({ agentUid, playerId: p.id, spaceId, kind: agentUid === 'mentat' ? 'mentat' : 'agent' });
    p.infiltrate = false; p.nextAgentFactions = false; sync(s);
  }
  function recall(s, p, agentUid) {
    demand(s.agentPositions.some(a => a.agentUid === agentUid && a.playerId === p.id), 'INVALID_AGENT', '只能召回自己已派出的特工。');
    s.agentPositions = s.agentPositions.filter(a => a.agentUid !== agentUid); sync(s);
    addLog(s, 'agent-recalled', { playerId: p.id, agentUid });
  }
  function recruited(s, p, n) {
    if (s.turn?.playerId !== p.id) return;
    s.turn.recruited += n; s.turn.freshGarrison += n;
  }
  function maxDeploy(s, p) {
    return Math.min(p.troops.garrison, s.turn.freshGarrison + Math.max(0, 2 - s.turn.boardOldDeployed));
  }
  function deploy(s, p, n, board = false) {
    demand(Number.isInteger(n) && n >= 0 && n <= p.troops.garrison, 'INVALID_DEPLOYMENT', '部署部队不足。');
    p.troops.garrison -= n; p.troops.conflict += n;
    if (s.turn?.playerId === p.id) {
      const fresh = Math.min(s.turn.freshGarrison, n);
      s.turn.freshGarrison -= fresh; s.turn.freshConflict += fresh; s.turn.deployed += n;
      if (board) s.turn.boardOldDeployed += n - fresh;
    }
    addLog(s, 'troops-deployed', { playerId: p.id, count: n });
  }
  function retreat(s, p, n) {
    demand(Number.isInteger(n) && n >= 0 && n <= p.troops.conflict, 'INVALID_DEPLOYMENT', '撤回部队不足。');
    p.troops.conflict -= n; p.troops.garrison += n;
    if (s.turn?.playerId === p.id) {
      const fresh = Math.min(s.turn.freshConflict, n);
      s.turn.freshConflict -= fresh; s.turn.freshGarrison += fresh;
    }
    addLog(s, 'troops-retreated', { playerId: p.id, count: n });
  }
  function masterstrokeEffect(s, p) {
    if (!has(p, 'baron-vladimir-harkonnen') || p.leaderState.masterstrokeUsed ||
        s.turn?.playerId !== p.id || s.turn.deployed < 4 || s.turn.masterstrokeOffered) return null;
    s.turn.masterstrokeOffered = true;
    return { masterstrokeChoice: true };
  }
  function playable(s, p, card) {
    if (card.requirement?.kind === 'turn-start') return s.phase === 'player-turns' && s.turn?.playerId === p.id && s.turn.atStart;
    if (card.requirement?.kind === 'placed-agent') return s.agentPositions.some(a => a.playerId === p.id);
    return true;
  }
  function optionsFor(s, p, effect, context) {
    if (!isFull(s)) return null;
    if (effect.voiceChoice) return spacesFor(s).map(space => ({ label: `封锁：${space.name}`, spaceId: space.id, effect: { voiceSpace: space.id } }));
    if (effect.recallChoice) return s.agentPositions.filter(a => a.playerId === p.id).map(a => ({ label: `召回：${spacesFor(s).find(x => x.id === a.spaceId).name}`,
      agentUid: a.agentUid, spaceId: a.spaceId, effect: { recallAgent: a.agentUid } }));
    if (effect.shiftInfluenceChoice) {
      const options = [{ label: '不转移影响力', effect: {} }];
      if (p.resources.spice >= 2) for (const from of FACTIONS.filter(f => p.influence[f] > 0)) for (const to of FACTIONS) options.push({
        label: `支付 2 香料，${from} -1，${to} +2`, effect: { steps: [{ cost: { spice: 2 } }, { influence: { [from]: -1 } }, { influence: { [to]: 2 } }] },
      });
      return options;
    }
    if (effect.chooseAlliance) return effect.chooseAlliance.playerIds.map(id => ({ label: `同盟转交：${playerById(s, id).name}`,
      targetPlayerId: id, effect: { assignAlliance: { faction: effect.chooseAlliance.faction, playerId: id } } }));
    if (effect.discardChoice) {
      const options = p.hand.map(c => ({ label: `弃掉：${CARDS[c.cardId].name}`, cardUid: c.uid, cardId: c.cardId,
        effect: { steps: [{ discardUid: c.uid }, ...(effect.discardChoice > 1 ? [{ discardChoice: effect.discardChoice - 1 }] : [])] } }));
      if (effect.orTroopLoss && p.troops.conflict > 0) options.push({ label: '损失 1 参战兵', effect: { loseConflictTroops: 1 } });
      return options;
    }
    if (effect.peekChoice) {
      if (!effect.peekedCard) effect.peekedCard = p.deck.length ? { ...p.deck.at(-1) } : null;
      const c = effect.peekedCard;
      if (!c || p.deck.at(-1)?.uid !== c.uid) return [];
      return [{ label: `抽取牌库顶：${CARDS[c.cardId].name}`, cardUid: c.uid, cardId: c.cardId, effect: { peekDraw: c.uid } },
        { label: `销毁牌库顶：${CARDS[c.cardId].name}`, cardUid: c.uid, cardId: c.cardId, effect: { peekTrash: c.uid } }];
    }
    if (effect.masterstrokeSetupChoice) {
      const options = [];
      for (let i = 0; i < FACTIONS.length; i++) for (const second of FACTIONS.slice(i + 1)) options.push({
        label: `秘密选择：${FACTIONS[i]}、${second}`, effect: { baronFactions: [FACTIONS[i], second] },
      });
      return options;
    }
    if (effect.masterstrokeChoice) return [{ label: '暂不揭示秘密势力', effect: {} }, { label: '揭示秘密势力并各提升 1 影响力', effect: { masterstroke: true } }];
    if (effect.letoSignetChoice) return [{ label: '不支付香料', effect: {} }, ...FACTIONS.filter(f => p.resources.spice >= 1 &&
      s.players.some(x => x.id !== p.id && x.influence[f] > p.influence[f])).map(f => ({
        label: `支付 1 香料，提升 ${f} 影响力`, effect: { cost: { spice: 1 }, influence: { [f]: 1 } },
      }))];
    if (effect.manipulateChoice) return s.market.map(c => ({ label: `移走并补充：${CARDS[c.cardId].name}`, cardUid: c.uid, cardId: c.cardId,
      effect: { manipulateUid: c.uid } }));
    if (effect.bypassChoice) {
      const options = [];
      for (const candidate of acquisitionCandidates(s, p)) {
        const cost = CARDS[candidate.cardId].cost;
        const label = CARDS[candidate.cardId].name;
        if (cost <= 3) {
          options.push({ label: `免费获得：${label}`, cardId: candidate.cardId, effect: { acquireCard: { ...candidate, destination: 'discard' } } });
          if (context.logicalPhase === 'reveal' && p.acquireTopdeck) options.push({ label: `免费获得并置于牌库顶：${label}`, cardId: candidate.cardId,
            effect: { acquireCard: { ...candidate, destination: 'deck' } } });
        }
        if (cost <= 5 && p.resources.spice >= 2) options.push({ label: `支付 2 香料获得并置于牌库顶：${label}`, cardId: candidate.cardId,
          effect: { cost: { spice: 2 }, acquireCard: { ...candidate, destination: 'deck' } } });
      }
      return options;
    }
    if (effect.demandRespectChoice) return [{ label: '任一势力影响力 +1', effect: { chooseInfluence: { amount: 1 } } },
      ...(p.resources.spice >= 2 ? [{ label: '支付 2 香料，任一势力影响力 +2', effect: { cost: { spice: 2 }, chooseInfluence: { amount: 2 } } }] : [])];
    return null;
  }
  function execute(s, p, effect, context) {
    if (!isFull(s)) return [];
    const tasks = [];
    if (effect.opponentsDiscard) {
      const at = s.players.findIndex(x => x.id === p.id);
      for (let n = 1; n < s.players.length; n++) tasks.push({ playerId: s.players[(at + n) % s.players.length].id,
        effect: { discardChoice: effect.opponentsDiscard, orTroopLoss: effect.orTroopLoss === true } });
    }
    if (effect.discardUid) {
      const i = p.hand.findIndex(c => c.uid === effect.discardUid);
      demand(i >= 0, 'CARD_UNAVAILABLE', '只能弃掉自己当前的手牌。');
      const [c] = p.hand.splice(i, 1); p.discard.push(c); addLog(s, 'card-discarded', { playerId: p.id, card: c });
    }
    if (effect.voiceSpace) { s.voiceBlocks.push({ playerId: p.id, spaceId: effect.voiceSpace }); addLog(s, 'voice-used', { playerId: p.id, spaceId: effect.voiceSpace }); }
    if (effect.infiltrate) p.infiltrate = true;
    if (effect.recallAgent) recall(s, p, effect.recallAgent);
    if (effect.peekDraw || effect.peekTrash) {
      const uid = effect.peekDraw || effect.peekTrash;
      demand(p.deck.at(-1)?.uid === uid, 'CARD_UNAVAILABLE', '已查看的牌库顶已改变。');
      if (effect.peekDraw) draw(s, p, 1);
      else { p.hand.push(p.deck.pop()); trash(s, p, uid); }
    }
    if (effect.assignAlliance) {
      const { faction, playerId } = effect.assignAlliance;
      const owner = playerById(s, playerId), highest = Math.max(...s.players.map(x => x.influence[faction]));
      demand(owner && highest >= 4 && owner.influence[faction] === highest && !s.alliances[faction], 'INVALID_ALLIANCE', '同盟候选已改变。');
      s.alliances[faction] = owner.id; owner.vp++;
      addLog(s, 'alliance-transferred', { faction, playerId });
    }
    if (effect.baronFactions) p.leaderState.masterstrokeFactions = [...effect.baronFactions];
    if (effect.masterstroke) {
      demand(has(p, 'baron-vladimir-harkonnen') && !p.leaderState.masterstrokeUsed && s.turn?.playerId === p.id && s.turn.deployed >= 4,
        'LEADER_REQUIREMENTS', '男爵本回合尚未部署四兵，或本局已经使用过技能。');
      p.leaderState.masterstrokeUsed = true;
      const factions = p.leaderState.masterstrokeFactions;
      demand(Array.isArray(factions) && factions.length === 2, 'LEADER_SETUP_REQUIRED', '尚未完成男爵的秘密选择。');
      addLog(s, 'masterstroke-revealed', { playerId: p.id, factions });
      tasks.push({ effect: { influence: Object.fromEntries(factions.map(f => [f, 1])) } });
    }
    if (effect.leaderRing) tasks.push({ effect: LEADERS[p.leaderId].signetEffect, sourceCardId: 'signet-ring' });
    if (effect.rabbanSignet) tasks.push({ effect: { troops: Object.values(s.alliances).includes(p.id) ? 2 : 1 } });
    if (effect.manipulateUid) {
      const i = s.market.findIndex(c => c.uid === effect.manipulateUid);
      demand(i >= 0, 'CARD_UNAVAILABLE', '这张牌已不在市场。');
      const [c] = s.market.splice(i, 1); if (s.marketDeck.length) s.market.splice(i, 0, s.marketDeck.pop());
      p.setAsideMarket.push(c); addLog(s, 'market-manipulated', { playerId: p.id, card: c });
    }
    if (effect.acquireCard) {
      const c = takeAcquisition(s, p, effect.acquireCard);
      tasks.push({ effect: CARDS[c.cardId].acquire || {}, sourceUid: c.uid, sourceCardId: c.cardId });
    }
    if (effect.harvest) {
      const space = spacesFor(s).find(x => x.id === effect.harvest.spaceId);
      const total = space.effect.spice * effect.harvest.multiplier + s.bonusSpice[space.id];
      p.resources.spice += Math.max(0, total - (has(p, 'countess-ariana-thorvald') ? 1 : 0));
      s.bonusSpice[space.id] = 0;
      if (has(p, 'countess-ariana-thorvald') && total > 0) draw(s, p, 1);
    }
    if (effect.highCouncil && has(p, 'earl-memnon-thorvald')) tasks.push({ effect: { chooseInfluence: { amount: 1 } }, sourceCardId: p.leaderId });
    return tasks;
  }
  function publicLeaderState(p, viewerId) {
    return { masterstrokeUsed: p.leaderState.masterstrokeUsed === true,
      ...((p.id === viewerId || p.leaderState.masterstrokeUsed) && p.leaderState.masterstrokeFactions ? { masterstrokeFactions: p.leaderState.masterstrokeFactions } : {}) };
  }
  function finishIntrigue(s, p, uid) {
    if (!isFull(s) || !uid) return;
    const i = p.resolvingIntrigues.findIndex(c => c.uid === uid);
    if (i >= 0) s.intrigueDiscard.push(p.resolvingIntrigues.splice(i, 1)[0]);
  }
  return { isFull, has, LEADERS, tokens, available, sync, initialize, selectLeader, openTurn,
    logicalPhase, ownTurn, costs, placementError, place, recall, recruited, maxDeploy, deploy, retreat,
    masterstrokeEffect, playable, optionsFor, execute, publicLeaderState, finishIntrigue };
};
