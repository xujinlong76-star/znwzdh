# EVIDENCE — 剩余图标补齐 W5 短剧组（2026-11-25）

- Worker：W5（短剧组，7 站）
- Worktree：`~/workspace/znwzdh-icons-remaining-w5`，分支 `feat/icons-remaining-w5`
- 基线：`feat/icons-remaining-2026-11-25` @ `bef26ed3`
- 缺口清单来源：`~/workspace/goals/efficiency-goal-2/hidden_files/icons-remaining-gap-2026-11-25.json`
  （6 站 `letter_fallback`，`map_key: null`；ReelShort `remote_favicon`，`resolved` 为站方 CDN 直链）
- 接手说明：上一位 worker 在守护进程重启后丢失，无汇报；本文件由接续 worker 从 worktree 现场接手后补写。
  现场核实（2026-11-25 19:34–19:40 CST）：分支 `feat/icons-remaining-w5`，HEAD `bef26ed3`，
  工作区已有 6 个图标文件 + `site-favicon.tsx` 改动 + 完整测试文件，零提交。
  与任务描述不符的一处：**ReelShort 图标文件并非缺失**——`reelshort.png`（12,804 B）已在基线 HEAD
  中被跟踪（2b 批建好），缺的是它的可达性（见 §7）；本批不改该文件，只修解析链。
  6 站取材由上一位 worker 于 2026-11-25 19:19–19:21 CST 用 curl（Chrome UA）逐站实测，
  取材事实以测试文件 `apps/web-overlay/test/site-favicon-iconbatch-remaining-w5.test.ts`
  头部注释钉死；接续 worker 复核了落盘文件的字节数 / md5 / PNG 尺寸（与测试钉死值逐个一致，
  见 §8）并目视核对 7 标均为真实品牌标。ReelShort 官方源由接续 worker 于 19:40 CST
  重新下载验证（见 §7）。未造假、未用第三方图标库顶替。
- 结论：**7 站全部落地，阻塞 0**。`navigation.json` 未动；17K小说网、书旗小说、Adobe Color、
  Batch 0、Batch 1、llms.txt、复盘自动化文件均未碰。

## 1. ShortMax — 落地：`shortmax.png`，键 `shorttv.live`

- navigation：标题 `ShortMax`，href `https://www.shorttv.live/`，icon `https://www.shorttv.live/favicon.ico`
  （远端裸 favicon，被 isRemoteRawFavicon 拦截后回落 map）。
- 来源 URL：`https://www.shorttv.live/images/logo.png`（首页声明 apple-touch-icon；
  首页 200，527,529 B，text/html；另声明 `<link rel="icon" sizes="32x32" href="/favicon.ico">`）
- 取回：200、2,835 B、PNG 71×71（黑底白 S + 橙色 TV 带）；`/favicon.ico` 200，4,286 B，
  ICO 32×32 单帧，同标（底行橙色占比 75%–91% vs logo 版 75%–92%），取较大的 71 版。
- 设计说明：黑底圆角方块 + 白 S + 底部橙色 TV 带。71×71 < 128 按规范原样不放大落盘。
  落盘 71×71 RGBA、2,835 B、md5 `6d09cf77f1f22b39ab5f96fcfa801aae`。

## 2. GoodShort — 落地：`goodshort.png`，键 `goodshort.com`

- navigation：标题 `GoodShort`，href `https://www.goodshort.com`，icon `https://www.goodshort.com/favicon.ico`
  （远端裸 favicon，被拦截后回落 map）。
- 来源 URL：`https://www.goodshort.com/public/favicon.ico`（首页声明
  `<link rel="icon" href="/public/favicon.ico" />`；首页 200，269,255 B）
- 取回：200、1,286 B、image/x-icon，内容实为 PNG 40×40（白底红橙播放三角标）；
  与根 `/favicon.ico` 逐字节相同（md5 `16f2e6d9…`）。
- 设计说明：白底红橙渐变播放三角标。40×40 < 128 原样不放大落盘。
  落盘 40×40 RGB、1,286 B、md5 `16f2e6d9f8ded7c498860e65683368d9`。

## 3. NetShort — 落地：`netshort.png`，键 `netshort.com`

- navigation：标题 `NetShort`，href `https://netshort.com`，icon `https://netshort.com/favicon.ico`
  （远端裸 favicon，被拦截后回落 map）。
- 来源 URL：`https://netshort.com/a2hs/apple-touch-icon.png`（首页声明 apple-touch-icon；
  首页 200，420,627 B）
- 取回：200、10,179 B、PNG 180×180（红橙渐变圆角方块 + 白色胶片标）。
  未用：根 `/favicon.ico`（200，20,718 B，内容实为 WebP 300×300 全幅渐变同标，路径与内容类型不符）。
- 设计说明：红橙渐变圆角方块 + 白色胶片标。Pillow LANCZOS 180→128 缩放落盘。
  落盘 128×128 RGBA、11,670 B、md5 `33e43a2b22b9edc4f2a65ca4b26e3bed`。

## 4. FlexTV — 落地：`flextv.png`，键 `flextv.cc`

- navigation：标题 `FlexTV`，href `https://www.flextv.cc`，icon `https://www.flextv.cc/favicon.ico`
  （远端裸 favicon，被拦截后回落 map）。
- 来源 URL：`https://www.flextv.cc/apple-touch-icon.png`（首页声明 apple-touch-icon；
  首页 200，706,683 B；另声明 `<link rel="icon" href="https://www.flextv.cc/favicon.ico">`）
- 取回：200、14,875 B、PNG 672×672（粉 #FB3867 圆角方块 + 白色电视播放标）；
  与根 `/favicon.ico` 256×256 帧同标（64 档均值差异 3.70，仅重采样差）；根 ICO 270,398 B 未用。
- 设计说明：粉红圆角方块 + 白电视 + 白播放三角。Pillow LANCZOS 672→128 缩放落盘。
  落盘 128×128 RGBA、2,976 B、md5 `46c2048d4fe1871070da720fce58a8f4`。

## 5. MoboReels — 落地：`moboreels.png`，键 `moboreels.com`

- navigation：标题 `MoboReels`，href `https://www.moboreels.com`，icon `https://www.moboreels.com/favicon.ico`
  （远端裸 favicon，被拦截后回落 map）。
- 来源 URL：`https://www.moboreels.com/_nuxt/img/logo.1733fb4.png`（站内页头/页脚同源站方 logo；
  首页 200，156,338 B，仅声明 `<link rel="icon" type="image/x-icon" href="/favicon.ico">`）
- 取回：200、1,586 B、PNG 80×80（粉红渐变方块 + 白电视 + 白爱心完整标），目视核对为同一品牌标的完整版。
  未用：`/favicon.ico`（200，4,286 B，ICO 32×32 单帧，粉红渐变方块 + 深红爱心，零白像素——
  32px 下白电视描边已丢失的简化版；复审如改用 32 版只需换文件一行）。
- 设计说明：粉红渐变圆角方块 + 白电视框 + 白爱心。80×80 < 128 原样不放大落盘。
  落盘 80×80 索引色、1,586 B、md5 `1733fb416f82abda1a75e3b7a7b5ad8e`。

## 6. Melolo — 落地：`melolo.png`，键 `melolo.com`

- navigation：标题 `Melolo`，href `https://melolo.com`，icon `https://melolo.com/favicon.ico`
  （远端裸 favicon，被拦截后回落 map）。
- 来源 URL：`https://melolo.com/favicon.ico?favicon.1jo7br0ifgqa8.ico`（首页声明
  `<link rel="icon" href="/favicon.ico?favicon.1jo7br0ifgqa8.ico" sizes="64x64">`；
  首页 200，404,517 B；另声明 `/favicon.png` 与 apple-touch-icon `/icon.png`）
- 取回：200、16,958 B、ICO 64×64 单帧（红 #B90004 圆角方块 + 白电视 M 标）；
  与 `/icon.png` 56×56 同标（64 档均值差异 3.92，仅重采样差）。
  未用：声明的 `/favicon.png`（200 回 HTML 壳页，不可用）。
- 设计说明：红圆角方块 + 白电视 + 白 M。ICO 64 帧解码原样落盘。
  落盘 64×64 RGBA、3,916 B、md5 `9c0dc3f8bb25bfaa3a5fb1236bd01c15`。

## 7. ReelShort — 落地：`reelshort.png`，键 `reelshort.com`（只修可达性，文件不动）

- navigation：标题 `ReelShort`，href `https://www.reelshort.com`，icon 为站方自有 CDN 直链
  `https://v-mps.crazymaplestudios.com/images/211d3420-d721-11f0-84ad-6b5693b490dc.png`
  （缺口清单 `resolved` 字段即此 URL，机制 `customIcon-passthrough`）。
- 旧行为：该 icon 既非第三方图标服务、又非 `/favicon.ico` 盲猜路径，`resolveSiteIcon` 的
  customIcon 优先分支直接热链回传，`LOCAL_LOGO_MAP` 里已有的 `'reelshort.com'` 键永不可达
  （缺口清单误记 `map_key: null` 即源于此）。
- 来源 URL（接续 worker 2026-11-25 19:40 CST 重新下载验证，curl，Chrome UA）：
  `https://v-mps.crazymaplestudios.com/images/211d3420-d721-11f0-84ad-6b5693b490dc.png`
- 取回：HTTP 200、`image/png`、**14,425 B**、PNG **204×204** RGBA、
  md5 `7cb3217335abfe04c3908991d79dffaa`（红粉渐变圆角方块 + 白 R + 播放三角标）；
  首页 200（600,514 B），head 三处声明同源同文件（apple-touch-icon + icon）；
  站根 `/favicon.ico` 404 未用。
- 本地化：204→128 LANCZOS 与基线已跟踪的 `reelshort.png` 逐字节一致
  （md5 `0cd48cd0ba550cf52a474cbb8db749bf`，12,804 B），故**本批不改文件**。
  只修可达性：在 `resolveSiteIcon` 顶部加单站绕过——`reelshort.com`（含 www 归一后同键）
  跳过 customIcon 直通、回落 map；`navigation.json` 不动，清空 icon 字段留待合流方按 R1 裁决处理。
  作用域仅此一站，其余站行为不变；测试钉死 CDN URL 本身不再作为解析结果出现。
- 设计说明：红粉渐变圆角方块 + 白 R + 红粉播放三角。落盘 128×128 RGBA、12,804 B、
  md5 `0cd48cd0ba550cf52a474cbb8db749bf`。

## 8. 落盘复核（接续 worker，2026-11-25 19:34–19:40 CST）

| 站 | 文件 | 尺寸 | 字节 | md5 | 目视 |
|---|---|---|---|---|---|
| ShortMax | `shortmax.png` | 71×71 | 2,835 | `6d09cf77f1f22b39ab5f96fcfa801aae` | 黑 S + 橙 TV 带 ✅ |
| GoodShort | `goodshort.png` | 40×40 | 1,286 | `16f2e6d9f8ded7c498860e65683368d9` | 红橙播放三角 ✅ |
| NetShort | `netshort.png` | 128×128 | 11,670 | `33e43a2b22b9edc4f2a65ca4b26e3bed` | 红橙胶片标 ✅ |
| FlexTV | `flextv.png` | 128×128 | 2,976 | `46c2048d4fe1871070da720fce58a8f4` | 粉电视播放标 ✅ |
| MoboReels | `moboreels.png` | 80×80 | 1,586 | `1733fb416f82abda1a75e3b7a7b5ad8e` | 粉电视爱心标 ✅ |
| Melolo | `melolo.png` | 64×64 | 3,916 | `9c0dc3f8bb25bfaa3a5fb1236bd01c15` | 红电视 M 标 ✅ |
| ReelShort | `reelshort.png` | 128×128 | 12,804 | `0cd48cd0ba550cf52a474cbb8db749bf` | 红粉 R 播放标 ✅ |

- 7 文件均 ≤ ~15 KB 参考线（最大 netshort.png 11,670 B）；6 站新文件均 <128 原样或只缩小，
  无一放大（16px 原图不放大冒充）；7 标均为真实品牌标，浅/深主题均可见，按规范 §9
  不做单站底块补丁、不配 LOGO_TILE_MAP（`resolveLogoTile` 为 null），留待统一处理轮。
- 键的精确性：6 个新键在 `navigation.json` 全库 388 站 href 中各只命中 1 站，无后缀串站、无子域站；
  禁加的键 `miguvideo.com` / 裸 `yangshipin.cn` / `qq.com` / `github.com` / `adobe.com` 本批均未碰
  （测试断言钉死）。
- 接线：`site-favicon.tsx` 的 `LOCAL_LOGO_MAP` 末尾追加 6 键
  （`shorttv.live=shortmaxp` / `goodshort.com=goodshortp` / `netshort.com=netshortp` /
  `flextv.cc=flextvp` / `moboreels.com=moboreelsp` / `melolo.com=melolop`），
  另 `resolveSiteIcon` 顶部加 ReelShort 单站绕过（见 §7）。`navigation.json` 未改。

## 390px 渲染验证（待填）

- 方法：C7 替代法——真实卡片 28px + object-contain + Playwright + 本地 Chromium 截图，浅/深双主题。
- 结果：（跑完后填）

## 测试与 typecheck（待填）

- 定向测试：（跑完后填）
- typecheck：（跑完后填）
