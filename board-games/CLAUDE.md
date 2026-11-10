# 给 Claude：桌游栏目前端交接

最新状态（2026-11-10）：先读 [EXPANSIONS-HANDOFF.md](EXPANSIONS-HANDOFF.md) 的“Sol 后端进度”。两款扩展已接入实际引擎，`supportedExpansions` 为两款 ID、`playable:true,status:'implemented-unverified'`，可开始接入真实动作。四种建房配置、新棋盘、嫁接、运输/研究/科技、舰战、六名领袖都已有后端处理；测试仍由用户执行，不能宣称已验收。

本轮必须修复的提示问题：读取 `game.agentPlacements` 的 `legal/reason/costs/agentUids`，不要再用普通图标/占位规则猜“不能派遣”的原因。缺少匹配项时用“当前无法派遣，请刷新合法动作”。魁萨茨、海伦娜和渗透都已由后端判断。

界面按 `game.spaces` 与 `game.expansionState` 渲染；研究、运输、科技购买和嫁接排序沿用 `chooseEffect`。新增 `cardUids/graftMarketUid`、部署 `dreadnoughts`、`useTech/buyTleilaxu/familyAtomics/returnSpecimens/passCombatEnd` 的字段和私密边界见 API 与交接文档。Sol 本轮没有修改前端 JS/CSS；请保留现有布局与此前三个请求/资源修复。图片共 270 张，继续单独从静态清单读取。

用户分工：Codex 负责框架和后端，Claude 后续补前端。后端位于仓库根 `board-games/`，目前只放《沙丘：帝国》，以后其他游戏与 `games/dune-imperium/` 并列。**此文档是实现交接，不是要求现在提交、推送或部署。**

用户最新约定（2026-11-09）：测试由用户执行。本轮子代理已停止；后续交接保留测试命令供用户自行使用，不自动运行测试。

## 先读这些文件

- `README.md`：启动、目录、插件扩展与存储约束。
- `API.md`：完整房间接口、版本、错误和幂等约定。
- `ASSETS.md`：最新卡图架构、静态目录与 SDK 加载示例，前端按此接图。
- `games/dune-imperium/RULES.md`：查阅过的官方规则链接和页码。
- `games/dune-imperium/data.js`：棋盘、卡牌、manifest 限制说明。
- `games/dune-imperium/index.js`：实际动作与视图契约；不要根据桌游常识自行猜字段。
- `client/board-games.mjs`：直接可用的前端 SDK。
- `../apps/site/README.md`：现站样式和登录机制；黑白、细线、系统字体、本地资源，无外部 CDN。

## 当前边界

平台已有目录、建房/加入/准备/开始、角色权限、存档、重新连接、服务器裁决、隐藏信息隔离与版本冲突处理。现网 nginx 的 `/api/` 已转发到主站，接口复用统一登录。

`dune-imperium` 新局是 3–4 人的 `base-dev-v3`，`status:'experimental'`。43 种/67 张帝国牌、34 种/40 张阴谋、18 张冲突和 8 名领袖的技能均已录入，等待用户执行测试。UI 显示“基础版开发版”及 `manifest.limitations`，不要把未测试的实现宣传为已验收正式模式。旧 `base-subset-v2` 和 `core-dev-v1` 房间保持原牌组与流程，按 `room.ruleset` 区分。允许按 manifest 开放两款扩展；含扩展新局为 `expansions-dev-v4`。不要提供单人、双人、AI、Epic、Go to 11 或 Uprising 选项。

前端继续在 `apps/site/public/board-games/` 下实现；保留该目录中已经开始编写的页面，入口 `/board-games/index.html`，并在主站导航/游戏区添加入口。后续若想用 `/board-games/`，核实静态目录的 index 路由后再设置短链接。新增 HTML 要加入 `deploy/scripts/csp.js` 的 PAGES；建议 JS/CSS 使用同源外部文件。

**用户新增架构要求：卡牌图片存于本地并缓存，减轻游戏服务器负担。** 本地文件目录为 `apps/site/public/board-games/assets/<gameId>/`。游戏 manifest 的 `assets.manifestUrl` 指向静态清单；用 `loadCardAssets(game)` 加载一次，再用 `assets.imageFor(cardId)` 取图。Nginx 直接提供图片，浏览器缓存 30 天；不在 Node 生成图片、代理外站图或把 base64 放进 API/存档。已加入基础与扩展合计 270 张来源 WebP（约 24.3 MB），按内容哈希命名；通用卡背与占位图继续兜底。每轮轮询只更新局面，不重新加载图片清单；不要覆盖正在使用的版本化图片文件。

## 本轮前端必须适配的接口

**v3 新增，优先处理：**

1. `api.start()` 后可能是 `leader-selection`、第 0 轮；按 `legalActions` 显示领袖卡并提交 `chooseLeader`。男爵的秘密势力选择仍用 `chooseEffect`，选项只给男爵本人。第一轮手牌在领袖设置完成后才出现。
2. 特工效果结束后增加明确“结束特工回合”按钮，提交 `endAgent`。`agent-end` 中可继续 Plot 或追加合法部署；不能把 `deploy` 成功当成自动轮到别人。
3. `combat-win` 是唯一第一名的获胜阴谋窗口，提交 `passCombatWin` 才完成战斗。并列第一没有此窗口；直接按 `legalActions` 显示可打阴谋。
4. 棋盘用 `agentPositions` 绘制多人占位。Kwisatz 的动作带 `agentUid`，选择要移动的特工；不要仅用 `occupied` 的旧单玩家摘要。费用优先展示 `effectiveSpaceCosts`。
5. Mohiam/Test of Humanity 会把选择交给其他玩家：`currentPlayerId` 是响应者，`turn.playerId` 是原回合玩家。显示“等待某玩家选择”并按各自新快照显示候选，不在浏览器推进轮次。
6. `leaderId` 和 `catalog.leaders` 提供技能说明；保罗自己的 `deckTop`、男爵未揭示前自己的 `leaderState.masterstrokeFactions` 仅在返回时展示。对手缺失字段不能补算。男爵满足部署条件时有自动提示，暂缓后还可提交合法的 `useMasterstroke`。
7. 海伦娜的 `setAsideMarket` 放在本人可购买区，提交 `buy.source:'set-aside'`；其他玩家可看牌面但不可购买。`resolvingIntrigues` 与 `activeIntrigues` 是公开效果区，不算暗手阴谋。
8. 玩家在自己选择窗口打出 Plot 后，原选项会重新生成。不要缓存旧 `option` 索引；依照返回的最新 `pending.options`、`legalActions` 与房间版本刷新。伊尔班动作可能有 `leaderEffectAt`，与 `effectOrder` 一起作为顺序选项分组。

**v2/v3 共用接口继续保留：**

1. 新局 `reveal` 后，逐张显示 `legalActions` 中的 `resolveReveal`，提交其中的 `cardUid`。用户可选择效果顺序，也可中途购买；未结算完不能结束展示。`unresolvedReveal` 中包括展示期间新抽到的牌。
2. `phase:'effect-choice'` 时，当前玩家按 `game.pending.options` 显示按钮，提交对应的 `{type:'chooseEffect',option}`。这同样覆盖付费、销毁、部署、撤退、影响力、购入奖励和冲突奖励。候选由后端给出，不自行计算或填充收益。
3. `buy` 有 `destination:'deck'` 的合法对象时，提供“牌库顶/弃牌堆”选择。Guild Bankers 的折扣由后端算；不要用固定 9 点判断可购。
4. 派遣效果顺序来自 `catalog.effectOrders`，可按同一 `cardUid/spaceId/spice` 分组；六种整体顺序不应画成六个重复棋盘格。
5. 图鉴从 `catalog.referenceCatalog.cards` 渲染，显示 `englishName`、分类、数量和实现状态；`catalog-only` 的卡不能提供出牌/购买按钮。实际市场仍取 `game.market`。
6. 新图片是完整英文卡面，竖版卡应完整展示或提供放大查看，避免仅用现有横向裁切条显示规则文字；领袖是横版。对手暗牌一律使用 `assets.back`。

新功能后端、静态资源与交接已写入；本轮未修改前端 JS/CSS/HTML，也未运行测试。用户执行测试后再由 Claude 验收交互。

## 页面与交互

1. **桌游大厅**：从 `GET /games` 动态渲染并列卡片，现在只有沙丘；登录后显示公开等待房和自己的房间，支持创建及房间 ID 加入。
2. **等待室**：人数、座位、房主、准备状态、邀请链接。默认私密；房主也要准备。缺人/有人未准备时禁用开始，最终仍以服务端判定为准。
3. **游戏桌**：顶部轮数/阶段/当前玩家；中间棋盘与占位、市场和冲突；侧边资源、势力、同盟、兵力；底部自己的手牌/阴谋牌与动作面板。其他玩家只显示服务端允许的公开信息。
4. **揭示与战斗**：揭示购买是一个持续窗口，买完需要主动结束揭示；战斗允许出牌或让过。依据 `legalActions` 显示选择，并展示服务器的错误说明。
5. **终局与恢复**：显示赢家、得分/平分判定，刷新后用房间 ID 恢复。房主“关闭房间”会中止游戏，应明确提示。不要调用关闭来处理普通页面卸载。

界面不得在本地决定抽牌、扣资源、加分、回合推进或随机数。按钮只是提交命令，成功后以服务器返回的完整 room 替换当前状态。卡名/玩家名用 `textContent` 或框架默认转义，不插入裸 HTML。

## SDK 示例

```js
import { createBoardGamesClient } from '/api/board-games/client.js';

const api = createBoardGamesClient();
const { games } = await api.games();
let { room } = await api.create({
  gameId: 'dune-imperium', name: '周末沙丘', capacity: 3,
  visibility: 'private'
});
({ room } = await api.ready(room, true));
// 另外两位登录用户 api.join(room.id)，然后分别准备。
({ room } = await api.room(room.id));
// 所有人准备后，房主才可：
({ room } = await api.start(room));
// 根据 room.legalActions 构造 action，保持服务端字段，不要上传整份 state。
const requestId = crypto.randomUUID();
// await api.act(room, action, { requestId });
```

SDK 不会自动重试。若超时，保留原 `room`、`action` 和 `requestId` 重试；获取过新快照后，先检查原请求是否已生效。409 时刷新并提示重新选择，不自动重复扣资源。避免轮询响应倒序覆盖新状态：只接受 `room.version >= 当前版本` 的快照；取消过期请求。

## 沙丘动作与视图速查

`room.legalActions` 是**可直接提交的具体 action 对象数组**，不是动作类型列表或 JSON Schema；对不在行动的玩家返回空数组。每次操作后重新渲染合法动作，别缓存旧选项。例如某个合法派遣对象可以直接传给 `api.act(room, action)`。购买、派遣、销毁等菜单可按 type 分组，再利用 catalog 的名称与图标渲染。

| action.type | 其他字段 | 用途 |
| --- | --- | --- |
| `agent` | `cardUid,spaceId`；卖香料另有 `spice`；部分效果可选 `effectOrder` | 打出本人手牌并派遣 |
| `chooseLeader` | `leaderId` | v3 开局选择未被占用的领袖 |
| `endAgent` | 无 | v3 结束特工回合 |
| `passCombatWin` | 无 | v3 结束独胜后的阴谋窗口 |
| `useMasterstroke` | 无 | v3 男爵在满足条件时揭示秘密势力 |
| `deploy` | `count` | 战斗格效果结算后，选择部署兵数，包括 0 |
| `chooseTrash` | `cardUid` 或 `null` | 选择性育种销毁指定卡，或放弃销毁与抽牌 |
| `reveal` | 无 | 展示未打出的手牌，进入购买窗口 |
| `resolveReveal` | `cardUid` | v2 逐张结算展示效果 |
| `chooseEffect` | `option` | v2 选择当前 pending.options 的服务端选项 |
| `buy` | 市场：`source:'market',cardUid`；保留牌：`source:'reserve',cardId` | 购买，立即花费说服力并补市场 |
| `endReveal` | 无 | 结束本人的展示窗口 |
| `playIntrigue` | `cardUid` | 在对应行动/战斗/终局时机打出阴谋牌 |
| `passCombat` | 无 | 战斗让过；别人继续出牌后可能再轮到本人 |
| `defend` | `deploy:true/false` | 控制地点冲突开始时是否部署免费防守兵 |
| `passEndgame` | 无 | 放弃继续打终局阴谋牌，等待最终计分 |

卡实例 `{uid,cardId}` 中，`uid` 指这张物理卡；`cardId` 是数据定义 ID。同名牌可有多个 uid，不要把 cardId 用作手牌的唯一键。除动作表字段外不发送其他游戏状态；服务端拒绝未知字段。

`game.phase` 为 `leader-selection / leader-setup / round-start / player-turns / agent-choice / agent-end / effect-choice / reveal / combat / combat-rewards / combat-win / endgame / finished`。`game.currentPlayerId` 为当前需要选择的人，可能是响应、防守或奖励玩家。`game.pending.stage` 解释当前的 deploy/trash/defend/effect/agent-end 窗口；可选数量直接取 `legalActions`。轮末的产香料、召回与新轮开始会自动计算。

`game.players` 含 `resources.{spice,solari,water}`、`troops.{supply,garrison,conflict}`、`vp`、`influence`、`strength`、升级与特工数、公开 `discard/inPlay`。只有自己的条目带 `hand/intrigues`；其他人只带计数。棋盘查看 `occupied/bonusSpice/controls/alliances`，市场查看 `market/reserve`，冲突查看 `conflict/lastCombat`，结果查看 `result`。定义来自 catalog 的 `cards/intrigues/spaces`，不要把服务器存档文件直接暴露给浏览器。

生产请求通过同源 cookie 登录，不能发送 `X-Auth-*` 或启用 `devUser`。本地独立服务允许开发身份，须先设置 `BOARD_GAMES_DEV_AUTH=1`；SDK `devUser:'alice'` 只在此场景使用。没有跨域 CORS，需要同源开发代理；不要为方便联调开放 `Access-Control-Allow-Origin:*`。

## 接完前端的验收

- 三个账号建房/加入/准备/开始，刷新恢复各自座位与手牌。
- 未轮到本人时动作禁用，非法动作仍由服务器拒绝；看不到对手手牌和未来牌序。
- 两个标签页操作时正确处理 409；网络重试不会重复行动。
- 完成一轮及一局，展示资源、派遣、揭示购买、战斗、下一轮和结果。
- 清楚显示开发规则集与测试牌，不向用户展示未实现能力。
- 手机、键盘、低带宽以及错误提示；沿用站点风格和统一登录。
- 交由用户运行 `node board-games/test/run-all.js` 与 `node apps/site/test/run-all.js`。新增前端应提供适合其实际行为的验证说明。

原先缺少的 5 种帝国牌、7 种阴谋和全部领袖技能已补上。仍保留开发标签，原因是用户尚未执行本轮回归测试；同一张牌内部多段非选择效果仍按定义顺序处理。旧测试牌仅用于兼容旧存档。
