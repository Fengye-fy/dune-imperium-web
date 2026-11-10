'use strict';

// Content metadata is deliberately separate from executable card definitions.
// Having an image or a setup recipe must never make a card playable.
const REFERENCE = require('./catalog-expansions.json');
const NAMES_ZH = require('./expansion-names-zh.json');
for (const entry of REFERENCE.entries) entry.name = NAMES_ZH[entry.id] || entry.englishName;
const clone = value => JSON.parse(JSON.stringify(value));
const IDS = ['rise-of-ix', 'immortality'];
const SOURCES = {
  'rise-of-ix': 'https://d19y2ttatozxjp.cloudfront.net/pdfs/DUNE_IMPERIUM_RISE_OF_IX_Rulebook_22-2-11.pdf',
  immortality: 'https://d19y2ttatozxjp.cloudfront.net/pdfs/DUNE_IMPERIUM_IMMORTALITY_Rulebook.pdf',
  researchBoard: 'https://d19y2ttatozxjp.cloudfront.net/wp-content/uploads/2025/04/22195145/immortality-tleilaxu-board.jpg',
};
const EXPANSIONS = {
  'rise-of-ix': { id: 'rise-of-ix', name: 'Rise of Ix', playable: true,
    status: 'implemented-unverified', reason: '已接入扩展对局与效果队列；待用户执行测试及规则验收。',
    expected: { market: 35, intrigue: 17, conflicts: 4, leaders: 6, tech: 18 }, rulebook: SOURCES['rise-of-ix'] },
  immortality: { id: 'immortality', name: 'Immortality', playable: true,
    status: 'implemented-unverified', reason: '已接入研究、特莱拉牌市与双卡嫁接；待用户执行测试及规则验收。',
    expected: { market: 30, intrigue: 15, tleilaxu: 18, fixed: 1, starterPerPlayer: 2 }, rulebook: SOURCES.immortality },
};
function error(code, message) { return Object.assign(new Error(message), { code, status: 400 }); }
function normalizeOptions(options = {}, { allowUnavailable = false } = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => key !== 'expansions')) throw error('UNSUPPORTED_OPTIONS', '只支持 expansions 开局参数。');
  const selected = options.expansions === undefined ? [] : options.expansions;
  if (!Array.isArray(selected) || selected.length > IDS.length ||
      selected.some(id => typeof id !== 'string' || !IDS.includes(id)) || new Set(selected).size !== selected.length) {
    throw error('INVALID_EXPANSIONS', 'expansions 必须是不重复的 rise-of-ix / immortality 数组。');
  }
  const expansions = IDS.filter(id => selected.includes(id));
  if (!allowUnavailable) for (const id of expansions) if (!EXPANSIONS[id].playable) {
    throw error('EXPANSION_NOT_READY', `${EXPANSIONS[id].name} 尚未接入完整对局：${EXPANSIONS[id].reason}`);
  }
  return { expansions };
}
function physicalCards(expansions, category, { fixed = false } = {}) {
  return REFERENCE.entries.filter(c => expansions.includes(c.expansion) && c.category === category && Boolean(c.fixed) === fixed)
    .flatMap(c => Array(c.copies).fill(c.id));
}
const IX_SPACES = [
  { id: 'tech-negotiation', name: '科技谈判', icon: 'landsraad', cost: {}, combat: false,
    revealPersuasion: 1, effect: { choice: [
      { label: '以 1 香料折扣获取科技', effect: { acquireTech: { discount: 1 } } },
      { label: '派遣 1 名谈判员', effect: { negotiators: 1 } },
    ] } },
  { id: 'dreadnought', name: '无畏舰', icon: 'landsraad', cost: { solari: 3 }, combat: false,
    effect: { steps: [{ commissionDreadnought: 1 }, { acquireTech: { discount: 0 } }] } },
  { id: 'interstellar-shipping', name: '星际运输', icon: 'spice-trade', cost: {}, combat: false,
    requirement: { faction: 'spacing-guild', influence: 2 }, effect: { steps: [{ shipping: 1 }, { shipping: 1 }] } },
  { id: 'smuggling', name: '走私', icon: 'spice-trade', cost: {}, combat: false,
    effect: { solari: 1, shipping: 1 } },
];
function spacesFor(baseSpaces, expansions) {
  let spaces = clone(baseSpaces).map(space => ({ ...space, board: 'base' }));
  if (expansions.includes('rise-of-ix')) {
    const removed = ['hall-of-oratory', 'rally-troops', 'secure-contract', 'sell-melange'];
    spaces = spaces.filter(s => !removed.includes(s.id)).map(space => space.icon === 'landsraad' ? { ...space, board: 'choam-overlay' } : space)
      .concat(clone(IX_SPACES).map(space => ({ ...space, board: 'choam-overlay' })));
  }
  if (expansions.includes('immortality')) spaces = spaces.map(s => s.id === 'research-station' ?
    { ...s, effect: { draw: 2, research: 1 }, overlay: 'immortality', board: 'research-station-overlay' } : s);
  return spaces;
}
// Coordinates use x increasing to the right, y increasing toward the top.
// An edge always advances exactly one column and at most one row.
const CELLS = [
  [0, 0, {}], [1, 0, { specimens: 1 }],
  [2, 1, { specimens: 1 }], [2, -1, { tleilaxu: 1 }],
  [3, 2, { research: 1 }], [3, 0, { steps: [{ trashChoice: true }, { specimens: 1 }] }], [3, -2, { tleilaxu: 1, specimens: 1 }],
  [4, 1, { tleilaxu: 1 }], [4, -1, { specimens: 1 }], [4, -3, { research: 1 }],
  [5, 2, { research: 1 }], [5, 0, { specimens: 1 }], [5, -2, { solari: 1 }],
  [6, 1, { spice: 1 }], [6, -1, { tleilaxu: 1 }], [6, -3, { chooseInfluence: { amount: 1 } }],
  [7, 2, { tleilaxu: 1 }], [7, 0, { trashIntrigueFor: { draw: 1, intrigue: 1 } }],
  [7, -2, { steps: [{ trashChoice: true }, { specimens: 1 }] }],
  [8, 1, { spice: 2 }], [8, -1, { tleilaxu: 1 }],
  [8, -3, { choice: [{ label: '跳过', effect: {} }, { label: '支付 7 索拉里，特莱拉前进两格', effect: { cost: { solari: 7 }, tleilaxu: 2 } }] }],
];
const RESEARCH = Object.fromEntries(CELLS.map(([x, y, effect]) => {
  const id = `${x}:${y}`;
  return [id, { id, x, y, geneticMarker: x >= 8 ? 2 : x >= 4 ? 1 : 0, effect,
    next: CELLS.filter(([nx, ny]) => nx === x + 1 && Math.abs(ny - y) <= 1).map(([nx, ny]) => `${nx}:${ny}`) }];
}));
const TLEILAXU = [{}, {}, { intrigue: 1 }, {}, { vp: 1, firstSpice: 2 }, {}, { intrigue: 1 }, { vp: 1 }];
const tech = (cost, acquire = {}, hooks = {}) => ({ cost, acquire, ...hooks });
const TECH = {
  'tech-artillery': tech(1, {}, { passive: 'sword-per-revealed-sword-card' }),
  'tech-chaumurky': tech(4, { intrigue: 2 }, { endgame: 'win-tiebreakers' }),
  'tech-detonation-devices': tech(3, {}, { victory: 'detonate-dreadnought-for-vp' }),
  'tech-disposal-facility': tech(3, { trashChoice: true }, { reveal: 'trash-in-play-if-six-persuasion' }),
  'tech-flagship': tech(8, { vp: 1 }, { activate: { cost: { solari: 4 }, troops: 3 } }),
  'tech-holoprojectors': tech(3, {}, { activate: { discardFor: { draw: 1 } } }),
  'tech-holtzman-engine': tech(6, {}, { roundStart: { draw: 1 }, endgame: 'vp-if-two-spice-must-flow' }),
  'tech-invasion-ships': tech(5, { troops: 4 }, { activate: { discardFor: { infiltrate: true } } }),
  'tech-memocorders': tech(2, { chooseInfluence: { amount: 1 } }, { endgame: 'vp-if-three-influence-every-faction' }),
  'tech-minimic-film': tech(2, {}, { reveal: { persuasion: 1 } }),
  'tech-restricted-ordnance': tech(4, {}, { reveal: { condition: { kind: 'high-council' }, then: { swords: 4 } } }),
  'tech-shuttle-fleet': tech(6, { chooseInfluence: { amount: 1, distinct: 2 } }, { roundStart: { solari: 2 } }),
  'tech-sonic-snoopers': tech(2, { intrigue: 1 }, { consume: 'cycle-intrigues' }),
  'tech-spaceport': tech(5, { draw: 2 }, { passive: 'acquire-topdeck' }),
  'tech-spy-satellites': tech(4, {}, { consume: { cost: { spice: 3 }, vp: 1 }, endgame: 'vp-per-faction-at-most-one-influence' }),
  'tech-training-drones': tech(3, {}, { activate: { troops: 1 } }),
  'tech-troop-transports': tech(2, {}, { passive: 'shipping-recruit-extra-and-deploy' }),
  'tech-windtraps': tech(2, { water: 1 }, { victory: { water: 1 } }),
};
for (const entry of REFERENCE.entries) if (TECH[entry.id]) Object.assign(TECH[entry.id], { id: entry.id, name: entry.name, englishName: entry.englishName });

function setupPlan(base, options = {}) {
  const { expansions } = normalizeOptions(options, { allowUnavailable: true });
  const selected = new Set(expansions);
  const starter = base.STARTER.map(id => selected.has('immortality') && id === 'dune-desert-planet' ? 'experimentation' : id);
  const conflicts = [...base.BASE_CONFLICTS.map(c => c.id), ...physicalCards(expansions, 'conflict')];
  return {
    previewOnly: expansions.some(id => !EXPANSIONS[id].playable), options: { expansions },
    ruleset: expansions.length ? 'expansions-dev-v4' : base.manifest.ruleset,
    starter, market: [...base.BASE_MARKET, ...physicalCards(expansions, 'imperium')],
    intrigue: [...base.BASE_INTRIGUE_DECK, ...physicalCards(expansions, 'intrigue')],
    conflictPool: conflicts, conflictSelection: [{ level: 1, count: 1 }, { level: 2, count: 5 }, { level: 3, count: 4 }],
    leaders: [...Object.keys(base.LEADERS).filter(id => !base.LEADERS[id].expansion), ...physicalCards(expansions, 'leader')],
    tech: physicalCards(expansions, 'tech'), techStackSizes: selected.has('rise-of-ix') ? [6, 6, 6] : [],
    tleilaxu: physicalCards(expansions, 'tleilaxu'), fixedTleilaxu: physicalCards(expansions, 'tleilaxu', { fixed: true }),
    spaces: spacesFor(base.SPACES, expansions),
    boards: ['base', ...(selected.has('rise-of-ix') ? ['choam-overlay', 'ix', 'shipping'] : []),
      ...(selected.has('immortality') ? ['research-station-overlay', 'bene-tleilax', 'tleilaxu-row'] : [])],
  };
}
function catalog(base) {
  return clone({ definitions: EXPANSIONS, optionSchema: { expansions: { type: 'array', items: IDS, uniqueItems: true, default: [] } },
    plans: [[], ['rise-of-ix'], ['immortality'], IDS].map(expansions => setupPlan(base, { expansions })),
    research: RESEARCH, tleilaxuTrack: TLEILAXU, tech: TECH, sources: SOURCES,
    leaders: require('./expansion-cards').LEADERS, conflicts: require('./expansion-cards').CONFLICTS,
    referenceRevision: REFERENCE.revision,
    referenceCards: Object.fromEntries(REFERENCE.entries.map(({ image, imageUrl, ...c }) => [c.id, {
      ...c, implementation: c.category === 'variant' ? 'excluded-variant' : c.category === 'location' ? 'board-space' : 'playable',
      ...(c.category === 'variant' ? { pendingReason: 'Epic Game 变体不在常规 3–4 人范围内。' } : {}),
    }])),
  });
}
module.exports = { REFERENCE, EXPANSIONS, SOURCES, RESEARCH, TLEILAXU, TECH, normalizeOptions, spacesFor, setupPlan, catalog };
