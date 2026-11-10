'use strict';

const RULEBOOK = 'https://d19y2ttatozxjp.cloudfront.net/pdfs/DUNE_IMPERIUM_Rules_2020_10_26.pdf';
const FACTIONS = ['emperor', 'spacing-guild', 'bene-gesserit', 'fremen'];
const ALL_ICONS = [...FACTIONS, 'landsraad', 'city', 'spice-trade'];
const BASE = require('./base-data');
const REFERENCE = require('./catalog-base.json');
const { LEADERS } = require('./leaders');
const EXPANSION_CONTENT = require('./expansion-cards');
Object.assign(LEADERS, EXPANSION_CONTENT.LEADERS);

const manifest = {
  id: 'dune-imperium', name: '沙丘：帝国', englishName: 'Dune: Imperium',
  status: 'experimental', minPlayers: 3, maxPlayers: 4, ruleset: 'base-dev-v3',
  supportedRulesets: ['expansions-dev-v4', 'base-dev-v3', 'base-subset-v2', 'core-dev-v1'],
  description: '基础版及 Rise of Ix / Immortality 的 3–4 人后端开发版，支持独立或组合扩展，待用户验收。',
  assets: {
    mode: 'local-static',
    manifestUrl: '/board-games/assets/dune-imperium/manifest.json',
  },
  supportedExpansions: ['rise-of-ix', 'immortality'],
  expansionCatalog: [
    { id: 'rise-of-ix', name: 'Rise of Ix', playable: true, status: 'implemented-unverified' },
    { id: 'immortality', name: 'Immortality', playable: true, status: 'implemented-unverified' },
  ],
  limitations: [
    '仅支持 3–4 人真人对局；未实现 House Hagal、AI、Epic、Go to 11 和 Uprising。',
    '基础版及两款扩展已录入并接入引擎；本轮未运行测试，仍需用户进行规则与对局验收。',
    '旧 base-subset-v2 和 core-dev-v1 存档保持原牌库与规则，不自动追加新牌或领袖。',
    '单卡派遣选择卡牌、行动格与影响力的整体顺序；嫁接通过后端选项排列两张牌、行动格与影响力。单张牌内部多段效果仍按数据顺序结算。',
    '扩展局使用 expansions-dev-v4，按房间配置替换起始牌与行动格；中文牌名仅作开发译名。',
  ],
  sources: [{ title: 'Dire Wolf 官方基础版规则（含行动格）', url: RULEBOOK },
    { title: 'Dire Wolf Rise of Ix 官方规则', url: 'https://d19y2ttatozxjp.cloudfront.net/pdfs/DUNE_IMPERIUM_RISE_OF_IX_Rulebook_22-2-11.pdf' },
    { title: 'Dire Wolf Immortality 官方规则', url: 'https://d19y2ttatozxjp.cloudfront.net/pdfs/DUNE_IMPERIUM_IMMORTALITY_Rulebook.pdf' }],
};

const card = (id, name, icons, reveal, extra = {}) => ({ id, name, icons, reveal, agent: {}, ...extra });
const CARDS = {
  'convincing-argument': card('convincing-argument', '有力论证', [], { persuasion: 2 }),
  dagger: card('dagger', '匕首', ['landsraad'], { swords: 1 }),
  diplomacy: card('diplomacy', '外交', FACTIONS, { persuasion: 1 }),
  'dune-desert-planet': card('dune-desert-planet', '沙丘，沙漠星球', ['spice-trade'], { persuasion: 1 }),
  reconnaissance: card('reconnaissance', '侦察', ['city'], { persuasion: 1 }),
  'seek-allies': card('seek-allies', '寻求盟友', FACTIONS, {}, { agent: { trashSelf: true } }),
  'signet-ring': card('signet-ring', '印章戒指', ['landsraad', 'city', 'spice-trade'], { persuasion: 1 }, { note: 'base-dev-v3 派遣时触发本人领袖的戒指技能；旧存档不触发。' }),
  'arrakis-liaison': card('arrakis-liaison', '厄拉科斯联络人', ['landsraad', 'city'], { persuasion: 2 }, { cost: 2, faction: 'fremen', factions: ['fremen'], reserve: true }),
  'the-spice-must-flow': card('the-spice-must-flow', '香料必须流动', [], { spice: 1 }, { cost: 9, acquire: { vp: 1 }, reserve: true }),
  foldspace: card('foldspace', '折叠空间', ALL_ICONS, {}, { agent: { draw: 1, trashSelf: true }, reserve: true }),
  'dev-envoy': card('dev-envoy', '测试牌·使者', FACTIONS, { persuasion: 2 }, { cost: 3, developmentOnly: true }),
  'dev-scout': card('dev-scout', '测试牌·斥候', ['city', 'spice-trade'], { persuasion: 1, swords: 1 }, { cost: 3, agent: { draw: 1 }, developmentOnly: true }),
  'dev-recruiter': card('dev-recruiter', '测试牌·征募官', ['landsraad', 'emperor'], { persuasion: 2, swords: 1 }, { cost: 4, agent: { troops: 1 }, developmentOnly: true }),
  'dev-water-carrier': card('dev-water-carrier', '测试牌·运水者', ['fremen', 'city'], { persuasion: 2 }, { cost: 4, agent: { water: 1 }, developmentOnly: true }),
  'dev-spice-broker': card('dev-spice-broker', '测试牌·香料经纪', ['spice-trade', 'spacing-guild'], { persuasion: 3 }, { cost: 5, agent: { spice: 1 }, developmentOnly: true }),
};
const STARTER = ['convincing-argument', 'convincing-argument', 'dagger', 'dagger', 'diplomacy', 'dune-desert-planet', 'dune-desert-planet', 'reconnaissance', 'seek-allies', 'signet-ring'];
const RESERVE = { 'arrakis-liaison': 8, 'the-spice-must-flow': 10, foldspace: 6 };
const INTRIGUES = {
  'dev-ambush': { id: 'dev-ambush', name: '测试阴谋·伏击', timing: 'combat', effect: { swords: 4 }, developmentOnly: true },
  'dev-cache': { id: 'dev-cache', name: '测试阴谋·补给', timing: 'plot', effect: { spice: 1 }, developmentOnly: true },
  'dev-water': { id: 'dev-water', name: '测试阴谋·储水', timing: 'plot', effect: { water: 1 }, developmentOnly: true },
  'dev-legacy': { id: 'dev-legacy', name: '测试阴谋·遗产', timing: 'endgame', effect: { vp: 1 }, developmentOnly: true },
};
Object.assign(CARDS, BASE.CARDS);
Object.assign(INTRIGUES, BASE.INTRIGUES);
Object.assign(CARDS, EXPANSION_CONTENT.CARDS);
Object.assign(INTRIGUES, EXPANSION_CONTENT.INTRIGUES);
const space = (id, name, icon, effect, extra = {}) => ({ id, name, icon, effect, cost: {}, combat: false, ...extra });
const SPACES = [
  space('wealth', '财富', 'emperor', { solari: 2 }, { faction: 'emperor' }),
  space('conspire', '密谋', 'emperor', { solari: 5, troops: 2, intrigue: 1 }, { faction: 'emperor', cost: { spice: 4 } }),
  space('foldspace', '折叠空间', 'spacing-guild', { reserve: 'foldspace' }, { faction: 'spacing-guild' }),
  space('heighliner', '运输舰', 'spacing-guild', { troops: 5, water: 2 }, { faction: 'spacing-guild', cost: { spice: 6 }, combat: true }),
  space('secrets', '秘密', 'bene-gesserit', { intrigue: 1, stealIntrigue: true }, { faction: 'bene-gesserit' }),
  space('selective-breeding', '选择性育种', 'bene-gesserit', { selectiveBreeding: true }, { faction: 'bene-gesserit', cost: { spice: 2 } }),
  space('stillsuits', '蒸馏服', 'fremen', { water: 1 }, { faction: 'fremen', combat: true }),
  space('hardy-warriors', '坚韧战士', 'fremen', { troops: 2 }, { faction: 'fremen', cost: { water: 1 }, combat: true }),
  space('arrakeen', '厄拉科恩', 'city', { troops: 1, draw: 1 }, { combat: true, controlBonus: { solari: 1 } }),
  space('carthag', '迦太格', 'city', { troops: 1, intrigue: 1 }, { combat: true, controlBonus: { solari: 1 } }),
  space('research-station', '研究站', 'city', { draw: 3 }, { cost: { water: 2 }, combat: true }),
  space('sietch-tabr', '塔布穴地', 'city', { troops: 1, water: 1 }, { combat: true, requirement: { faction: 'fremen', influence: 2 } }),
  space('imperial-basin', '帝国盆地', 'spice-trade', { spice: 1 }, { combat: true, maker: true, controlBonus: { spice: 1 } }),
  space('hagga-basin', '哈加盆地', 'spice-trade', { spice: 2 }, { cost: { water: 1 }, combat: true, maker: true }),
  space('great-flat', '大平原', 'spice-trade', { spice: 3 }, { cost: { water: 2 }, combat: true, maker: true }),
  space('secure-contract', '确保合同', 'spice-trade', { solari: 3 }),
  space('sell-melange', '出售香料', 'spice-trade', { sellMelange: true }),
  space('hall-of-oratory', '演说大厅', 'landsraad', { troops: 1 }, { revealPersuasion: 1 }),
  space('mentat', '门泰特', 'landsraad', { draw: 1, mentat: true }, { cost: { solari: 2 } }),
  space('high-council', '最高议会', 'landsraad', { highCouncil: true }, { cost: { solari: 5 }, oncePerGame: 'highCouncil' }),
  space('swordmaster', '剑术大师', 'landsraad', { swordmaster: true }, { cost: { solari: 8 }, oncePerGame: 'swordmaster' }),
  space('rally-troops', '集结部队', 'landsraad', { troops: 4 }, { cost: { solari: 4 } }),
];
const SPACE_BY_ID = Object.fromEntries(SPACES.map(s => [s.id, s]));
const INFLUENCE_BONUS = { emperor: { troops: 2 }, 'spacing-guild': { solari: 3 }, 'bene-gesserit': { intrigue: 1 }, fremen: { water: 1 } };

function developmentConflicts() {
  return Array.from({ length: 10 }, (_, i) => {
    const level = i === 0 ? 1 : i < 6 ? 2 : 3;
    const control = ['arrakeen', 'carthag', 'imperial-basin'][i % 3];
    return { id: `dev-conflict-${i + 1}`, name: `开发冲突 ${i + 1}`, level, developmentOnly: true, control,
      rewards: [{ vp: level === 3 ? 2 : 1, control }, { solari: level + 2 }, { spice: 1 }] };
  });
}

const BASE_MARKET = REFERENCE.entries.filter(c => c.category === 'imperium' && BASE.CARDS[c.id])
  .flatMap(c => Array(c.copies).fill(c.id));
const BASE_INTRIGUE_DECK = REFERENCE.entries.filter(c => c.category === 'intrigue' && BASE.INTRIGUES[c.id])
  .flatMap(c => Array(c.copies).fill(c.id));
manifest.content = {
  edition: 'base-2020', referenceCardFaces: REFERENCE.entries.filter(c => c.category !== 'location').length,
  market: { implemented: Object.keys(BASE.CARDS).length, unique: 43, copies: BASE_MARKET.length, fullCopies: 67 },
  intrigue: { implemented: Object.keys(BASE.INTRIGUES).length, unique: 34, copies: BASE_INTRIGUE_DECK.length, fullCopies: 40 },
  conflicts: { implemented: BASE.CONFLICTS.length, unique: 18 }, leaders: { implemented: 8, unique: 8 },
};

module.exports = { manifest, RULEBOOK, FACTIONS, ALL_ICONS, CARDS, STARTER, RESERVE, INTRIGUES,
  SPACES, SPACE_BY_ID, INFLUENCE_BONUS, developmentConflicts, BASE_MARKET, BASE_INTRIGUE_DECK,
  BASE_CONFLICTS: BASE.CONFLICTS, REFERENCE, PENDING_CONTENT: BASE.PENDING, LEADERS };
