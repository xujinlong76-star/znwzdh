# W10 证据 — 剩余图标（AI 工具 + 效率办公组，6 站）

- 工作组：W10；分支 `feat/icons-remaining-w10`；基分支 `feat/icons-remaining-2026-11-25`（HEAD bef26ed）。
- 克隆：`~/workspace/znwzdh-icons-remaining-w10`（独立 worktree）。
- 取材时间：2026-11-25 11:18–11:20 CST；工具：curl（Chrome UA `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36`）；像素核对：Pillow + ASCII 渲染。
- 铁律遵守：全部取官方源；16px 原图不放大冒充；<128 源原样保留；>128 源 LANCZOS 只缩小；不造假、不放占位图。
- 阻塞：0 站取不到；1 站机制遗留（OpusClip，见 §OpusClip）。

## Descript — 落地

- 站点：Descript，`https://www.descript.com`（AI 工具/AI 音频语音）。
- 首页：200，`text/html`，291,384 B。声明：
  - `<link rel="icon" href="https://static-cdn.descript.com/web/icons/favicon-96x96.png" sizes="96x96" type="image/png"/>`
  - `<link rel="icon" href="https://static-cdn.descript.com/web/icons/favicon.svg" type="image/svg+xml"/>`
  - `<link rel="icon" href="https://static-cdn.descript.com/web/icons/favicon.ico"/>`
  - `<link rel="apple-touch-icon" href="https://static-cdn.descript.com/web/icons/apple-touch-icon.png"/>`
- 站根 `/favicon.ico`：200，`image/vnd.microsoft.icon`，459 B——内容不是有效图像（Pillow 无法识别，魔数 `03e38089504e470d`），**不可用**，已记录。
- 采用源：`https://static-cdn.descript.com/web/icons/apple-touch-icon.png`（200，`image/png`，3,175 B，PNG 180×180 RGBA）。与 favicon-96x96.png（200，1,555 B，96×96 RGBA）同一 artwork：暗紫圆角方块主色 #651A39（101,26,57）+ 红波形标 #F73B3B（247,59,59），ASCII 渲染一致；取 180 版是 C7 Udemy/Codecademy“取官方最大档”先例。
- 设计文件：`apps/web-overlay/public/brand-icons/descript.png`——LANCZOS 180→128，128×128 RGBA，3,957 B，md5 `c2eb26287ebb5b7b2d15de9143889476`。
- 接线：`site-favicon.tsx` 加 `'descript.com=descriptp'`。全库核对 `descript.com` 只命中 Descript 一站；navigation.json icon 字段 `https://www.descript.com/favicon.ico` 被 isRemoteRawFavicon 拦截，map 生效。

## Make — 落地

- 站点：Make，`https://www.make.com`（AI 工具/智能体与自动化）。
- 首页：200，`text/html`，351,781 B。声明（同源 Webflow CDN）：
  - 32×32（light/dark 同一文件）：`https://cdn.prod.website-files.com/6a294495bc84130c6dd0c4fd/6a7b944121e8a94aaf6ca04f_favicon-32x32.png`
  - 48×48：`.../6a7b9440756d01907cfc9ba4_favicon-32x32.png`
  - apple-touch 180×180：`.../6a7b9441756d01907cfc9bc0_favicon-32x32.png`
  - 192×192：`.../6a7b9441756d01907cfc9bbb_favicon-32x32.png`
  - 512×512：`.../6a7b9441e295d2f297063147_favicon-32x32.png`
- 站根 `/favicon.ico`：404，`text/html`，121,529 B，**不可用**。
- 采用源：512×512 档（200，`image/png`，164,823 B，PNG 512×512 RGBA）。48×48 档（200，3,078 B）与之同一 artwork：品红渐变缎带 M 标（主色 #FF00FF 品红，透明底），48×48 与 512×512 的 ASCII 渲染一致。
- 设计文件：`apps/web-overlay/public/brand-icons/make.png`——LANCZOS 512→128，128×128 RGBA，12,530 B（≤15KB 参考线内），md5 `159d065b8e12bd7e79eeea87f1ee129b`。
- 接线：`site-favicon.tsx` 加 `'make.com=makep'`。全库核对 `make.com` 只命中 Make 一站；navigation.json icon 字段（32×32 CDN PNG，路径含 `favicon`）被 isRemoteRawFavicon 拦截，map 生效。

## SkyReels — 落地

- 站点：SkyReels，`https://www.skyreels.ai/`（AI 工具/AI 短剧与漫剧创作）。
- 首页：200，`text/html`，1,271 B。声明：`<link rel="icon" href="/favicon.png"/>`（多行 head 写法）。
- 声明源 `/favicon.png`：200，`image/png`，1,629 B，PNG 71×96 RGBA，透明底，金色 S 标主色 #FFCF00（255,207,0）。非方形。
- 站根 `/favicon.ico`：200，`image/x-icon`，2,449 B——内容实为 PNG 128×128 RGBA（魔数 `89504e47…`），黑底圆角方块（四角透明）+ 金色 S 标 #FFCF00，md5 `1e407229e15e2cbc00e8b531a0619f2f`。与 /favicon.png 同一金色 S 标。
- 采用源：站根 `/favicon.ico` 的内容（方形 128×128，更适 28px 卡片；C7“首页声明的最大尺寸 icon”先例的方形版）。原样落盘，不做缩放。
- 设计文件：`apps/web-overlay/public/brand-icons/skyreels.png`——128×128 RGBA，2,449 B，md5 `1e407229e15e2cbc00e8b531a0619f2f`（与源逐字节相同）。
- 接线：`site-favicon.tsx` 加 `'skyreels.ai=skyreelsp'`。全库核对 `skyreels.ai` 只命中 SkyReels 一站；navigation.json icon 字段 `https://www.skyreels.ai/favicon.ico` 被拦截，map 生效。

## 讯飞绘镜 — 落地

- 站点：讯飞绘镜，`https://typemovie.art/`（AI 工具/AI 短剧与漫剧创作）。
- 首页：200，`text/html; charset=utf-8`，3,646 B；**无 icon 声明**（head 内无 rel="icon" 链接）。首页含跳转脚本（根路径跳 `/landing`），不影响取标。
- 站根 `/favicon.ico`：200，`image/x-icon`，9,119 B；ICO 单帧 256×256 RGBA（Pillow `sizes={(256, 256)}`），透明底，紫 #8E4BFF（142,75,255）+ 珊瑚红 #FF5A53（255,90,83）抽象标，ASCII 渲染确认标志完整。
- 设计文件：`apps/web-overlay/public/brand-icons/typemovie.png`——LANCZOS 256→128，128×128 RGBA，6,077 B，md5 `4efc13e1b569e1c3c4cae3a55b74c821`。
- 接线：`site-favicon.tsx` 加 `'typemovie.art=typemoviep'`。全库核对 `typemovie.art` 只命中讯飞绘镜一站；navigation.json icon 字段 `https://typemovie.art/favicon.ico` 被拦截，map 生效。

## Todoist — 落地

- 站点：Todoist，`https://todoist.com`（效率办公/在线文档与表格）。
- 首页：200，`text/html; charset=utf-8`，722,722 B。声明：
  - `<link rel="icon" type="image/x-icon" href="/static/favicon.ico">`
  - `<link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32x32.png">`
  - `<link rel="icon" type="image/png" sizes="16x16" href="/static/favicon-16x16.png">`
  - `<link rel="mask-icon" color="#e44332" href="/static/safari-pinned-tab.svg">`
- 站根 `/favicon.ico`：200，`image/vnd.microsoft.icon`，15,086 B；ICO 3 帧 16/32/48，Pillow 默认取最大帧 48×48 RGBA；红圆角方块主色 #E44332（228,67,50）+ 白勾，ASCII 渲染确认。
- 声明的 `/static/favicon-32x32.png`：200，982 B，PNG 32×32 RGBA，同一红底白勾标。
- 采用源：站根 ICO 最大帧 48×48（比声明的 32 PNG 更大；C7“取最大帧”先例：W1 爱奇艺、W10 猫眼）。48×48 原样保留，**绝不放大**（规范 §1.1）。
- 设计文件：`apps/web-overlay/public/brand-icons/todoist.png`——48×48 RGBA，1,963 B，md5 `03f7e5d29329731aa83d08fc5e0e8c9e`。
- 接线：`site-favicon.tsx` 加 `'todoist.com=todoistp'`。全库核对 `todoist.com` 只命中 Todoist 一站；navigation.json icon 字段 `https://todoist.com/favicon.ico` 被拦截，map 生效。

## OpusClip — 落地（文件 + map 键），1 项机制遗留待协调员裁决

- 站点：OpusClip，`https://www.opus.pro`（AI 工具/AI 视频生成）。
- 首页：200，`text/html; charset=utf-8`，403,943 B。声明：
  - `<link href="https://cdn.prod.website-files.com/6388604483b03a9ecb34d695/64351a9e4e9223f5e0f46d64_ico-final.png" rel="shortcut icon" type="image/x-icon"/>`
  - `<link href="https://cdn.prod.website-files.com/6388604483b03a9ecb34d695/6435197bfb1d6e486e04c37b_webclip.png" rel="apple-touch-icon"/>`
- 缺口 JSON 的 resolved 字段（即 navigation.json 的 icon 字段）：`https://cdn.prod.website-files.com/6388604483b03a9ecb34d695/64351a9e4e9223f5e0f46d64_ico-final.png`——200，`image/png`，527 B，PNG 32×32 调色板（P 模式），黑底白 O 形标。已下载，不再热链（见下）。
- 采用源：同源 apple-touch-icon `webclip.png`——200，`image/png`，2,021 B，PNG 256×256 调色板（P 模式）。与 _ico-final.png 同一 artwork（黑底 #0E1015 + 白 O 形标，32×32 ASCII 渲染对照一致，仅留白不同）；取 256 版是 C7“取官方最大档”先例（W2 芒果 64 取代 32、W11 Udemy 180 取代 32）。两者均为官方 Webflow CDN 同站静态资源。
- 设计文件：`apps/web-overlay/public/brand-icons/opusclip.png`——LANCZOS 256→128，128×128 RGBA，7,226 B，md5 `c48623e0ffdf12f34e0ad43898dd2b8e`。
- 接线：`site-favicon.tsx` 加 `'opus.pro=opusclipp'`。全库核对 `opus.pro` 只命中 OpusClip 一站。
- **机制遗留（非阻塞取材，阻塞生效）**：`_ico-final.png` 路径不含 `favicon`，不被 `isRemoteRawFavicon` 拦截；`resolveSiteIcon` 里 customIcon 优先于 map（R1 Beatoven/Sudowrite 先例：单加 map 键不可达，须同步清 icon 字段）。本任务禁改 navigation.json，故本支只落盘 + 建 map 键；**卡片渲染路径（SiteFavicon 传 icon）在 navigation.json 的 icon 行清空前仍走 CDN 直链**。map 本身已验证可达：`resolveSiteIcon('https://www.opus.pro', 'OpusClip')`（无 customIcon，与 ecosystem-graph 调用形态一致）→ `/brand-icons/opusclip.png`。测试文件把直通事实钉死。待协调员/合流方按 R1 先例清一行 navigation.json icon（`opus.pro` 的 `icon` 字段）即可生效；或由复审裁决是否改拦截规则。本支不擅自改 navigation.json、不改 resolver。

## 接线核对总表

| 站 | 映射键 | 文件 | 尺寸 | 字节 | 全库命中 |
|---|---|---|---|---|---|
| Descript | descript.com | descript.png | 128×128 | 3,957 | 1 站 |
| Make | make.com | make.png | 128×128 | 12,530 | 1 站 |
| SkyReels | skyreels.ai | skyreels.png | 128×128 | 2,449 | 1 站 |
| 讯飞绘镜 | typemovie.art | typemovie.png | 128×128 | 6,077 | 1 站 |
| Todoist | todoist.com | todoist.png | 48×48 | 1,963 | 1 站 |
| OpusClip | opus.pro | opusclip.png | 128×128 | 7,226 | 1 站 |

- 六站均无标题规则拦截、无后缀串站；navigation.json 未动；17K小说网、书旗小说、Adobe Color、Batch 0、Batch 1、llms.txt、复盘自动化文件均未碰。
- 六标浅/深主题均可辨（Descript 暗紫方块、Make 品红缎带、SkyReels 黑底金 S、绘镜紫红标、Todoist 红底白勾、OpusClip 黑底白 O），按规范 §9 不做单站底块补丁、不配 LOGO_TILE_MAP（`resolveLogoTile` 为 null，已断言）。

## 测试与验证（待填）

- 定向测试：`apps/web-overlay/test/site-favicon-iconbatch-remaining-w10.test.ts`
- 回归：`site-favicon-iconbatch-*.test.ts`
- typecheck：
- 390px 渲染验证：
