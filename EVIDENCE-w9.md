# EVIDENCE-w9.md — 剩余图标补齐 W9（设计与创意组，8 站）

- 分支：`feat/icons-remaining-w9`（基分支 `feat/icons-remaining-2026-11-25`，HEAD `bef26ed`）
- 落地提交：`f05169ba`（6 站：图标 + 接线 + 测试）
- 本文件提交：见同分支追加提交
- 时间：2026-11-25 20:06–20:15 CST（W9 接续核实与复测；前任 5 站取材 2026-11-25 19:2x CST）
- 范围：SiteInspire、Paletton、Colormind、Pexels、Pixabay、Photopea、Khroma、Happy Hues
- 不在本组：17K小说网、书旗小说（绝对排除）、Adobe Color（另一 worker 单独做）
- 铁律：每站先研究官网在用的图标再本地化；16px 原图不放大冒充；无官方源不造假、不拿通用图/第三方图标库顶替；`navigation.json` 不动。

## 落地 6 站

| 站 | 源 URL（官网在用图标） | 源尺寸 / 响应 | 本地文件 | 本地尺寸 / 字节 / md5 | 接线键 | nav icon 字段与解析 |
|---|---|---|---|---|---|---|
| Paletton | https://paletton.com/img/favicon-128.png（首页声明的最大档） | 128×128 RGBA，200、image/png、4,345 B，md5 f23476c6715214726e096a8d3cf8275f | `apps/web-overlay/public/brand-icons/paletton.png` | 128×128 / 4,244 B / fed94784d27d8bf2e389002d133bdd1c | `paletton.com=palettonp` | `https://paletton.com/favicon.ico`，被 `isRemoteRawFavicon` 拦截，map 生效 |
| Colormind | https://colormind.io/favicon32.gif（首页声明；根 /favicon.ico 404 未用） | 32×32 GIF，200、image/gif、2,389 B，md5 2bc31481c2048290cd453d873c7b0d29 | `colormind.png` | 32×32 / 1,509 B / c433be10c6a2c208411dfc13c3a4efba | `colormind.io=colormindp` | `https://colormind.io/favicon32.gif`，路径含 favicon 被拦截，map 生效 |
| Photopea | https://www.photopea.com/promo/icon512.png（首页声明） | 512×512 RGBA，200、image/png、17,293 B，md5 59b6b69a426e8232fbbbed410badc879 | `photopea.png` | 128×128 / 11,480 B / edb41c65fb239d86ba3ff469b03d5dc2 | `photopea.com=photopeap` | `https://www.photopea.com/promo/icon512.png`（路径不含 favicon，不触发拦截；`customIcon` 优先于 map，运行时仍走远端直链——截胡现状，见下） |
| Khroma | https://www.khroma.co/assets/icons/fav.png（首页声明 `../assets/icons/fav.png`） | 31×32 RGBA，200、image/png、358 B，md5 4cd5d47db8d104df49627f4e7e44e34b | `khroma.png` | 31×32 / 358 B / 4cd5d47db8d104df49627f4e7e44e34b（字节原样） | `khroma.co=khromap` | `https://www.khroma.co/assets/icons/fav.png`，同 Photopea 截胡现状 |
| Happy Hues | https://cdn.prod.website-files.com/5dd40aa8049df8748c72d0ee/5dd9b94105da589ba59c4907_happy-hues-fav.png（首页声明的 Webflow CDN） | 32×32 RGBA，200、image/png、1,179 B，md5 43924ea552e27ebba0a2e2add953ccf2 | `happyhues.png` | 32×32 / 1,179 B / 43924ea552e27ebba0a2e2add953ccf2（字节原样） | `happyhues.co=happyhuesp` | 同上 CDN 直链，同 Photopea 截胡现状 |
| Pexels | https://images.pexels.com/lib/api/pexels.png（站方自有图片 CDN，官方 API 品牌资产；主域 www.pexels.com 全路径被 Cloudflare 墙，见阻塞备注） | 1010×446 RGBA，200、image/png、24,726 B，md5 fa5df91be27d70e447150875f2e6b8f3 | `pexels.png` | 256×113 / 13,890 B / 85ff250e3d2ce2f64b38711249f9ba20 | `pexels.com=pexelsp` | `https://www.pexels.com/favicon.ico`，被 `isRemoteRawFavicon` 拦截，map 生效 |

取材方式：

- Paletton / Photopea：源图等比缩放落盘（Paletton 源即 128×128 原样；Photopea 512→128 Pillow LANCZOS）。
- Colormind：GIF 转 RGBA PNG，原样 32×32，不放大。
- Khroma / Happy Hues：字节原样落盘（31×32 / 32×32），不放大。
- Pexels（W9 接续由阻塞改落地）：前任只落盘未接线，测试仍断言阻塞。W9 复测源站 `images.pexels.com/lib/api/pexels.png`：200、image/png、24,726 B、md5 `fa5df91b…` 与前任记录一致；本地文件与源等比缩放像素逐点一致（max abs diff 0，md5 差异仅 PNG 编码器元数据）；ASCII 渲染确认 “pexels” 手写体 + 右上 P 形 swoosh 标完整，故补 `pexels.com=pexelsp` 接线并更新测试（CASES + LOCAL_ASSETS，BLOCKED 改 2 站）。宽 wordmark 先例见库内 chinatax/ncpssd/nmc。

键的精确性：6 键在 388 站库中各只命中 1 站（逐站核对），无后缀串站、无子域站；`navigation.json` 不动。

### 已知局限（只记、不打散补丁，留待统一处理轮）

- Photopea / Khroma / Happy Hues 的 nav `icon` 字段是远端非 favicon 直链（路径不含 `favicon`，不触发 `isRemoteRawFavicon`），`customIcon` 优先于 map——带真实 `customIcon` 调用时仍返回远端 URL，本地 map 键在运行时不可达；“停热链”须由协调方按 R1 裁决（B2a/B3a 先例）清空其 `icon` 字段才能生效。测试内钉死该现状，不谎称已停热链；无 `customIcon` 时 3 站均正确解析到本地。
- Khroma 纯黑标、Pexels 黑字标深色弱（见下渲染验证），只加普通 map 条目，不做单站底块补丁。
- 6 站 `resolveLogoTile` 均为 null（无底块）。

## 阻塞 2 站（未落盘、未接线、无 map 键）

| 站 | 现象（W9 接续复测 2026-11-25 20:06–20:08 CST，Chrome UA curl） | 前任记录 | 结论 |
|---|---|---|---|
| SiteInspire | www 根、`/favicon.ico`、裸域 `siteinspire.com`、`/favicon.svg` 四路均 429，约 25.1 KB 同款限流页（25,093 / 25,102 / 25,099 / 25,091 B） | 首页与 `/favicon.ico` 两次 429（25,103 / 25,098 B），间隔 20 秒复测仍 429；首页声明 `rel="icon" href="data:,"`（无真实图标声明） | 阻塞待浏览器实访；不造假、不拿第三方图标库顶替 |
| Pixabay | 首页、`/favicon.ico`、`/favicon-32x32.png`、`/static/img/logo.png`、`/static/img/logo_square.png` 均 403 Cloudflare “Just a moment...”（约 3,289 B；`/static/img/logo.png` 一次 000 空回复）；`cdn.pixabay.com` 一张用户上传图 URL 403 AccessDenied，本就不是品牌资产、未采用 | 首页与 `/favicon.ico` 均 403（1,920 B / 3,289 B） | 阻塞待浏览器实访；不造假、不拿通用图顶替 |

两站 `customIcon` 均为 `…/favicon.ico`，被 `isRemoteRawFavicon` 拦截后解析为空串（走渐变字母徽标兜底），不是本地图标、不是远端直链。复测时间：2026-11-25 20:06–20:08 CST；建议下次复测：浏览器实访（或待限流/验证墙缓解后 curl 复测）。

## 验证

- 定向测试：`apps/web-overlay/test/site-favicon-iconbatch-remaining-w9.test.ts`，经 `node scripts/generate-web-mirror.mjs`（写入 3 个文件：`pexels.png`、接线后 `site-favicon.tsx`、更新后测试）在 `apps/web/test/` 镜像上跑——**16/16 通过**（`node_modules/.bin/vitest run apps/web/test/site-favicon-iconbatch-remaining-w9.test.ts`）。注意：`apps/web/*` 是 gitignored 的生成镜像，不进提交；overlay 原文件才是提交物。
- Typecheck：`node scripts/typecheck.mjs`——55 个既存错误，全在 `apps/api`（52）/`packages/ai`（2）/`packages/store`（1），本组文件零新增；`node scripts/check-frontend-typecheck.mjs`——5 个既存错误，全在 `src/lib/palette-pinyin.ts`（缺 `pinyin-pro` 模块），本组文件零新增。
- 390px 双主题渲染：`w9-render-390.png`（本文件同目录；Pillow 合成，390px 宽，浅色/深色两行，图标 48px）。目视结论：Paletton 彩色色轮、Colormind 深底色点、Photopea 青绿白字标、Happy Hues 珊瑚红笑脸——浅/深双主题均清晰；Khroma 纯黑标浅色可见、深色不可见；Pexels 黑字标浅色可见、深色几乎不可见——后两者为已注明的已知局限，留待统一处理轮。
