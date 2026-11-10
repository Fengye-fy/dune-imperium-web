'use strict';
const { REFERENCE } = require('./expansion-data');
const F = ['emperor', 'spacing-guild', 'bene-gesserit', 'fremen'];
const E = 'emperor', G = 'spacing-guild', B = 'bene-gesserit', R = 'fremen';
const L = 'landsraad', C = 'city', S = 'spice-trade';
const seq = (...steps) => ({ steps });
const when = (kind, then, rest = {}) => ({ condition: { kind, ...rest }, then });
const gen = (amount, then) => when('genetic', then, { amount });
const grafted = then => when('grafted', then);
const bond = (faction, then) => when('bond', then, { faction });
const alliance = (faction, then) => when('alliance', then, { faction });
const influence = (faction, amount, then) => when('influence', then, { faction, amount });
const optional = (label, effect) => ({ choice: [{ label: '跳过', effect: {} }, { label, effect }] });
const pay = (cost, effect) => optional('支付费用并执行', { ...effect, cost });
const discard = (count, reward) => ({ discardFor: { count, reward, optional: true } });
const choose = (...effects) => ({ choice: effects.map((effect, n) => ({ label: `选择 ${n + 1}`, effect })) });
const CARDS = {};
function card(id, cost, icons, agent, reveal, extra = {}) {
  const ref = REFERENCE.entries.find(c => c.id === id);
  CARDS[id] = { id, name: ref?.name || ref?.englishName || id, englishName: ref?.englishName || id,
    icons, agent, reveal, factions: [], cost, expansion: ref?.expansion, implementation: 'playable', ...extra };
}
function ix(slug, cost, icons, agent, reveal, extra) { card('ix-' + slug, cost, icons, agent, reveal, extra); }
function imm(slug, cost, icons, agent, reveal, extra) { card('imm-' + slug, cost, icons, agent, reveal, extra); }
function tleilaxu(slug, cost, icons, agent, reveal, extra) {
  card('tleilaxu-' + slug, undefined, icons, agent, reveal, { specimenCost: cost, ...extra });
}
const inf = { chooseInfluence: { amount: 1 } };
ix('appropriate', 5, [L, S], influence(E, 2, { acquireTech: { allowSolari: true } }), { persuasion: 2 }, { factions: [E], acquire: { shipping: 1 } });
ix('bounty-hunter', 1, [C], when('enemy-occupied', { solari: 2 }), { persuasion: 1, swords: 1 }, { infiltration: [C] });
ix('choam-delegate', 1, [S], {}, { solari: 3 }, { infiltration: [S], unload: true });
ix('court-intrigue', 2, [E], { cycleIntrigueChoice: 1 }, { persuasion: 1, swords: 1 }, { factions: [E], infiltration: [E] });
ix('desert-ambush', 3, [S], { desertAmbush: true }, { persuasion: 1, swords: 1 }, { factions: [R] });
ix('embedded-agent', 5, [L], bond(B, seq({ shipping: 1 }, { shipping: 1 })), { persuasion: 1, intrigue: 1 }, { factions: [B], infiltration: [L] });
ix('esmar-tuek', 5, [C, S], pay({ spice: 1 }, { influence: { [G]: 1 }, draw: 1 }), { spice: 2, solari: 2 }, { factions: [G], unload: true });
ix('freighter-fleet', 2, [S], {}, { shipping: 1 }, { unload: true });
ix('full-scale-assault', 8, [E, C], { troops: 2 }, seq({ persuasion: 2 }, { swordsPerDreadnought: 3 }), { factions: [E], acquire: { commissionDreadnought: 1 } });
ix('guild-accord', 6, [G], {}, seq({ water: 1 }, alliance(G, { spice: 3 })), { factions: [G], infiltration: [G], heighlinerDiscount: 2, unload: true });
ix('guild-chief-administrator', 4, [G, C, S], discard(1, { trashSelf: true }), { persuasion: 1, shipping: 1 }, { factions: [G] });
ix('imperial-bashar', 4, [C], choose({ troops: 1 }, { trashChoice: true }), { persuasion: 1, swords: 2, bashar: true }, { factions: [E] });
ix('imperial-shock-trooper', 3, [], {}, seq({ persuasion: 1, swords: 2 }, when('agent-at-faction', { swords: 3 }, { faction: E })), { factions: [E] });
ix('in-the-shadows', 2, [L, C], influence(B, 2, discard(1, { influenceExcept: B })), { influence: { [B]: 1 } }, { factions: [B], unload: true });
ix('ix-guild-compact', 3, [G], discard(2, { commissionDreadnought: 1 }), { negotiators: 2 }, { factions: [G], unload: true });
ix('ixian-engineer', 5, [S], { acquireTech: {} }, when('tech-count', { trashSelfChoice: true, afterTrash: { vp: 1 } }, { amount: 3 }));
ix('jamis', 2, [R], { trashChoice: true }, { persuasion: 1, swords: 2 }, { factions: [R], infiltration: [R] });
ix('landing-rights', 4, [C], { shipping: 1 }, { persuasion: 2 }, { factions: [G] });
ix('local-fence', 3, [C], choose({}, { cost: { spice: 2 }, solari: 5 }, { cost: { solari: 5 }, spice: 4 }), { persuasion: 2 });
ix('negotiated-withdrawal', 4, [L, C, S], {}, seq({ persuasion: 2 }, { retreatUnitsFor: { count: 3, reward: inf } }), { acquire: { troops: 1 } });
ix('satellite-ban', 5, [G, R], discard(1, { spice: 1, water: 1 }), { persuasion: 1, retreatChoice: 2 }, { factions: [G, R] });
ix('sayyadina', 3, [B, R], pay({ water: 3 }, { vp: 1 }), bond(R, { persuasion: 3 }), { factions: [B, R] });
ix('shai-hulud', 7, [S], { trashChoice: true, afterTrash: { troops: 2 } }, bond(R, { swords: 5 }), { factions: [R], acquire: { trashChoice: true } });
ix('spice-trader', 4, [C, S], influence(R, 2, discard(1, { spice: 2 })), { persuasion: 2, swords: 1 }, { factions: [R] });
ix('treachery', 6, F, { trashSelf: true }, { troops: 2, forceDeployRecruits: true }, { unload: true, factionInfluence: 2 });
ix('truthsayer', 3, [E, B, L], discard(1, { draw: 1 }), { persuasion: 1, swords: 1 }, { factions: [E, B] });
ix('water-peddler', 1, [], {}, { water: 1 }, { unload: true, acquire: { water: 1 } });
ix('web-of-power', 4, [B], seq(influence(E, 2, { solari: 2 }), influence(G, 2, { draw: 1 }), influence(R, 2, { water: 1 })),
  { persuasion: 1, chooseInfluence: { amount: 1 } }, { infiltration: [B], factions: [B] });
ix('weirding-way', 3, [C, S], optional('立即再进行一个回合', { extraTurn: 1 }), { persuasion: 1, swords: 2 }, { factions: [B] });

card('experimentation', undefined, [S], { research: 1 }, { persuasion: 1, specimens: 1 });
imm('bene-tleilax-lab', 2, [C, S], { specimens: 1 }, seq({ persuasion: 1 }, gen(1, { spice: 1 })));
imm('bene-tleilax-researcher', 4, [L], { research: 1 }, seq({ persuasion: 1 }, gen(1, { persuasion: 1 }), gen(2, { persuasion: 1 })), { graft: true });
imm('blank-slate', 1, [L, C, S], {}, { persuasion: 1 }, { graftFactions: F });
imm('clandestine-meeting', 4, [], { influence: { [B]: 1 }, intrigue: 1 }, { persuasion: 2 }, { factions: [B] });
imm('corrupt-smuggler', 3, [G, S], grafted({ spice: 2 }), { persuasion: 1, swords: 1 }, { factions: [G, R] });
imm('dissecting-kit', 2, [L, C], { trashOtherGraftFor: { specimens: 1 } }, seq({ persuasion: 1 }, gen(1, { tleilaxu: 1 })), { graft: true });
imm('for-humanity', 7, [B, L, S], inf, seq({ persuasion: 2 }, alliance(B, { loseInfluenceForVP: 2 })), { factions: [B] });
imm('high-priority-travel', 1, [L, S], influence(G, 2, choose({ draw: 1 }, { combatAccess: true })), { persuasion: 1, solari: 1 }, { factions: [G] });
imm('imperium-ceremony', 6, [E, G, L], { peekIntrigues: 2 }, { persuasion: 3 }, { factions: [E, G] });
imm('interstellar-conspiracy', 4, [C], seq({ spice: 1 }, when('grafted-faction', inf, { factions: [E, G] })), { persuasion: 2 }, { graft: true });
imm('keys-to-power', 5, [G, B, L], influence(E, 2, { spice: 2 }), { persuasion: 2 }, { factions: [G, B] });
imm('lisan-al-gaib', 4, [R, C, S], bond(B, { influence: { [R]: 1 } }), seq({ persuasion: 1 }, bond(R, { swords: 2 })), { factions: [B, R], acquire: { spice: 1 } });
imm('long-reach', 6, [], { chooseInfluence: { amount: 1, distinct: 2 } }, { persuasion: 1, intrigue: 1 }, { factions: [B], conditionalIcons: 'bene-gesserit-bond' });
imm('occupation', 8, [...F, C, S], { draw: 1, combatAccess: true }, { water: 1, spice: 1, troops: 1 }, { factions: [G], acquire: { troops: 3 } });
imm('organ-merchants', 3, [C, S], pay({ specimens: 1 }, { solari: 4 }), { persuasion: 1, solari: 1 });
imm('planned-coupling', 3, [B], { draw: 1 }, { persuasion: 1 }, { graft: true, factions: [B] });
imm('replacement-eyes', 5, [C], { trashChoice: true, afterTrash: { draw: 1 } }, { persuasion: 1, swords: 1 }, { graft: true, onTrash: { tleilaxu: 1 } });
imm('sardaukar-quartermaster', 2, [L, C], grafted({ troops: 1, draw: 1 }), { persuasion: 1, swords: 2 }, { factions: [E] });
imm('shadout-mapes', 2, [R, S], {}, seq({ persuasion: 1, swords: 1 }, choose({ deployChoice: 1 }, { retreatChoice: 1 })), { factions: [R] });
imm('show-of-strength', 3, [], { draw: 2 }, { persuasion: 1, swords: 2 }, { factions: [E, R], conditionalIcons: 'most-conflict-troops' });
imm('spiritual-fervor', 3, [S], {}, { persuasion: 1, specimens: 1 }, { acquire: { research: 1 } });
imm('stillsuit-manufacturer', 5, [R, C], seq({ water: 1 }, alliance(R, { returnSelf: true })), seq({ persuasion: 1 }, bond(R, { spice: 2 })), { factions: [R] });
imm('throne-room-politics', 4, [E], { troops: 1, trashChoice: true }, { persuasion: 1, influence: { [B]: 1 } }, { factions: [E] });
imm('tleilaxu-master', 5, [L, S], gen(1, { acquireUpTo: 6, geneticDestination: true }), { persuasion: 1, research: 2 });
imm('tleilaxu-surgeon', 3, [E, C], pay({ specimens: 2 }, { tleilaxu: 2 }), seq({ persuasion: 2 }, { loseTroopsFor: { count: 2, reward: { specimens: 2 } } }));

tleilaxu('beguiling-pheromones', 2, [C, S], when('sent-faction', { trashGraftForInfluence: true }), { persuasion: 1, swords: 1 }, { graft: true });
tleilaxu('chairdog', 2, [C], { chairdog: true }, { persuasion: 2 }, { graft: true });
tleilaxu('contaminator', 1, [R], { tleilaxu: 1 }, { persuasion: 1 }, { factions: [R] });
tleilaxu('corrino-genes', 1, [E], grafted({ tleilaxu: 1 }), { persuasion: 1 }, { factions: [E], acquire: { solari: 2 } });
tleilaxu('face-dancer', 2, [E, G, R], { draw: 1 }, { persuasion: 1 }, { factions: [E, G, R], graft: true });
tleilaxu('face-dancer-initiate', 1, [E, G, R], {}, { persuasion: 1 }, { factions: [E, G, R], graft: true });
tleilaxu('from-the-tanks', 1, [L], { troops: 2 }, { persuasion: 1 });
tleilaxu('ghola', 3, [C], { copyGraft: true }, { persuasion: 1, swords: 1 }, { graft: true });
tleilaxu('guild-impersonator', 2, [G], { onSpiceGainGuild: true }, { persuasion: 1 }, { factions: [G], graft: true });
tleilaxu('industrial-espionage', 1, [L], seq({ draw: 1 }, grafted({ research: 1, specimens: 1 })), { persuasion: 1 });
tleilaxu('scientific-breakthrough', 3, [L, C, S], seq({ research: 1 }, gen(2, { trashSelfChoice: true, afterTrash: { vp: 1 } })), { persuasion: 1, swords: 1 });
tleilaxu('slig-farmer', 2, [L], seq({ solariPerOtherIcon: true }, pay({ solari: 5 }, { tleilaxu: 1 })), { persuasion: 1 }, { graft: true });
tleilaxu('stitched-horror', 3, [C], { chooseTwo: [{ water: 1 }, { troops: 1 }, { trashChoice: true }, { tleilaxu: 1 }] }, { persuasion: 1, swords: 1 }, { graft: true });
tleilaxu('subject-x-137', 2, [L, S], gen(1, { tleilaxu: 1 }), { persuasion: 1 }, { acquire: { tleilaxu: 1 } });
tleilaxu('tleilaxu-infiltrator', 2, [C], seq({ draw: 1 }, gen(2, { intrigue: 1 })), { persuasion: 1 }, { graft: true, infiltrateAll: true });
tleilaxu('twisted-mentat', 3, [L, C], optional('召回刚派出的特工', { recallThisAgent: true }), { persuasion: 1, specimens: 1 }, { graft: true });
tleilaxu('unnatural-reflexes', 3, [S], gen(1, { draw: 2 }), { persuasion: 1, swords: 1 }, { graft: true });
tleilaxu('usurp', 3, [], {}, { persuasion: 1, swords: 1, specimens: 1 }, { graft: true, graftMarket: true });
card('reclaimed-forces', undefined, [], {}, {}, { specimenCost: 3, fixed: true,
  acquire: { choice: [{ label: '征募 2 兵', effect: { troops: 2 } }, { label: '特莱拉前进一格', effect: { tleilaxu: 1 } }] } });

const INTRIGUES = {};
function intrigue(prefix, slug, timing, effect, requirement) {
  const id = `intrigue-${prefix}-${slug}`, ref = REFERENCE.entries.find(c => c.id === id);
  INTRIGUES[id] = { id, name: ref.name, englishName: ref.englishName, timing, effect, ...(requirement ? { requirement } : {}),
    expansion: ref.expansion, implementation: 'playable' };
}
const xi = (slug, timing, effect, requirement) => intrigue('ix', slug, timing, effect, requirement);
const mi = (slug, timing, effect, requirement) => intrigue('imm', slug, timing, effect, requirement);
xi('advanced-weaponry', ['plot', 'combat'], { timed: { plot: { cost: { solari: 3 }, commissionDreadnought: 1 }, combat: when('tech-count', { swords: 4 }, { amount: 3 }) } });
xi('blackmail', 'combat', { loseInfluenceForSwords: 5 }, { kind: 'any-influence' });
xi('cannon-turrets', 'combat', { swords: 2, opponentsRetreatDreadnought: true });
xi('cull', 'plot', { cost: { solari: 1 }, trashChoice: true });
xi('diversion', 'plot', { shipping: 1 }, { kind: 'deployed-units', amount: 4 });
xi('expedite', 'plot', { cost: { spice: 1 }, shipping: 1 });
xi('finesse', ['plot', 'combat'], { timed: { plot: { shiftOneInfluence: true }, combat: { swords: 2 } } });
xi('glimpse-the-path', 'plot', { cost: { spice: 1 }, water: 1, draw: 1 });
xi('grand-conspiracy', 'endgame', { grandConspiracy: true });
xi('ixian-probe', 'plot', { discardFor: { count: 2, reward: { draw: 2 }, optional: false } }, { kind: 'hand-count', amount: 2 });
xi('machine-culture', ['plot', 'endgame'], { timed: { plot: { acquireTech: {} }, endgame: when('tech-count', { vp: 1 }, { amount: 3 }) } });
xi('quid-pro-quo', 'plot', { cost: { spice: 2 }, influenceAtAgents: true });
xi('second-wave', 'combat', { swords: 2, deployUnitsChoice: 2 });
xi('secret-forces', 'plot', when('high-council', { troops: 2 }));
xi('strategic-push', 'combat', { swords: 2, winSolari: 2 });
xi('strongarm', 'plot', { loseTroopsFor: { count: 1, reward: { influenceSentFaction: true }, optional: false } }, { kind: 'strongarm' });
xi('war-chest', ['combat', 'endgame'], { timed: { combat: { cost: { solari: 2 }, swords: 4 }, endgame: when('resource', { vp: 1 }, { resource: 'solari', amount: 10 }) } });
mi('breakthrough', 'plot', { research: 1 });
mi('counterattack', ['plot', 'combat'], { timed: { plot: { deployChoice: 2 }, combat: when('opponent-combat-intrigue', { swords: 4 }) } });
mi('disguised-bureaucrat', 'plot', seq(gen(1, { spice: 1 }), gen(2, inf)));
mi('economic-positioning', ['combat', 'endgame'], { timed: { combat: { retreatTroopsFor: { count: 2, reward: { solari: 3 }, optional: false } },
  endgame: when('resource', { vp: 1 }, { resource: 'solari', amount: 10 }) } });
mi('gruesome-sacrifice', 'combat', { loseConflictTroops: 2, tleilaxu: 1, specimens: 2 });
mi('harvest-cells', 'combat-end', { steps: [{ specimens: 2 }, { acquireTleilaxuChoice: true }] }, { kind: 'combat-losses', amount: 3 });
mi('illicit-dealings', 'plot', { tleilaxu: 1 });
mi('shadowy-bargain', ['plot', 'endgame'], { timed: { plot: { specimens: 1 }, endgame: { tleilaxu: 1 } } });
mi('study-melange', ['plot', 'endgame'], { timed: { plot: { spice: 1 }, endgame: when('resource', gen(2, { vp: 1 }), { resource: 'spice', amount: 3 }) } });
mi('tleilaxu-puppet', ['plot', 'endgame'], { timed: { plot: { roundPersuasion: 1 }, endgame: when('high-council', gen(2, { vp: 1 })) } });
mi('vicious-talents', 'combat', seq({ swords: 2 }, gen(1, { swords: 2 }), gen(2, { swords: 2 })));

const CONFLICTS = [
  { id: 'conflict-ix-skirmish-i', name: 'Skirmish (Ix I)', level: 1, rewards: [{ shipping: 1, troops: 1 }, { spice: 2 }, { spice: 1 }] },
  { id: 'conflict-ix-skirmish-ii', name: 'Skirmish (Ix II)', level: 1, rewards: [{ shipping: 1, spice: 1 }, { solari: 3 }, { solari: 2 }] },
  { id: 'conflict-ix-trade-monopoly', name: 'Trade Monopoly', level: 2, rewards: [{ steps: [{ shipping: 1 }, { shipping: 1 }, { troops: 1 }] }, { intrigue: 1, water: 1 }, choose({ intrigue: 1 }, { water: 1 })] },
  { id: 'conflict-ix-economic-supremacy', name: 'Economic Supremacy', level: 3, rewards: [{ steps: [{ vp: 1 }, pay({ solari: 6 }, { vp: 1 }), pay({ spice: 4 }, { vp: 1 })] }, { vp: 1 }, { spice: 2, solari: 2 }] },
].map(c => ({ ...c, expansion: 'rise-of-ix', implementation: 'playable' }));
const LEADERS = {};
function leader(slug, complexity, passive, signet, signetEffect) {
  const id = 'leader-' + slug, ref = REFERENCE.entries.find(c => c.id === id);
  LEADERS[id] = { id, name: ref.name, englishName: ref.englishName, house: slug.includes('ecaz') ? 'ecaz' : slug.includes('vernius') ? 'vernius' : 'moritani',
    complexity, passive, signet, signetEffect, expansion: 'rise-of-ix', implementation: 'playable' };
}
leader('archduke-armand-ecaz', 2, '展示时，若至少两名特工在议会/城市/香料贸易格，可销毁一张场上牌。', '获得费用不超过 3 的帝国牌。', { acquireUpTo: 3 });
leader('ilesa-ecaz', 3, '轮开始秘密留置一张手牌；第二回合取回，派遣该牌时按图标数量获得额外资源。', '支付 1 索拉里获取 Foldspace。', pay({ solari: 1 }, { reserve: 'foldspace' }));
leader('prince-rhombur-vernius', 1, '无畏舰的基础战力为 4。', '获取科技或派遣一名谈判员。', choose({ acquireTech: {} }, { negotiators: 1 }));
leader('princess-yuna-moritani', 2, '起始没有水；本人回合每次获得索拉里时额外获得 1。', '支付 7 索拉里获得任一影响力、1 普通兵、1 香料。', pay({ solari: 7 }, { troops: 1, spice: 1, chooseInfluence: { amount: 1 } }));
leader('tessia-vernius', 3, '每个势力影响力 2 放置观察标记，触及后按回收顺序获得奖励。', '提升一个仍有观察标记的势力影响力。', { tessiaRing: true });
leader('viscount-hundro-moritani', 2, '开局查看两张阴谋，留一张，另一张放回牌顶。', '失去任意一势力 1 影响力，移动运输标记一次。', { hundroRing: true });
for (const c of CONFLICTS) { const ref = REFERENCE.entries.find(r => r.id === c.id); if (ref) { c.name = ref.name; c.englishName = ref.englishName; } }
module.exports = { CARDS, INTRIGUES, CONFLICTS, LEADERS };
