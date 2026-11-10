# 两款扩展与棋盘界面交接

## 2026-11-10：截图中三项不足已补代码，待人工验收

- `pending.options[].ui` 增加四种公开展示元数据：`research`（target）、`shipping`（movement）、`shipping-reward`（level/choice）、`tech`（techId/cost/currency/negotiators）。仅当前响应者收到；仍提交原有 chooseEffect 索引，不传入客户端收益。
- 研究图合法目标可点，运输轨可推进、召回及按等级领取奖励，科技顶牌可选并展开真实支付方案。手机收到这些选择时切到研究科技页签；其余通用选择和跳过仍保留。
- 对局及预览共用 Ix 分区布局：议会、运输覆盖板、外侧伊克斯科技谈判/无畏舰板，手机换行保留分区。
- 新增 `games/dune-imperium/expansion-names-zh.json`，中文为项目译名；卡牌、阴谋、科技、冲突、领袖与图鉴使用中文，保留 englishName 对照。不改稳定 ID 或规则效果。
- 用户约定：未运行测试、不启用子代理。人工环境沿用 MANUAL-TEST.md 的 18770 入口，重启服务加载后端展示字段，刷新浏览器重新读取目录。

以下历史进度按时间保留，“仍为文字按钮/没有中文名”描述已被本节替代。

用户分工：Sol 实现后端，Claude 实现前端。不开子代理，不自动跑测试，不修改现有对局。Sol 最新后端进度见下节，Astra 整理的官方资料与规则核对清单保留在后文。

## Sol 后端进度（2026-11-10）

两款扩展现已接入 `createGame / applyAction / getLegalActions / getView`，不再仅提供设置预览。状态为 `implemented-unverified`：本轮只检查语法与定义覆盖，**未运行测试、未启动对局服务，等待用户验收**。前端继续由 Claude 实现。

四种配置统一使用 gameId `dune-imperium`，建房 options 为 `{expansions:[]}`、`{expansions:['rise-of-ix']}`、`{expansions:['immortality']}` 或两者数组。基础版仍用 `base-dev-v3`；含扩展的新局用 `expansions-dev-v4`，旧对局不迁移。等待房也会根据选项显示实际规则版本。

| 配置 | 帝国牌实体数 | 阴谋实体数 | 冲突候选池 | 可选领袖 |
| --- | ---: | ---: | ---: | ---: |
| 基础 | 67 | 40 | 18 | 8 |
| Ix | 102 | 57 | 22 | 14 |
| Immortality | 97 | 55 | 18 | 8 |
| 两扩展 | 132 | 72 | 22 | 14 |

各组合冲突都抽 1/5/4，共十张。Immortality 替换两张起始牌和研究站，独立特莱拉牌堆 18 张、牌市两张加固定 Reclaimed Forces。Ix 替换四个行动格、设置三堆各六块科技及每人两艘无畏舰。Epic / Go to 11 / House Hagal / Uprising 不开放。

已接入的机制与触发：

- 54 种扩展帝国牌、28 种扩展阴谋、18 种特莱拉牌、Experimentation、固定牌、4 张冲突、6 名 Ix 领袖和 18 科技；130 个常规非地点定义均有对应项，另外 4 张行动格图片与 1 张 Epic 参考图片不算牌组定义。
- 研究分岔、基因标记、终点抽牌、特莱拉轨首到奖励；标本与谈判员占用普通兵供应并守恒。
- 运输推进/召回及累计奖励领取顺序；单次科技获取许可、折扣、支付谈判员、耗尽/轮重置、展示/轮开始/胜利/终局科技能力。
- 双卡 Graft 的效果顺序选择；Ghola 复制保留自己的 source UID，Power Play 仍为两影响力，Carryall + Ghola 为四倍基础收割；Chairdog、Usurp 与 Unload 接入相应时点。
- 无畏舰独立战力、普通兵/舰共享旧驻军额度、胜者单舰临时控制；前一轮占位须在本轮胜者选址后才归还，永久控制标记保留。
- 独胜者 `combat-win` 后处理舰占位；有 Harvest Cells 且损失至少三普通兵的玩家获得 `combat-end` 窗口，使用后可按正常费用获取特莱拉牌。
- 六名领袖的初始、戒指、轮开始、第二回合、展示及影响力触发；伊莱莎留置牌、查看阴谋、暗牌顺序和效果队列仍按玩家隔离。
- 家族原子弹、Spaceport 置顶（包括 Foldspace）、额外回合、图标渗透；标本可在非本人回合返还。

Claude 必须对接的实际接口：

1. `manifest.supportedExpansions` 与 `expansionCatalog[].playable` 决定建房开关；`catalog.expansions.plans` 四种配方现在都为 `previewOnly:false`。完整卡牌/领袖定义在 catalog，图片仍从静态清单单独加载，共 270 张。
2. 盘面使用 `game.spaces`，不要总用静态基础版 `catalog.spaces`。v4 地点提供稳定 `board:'base'|'choam-overlay'|'research-station-overlay'`。扩展公开状态在 `game.expansionState`，科技只给堆顶与剩余数量；特莱拉牌只给牌市和牌堆数量。
3. 派遣提交合法动作中的 `cardUid` 或 `cardUids:[uid1,uid2]`；Usurp 使用 `cardUid` 加 `graftMarketUid`；Dispatch 可带 `dispatchCardUid`。嫁接派遣后用 `chooseEffect` 选择效果顺序，不自行编造效果/费用。
4. 部署使用 `deploy:{count:普通兵,dreadnoughts:舰}`，取服务器给出的组合。科技使用 `useTech:{techId,discardUid?,trashUid?}`；Sonic Snoopers 会再进入私密选择。获取科技、研究、运输都走 `chooseEffect`，不直接提交资源变化。
5. `buyTleilaxu:{cardUid,cardId,destination?}` 或固定牌 `{cardId:'reclaimed-forces',reclaimedChoice:'troops'|'tleilaxu'}`；`familyAtomics`、`returnSpecimens:{count}`；`passCombatEnd` 结束战后阴谋窗口。
6. **修复误导性的不可派遣提示**：使用 `game.agentPlacements`。每组有 `cardUid/cardUids/graftMarketUid` 与 `spaces:[{spaceId,spice?,legal,reason,costs,agentUids}]`，原因已考虑魁萨茨、海伦娜、渗透、Voice、影响力和费用。若无当前匹配组，显示中性提示“当前无法派遣，请刷新合法动作”，不要再按普通图标自行猜“没有图标”。该字段只给当前玩家自己的手牌，不泄漏别人的候选。

本轮没有修改 `apps/site/public/board-games/board-games.js` 或 CSS，也没有调用 Claude / 子代理。前端还需按以上字段接入，不能将本次后端接线描述为 UI 已经验收通过。

已准备、未执行的用例：`test/expansions.test.js`、`test/expansion-engine.test.js`，另更新基础版与房间选项回归用例。用户可从仓库根手动运行：

```powershell
node --test board-games/games/dune-imperium/test/expansions.test.js board-games/games/dune-imperium/test/expansion-engine.test.js board-games/games/dune-imperium/test/full-cards.test.js board-games/games/dune-imperium/test/leaders.test.js board-games/test/platform.test.js
```

人工验收重点：四种组合真实开局；旧局恢复；魁萨茨缺资源与海伦娜敌占位原因；科技/运输选择中刷新和插入阴谋；仅舰战斗及第二次战后控制归还；研究终点和首到奖励；固定牌重复获取；Ghola/Usurp/Unload；六名领袖与隐藏信息。测试与本地服务重启均由用户执行。

## 官方资料（2026-11-09 获取）

来源入口：https://direwolfdigital.com/dune-imperium/resources/

下载文件和逐页文本位于 `references/dune-imperium/`。PNG 是官方规则页的阅读参考，不是生成的仿制棋盘，也尚未接入线上资源。

- 基础版：[官方 PDF](https://d19y2ttatozxjp.cloudfront.net/pdfs/DUNE_IMPERIUM_Rules_2020_10_26.pdf)，本地 `base.pdf`。
- Rise of Ix：[官方 PDF](https://d19y2ttatozxjp.cloudfront.net/pdfs/DUNE_IMPERIUM_RISE_OF_IX_Rulebook_22-2-11.pdf)，本地 `rise-of-ix.pdf`。
- Immortality：[官方 PDF](https://d19y2ttatozxjp.cloudfront.net/pdfs/DUNE_IMPERIUM_IMMORTALITY_Rulebook.pdf)，本地 `immortality.pdf`。
- [官方 FAQ](https://d19y2ttatozxjp.cloudfront.net/pdfs/DUNE_IMPERIUM_FAQ_25-1-13.pdf)，本地 `faq.pdf`。混含其他版本，逐条筛选适用范围。

## Claude：先看这些图

1. `references/dune-imperium/base-setup-full.png`：原版第 4–5 页完整跨页摆放图；左右分图为 `base-page-4.png`、`base-page-5.png`。这是真实棋盘布局参考，含说明标注，不是无标注高清扫描。
2. `rise-of-ix-page-3.png`：覆盖原棋盘右上议会/CHOAM 区的设置；第 4、5、6 页分别是科技、运输轨、无畏舰。
3. `immortality-page-4.png`、`immortality-page-5.png`：新增面板及牌市摆放；第 6–7 页为研究/特莱拉轨，第 8–9 页为标本和牌市，第 10–11 页为嫁接，第 12 页为家族原子弹。

建议桌面版以一个连续棋盘为主体：左侧四势力及影响力轨，右上议会/经济区，中间厄拉科斯行动格，下部冲突与驻军；帝国牌市放在棋盘上方，储备靠近牌市。不要继续把七类行动格做成彼此割裂、需要大量纵向滚动的列表。

Ix 覆盖区域按启用扩展替换，科技板邻接运输区；Immortality 研究板与独立牌市靠近帝国牌市。手机端可分“棋盘 / 牌市 / 研究科技 / 玩家”，仍保留清晰的当前阶段和行动入口；不能直接把整张桌面缩成不可点击的小图。

交互优先级：

- 先选手牌，再高亮合法目的地；非合法格可查看明确原因。目的地展示后端给出的实际费用及占位，确认前摘要本次操作。
- 手牌保持固定可见的紧凑区域；复杂选择面板只在需要时展开，避免底部面板遮住大半棋盘。轮询更新不抢焦点、不跳滚动位置。
- 嫁接必须能选择两张牌、分别取消，并显示实际可去的行动格；不能把单卡派遣按钮简单复制两份。
- 部署分别选择普通兵与无畏舰；运输推进/召回分开，召回展示奖励选择；研究分岔以路径选择呈现。
- 帝国牌市用说服力，特莱拉牌市用标本；科技用香料及谈判员。不同获取方式不要复用含糊的统一“购买”按钮。
- 家族原子弹显示每局剩余次数，确认后提交；科技标明本轮已用、获得时效果、被动效果。
- 保留最近修复的路由响应隔离、同请求 ID 重试和缺图文字回退。图片仍从本地静态清单读取，不加入房间快照。

## Sol：实现前核对范围

维持同一游戏 `dune-imperium`，扩展是建房配置，不是另外两款并列游戏。建议支持基础版、基础+Ix、基础+Immortality、基础+两扩展；最终字段由 Sol 写入 API 后 Claude 对接，以下不是现成接口。

### Rise of Ix

- 第 2–3 页：35 张帝国牌、17 张阴谋、4 张冲突、6 名领袖、18 块科技；每人两艘无畏舰及运输标记。替换棋盘覆盖区域，科技三堆各六块，仅顶牌公开。
- 冲突仍抽 1/5/4，共十张；现有直接放入所有 III 级冲突的实现必须改为抽四张。
- 第 4–5 页：科技获取、谈判员及折扣、每轮使用次数；运输可上升或召回，召回累计奖励及其选择顺序。
- 第 6 页：战力、部署额度改为单位；普通兵与无畏舰仍须区分，老牌的“troop”不可自动作用于舰。舰战后返回驻军；获胜舰临时覆盖地点控制，下一次战斗结束恢复原控制。
- 第 7 页：弃牌费用、Unload 的弃置/销毁触发、渗透；注意效果栈、对手响应、复制与多次触发。

### Immortality

- 第 3–5 页：30 张帝国牌、15 张阴谋、18 张独立特莱拉牌及 Reclaimed Forces；每人以两张 Experimentation 替换两张 Dune, the Desert Planet；研究站覆盖，不另加一个同名格。
- 第 6–7 页：研究轨是分岔路径，不能简化成线性计数；基因标记解锁、终点抽牌、特莱拉轨先到香料奖励须存档。
- 第 8–9 页：标本占用供应区普通兵；花费/返还回供应区。独立牌市为两张牌加固定 Reclaimed Forces；后者结算效果后留在牌市，不进个人牌组。不得被帝国牌市获取效果误选。
- 第 10–11 页：嫁接恰好两张且至少一张具备 Graft；两张都视为派遣卡，处理双方图标、效果顺序、复制、销毁及返回手牌的跨回合效果。
- 第 12 页：家族原子弹每局一次，在本人回合更换帝国牌市；不替换特莱拉牌市。
- Epic、Go to 11 属于可选变体；先完成常规 3–4 人扩展组合，不默认混入变体、House Hagal 或 Uprising。

## 双方对接与人工验收

Sol 先确定：扩展配置持久化与版本、棋盘格集合、单位/标本/谈判员守恒、科技与轨道视图、双卡动作、服务器合法选择以及隐藏牌堆边界。新局按配置组牌；旧局不迁移或追加扩展。

Claude 只根据后端支持列表开放选项，棋盘与卡牌依局内配置渲染，不能先做可点击但无规则的扩展按钮。所有选择以最新 legalActions/pending 为准。

交给用户人工检查：四种组合开局；旧基础局恢复；Ix 覆盖格与十张冲突；科技耗尽/每轮重置；只有舰的战斗及临时控制归还；研究分岔和终点；标本返还；固定牌反复获取；双嫁接与复制/销毁；原子弹；中途刷新及玩家私密信息。沿用 MANUAL-TEST.md 的本地环境，后端修改后再由用户重启。此文档不声明任何测试通过。

## Claude：前端这一轮做了什么（2026-11-09）

只改了基础版界面和通用机制，没有做任何扩展专属的可点击入口；建房表单也没有扩展选项，等 Sol 的能力契约。

- **连续棋盘**：`viewGame()` 里的 `board` 现在是一张棋盘：左列四势力（影响力轨并在标题行）、右上议会 + 宇联公司、中间城镇 + 采香料、下沿冲突牌 / 战场与驻军 / 计分轨。牌市在棋盘上方，玩家信息在右侧栏。
- **格子集合取自 `catalog.spaces`**：按 `icon`（及 `maker`）分区；图标不在已知七类里的格子会落进「其他行动格」一块，不会消失。Ix 覆盖区若要落在指定位置，请在 space 上给一个稳定的分区字段，前端再按它排。
- **去不了的原因**：选了手牌后，非合法格变暗，悬停或点击给出原因（图标不符、被占、魅音封锁、资源或影响力不够等）。这是照公开局面做的提示；能否派遣仍只看 `legalActions`。后端若愿意直接给原因，前端改为显示后端文案。
- **确认摘要**：确认派遣前显示实际费用（`effectiveSpaceCosts`）和行动格收益。
- **未知合法动作兜底**：`legalActions` 里出现前端没有专门界面的 `type` 时，会在底部「其他操作」里按原样列出并可提交。新动作（科技、运输、研究、嫁接、原子弹）接口定下来后，再替换成专门界面。
- **手机页签**：棋盘 / 牌市 / 玩家 / 记录。扩展加「研究 · 科技」页签时在 `viewGame()` 末尾的页签数组里加一项。
- **重画不抢焦点**：整页重画后恢复焦点、各横向滚动条和已展开的折叠块。

未做、需要接口的：扩展建房选项、科技板、运输轨、无畏舰部署、研究分岔、标本与特莱拉牌市、双卡嫁接、家族原子弹。

## Claude：对接 Sol 的扩展数据层（2026-11-10）

按"只开放后端声明支持的东西"接了这几处，没有新增任何会提交扩展命令的控件：

- **建房**：表单多了"扩展"一行，列出 `manifest.expansionCatalog`。只有出现在 `manifest.supportedExpansions` 里的才可选，选中后提交 `options:{expansions:[...]}`（顺序同目录）；其余显示"未开放"，点了只提示原因。现在两项都不可选，建房请求与以前一样不带 `options`。
- **房间**：等待室显示本房配置（读 `room.options`）；对局顶栏在带扩展时显示配置徽标（读 `game.options`，没有则退回 `room.options`）。
- **图鉴**：按来源切换 基础版 / Rise of Ix / Immortality，读 `catalog.expansions.referenceCards`，新增类别 科技、特莱拉牌、可选变体。扩展牌目前只有英文名。
- **设置预览**：图鉴页的"设置预览"读 `catalog.expansions.plans`，可在四种组合间切换：牌库数量与相对基础版的增量、每局冲突抽取、用到的板块、按 `plan.spaces` 画的静态棋盘（替换或新增的格子带"扩展"角标）、科技堆和特莱拉牌市。纯展示，不能操作。
- **效果文字**：`shipping`、`negotiators`、`commissionDreadnought`、`acquireTech` 四个字段有了中文说明，其余未知字段仍显示"效果详见卡面"。

等 Sol 把扩展接进对局后，前端还需要这些才能做专门界面：

1. `supportedExpansions` 填上可开局的扩展 ID，建房选项会自动放开。
2. 行动格给一个稳定的分区或板块字段（比如 `board:'choam-overlay'`），现在只能按 `icon` 归区，Ix 的四个新格分别落在议会区和宇联公司区。
3. 玩家视图里的新量：无畏舰、谈判员、标本、运输轨位置、研究轨位置、已有科技及本轮是否用过、原子弹是否已用。
4. 公开区：三堆科技的顶牌、特莱拉牌市两张加固定牌。
5. 新动作的字段约定（获取科技、运输推进与召回、研究路径、双卡嫁接、原子弹、无畏舰部署）。接口出来前，这些动作会落在底部"其他操作"里原样可提交。

## Claude：扩展对局前端对接（2026-11-10）

按"Claude 必须对接的实际接口"六条接了，沿用现有布局和此前的请求/资源修复：

1. **建房**：`supportedExpansions` 里的扩展可选，提交 `options:{expansions:[...]}`；等待室、对局顶栏显示配置，规则版本显示"扩展开发版"。选领袖时只列本局配置里的领袖。
2. **盘面**：棋盘格子取 `game.spaces`（没有时退回 `catalog.spaces`）；`board` 不是 `base` 的格子带"伊克斯 / 永生"角标。分区仍按 `icon`，Ix 的新格落在议会区和宇联公司区。
3. **派遣与嫁接**：手牌可选第二张——只有服务器 `cardUids` 里能和第一张配对的牌会发亮可点；两张选定后按配对的合法动作高亮目的地。`graftMarketUid`、`dispatchCardUid` 作为确认前的可选项列出。嫁接后的效果顺序走 `chooseEffect`。
4. **部署**：按服务器给的 `{count,dreadnoughts}` 组合出按钮（"2 兵 + 1 舰"）。
5. **新动作**：`useTech`（研究科技面板里，带弃牌/销毁对象的写明是哪张）、`buyTleilaxu`（牌市条里的特莱拉牌，固定牌按 `reclaimedChoice` 分两个按钮，标"用标本获取"而不是"购买"）、`familyAtomics`（二次确认）、`returnSpecimens`（不是自己回合也显示）、`passCombatEnd`。
6. **去不了的原因**：有 `game.agentPlacements` 时只显示服务器给的 `reason`，费用用它的 `costs`；找不到匹配组时显示"当前无法派遣，请刷新合法动作"。前端自己的猜测只留给没有这个字段的旧规则集。

新增"研究科技"面板（手机上是单独页签）：三堆科技的顶牌与剩余、每人的运输位置/谈判员/无畏舰/已有科技、研究分岔图（按 `catalog.expansions.research` 的坐标画，标出各玩家位置和基因标记分界）、特莱拉轨、标本与原子弹状态。

没有做成专门界面、仍靠 `chooseEffect` 文字按钮的：获取科技、运输推进与召回奖励、研究选路。扩展牌、科技、Ix 领袖的名字目前是英文，等后端给中文名。
