# 桌游栏目

仓库根目录的独立业务模块。目前只注册《沙丘：帝国》，以后在 `games/` 下并列增加游戏。**这一期提供框架、后端和浏览器 SDK，页面由 Claude 后续实现。**

《沙丘：帝国》新局使用 `base-dev-v3`，支持 3–4 人：43 种帝国牌（67 张）、34 种阴谋牌（40 张）、18 张冲突牌与 8 名领袖的主动/被动技能均已录入。开始后先选择不同领袖，男爵再秘密选择势力，然后进入第一轮；冲突按 1/5/4 抽取。仍是待用户验收的开发版，本轮未运行测试。已有 `base-subset-v2`、`core-dev-v1` 存档保留原牌库与流程，不自动换牌或追加领袖。

```text
board-games/
  server.js                 HTTP 接口，主站挂载 /api/board-games
  registry.js               游戏注册表
  lib/                      通用房间、存档、校验
  games/
    dune-imperium/          第一款游戏的规则、数据、引擎、测试
  client/board-games.mjs    无 UI 的浏览器 SDK
  test/                    通用后端验收
  CLAUDE.md                给 Claude 的前端交接入口
  API.md                   房间接口契约
  ASSETS.md                本地卡图、静态发布与浏览器缓存约定
```

卡牌图片与规则服务分离，文件放在 `apps/site/public/board-games/assets/<gameId>/`，由 Nginx 静态直出、浏览器缓存。游戏 API 只给出资源清单地址；房间状态只保留卡实例 ID，不附带图片。已下载基础与两款扩展的卡牌、科技、领袖和行动格图片，共 270 张 WebP，约 24.3 MB；保留通用卡背与缺图回退。目录、清单、来源、可重复下载工具及 Claude 接入示例见 [ASSETS.md](ASSETS.md)。

新版动作包括 `chooseLeader`、`resolveReveal`、`chooseEffect`、`endAgent`、`passCombatWin` 和男爵的 `useMasterstroke`。响应、费用、奖励、多人占位和私密信息均由服务器裁决，选择中途可存档与重连。`catalog.referenceCatalog` 是图片图鉴，实际牌库见 `catalog.playableDecks`。前端适配仍交给 Claude，具体契约见 [CLAUDE.md](CLAUDE.md) 和 [API.md](API.md)。

## 本地运行

Node.js 18+，没有第三方依赖，不需要 `npm install`。

在仓库根运行 `node apps/site/server.js`，API 随主站在 `127.0.0.1:8766` 启动。线上复用现有登录 cookie，由 nginx 验证后注入用户身份；浏览器不应伪造 `X-Auth-*`。

也可独立启动 API 进行开发联调。PowerShell：

```powershell
cd board-games
$env:BOARD_GAMES_DEV_AUTH = '1'
node server.js
```

独立开发服务仅监听 `127.0.0.1:8767`。打开 `/api/board-games/games` 可看游戏目录；用 `X-Dev-User: alice`、`bob`、`carol` 模拟三人。此开关只对独立开发服务有效；生产挂载不接受此身份头。停止测试后可 `Remove-Item Env:BOARD_GAMES_DEV_AUTH`。

可配置 `BOARD_GAMES_PORT`、`BOARD_GAMES_DATA_DIR`、`BOARD_GAMES_ORIGIN`（完整允许的 Origin）。主站挂载使用 `SITE_DATA_DIR/board-games/rooms.json`，随现有站点数据备份；独立服务默认写 `board-games/data/rooms.json`，该目录已被仓库 `.gitignore` 排除。

## 验证

```powershell
node board-games/test/run-all.js
node apps/site/test/board-games.test.js
```

部署脚本已加入桌游测试。`board-games/` 的改动会触发 `website-site` 重启，不需要增加服务。游戏 API 复用现有路由，Nginx 静态配置新增卡图专用目录和缓存策略。测试由用户执行；当前工作仅修改本地源码，没有提交或上线。

## 增加下一款游戏

1. 在 `games/<slug>/` 新建独立目录，稳定 ID 使用英文短名。
2. 导出 `manifest`、`getCatalog()`、`createGame({players,options})`、`applyAction(state,playerId,action)`、`getView(state,viewerId)`、`getLegalActions(state,playerId)`。
3. 在 `registry.js` 注册，并添加规则与隐私测试。

`applyAction` 不修改输入，返回可 JSON 序列化的新状态，非法动作抛出有 `code`、`status` 的错误。终局使用 `phase: 'finished'`。`getView` 必须按请求者裁剪隐藏信息；账户标识留在通用房间层，插件只接收不透明的座位 UUID。游戏目录由注册表生成，不应在前端写死仅一款游戏。

存储针对现有**单个 Node 主站进程**设计：同步变更 + 临时文件写入/fsync/rename + 成功后替换内存。不要让多个进程或多个副本共享同一数据目录；需要横向扩展时先迁移到有事务和版本条件更新的数据库。已结束房间目前保留存档，最多 5000 间；尚未实现自动清理、观战或中途换人。

## 扩展对局与插件配置

`dune-imperium` 通过 `options.expansions` 支持基础、Ix、Immortality 和两扩展组合。基础局仍为 v3，带扩展新局为 `expansions-dev-v4`；不自动迁移旧存档。实际动作和玩家投影已经接线，状态为开发实现、未运行测试，等待用户验收。具体配置、动作及 Claude 前端适配见 [EXPANSIONS-HANDOFF.md](EXPANSIONS-HANDOFF.md)。

插件可提供 `validateOptions(options)` 返回规范化、公开的配置；房间层保存并在开局传回。没有此钩子的插件仍拒绝非空配置。可选 `rulesetForOptions(options)` 决定等待房的规则版本；已开始房间以存档中的 ruleset 为准。
