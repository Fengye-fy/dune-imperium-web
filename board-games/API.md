# 桌游 API v1

2026-11-10 展示字段：当前响应者的 `game.pending.options[].ui` 可为 `research`（target）、`shipping`（movement）、`shipping-reward`（level/choice）、`tech`（techId/cost/currency/negotiators），类别在 `kind` 中。用于棋盘上的专门控件；提交仍是 `{type:'chooseEffect', option}`，只能使用最新响应中的索引。未识别或未提供 ui 时继续显示 label。元数据不含效果队列、获取许可 ID 或其他玩家私密选项。

前缀 `/api/board-games`。响应为 JSON；SDK 在 `GET /api/board-games/client.js` 以 ES module 提供。

`GET /games` 和 `GET /games/:gameId` 返回的游戏 manifest 增加 `assets:{mode:'local-static',manifestUrl:'/board-games/assets/dune-imperium/manifest.json'}`。这是公开静态清单地址，前端用 SDK 导出的 `loadCardAssets(game)` 单独读取一次，再按 `cardId` 查找图片。静态图片和清单不走本节游戏 API，也不使用房间请求的 `no-store` 策略；图片本体不会进入房间快照或存档。详见 [ASSETS.md](ASSETS.md)。

公开接口：`GET /health`、`GET /games`、`GET /games/:gameId`。其他接口必须登录，身份由站点服务提供。所有 POST 需要 `Content-Type: application/json` 与 `X-Board-Games-Request: 1`，同源请求，16 KiB 请求体上限。

## 接口

| 方法与路径 | 请求体 | 响应 |
| --- | --- | --- |
| GET `/games` | — | `{games:[manifest]}` |
| GET `/games/dune-imperium` | — | `{game:manifest,catalog}` |
| GET `/rooms` | — | `{rooms:[summary]}`：自己参加的房间及公开等待房，最近 100 间 |
| POST `/rooms` | `{gameId,name?,capacity?,visibility?,options?,requestId}` | 201 `{room,replayed:false,appliedVersion:1}` |
| GET `/rooms/:id` | — | `{room}`，仅成员可读 |
| POST `/rooms/:id/join` | `{requestId}` | 加入未满的等待房；无需版本号 |
| POST `/rooms/:id/ready` | `{ready,expectedVersion,requestId}` | 设置本人准备状态 |
| POST `/rooms/:id/start` | `{expectedVersion,requestId}` | 房主开始；至少 3 人，所有人已准备 |
| POST `/rooms/:id/leave` | `{expectedVersion,requestId}` | 等待房可离开；房主转交下一玩家；返回 `room:null` |
| POST `/rooms/:id/close` | `{expectedVersion,requestId}` | 房主关闭等待或进行中房间，保留存档 |
| POST `/rooms/:id/actions` | `{action,expectedVersion,requestId}` | 由插件验证并执行本人游戏动作 |

默认 `capacity:4`，只支持 3/4；默认 `visibility:'private'`，也支持 `public`。私密房不会出现在外人的大厅，但拿到房间 ID 的登录用户可加入，所以邀请链接只发给同桌玩家。`options` 由插件 `validateOptions` 验证与规范化，保存为公开的 `room.options` 并在开局时传入插件；没有此钩子的插件只接受空对象。沙丘接受省略、`{}` 或 `{expansions:[]}`（基础版），以及 `rise-of-ix`、`immortality` 的不重复数组；未知键、非数组、未知扩展或重复项拒绝。扩展参数顺序会规范化，包含扩展时新局使用 `expansions-dev-v4`。

除离开以外，成功变更返回 `{room,roomId?,replayed,appliedVersion}`。关闭的房间仍可由原成员查看，不接受游戏命令；中途刷新和重新登录不改变座位，用原账号 GET 即可恢复。

若建房者已经离开，再重试原建房请求仍会返回 `replayed:true`，但只提供 `roomId`、`room:null`，不泄漏离开后房间的信息。

## 房间状态

```json
{
  "id": "012345ABCDEF",
  "gameId": "dune-imperium",
  "name": "周末沙丘",
  "status": "waiting",
  "visibility": "private",
  "capacity": 4,
  "options": {"expansions":[]},
  "version": 1,
  "hostPlayerId": "opaque-seat-uuid",
  "viewerPlayerId": "opaque-seat-uuid",
  "players": [{"id":"opaque-seat-uuid","name":"玩家","ready":false}],
  "ruleset": "base-dev-v3",
  "game": null,
  "legalActions": [],
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "events": [{"version":1,"type":"created","actorPlayerId":"opaque-seat-uuid","at":"ISO-8601"}]
}
```

`status`：`waiting → playing → finished`，或房主中止为 `closed`。大厅的 summary 只有房间基本信息和公开玩家列表，没有 `game`、`viewerPlayerId`、`legalActions` 和日志。具体游戏视图以插件为准，不包含其他人的手牌、阴谋牌、未来牌序或随机种子。

`events` 是最多 50 条的公开操作类型提示，刻意不存命令载荷，避免泄漏私密牌。不是完整回放系统；绘制盘面以 `game` 快照为准。

## 沙丘基础版 v3

不含扩展的新局默认 `base-dev-v3`；含扩展的新局使用 `expansions-dev-v4`。已开始的 `base-subset-v2`（60/32 张子集、无领袖）和 `core-dev-v1`（测试牌）保留原规则；`room.ruleset` 与实际 `room.game.ruleset` 一致。旧房间缺少 `options` 时返回 `{}`，开局按基础版默认值；游戏视图缺少该字段时投影为 `{expansions:[]}`，不改写旧存档。HTTP API 版本仍为 1，游戏动作以各房间 `legalActions` 为准。

两款扩展已接入实际引擎。`manifest.supportedExpansions` 为 `['rise-of-ix','immortality']`，`expansionCatalog` 与 `catalog.expansions.definitions` 均为 `playable:true,status:'implemented-unverified'`，表示实现待用户验收，不表示测试已通过。

`catalog.expansions` 提供四种实际设置配方 `plans`（`previewOnly:false`）、研究有向图 `research`、特莱拉轨 `tleilaxuTrack`、18 项科技 `tech`、扩展 `leaders/conflicts` 和新增 135 项 `referenceCards`。`cards/intrigues/leaders` 顶层表含完整基础及扩展定义；基础版牌库仍只取 `playableDecks` 的基础 ID，扩展按配方组牌。不要直接把所有定义都塞入牌堆。Epic 参考牌为 `excluded-variant`，地点参考项为 `board-space`。

游戏视图新增 `spaces`，必须据此绘制本局实际棋盘。v4 地点的 `board` 为 `base`、`choam-overlay` 或 `research-station-overlay`，可用于稳定分区。`expansionState` 只在 v4 出现：`expansions` 表示已启用扩展；`ix` 给 `techStacks:[{top,remaining}]`、`occupations`、`trashedTech` 及各玩家的运输、谈判员、无畏舰和科技；`immortality` 给 `tleilaxuRow`、`fixedCard`、`tleilaxuDeckCount`、`firstSpice` 及各玩家研究、基因标记、特莱拉、标本、原子弹状态。不给未来科技/特莱拉牌序、获取许可或效果载荷。

`agentPlacements` 为当前玩家在 `player-turns` 阶段的派遣解释，其他查看者为空数组。每组包含 `cardUid`、`cardUids` 或 `cardUid+graftMarketUid`，以及 `spaces:[{spaceId,spice?,legal,reason,costs,agentUids}]`。`reason:null` 表示存在合法特工；否则是后端的实际原因，已处理魁萨茨、海伦娜、图标渗透、Voice、费用和前置条件。客户端不得自行根据普通图标猜失败原因；无匹配组时用中性提示。真正提交动作仍按最新 `legalActions`。

| v4 动作 | 字段 | 行为 |
| --- | --- | --- |
| `agent` | `cardUid` 或 `cardUids:[uid1,uid2]`，另有 `spaceId,agentUid` | 至少一张 Graft 才能双卡，Graft 不能单独派遣；双卡后进入效果顺序选择 |
| `agent`（Usurp） | `cardUid,graftMarketUid,spaceId,agentUid` | 嫁接帝国牌市中的牌；牌不进个人场上区，回合结束销毁并触发相应效果 |
| `agent`（Dispatch） | 可选 `dispatchCardUid` | 把新增图标给所选的一张牌；图标不重复，不从新增图标继承渗透 |
| `deploy` | `count,dreadnoughts?` | 共享最多两名旧驻军额度；新招募的普通兵与新建造的舰另计 |
| `useTech` | `techId,discardUid?,trashUid?` | 使用持有的合法科技；阴谋循环再进入私密选择，不接受客户端费用或收益 |
| `buyTleilaxu` | `cardUid,cardId,destination?` | 用标本获取独立牌市卡；解锁后可 `destination:'deck'` |
| `buyTleilaxu`（固定牌） | `cardId:'reclaimed-forces',reclaimedChoice:'troops'|'tleilaxu'` | 征募两兵或前进一格；不移走固定牌、不进入个人牌库，可重复支付 |
| `familyAtomics` | 无 | 本人回合每局一次，只替换帝国牌市 |
| `returnSpecimens` | `count` 正整数 | 返还本人标本，可在非本人回合使用 |
| `passCombatEnd` | 无 | 结束 Harvest Cells 的 `combat-end` 窗口 |

运输移动/召回、奖励顺序、研究路径、科技获取/折扣/谈判员、嫁接效果顺序、胜者舰控制均使用 `chooseEffect:{option}`。各选项和时机可序列化保存，客户端不能直接选择任意资源或传入隐藏牌序。v4 `players` 另给公开的 `graftedCards,chairdogReturns,extraTurns,lostTroopsThisCombat`；伊莱莎留置牌及奖励 UID 仅给本人，留置数量公开。详见 [EXPANSIONS-HANDOFF.md](EXPANSIONS-HANDOFF.md)。

`GET /games/dune-imperium` 的 catalog 新增：

- `conflicts`：18 张真实冲突的定义。每局随机抽取 1 张 I、5 张 II、4 张 III，共十张。
- `playableDecks.{ruleset,market,intrigue}`：新局牌库 ID，重复项代表物理数量。市场 43 种/67 张、阴谋 34 种/40 张。不能将新局目录直接追加进旧存档。
- `leaders`：8 名基础版与 6 名 Ix 领袖的定义；按当前 `chooseLeader` 合法列表开放，基础局仍只选八名基础领袖。
- `referenceCatalog.{edition,revision,cards}`：135 项图鉴，包含 113 种不同卡面和 22 张行动格参考图。每项有 `id,englishName,category,copies,sourceUrl,implementation,pendingReason?`。`catalog-only` 只能查图，不能当作可购买卡牌。
- `effectOrders`：派遣时卡牌、行动格、影响力三个整体效果的六种执行顺序。伊尔班支付行动格索拉里费用触发的抽牌还可用 `leaderEffectAt:0..3` 指定插入点；省略等于 0。按合法对象分组，不自行填入费用/收益。

| 动作 | 字段 | 行为 |
| --- | --- | --- |
| `resolveReveal` | `cardUid` | 结算本人 `unresolvedReveal` 中的一张展示牌；一张只能结算一次 |
| `chooseEffect` | `option` 整数 | 选择当前 `game.pending.options` 的选项；客户端不可提交费用或收益 |
| `buy` | 原字段，可选 `destination:'deck'` | Recruitment Mission 生效时可选择牌库顶；省略则进弃牌堆 |
| `chooseLeader` | `leaderId` | 领袖选择阶段按合法列表选未被使用的领袖 |
| `agent` | 原字段，另有 `agentUid`、`leaderEffectAt?` | 派遣指定的本人特工；Kwisatz 可选择已经在棋盘上的特工移动 |
| `endAgent` | 无 | 效果与响应完成后结束本次特工回合 |
| `passCombatWin` | 无 | 独胜者结束“赢得冲突后”的阴谋窗口 |
| `useMasterstroke` | 无 | 男爵本回合累计部署至少四兵、尚未用过技能时，再次决定揭示秘密势力 |

`reveal` 公开全部手牌，进入 `reveal`；v2/v3 均按 `resolveReveal` 逐张结算，可在两张牌之间购买或打出可用 Plot 阴谋。全部结算后才出现 `endReveal`。展示期间抽到的牌立即公开并加入 `unresolvedReveal`，不留在暗手牌中。

开局 `phase:'leader-selection'`、`round:0`，从起始玩家右手边开始逆序选择，起始玩家最后选；领袖不可重复，同一家族的两名领袖允许同局。选齐后，若有男爵，进入他的私密 `effect-choice` 选择两个不同势力。全部设置完成后才抽五张起始手牌并开始第 1 轮。

多选或付费效果进入 `phase:'effect-choice'`、`pending.stage:'effect'`。`pending.options` **只向当前选择者**提供 `{option,label,cardUid?,cardId?}`；其他玩家看到选择阶段与来源，不能看到未选的手牌候选。提交服务端给出的 `{type:'chooseEffect',option:n}`，不要自行构造资源变化。选择可保存并在重连后恢复。

v3 的候选还可能带 `spaceId`、`agentUid`、`targetPlayerId`，供 UI 展示目标。Mohiam/Test of Humanity 的选择依次交给施放者左侧各对手：`currentPlayerId` 指正在响应的人，`turn.playerId` 仍是原回合玩家。响应完成后自动返回施放者，不能在本地猜测下一玩家。

v3 不再在行动格效果结束后立即交棒：战斗格出现部署选择，其他情况进入 `agent-end`。提交 `endAgent` 才交棒；部署后也停在 `agent-end`，可分批部署本回合新兵及最多两名原驻军。Plot 阴谋可以在自己的费用/效果选择与特工结束窗口中使用，后端暂停并保存原选择，执行阴谋后重建可选项。必须使用最新快照的 option 编号。其他玩家的响应窗口、已支付影响力损失后的同盟转移选择保持原子结算，不能插入其他命令。

v2 的 `players` 额外公开 `activeIntrigues`（已打出、待展示清理的阴谋）、`unresolvedReveal`、`roundPersuasion`、`spiceMustFlowDiscount`、`acquireTopdeck`、`nextAgentFactions`。`hand/intrigues` 仍只给本人。效果队列、费用载荷、未来牌序和其他人的候选列表不进入视图。

v3 另有：

- `players[].leaderId/leaderState`：男爵的 `masterstrokeFactions` 在揭示前只返回给本人；揭示后公开，`masterstrokeUsed` 标记每局仅一次。
- 保罗本人的 `players[].deckTop`：真实牌库顶或 `null`。其他查看者没有此字段；查看空牌库不会洗弃牌。Poison Snooper 的查看信息仅在当前选择者的候选中出现。
- `agentPositions:[{agentUid,playerId,spaceId,kind}]`：实际特工列表，允许同一格多个特工。`occupied` 为旧界面保留该格第一位玩家的摘要，不能用于绘制完整占位。
- `voiceBlocks:[{playerId,spaceId}]`：施放者下一次正常行动开始时移除，不能被 Infiltrate、Helena 或 Kwisatz 绕过。
- `effectiveSpaceCosts`：当前查看者按领袖修正的行动格入场费用（卖香料的档位仍取动作中的 spice）。
- `setAsideMarket`：海伦娜移走的公开市场牌，只有本人可购；展示期间 `buy.source:'set-aside',cardUid` 有 1 说服力折扣。Bypass 可获取本人移走的牌，但按印刷费用判断上限、不享该折扣；未买的牌在展示清理进入 `removedMarket`。
- `resolvingIntrigues`：正在结算、尚未进入阴谋弃牌堆的公开牌。避免牌库耗尽时把还未结算完的阴谋洗回。

前端只显示返回的领袖私密字段，不请求对手牌库顶、未揭示的秘密势力或服务器存档。

冲突先冻结战力与名次，再按奖励队列发奖；需要选择的奖励沿用 `effect-choice`。奖励全部完成后才回收参战兵、判断终局和开始新轮。Sort Through the Chaos 的门泰特奖励在下一轮开始给予。无需客户端自行推进 `combat-rewards`。

v3 奖励完成后，唯一第一名进入 `combat-win`，可用 To the Victor 获得香料，再支付 Demand Respect 的费用；刚作为冲突奖励抽到的获胜阴谋也能使用。并列第一没有此窗口。独胜者提交 `passCombatWin` 后才回收部队并进入下一轮/终局。Bindu 只能在 `turn.atStart` 为真时打出，抽一张牌后立即跳过本次行动且不消耗特工。

常见新增错误：`UNRESOLVED_REVEAL`、`INVALID_CHOICE`、`INTRIGUE_REQUIREMENTS`、`INVALID_DESTINATION`。所有选择仍使用房间版本及 requestId；失败不会改写原状态。

## 并发与重试

- `expectedVersion` 是读取到的房间整数版本，不是游戏轮数。加入、准备等操作同样会加一。
- 旧版本返回 HTTP 409 `VERSION_CONFLICT` 和 `error.details.currentVersion`。刷新房间，让玩家重新确认动作，不要把旧动作自动套到新局面。
- 每次逻辑操作生成 8–80 位 `requestId`（推荐 UUID）。网络超时重试时复用**同一个 ID 和完全相同的请求体/版本**。
- 服务保存每房最近 256 次成功命令及全局最近 5000 次建房请求。窗口内的重试返回 `replayed:true`、原 `appliedVersion`，同时返回最新视图，不重复执行；ID 相同而内容不同返回 `REQUEST_ID_REUSED`。
- 先落盘再返回成功。错误不会消费 requestId；失败动作不改变资源、版本或存档。服务重启后上述幂等记录仍有效。
- 轮询建议 2 秒一次；页面隐藏时暂停，离开页面取消。无需 WebSocket，目前也没有 SSE。

每账号最多同时加入 10 个未结束房间；每分钟 300 次需要登录的请求，每 10 分钟最多 20 次建房调用（包括网络重试）。这些是开发阶段保护限制。

## 错误

```json
{"error":{"code":"VERSION_CONFLICT","message":"房间已更新，请刷新后重新操作","details":{"currentVersion":7}}}
```

常见 HTTP 状态：400 输入或规则动作错误，401 未登录，403 权限/来源拒绝，404 不存在，409 阶段/版本/人数冲突，413 请求体过大，415 不是 JSON，429 频率限制，503 存档失败。引擎错误会保留稳定 `code`，界面优先显示中文 `message`，不要仅按 HTTP 状态猜原因。
