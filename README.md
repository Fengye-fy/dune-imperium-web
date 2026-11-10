# 沙丘：帝国 · 网页联机版

桌游 *Dune: Imperium* 的网页实现，3–4 人联机，含 **Rise of Ix** 和 **Immortality** 两款扩展。规则全部由服务器裁决，浏览器只负责显示和提交操作。

线上在 [fengyefy.cn 的桌游栏目](https://fengyefy.cn/board-games/index.html)，介绍文章见 [《沙丘：帝国》网页联机版：内容与技术实现](https://fengyefy.cn/#/posts/dune-imperium)。

> **开发版。** 规则已全部录入，能从选领袖打到终局计分，但还没有经过足够多的真人对局验收。不包含单人与双人模式、Epic 变体和 Uprising。

## 本地试玩

需要 Node.js 18 以上，没有第三方依赖，不用 `npm install`。

```bash
node start.js
```

启动后分别打开（Chrome / Edge 可以直接解析 `*.localhost`）：

| 玩家 | 地址 |
| --- | --- |
| Alice | http://alice.localhost:8770/board-games/index.html |
| Bob | http://bob.localhost:8770/board-games/index.html |
| Carol | http://carol.localhost:8770/board-games/index.html |

子域名就是登录名，三个地址是三个互不串号的身份，换别的名字就是第四个人。Alice 开一间房，另外两人凭房间号加入，都点准备后由房主开始。

这种身份方式没有密码，只适合本机试玩和开发：服务只监听 `127.0.0.1`，不要直接暴露到公网。

## 内容

| 配置 | 帝国牌 | 阴谋牌 | 冲突牌池 | 领袖 | 额外组件 |
| --- | ---: | ---: | ---: | ---: | --- |
| 基础版 | 67 | 40 | 18 | 8 | 22 个行动格 |
| + Rise of Ix | 102 | 57 | 22 | 14 | 18 块科技、无畏舰、运输轨 |
| + Immortality | 97 | 55 | 18 | 8 | 18 张特莱拉牌、研究轨、标本 |
| 两款扩展 | 132 | 72 | 22 | 14 | 以上全部 |

每局抽十张冲突牌（Ⅰ 级 1 张、Ⅱ 级 5 张、Ⅲ 级 4 张）。建房时勾选扩展，四种组合都可以开。

## 目录

```text
start.js                              独立启动：页面 + 图片 + 接口，一个进程
board-games/                          后端
  server.js                           HTTP 接口，前缀 /api/board-games
  lib/                                房间、存档、校验（与具体游戏无关）
  games/dune-imperium/                规则引擎、卡牌数据、扩展、测试
  client/board-games.mjs              无界面的浏览器 SDK
  API.md  ASSETS.md  README.md        接口契约、图片约定、插件说明
apps/site/public/board-games/         前端
  index.html  board-games.js  board-games.css
  img/                                封面与棋盘分区背景
  assets/dune-imperium/               270 张卡面与清单
apps/site/public/auth.js              登录桩（接到自己的网站时替换）
```

前端路径保留了它在原网站里的位置（`apps/site/public/`），后端测试按这个相对路径核对图片清单。

## 怎么实现的

- **后端零依赖**。平台层管房间、座位、存档和并发；每款游戏是一个插件，导出 `createGame / applyAction / getLegalActions / getView / getCatalog`。`applyAction` 不修改输入，返回可序列化的新状态。
- **并发与重试**。每次变更带 `expectedVersion`，版本对不上返回 409；每次操作带 `requestId`，超时重试不会重复执行。
- **隐藏信息**。`getView` 按请求者裁剪局面，别人的手牌、阴谋牌和牌库顺序不会发给浏览器。
- **前端不算规则**。服务器返回局面时附带一份可直接提交的合法动作，界面只把它变成按钮和可点的卡牌。
- **无框架、无构建**。一个 HTML、一个 ES 模块脚本、一份样式表；2 秒轮询同步，没有 WebSocket。
- **存档**是单个 JSON 文件（`board-games/data/`），按单进程设计。

更多细节见 [board-games/API.md](board-games/API.md) 和 [board-games/README.md](board-games/README.md)。`board-games/` 下的 `CLAUDE.md`、`EXPANSIONS-HANDOFF.md` 是开发过程中前后端之间的交接记录，里面提到的"主站"指这个项目原本所在的网站。

## 测试

```bash
node board-games/test/run-all.js
```

## 接到自己的网站

1. 用 `createBoardGamesHandler({ dataDir, getUser })` 把接口挂进你的 Node 服务，`getUser(req)` 返回 `{ key, name }` 或 `null`。
2. 把 `apps/site/public/board-games/` 当静态目录发出去，图片建议由 nginx 直出并长期缓存（文件名带内容哈希）。
3. 把 `auth.js` 换成你站上的登录模块，保留 `window.Auth.me()` 和 `login()`。

## 关于卡牌图片与版权

对局里显示的卡面是官方卡牌的图片，《沙丘：帝国》及其扩展的美术和规则版权属于 Dire Wolf Digital 等权利方。这是给朋友之间联机用的非商业爱好项目，和官方没有关系，卡牌图片不在本仓库代码的授权范围内。喜欢这个游戏的话，请去买一盒实体版。

封面和棋盘分区背景是 AI 生成的原创插画。

## 谁写的

后端规则引擎和前端界面分别由不同的 AI 编写（前端是 Claude），fengye 提需求、分配工作并负责测试。
