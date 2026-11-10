'use strict';

const leader = (slug, name, house, complexity, passive, signet, signetEffect) => ({
  id: 'leader-' + slug, name, house, complexity, passive, signet, signetEffect,
  edition: 'base-2020', implementation: 'playable',
});
const LEADERS = Object.fromEntries([
  leader('baron-vladimir-harkonnen', '弗拉基米尔·哈克南男爵', 'harkonnen', 3,
    '开局秘密选择两个不同势力；一回合部署至少四兵时，可揭示并各提升一次影响力，每局仅一次。',
    '可支付 1 索拉里抽 1 阴谋。', { optional: true, choice: [{ label: '支付 1 索拉里，抽 1 阴谋', effect: { cost: { solari: 1 }, intrigue: 1 } }] }),
  leader('count-ilban-richese', '伊尔班·里奇斯伯爵', 'richese', 1,
    '支付行动格印刷索拉里费用时抽 1 张牌；卡牌效果费用不触发。',
    '获得 1 索拉里。', { solari: 1 }),
  leader('countess-ariana-thorvald', '阿丽亚娜·索瓦尔德女伯爵', 'thorvald', 3,
    '在产香料行动格收获香料时少获得 1 香料，并抽 1 张牌。',
    '获得 1 水。', { water: 1 }),
  leader('duke-leto-atreides', '雷托·厄崔迪公爵', 'atreides', 2,
    '议会行动格的索拉里入场费用减少 1。',
    '可支付 1 香料，提升一个有对手领先于你的势力影响力。', { letoSignetChoice: true }),
  leader('earl-memnon-thorvald', '孟农·索瓦尔德伯爵', 'thorvald', 1,
    '获得最高议会席位时提升任一势力影响力。',
    '获得 1 香料。', { spice: 1 }),
  leader('glossu-the-beast-rabban', '野兽·拉班', 'harkonnen', 1,
    '起始额外获得 1 香料和 1 索拉里。',
    '招募 1 兵；若拥有任一同盟，改为招募 2 兵。', { rabbanSignet: true }),
  leader('helena-richese', '海伦娜·里奇斯', 'richese', 2,
    '敌方特工不会阻挡你进入议会或城市行动格；不能忽略自己的占位或 Voice。',
    '移走并补充一张市场牌；本轮展示时可以少 1 说服力购买移走的牌。', { manipulateChoice: true }),
  leader('paul-atreides', '保罗·厄崔迪', 'atreides', 1,
    '随时查看自己的牌库顶；空牌库不能为查看而提前洗弃牌。',
    '抽 1 张牌。', { draw: 1 }),
].map(l => [l.id, l]));

module.exports = { LEADERS };
