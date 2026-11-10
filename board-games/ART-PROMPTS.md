# 《沙丘：帝国》生图提示词（给 GPT）

前端已经按 `ASSETS.md` 接好图：清单里有哪张就显示哪张，没有的自动退回线条图标，所以可以分批生成、分批放。

**交付方式**：每张图按下面的「文件名」保存成 PNG（或 JPG），全部丢进
`apps/site/public/board-games/assets/dune-imperium/_incoming/`，然后告诉 Claude。Claude 负责裁切、压成 WebP、改名为 `*.v1.webp` 并写进 `manifest.json`。

**统一要求**（每条提示词前面都加上这一段）：

> Original fantasy sci-fi concept art, painterly digital illustration with fine ink linework, set on a vast desert planet at night. Palette: deep indigo and midnight blue shadows, warm spice-orange and pale gold highlights, a little teal. Soft rim light, subtle film grain, calm and atmospheric, slightly stylized (not photorealistic). Landscape 3:2, 1536×1024. Keep the main subject in the central 60% so the image survives being cropped to a wide strip. No text, no letters, no numbers, no logos, no watermark, no borders, no card frame, no UI. Do not depict any real actor or any film/TV/board-game artwork; all designs must be original.

卡名和效果由网页用文字渲染，所以图里**不要出现任何文字**。测试牌是开发版自定义内容，画成通用形象即可。

## 第一批：界面用图（8 张，最影响观感）

| 文件名 | 用途 | 提示词（接在统一要求后） |
| --- | --- | --- |
| `ui-cover` | 大厅封面、主站游戏仓封面 | A sweeping view of endless dunes under two moons, a distant fortress city glowing on a rock outcrop, the faint ridged back of a colossal sandworm cresting far away, drifting glowing spice dust in the wind. Epic, quiet, lots of sky. |
| `zone-emperor` | 皇帝区背景 | Interior of an imperial throne hall: towering dark columns, a distant empty throne on a dais, long crimson banners without symbols, shafts of gold light. |
| `zone-spacing-guild` | 宇航公会区背景 | A gigantic cylindrical starship hanging in orbit above a desert planet, tiny shuttles streaming toward it, warped light around its bow suggesting folded space. |
| `zone-bene-gesserit` | 贝尼·杰瑟里特区背景 | A candle-lit stone cloister at night, three hooded robed figures seen from behind walking under arches, violet shadows, an air of secrecy. |
| `zone-fremen` | 弗雷曼区背景 | Desert dwellers in full-body survival suits and cloaks standing on a dune crest at dusk, eyes faintly glowing blue, a hidden cave entrance in the rocks behind them. |
| `zone-landsraad` | 兰兹拉德区背景 | A grand circular council chamber with tiered seats and tall arched windows, nobles in dark formal dress as small distant figures, cool marble and gold light. |
| `zone-city` | 城镇区背景 | A walled desert city of angular sandstone towers and shield-wall cliffs at twilight, windows lit orange, ornithopter-like dragonfly aircraft as tiny silhouettes. |
| `zone-spice-trade` | 香料贸易区背景 | Open desert with a huge tracked harvester machine kicking up a glowing orange spice plume, carrier aircraft hovering above, worm sign rippling in the far sand. |

## 第二批：卡牌（15 张）

| 文件名 | 卡牌 | 提示词 |
| --- | --- | --- |
| `convincing-argument` | 有力论证 | A calm envoy in dark robes leaning over a table, one open hand extended persuasively, a pouch of coins and a sheathed knife on the table between two parties. |
| `dagger` | 匕首 | Close-up of an ornate curved dagger with a pale milky blade resting on dark cloth, gold glints, sand grains. |
| `diplomacy` | 外交 | Four emissaries in distinct robes (crimson, orange, violet, sand-blue) meeting around a low brazier, a wary handshake at the centre. |
| `dune-desert-planet` | 沙丘，沙漠星球 | The whole desert planet seen from orbit, ochre and amber with pale storm swirls, two small moons, thin glowing atmosphere. |
| `reconnaissance` | 侦察 | A lone scout lying on a dune ridge with a spyglass, a dragonfly-winged aircraft parked behind, a distant city on the horizon. |
| `seek-allies` | 寻求盟友 | A cloaked messenger offering a sealed scroll case to shadowed figures in a doorway, lantern light spilling out into the night sand. |
| `signet-ring` | 印章戒指 | Close-up of a heavy gold signet ring with a blank oval face on a gloved hand resting on a chair arm, deep shadows. |
| `arrakis-liaison` | 厄拉科斯联络人 | A desert guide in a survival suit and a city official in formal dress conferring on a rooftop terrace overlooking the dunes. |
| `the-spice-must-flow` | 香料必须流动 | A river of glowing orange spice pouring through cargo chutes into a freighter hold, workers as small silhouettes, dust catching the light. |
| `foldspace` | 折叠空间 | A starship plunging into a tunnel of bent starlight, space folding like cloth around it, teal and gold streaks. |
| `dev-envoy` | 测试牌·使者 | A dignified envoy in travelling cloak arriving at a palace gate, attendants carrying a small chest. |
| `dev-scout` | 测试牌·斥候 | A light desert scout running along a rock ledge at dawn, blade at hip, scarf trailing in the wind. |
| `dev-recruiter` | 测试牌·征募官 | A stern officer at a field table enlisting a line of soldiers, banners without symbols behind. |
| `dev-water-carrier` | 测试牌·运水者 | A robed carrier bearing sealed water flasks on a yoke through a narrow canyon, a few precious drops glinting teal. |
| `dev-spice-broker` | 测试牌·香料经纪 | A shrewd merchant weighing glowing orange spice on brass scales in a dim market stall, coins stacked beside. |

## 第三批：阴谋牌（4 张，可选）

| 文件名 | 卡牌 | 提示词 |
| --- | --- | --- |
| `dev-ambush` | 测试阴谋·伏击 | Fighters bursting out of the sand around a surprised patrol at night, blades flashing, dust exploding upward. |
| `dev-cache` | 测试阴谋·补给 | A hidden cache under a rock slab pried open to reveal sacks of glowing spice, a hooded figure holding a lantern. |
| `dev-water` | 测试阴谋·储水 | A secret underground cistern, dark still water reflecting a single lamp, a robed keeper at the edge. |
| `dev-legacy` | 测试阴谋·遗产 | An old ornate chest opened in a dusty vault revealing a folded banner and a gold circlet, light falling from above. |

每批内风格尽量一致：同一批最好在同一个对话里连续生成，并让它「保持与上一张相同的画风和色调」。
