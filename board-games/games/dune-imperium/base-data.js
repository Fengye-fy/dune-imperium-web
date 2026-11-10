'use strict';

// Executable 2020 base-game definitions. Runtime/version support is explicit.
const FACTIONS = ['emperor', 'spacing-guild', 'bene-gesserit', 'fremen'];
const influence = (faction, amount = 1) => ({ influence: { [faction]: amount } });
const optional = (cost, effect, label) => ({ optional: true, choice: [{ label, effect: { cost, ...effect } }] });
const bond = then => ({ condition: { kind: 'bond', faction: 'fremen' }, then });
const synergy = then => ({ condition: { kind: 'bond', faction: 'bene-gesserit' }, then });
const alliance = (faction, then) => ({ condition: { kind: 'alliance', faction }, then });
const anyInfluence = (amount = 1) => ({ chooseInfluence: { amount } });
const trash = { trashChoice: true };
const card = (id, name, cost, icons, agent, reveal, extra = {}) => ({
  id, name, cost, icons, agent, reveal, edition: 'base-2020', implementation: 'playable', ...extra,
});
const CARDS = Object.fromEntries([
  card('arrakis-recruiter', '厄拉科斯征募员', 2, ['city'], { troops: 1 }, { persuasion: 1, swords: 1 }),
  card('assassination-mission', '暗杀任务', 1, [], {}, { solari: 1, swords: 1 }, { onTrash: { solari: 4 } }),
  card('bene-gesserit-initiate', '贝尼·杰瑟里特见习者', 3, ['landsraad', 'city', 'spice-trade'], { draw: 1 }, { persuasion: 1 }, { factions: ['bene-gesserit'] }),
  card('bene-gesserit-sister', '贝尼·杰瑟里特姐妹', 3, ['bene-gesserit', 'landsraad'], {},
    { choice: [{ label: '获得 2 说服力', effect: { persuasion: 2 } }, { label: '获得 2 剑', effect: { swords: 2 } }] }, { factions: ['bene-gesserit'] }),
  card('carryall', '运载机', 5, ['spice-trade'], { doubleHarvest: true }, { persuasion: 1, spice: 1 }),
  card('chani', '契妮', 5, ['fremen', 'city', 'spice-trade'], {}, { steps: [{ persuasion: 2 }, { retreatChoice: 'all' }] }, { factions: ['fremen'], acquire: { water: 1 } }),
  card('choam-directorship', '宇联公司董事席位', 8, [], {}, { solari: 3 }, { acquire: { influence: Object.fromEntries(FACTIONS.map(f => [f, 1])) } }),
  card('crysknife', '晶牙匕', 3, ['fremen', 'spice-trade'], { solari: 1 }, { steps: [{ swords: 1 }, bond(influence('fremen'))] }, { factions: ['fremen'] }),
  card('dr-yueh', '岳医生', 1, ['city'], { draw: 1 }, { persuasion: 1 }),
  card('duncan-idaho', '邓肯·艾达荷', 4, ['city'], optional({ water: 1 }, { troops: 1, draw: 1 }, '支付 1 水，招募 1 兵并抽 1 张牌'), { water: 1, swords: 3 }),
  card('fedaykin-death-commando', '费达金敢死队', 3, ['city', 'spice-trade'], trash, { steps: [{ persuasion: 1 }, bond({ swords: 3 })] }, { factions: ['fremen'] }),
  card('firm-grip', '牢固掌控', 4, ['emperor', 'landsraad'],
    { optional: true, choice: FACTIONS.filter(f => f !== 'emperor').map(f => ({ label: `支付 2 索拉里，提升 ${f} 影响力`, effect: { cost: { solari: 2 }, ...influence(f) } })) },
    alliance('emperor', { persuasion: 4 }), { factions: ['emperor'] }),
  card('fremen-camp', '弗雷曼营地', 4, ['spice-trade'], optional({ spice: 2 }, { troops: 3 }, '支付 2 香料，招募 3 兵'), { persuasion: 2, swords: 1 }, { factions: ['fremen'] }),
  card('gene-manipulation', '基因操纵', 3, ['landsraad', 'city'], { steps: [trash, synergy({ spice: 2 })] }, { persuasion: 2 }, { factions: ['bene-gesserit'] }),
  card('guild-administrator', '公会行政官', 2, ['spacing-guild', 'spice-trade'], trash, { persuasion: 1 }, { factions: ['spacing-guild'] }),
  card('guild-ambassador', '公会大使', 4, ['landsraad'], { choice: [
    { label: '公会影响力 +1', effect: influence('spacing-guild') }, { label: '获得 2 香料', effect: { spice: 2 } },
  ] }, alliance('spacing-guild', optional({ spice: 3 }, { vp: 1 }, '支付 3 香料，获得 1 分')), { factions: ['spacing-guild'] }),
  card('guild-bankers', '公会银行家', 3, ['emperor', 'spacing-guild', 'landsraad'], {}, { spiceMustFlowDiscount: 3 }, { factions: ['spacing-guild'] }),
  card('gun-thopter', '武装扑翼机', 4, ['city', 'spice-trade'], { enemyGarrisonLoss: 1 }, { steps: [{ swords: 3 }, { deployChoice: 1 }] }),
  card('gurney-halleck', '哥尼·哈莱克', 6, ['city'], { troops: 2, draw: 1 },
    { steps: [{ persuasion: 2 }, optional({ solari: 3 }, { troops: 2, deployRecruits: true }, '支付 3 索拉里，招募至多 2 兵并选择部署')] }),
  card('imperial-spy', '帝国间谍', 2, ['emperor'], { trashSelfChoice: true, afterTrash: { intrigue: 1 } }, { persuasion: 1, swords: 1 }, { factions: ['emperor'] }),
  card('kwisatz-haderach', '魁萨茨·哈德拉克', 8, [], { draw: 1 }, {}, { factions: ['bene-gesserit'], moveAgent: true }),
  card('lady-jessica', '杰西卡夫人', 7, ['bene-gesserit', 'landsraad', 'city', 'spice-trade'], { draw: 2 }, { persuasion: 3, swords: 1 }, { factions: ['bene-gesserit'], acquire: anyInfluence() }),
  card('liet-kynes', '列特·凯恩斯', 5, ['fremen', 'city'], {}, { persuasionPerFaction: { faction: 'fremen', amount: 2 } }, { factions: ['emperor', 'fremen'], acquire: influence('emperor') }),
  card('missionaria-protectiva', '传道保护团', 1, ['city'], synergy(anyInfluence()), { persuasion: 1 }, { factions: ['bene-gesserit'] }),
  card('opulence', '奢华', 6, ['emperor'], { solari: 3 }, { steps: [{ persuasion: 1 }, optional({ solari: 6 }, { vp: 1 }, '支付 6 索拉里，获得 1 分')] }, { factions: ['emperor'] }),
  card('other-memory', '前世记忆', 4, ['city', 'spice-trade'], { drawDiscardFactionChoice: 'bene-gesserit' }, { persuasion: 2 }, { factions: ['bene-gesserit'] }),
  card('piter-de-vries', '彼得·德弗里斯', 5, ['landsraad', 'city'], { intrigue: 1 }, { persuasion: 3, swords: 1 }),
  card('power-play', '权力博弈', 5, FACTIONS, { trashSelf: true }, {}, { factionInfluence: 2 }),
  card('reverend-mother-mohiam', '莫希阿姆圣母', 6, ['emperor', 'bene-gesserit'],
    synergy({ opponentsDiscard: 2 }), { persuasion: 2, spice: 2 }, { factions: ['emperor', 'bene-gesserit'] }),
  card('sardaukar-infantry', '萨多卡步兵', 1, [], {}, { persuasion: 1, swords: 2 }, { factions: ['emperor'] }),
  card('sardaukar-legion', '萨多卡军团', 5, ['emperor', 'landsraad'], { troops: 2 }, { steps: [{ persuasion: 1 }, { deployChoice: 3 }] }, { factions: ['emperor'] }),
  card('scout', '斥候', 1, ['city', 'spice-trade'], {}, { steps: [{ persuasion: 1, swords: 1 }, { retreatChoice: 2 }] }),
  card('shifting-allegiances', '转移效忠', 3, ['landsraad', 'spice-trade'], { shiftInfluenceChoice: true }, { persuasion: 2 }),
  card('sietch-reverend-mother', '穴地圣母', 4, ['bene-gesserit', 'fremen'], trash, bond({ persuasion: 3, spice: 1 }), { factions: ['bene-gesserit', 'fremen'] }),
  card('smugglers-thopter', '走私者扑翼机', 4, ['spice-trade'], { condition: { kind: 'influence', faction: 'spacing-guild', amount: 2 }, then: { draw: 2 } }, { persuasion: 1, spice: 1 }, { factions: ['spacing-guild'] }),
  card('space-travel', '太空旅行', 3, ['spacing-guild', 'spice-trade'], { draw: 1 }, { persuasion: 2 }, { factions: ['spacing-guild'] }),
  card('spice-hunter', '香料猎人', 2, ['fremen', 'spice-trade'], {}, { steps: [{ persuasion: 1, swords: 1 }, bond({ spice: 1 })] }, { factions: ['fremen'] }),
  card('spice-smugglers', '香料走私者', 2, ['city'], optional({ spice: 2 }, { ...influence('spacing-guild'), solari: 3 }, '支付 2 香料，提升公会影响力并获得 3 索拉里'), { persuasion: 1, swords: 1 }, { factions: ['spacing-guild'] }),
  card('stilgar', '斯蒂尔加', 5, ['fremen', 'city', 'spice-trade'], { water: 1 }, { persuasion: 2, swords: 3 }, { factions: ['fremen'] }),
  card('test-of-humanity', '人性考验', 3, ['bene-gesserit', 'landsraad', 'city'], { opponentsDiscard: 1, orTroopLoss: true }, { persuasion: 2 }, { factions: ['bene-gesserit'] }),
  card('the-voice', '魅音', 2, ['city', 'spice-trade'], { voiceChoice: true }, { persuasion: 2 }, { factions: ['bene-gesserit'] }),
  card('thufir-hawat', '瑟菲尔·哈瓦特', 5, [...FACTIONS, 'city', 'spice-trade'], { draw: 1 }, { persuasion: 1, intrigue: 1 }),
  card('worm-riders', '沙虫骑手', 6, ['city', 'spice-trade'], { spice: 2 },
    { steps: [{ condition: { kind: 'influence', faction: 'fremen', amount: 2 }, then: { swords: 4 } }, alliance('fremen', { swords: 2 })] }, { factions: ['fremen'] }),
].map(c => [c.id, c]));

const intrigue = (slug, name, timing, effect, extra = {}) => ({
  id: 'intrigue-' + slug, name, timing, effect, edition: 'base-2020', implementation: 'playable', ...extra,
});
const INTRIGUES = Object.fromEntries([
  intrigue('allied-armada', '同盟舰队', 'combat', { cost: { spice: 2 }, swords: 7 }, { requirement: { kind: 'any-alliance' } }),
  intrigue('ambush', '伏击', 'combat', { swords: 4 }),
  intrigue('bindu-suspension', '宾杜暂停', 'plot', { draw: 1, bindu: true }, { requirement: { kind: 'turn-start' } }),
  intrigue('bribery', '贿赂', 'plot', { cost: { solari: 2 }, ...anyInfluence() }),
  intrigue('bypass-protocol', '绕过协议', 'plot', { bypassChoice: true }),
  intrigue('calculated-hire', '精算雇佣', 'plot', { cost: { spice: 1 }, mentat: true }, { requirement: { kind: 'mentat-available' } }),
  intrigue('charisma', '魅力', 'plot', { roundPersuasion: 2 }),
  intrigue('choam-shares', '宇联股份', 'plot', { cost: { solari: 7 }, vp: 1 }),
  intrigue('corner-the-market', '垄断市场', 'endgame', { cornerTheMarket: true }),
  intrigue('councilor-s-dispensation', '议员特许', 'plot', { spice: 2 }, { requirement: { kind: 'high-council' } }),
  intrigue('demand-respect', '赢得敬重', 'combat-win', { demandRespectChoice: true }),
  intrigue('dispatch-an-envoy', '派遣使节', 'plot', { nextAgentFactions: true }, { requirement: { kind: 'agent-turn' } }),
  intrigue('double-cross', '背叛', 'plot', { cost: { solari: 1 }, doubleCrossChoice: true }),
  intrigue('favored-subject', '受宠臣民', 'plot', influence('emperor')),
  intrigue('guild-authorization', '公会授权', 'plot', influence('spacing-guild')),
  intrigue('infiltrate', '渗透', 'plot', { infiltrate: true }),
  intrigue('know-their-ways', '熟知其道', 'plot', influence('fremen')),
  intrigue('master-tactician', '战术大师', 'combat', { choice: [{ label: '获得 3 剑', effect: { swords: 3 } }, { label: '撤回至多 3 兵', effect: { retreatChoice: 3 } }] }),
  intrigue('plans-within-plans', '计中计', 'endgame', { plansWithinPlans: true }),
  intrigue('poison-snooper', '毒物探测器', 'plot', { peekChoice: true }),
  intrigue('private-army', '私人军队', 'combat', { cost: { spice: 2 }, swords: 5 }),
  intrigue('rapid-mobilization', '快速动员', 'plot', { deployChoice: 'all' }),
  intrigue('recruitment-mission', '招募任务', 'plot', { roundPersuasion: 1, acquireTopdeck: true }),
  intrigue('refocus', '重整思路', 'plot', { refocus: true }),
  intrigue('reinforcements', '援军', 'plot', { cost: { solari: 3 }, troops: 3, deployOnReveal: true }),
  intrigue('secret-of-the-sisterhood', '姐妹会的秘密', 'plot', influence('bene-gesserit')),
  intrigue('staged-incident', '策划事端', 'combat', { loseConflictTroops: 3, vp: 1 }),
  intrigue('the-sleeper-must-awaken', '沉睡者必须觉醒', 'plot', { cost: { spice: 4 }, vp: 1 }),
  intrigue('tiebreaker', '打破平局', ['combat', 'endgame'], { tiebreaker: true }),
  intrigue('to-the-victory', '献给胜者', 'combat-win', { spice: 3 }),
  intrigue('urgent-mission', '紧急任务', 'plot', { recallChoice: true }, { requirement: { kind: 'placed-agent' } }),
  intrigue('water-of-life', '生命之水', 'plot', { cost: { water: 1, spice: 1 }, draw: 3 }),
  intrigue('water-peddlers-union', '水贩联盟', 'plot', { water: 1 }),
  intrigue('windfall', '意外之财', 'plot', { solari: 2 }),
].map(c => [c.id, c]));

const conflict = (slug, name, level, rewards, control) => ({
  id: 'conflict-' + slug, name, level, rewards, ...(control ? { control } : {}), edition: 'base-2020', implementation: 'playable',
});
const CONFLICTS = [
  conflict('skirmish-1', '小规模冲突·索拉里', 1, [{ steps: [{ solari: 2 }, anyInfluence()] }, { solari: 3 }, { solari: 2 }]),
  conflict('skirmish-2', '小规模冲突·香料', 1, [{ steps: [{ spice: 1 }, anyInfluence()] }, { spice: 2 }, { spice: 1 }]),
  conflict('skirmish-3', '小规模冲突·水', 1, [{ vp: 1 }, { water: 1 }, { spice: 1 }]),
  conflict('skirmish-4', '小规模冲突·阴谋', 1, [{ vp: 1 }, { intrigue: 1, solari: 2 }, { solari: 2 }]),
  conflict('desert-power', '沙漠之力', 2, [{ vp: 1, water: 1 }, { water: 1, spice: 1 }, { spice: 1 }]),
  conflict('raid-stockpiles', '突袭储备', 2, [{ intrigue: 1, spice: 3 }, { spice: 2 }, { spice: 1 }]),
  conflict('cloak-and-dagger', '暗中较量', 2, [{ steps: [{ intrigue: 2 }, anyInfluence()] }, { intrigue: 1, spice: 1 }, { choice: [{ label: '抽 1 阴谋', effect: { intrigue: 1 } }, { label: '获得 1 香料', effect: { spice: 1 } }] }]),
  conflict('machinations', '谋划', 2, [{ chooseInfluence: { amount: 1, distinct: 2 } }, { water: 1, solari: 2 }, { water: 1 }]),
  conflict('sort-through-the-chaos', '乱中取利', 2, [{ nextMentat: true, intrigue: 1, solari: 2 }, { intrigue: 1, solari: 2 }, { solari: 2 }]),
  conflict('terrible-purpose', '可怕使命', 2, [{ steps: [{ vp: 1 }, trash] }, { water: 1, spice: 1 }, { spice: 1 }]),
  conflict('guild-bank-raid', '突袭公会银行', 2, [{ solari: 6 }, { solari: 4 }, { solari: 2 }]),
  conflict('siege-of-arrakeen', '围攻厄拉科恩', 2, [{ vp: 1, control: 'arrakeen' }, { solari: 4 }, { solari: 2 }], 'arrakeen'),
  conflict('siege-of-carthag', '围攻迦太格', 2, [{ vp: 1, control: 'carthag' }, { intrigue: 1, spice: 1 }, { spice: 1 }], 'carthag'),
  conflict('secure-imperial-basin', '控制帝国盆地', 2, [{ vp: 1, control: 'imperial-basin' }, { water: 2 }, { water: 1 }], 'imperial-basin'),
  conflict('battle-for-arrakeen', '厄拉科恩之战', 3, [{ vp: 2, control: 'arrakeen' }, { choice: [
    { label: '阴谋 + 2 香料', effect: { intrigue: 1, spice: 2 } },
    { label: '阴谋 + 3 索拉里', effect: { intrigue: 1, solari: 3 } },
    { label: '2 香料 + 3 索拉里', effect: { spice: 2, solari: 3 } },
  ] }, { intrigue: 1, solari: 2 }], 'arrakeen'),
  conflict('battle-for-carthag', '迦太格之战', 3, [{ vp: 2, control: 'carthag' }, { intrigue: 1, spice: 3 }, { spice: 3 }], 'carthag'),
  conflict('battle-for-imperial-basin', '帝国盆地之战', 3, [{ vp: 2, control: 'imperial-basin' }, { solari: 5 }, { solari: 3 }], 'imperial-basin'),
  conflict('grand-vision', '宏伟愿景', 3, [{ steps: [{ intrigue: 1 }, anyInfluence(2)] }, { intrigue: 1, spice: 3 }, { spice: 3 }]),
];

const PENDING = {};
module.exports = { CARDS, INTRIGUES, CONFLICTS, PENDING };
