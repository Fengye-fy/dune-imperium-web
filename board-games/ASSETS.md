# 本地卡牌图片架构

卡面文件随网站源码保存在本地静态目录。线上由 Nginx 直接读取磁盘提供，浏览器通过 HTTP 缓存复用；Node 游戏服务不读取、生成、缩放、代理或传输卡面图片。首次加载仍需要下载，之后在浏览器缓存有效且未被清理时复用，减少重复网络传输和后端工作。

## 目录与数据流

```text
apps/site/public/board-games/assets/
  dune-imperium/
    manifest.json                 cardId → 本地文件路径、尺寸、说明
    card-placeholder.v1.svg        尚未补图时的通用本地占位图
    card-back.v1.svg               未公开卡牌的通用开发版卡背
    cards/<category>/             已下载的 WebP，文件名含内容哈希

GET /api/board-games/games
  → game.assets.manifestUrl
  → 浏览器读取静态 manifest.json（每次进入游戏读取一次）
  → 用 cardId 查图（不使用卡实例 uid）
  → 浏览器加载 /board-games/assets/.../cards/imperium/xxx.<hash>.webp
  → Nginx 静态直出 + 浏览器缓存

对局轮询 → 只有公开状态/本人手牌实例，图片不随轮询传输
```

所有游戏用同一结构，在 `assets/` 下并列增加游戏目录。游戏的 `manifest.assets` 只提供静态清单地址，不将整个图片清单塞进每个房间快照。卡图、base64、Data URL 和图片二进制不进入房间存档、动作请求或游戏状态。

基础版已下载 135 张英文原版资源，共 16,416,378 字节（约 16.4 MB），基础图鉴 revision 为 `base-2020-618706115c1f`：

| 分类 | 不同图片数 | 清单键示例 |
| --- | ---: | --- |
| 起始牌 | 7 | `dagger`、`dune-desert-planet` |
| 储备牌 | 3 | `arrakis-liaison`、`foldspace` |
| 帝国市场 | 43 | `arrakis-recruiter`、`kwisatz-haderach` |
| 阴谋牌 | 34 | `intrigue-ambush`、`intrigue-corner-the-market` |
| 冲突牌 | 18 | `conflict-grand-vision`、`conflict-skirmish-1` |
| 领袖 | 8 | `leader-paul-atreides` |
| 行动格 | 22 | `space-arrakeen`、`space-foldspace` |

不同图片数不是实体牌数量。例如起始的 7 种牌组成每人 10 张牌；完整帝国牌库 43 种/67 张、阴谋 34 种/40 张。新局 `base-dev-v3` 已录入全部基础版牌库与领袖技能，仍待用户测试验收；旧子集存档保持原牌库。范围为 2020 基础版多人内容，没有混入 Ix、Immortality、Uprising、Promo，也未加入单人/双人 House Hagal 牌。

新增两扩展图片 135 张，7,847,018 字节（约 7.85 MB），资源合计 270 张/约 24.3 MB：Ix 29 种帝国牌、17 种阴谋、18 科技、6 领袖、4 冲突、4 行动格及 1 张 Epic 参考牌；Immortality 25 种帝国牌、11 种阴谋、19 种特莱拉牌（含固定 Reclaimed Forces）及 1 种 Experimentation。图鉴在 `games/dune-imperium/catalog-expansions.json`，公开目录在 `catalog.expansions.referenceCards`，均有 `expansion` 字段。

扩展牌现已加入 `CARDS/INTRIGUES` 定义并按建房配置进入 v4 牌库，基础局不会混入扩展。实现状态为 `implemented-unverified`，等待用户验收。Epic 牌仅供参考，不进入常规设置。

静态清单的 `revision` 现为全部图片记录计算出的 `assets-<hash>`；`baseRevision`（基础导入后）和 `expansionRevision` 分别记录来源图鉴版本。两个导入器都保留对方的图片以及 Claude 添加的装饰资源。

文件来自 [Dune Cards Hub](https://dunecardshub.com/)，每张图片在 manifest 中记录 `sourceUrl`、实际尺寸、字节数与完整 SHA-256；原画权利归原权利人，来源站不是本项目或发行商的授权声明。卡面内容已供规则录入核对，下载后运行时只请求本站，不热链来源站。

原始目录和资源记录见 `games/dune-imperium/catalog-base.json`。其中四种帝国牌的来源数量有误，工具显式校正为 Arrakis Recruiter 2、Bene Gesserit Sister 3、Spice Hunter 2、Worm Riders 2，并保留 `sourceCopies/copiesSource`；完整数量合计 67。规则按实际卡面与官方规则处理，不直接执行来源站的描述文字。

SDK 对未知 ID 和旧 `dev-*` 测试牌仍返回占位图，暗牌继续使用通用卡背。卡名与规则效果由 catalog 渲染，不能靠图片 OCR 执行规则。

## 重复下载与修复

```powershell
# 一次性安装下载工具的 Python 依赖（游戏服务本身仍无第三方依赖）
python -m pip install requests Pillow
python board-games/tools/import-dune-assets.py

# 来源目录结构发生变化时，重新读取索引；数量变化会要求先人工检查
python board-games/tools/import-dune-assets.py --refresh

# 两款扩展的来源图片；不会自动启用扩展游戏
python board-games/tools/import-dune-expansion-assets.py
python board-games/tools/import-dune-expansion-assets.py --refresh
```

工具最多同时下载四张，复用本地校验值相同的文件；缺图或损坏时重新下载。下载解码失败不会发布新清单，全部成功后原子替换 JSON。哈希文件名保证图片更新后使用新地址，旧文件不会自动删除。`--refresh` 更新目录；同一来源 URL 的图片内容替换需要先移开对应本地文件，再重跑下载。命令可在任意工作目录执行。

## 补充与替换卡面

1. 官方参考图优先用上述工具下载；自备图片可保存为 `apps/site/public/board-games/assets/dune-imperium/cards/<cardId>.v1.webp`。优先压缩 WebP，也支持 AVIF、PNG、JPEG 或静态 SVG；生产端不动态转换。
2. 在 `manifest.json` 的 `images` 中添加对应 cardId，填写图片实际宽高与替代文字。不要填写 HTTP 外链、绝对磁盘路径、`..`、查询参数或 base64。SDK 只接受本游戏静态目录里的相对路径。
3. 修改已有图片时另存 `.v2.webp` 等新文件名，同时更新清单与 `revision`。不要用同一路径覆盖一张长期缓存的图片。保留旧版本文件，避免尚未刷新的页面请求失效。

示例（先放入实际文件，再添加映射，不要直接引用不存在的示例文件）：

```json
{
  "schemaVersion": 1,
  "gameId": "dune-imperium",
  "revision": "local-assets-v2",
  "defaults": {
    "face": {"src":"card-placeholder.v1.svg","width":400,"height":600,"alt":"卡面待补充","placeholder":true},
    "back": {"src":"card-back.v1.svg","width":400,"height":600,"alt":"未公开的卡牌","placeholder":true}
  },
  "images": {
    "dagger": {"src":"cards/dagger.v1.webp","width":400,"height":600,"alt":"匕首"}
  }
}
```

## Claude 的前端接入方式

```js
import { createBoardGamesClient, loadCardAssets } from '/api/board-games/client.js';

const api = createBoardGamesClient();
const { game, catalog } = await api.catalog('dune-imperium');
const assets = await loadCardAssets(game); // 保留这个对象，不放进房间轮询函数

function cardImage(cardId, hidden = false) {
  const info = assets.imageFor(cardId, { hidden });
  const img = document.createElement('img');
  img.width = info.width;
  img.height = info.height;
  img.alt = info.alt;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener('error', () => {
    // 缺图时仍保留界面的卡牌文字；错误回退只执行一次。
    img.src = (hidden ? assets.back : assets.fallback).src;
  }, { once: true });
  img.src = info.src;
  return img;
}
```

`loadCardAssets()` 读取清单失败时由页面捕获并切换成文字卡牌，不应中断对局。未知 cardId 自动使用占位图；有映射但文件缺失则由上例图片 error 事件回退。隐藏卡只传 `hidden:true`，使用通用卡背；不根据对手的牌序猜测或请求其卡面。

只加载当前可见卡牌，不在每次轮询预取整副牌。图片使用固定宽高/比例以避免加载时页面跳动；图片与清单都属于公开静态资源，不能用于保存未公开的手牌或房间数据。

## 服务与缓存

- 生产：`deploy/nginx/website/static.conf` 的 `/board-games/assets/` 直接从 `apps/site/public` 提供文件。缺失资源直接 404，不回退到 Node。图片缓存 30 天，清单 `expires -1` 允许更新时重新验证；沿用 Nginx 的静态 ETag/Last-Modified。
- 本地主站：`node apps/site/server.js` 已有静态文件服务，可以访问同一目录；开发时仍可能由 Node 读图，线上用 Nginx 才会绕过 Node。
- 独立 API：`node board-games/server.js` 不提供图片。前端开发代理应将 `/api/board-games` 转给 API 服务，将 `/board-games/assets/` 转给静态站点或本地静态目录，保持浏览器同源。
- 本轮没有加入 Service Worker 或离线对局机制；使用浏览器标准 HTTP 缓存，不承诺首次离线可用。
- 图片和清单无需安装依赖或构建生成，随现有 Git release 发布；没有执行部署。测试和验收按用户约定交给用户。

## 前端怎么用这些图（Claude 补充）

`apps/site/public/board-games/board-games.js` 启动时对每个带 `assets` 的游戏调用一次 `loadCardAssets()`，失败就用文字卡牌。

- 卡牌、阴谋、冲突、领袖都按 ID 从清单取**整张卡面**显示；鼠标悬停出大图，点卡角的 ⤢ 放大（触屏可用）。清单里没有或带 `placeholder:true` 的，退回 catalog 文字卡。
- 图鉴页 `#/cards/<gameId>` 按 `catalog.referenceCatalog.cards` 渲染，只能看不能操作。
- 行动格图（每张约 0.5 MB）只在图鉴里懒加载，棋盘上的格子用文字和图标画，不加载这些大图。
- 界面插画不进清单：封面和七个棋盘分区背景在 `apps/site/public/board-games/img/*.v1.webp`（由 `_incoming/` 里 GPT 生成的 PNG 压成），分区背景由 CSS 引用；主站游戏仓封面是 `apps/site/public/img/dune.webp`。
- `_incoming/` 是生图原件（约 80 MB），已写进 `.gitignore`，不随发布走。其中起始牌、保留牌、测试牌的插画没有使用：这些牌现在有清单里的完整卡面。
