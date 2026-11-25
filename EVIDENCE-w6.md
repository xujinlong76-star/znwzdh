# EVIDENCE — 剩余图标补齐 W6 政务/考试组（2026-11-25）

- Worker：W6（政务/考试组，6 站）
- Worktree：`~/workspace/znwzdh-icons-remaining-w6`，分支 `feat/icons-remaining-w6`
- 基线：`feat/icons-remaining-2026-11-25` @ `bef26ed3`
- 复测时间：2026-11-25 11:18–11:22 CST，工具 curl，UA
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`
- 结论：**3 站落地**（国家公务员局 3 站共用一标 scs.png），**3 站阻塞待浏览器实访**
  （中公教育、国家网信办举报中心、公安部）。未造假、未用第三方图标库顶替。
- 缺口清单来源：`~/workspace/goals/efficiency-goal-2/hidden_files/icons-remaining-gap-2026-11-25.json`
  （6 站均为 `letter_fallback`，`map_key: null`）；接线/测试写法参照 C7
  （`icon-c7-implementation-log.md`）。

## 1. 国家公务员局（scs.gov.cn）—— 落地 ✅

- navigation：标题 `国家公务员局`，href `http://www.scs.gov.cn/gkIndex.html`，
  icon `http://www.scs.gov.cn/favicon.ico`（远端裸 favicon，被 isRemoteRawFavicon 拦截）。

| # | URL | HTTP | 体字节 | 体判定 |
|---|-----|------|--------|--------|
| 1 | `http://www.scs.gov.cn/gkIndex.html` | 200 | 985 B | JS 挑战页（`EO_Bot_Ssid` 混淆脚本），非首页 |
| 2 | `https://www.scs.gov.cn/gkIndex.html` | 连接失败 | 0 B | https 全站不通（仅 http 可达，超时） |
| 3 | `https://www.scs.gov.cn/` | 连接失败 | 0 B | 同上 |
| 4 | `http://www.scs.gov.cn/favicon.ico` | 200 | 987 B | JS 挑战页（同款 `EO_Bot_Ssid` 脚本），**不是图标** |
| 5 | `https://www.scs.gov.cn/favicon.ico` | 连接失败 | 0 B | https 不通 |
| 6 | `https://www.scs.gov.cn/apple-touch-icon.png` | 连接失败 | 0 B | https 不通 |
| 7 | `http://scs.gov.cn/favicon.ico` | 连接失败 | 0 B | 裸域不通 |
| 8 | `http://www.scs.gov.cn/` | 200 | 988 B | JS 挑战页（同款） |

- 机器人验证墙证据：#1/#4/#8 的响应体均为 `<script>function a(a){…EO_Bot_Ssid=…}` 混淆 JS
  （`_0x649a` 混淆串，`WTKkN/bOYDu` 常量），HTTP 200 是假 200——墙后真实内容未返回。
- 官方标志来源（绕过墙的静态 host）：三站共用 gkweb 平台，静态资源走
  `dl.scs.gov.cn`（无墙）。bm/subb 实页无 rel=icon 声明，页头 logo-box 的
  background 即官方标志：
  - `http://dl.scs.gov.cn/pp/gkweb/core/web/ui/images/common/logo.png`
  - HTTP 200，`image/png`，**16,233 B**，PNG **80×84** RGBA，
    md5 `bc05012735ab6609bdccd258de168d20`
  - CSS 佐证：`dl.scs.gov.cn/pp/gkweb/core/web/ui/css/base.css`（200，8,987 B）含
    `.logo-box{width:90px;height:125px;float:left;background:url(../images/common/logo.png) 0 22px no-repeat}`
  - 像素实测（PIL）：不透明 5,522/6,720 px，四角透明；主色红桶 `#D020` 系
    （642+341+303 px）+ 金色 `#E0B040` 系（225+216+162 px）；ASCII 渲染确认
    圆形红底徽章 + 中央金色星穗（国徽造型），徽章完整、无文字裁切。
- 落地：`apps/web-overlay/public/brand-icons/scs.png`（源文件字节原样拷贝，
  md5 一致）；接线键 `'scs.gov.cn=scsp'`（LOCAL_LOGO_MAP 末尾追加，见 site-favicon.tsx 注释）。
- 80×84 < 128 按规范 §1.1 原样不放大；16,233 B 略超 ~15 KB 参考线（超 873 B），
  按 C7 W3 dramabox.png（15,595 B）先例原样接线、字节数与 md5 测试钉死。

## 2. 2027年国家公务员考试专题（bm.scs.gov.cn）—— 落地 ✅（与第 1 站共标）

- navigation：标题 `2027年国家公务员考试专题`，href `http://bm.scs.gov.cn/kl2027`，
  icon `http://www.scs.gov.cn/favicon.ico`（与 www 站同一 favicon 源）。

| # | URL | HTTP | 体字节 | 体判定 |
|---|-----|------|--------|--------|
| 1 | `http://bm.scs.gov.cn/kl2027` | 200 | 335 B | JS 跳转页：`location.href = "http://www.scs.gov.cn/gkIndex.html"`（注释掉的另一目标为 `/pp/gkweb/core/web/ui/business/home/gkhome.html`） |
| 2 | `https://bm.scs.gov.cn/kl2027` | 连接失败 | 0 B | https 不通 |
| 3 | `http://bm.scs.gov.cn/favicon.ico` | 404 | 548 B | HTML 404 页 |
| 4 | `https://bm.scs.gov.cn/favicon.ico` | 连接失败 | 0 B | https 不通 |
| 5 | `http://bm.scs.gov.cn/apple-touch-icon.png` | 404 | 548 B | HTML 404 页 |
| 6 | `http://bm.scs.gov.cn/pp/gkweb/core/web/ui/business/home/gkhome.html` | 200 | 5,056 B | 实页：无 rel=icon 声明；静态走 `http://dl.scs.gov.cn/pp/gkweb/core/web/ui/…`；页头 `<div class="header"><div class="top-bar"></div><div class="banner"></div></div>`，logo 即 §1 的 logo.png |

- 落地：共用 `scs.png`；接线键 `'bm.scs.gov.cn=scsp'`（完整 hostname 明写；
  即便无此键，后缀匹配 `.scs.gov.cn` 也会兜底到 `scs.gov.cn` 键）。

## 3. 中央机关公开遴选和公开选调专题（subb.scs.gov.cn）—— 落地 ✅（与第 1 站共标）

- navigation：标题 `中央机关公开遴选和公开选调专题`，href `http://subb.scs.gov.cn/lx2027`，
  icon `http://www.scs.gov.cn/favicon.ico`（与 www 站同一 favicon 源）。

| # | URL | HTTP | 体字节 | 体判定 |
|---|-----|------|--------|--------|
| 1 | `http://subb.scs.gov.cn/lx2027` | 200 | 260 B | JS 跳转页：`location.href = "/pp/gkweb/core/web/ui/business/home/lxhome.html"` |
| 2 | `https://subb.scs.gov.cn/lx2027` | 连接失败 | 0 B | https 不通 |
| 3 | `http://subb.scs.gov.cn/favicon.ico` | 404 | 548 B | HTML 404 页 |
| 4 | `https://subb.scs.gov.cn/favicon.ico` | 连接失败 | 0 B | https 不通 |
| 5 | `http://subb.scs.gov.cn/apple-touch-icon.png` | 404 | 548 B | HTML 404 页 |
| 6 | `http://subb.scs.gov.cn/pp/gkweb/core/web/ui/business/home/lxhome.html` | 200 | 3,895 B | 实页：无 rel=icon 声明；静态走 `/pp/gkweb/core/web/ui/…`（同 gkweb 平台）；页头结构与 gkhome.html 相同，logo 即 §1 的 logo.png |

- 落地：共用 `scs.png`；接线键 `'subb.scs.gov.cn=scsp'`。

## 4. 中公教育（offcn.com）—— 阻塞待浏览器实访 ⛔

- navigation：标题 `中公教育`，href `https://www.offcn.com`，
  icon `https://www.offcn.com/favicon.ico`。

| # | URL | HTTP | 体字节 | 体判定 |
|---|-----|------|--------|--------|
| 1 | `https://www.offcn.com` | 403 | 552 B | `403 Forbidden` + `openresty`（WAF） |
| 2 | `http://www.offcn.com` | 403 | 552 B | 同上 |
| 3 | `https://www.offcn.com/favicon.ico` | 403 | 552 B | 同上 |
| 4 | `https://www.offcn.com/apple-touch-icon.png` | 403 | 552 B | 同上 |
| 5 | `https://offcn.com/favicon.ico` | 连接失败 | 0 B | 裸域不通 |
| 6 | `https://offcn.com/` | 连接失败 | 0 B | 裸域不通 |
| 7 | `https://www.offcn.com/favicon.ico`（全套浏览器头：Accept image/*、Accept-Language zh-CN、Referer、--compressed） | 403 | 552 B | 同款 403，换头无效 |
| 8 | `https://m.offcn.com/favicon.ico` | 403 | 552 B | m 站同款 403 |
| 9 | `https://m.offcn.com/` | 403 | 552 B | m 站同款 403 |

- 403 体全文：`<html><head><title>403 Forbidden</title></head><body><center><h1>403 Forbidden</h1></center><hr><center>openresty</center></body></html>` + MSIE/Chrome 友好页 padding 注释。
- 结论：WAF 按源 IP/指纹拦截，curl 全路径 403，换 UA/换头/换 m 站均无效。
  **待浏览器实访**：浏览器打开 `https://www.offcn.com`，读 head 的 rel=icon 声明，
  取官方 favicon/logo 直链（200 + image MIME + 魔数核对后本地化）。不建键、不落盘。

## 5. 国家网信办举报中心（12377.cn）—— 阻塞待浏览器实访 ⛔

- navigation：标题 `国家网信办举报中心`，href `https://www.12377.cn`，
  icon `https://12377.cn/favicon.ico`。

| # | URL | HTTP | 体字节 | 体判定 |
|---|-----|------|--------|--------|
| 1 | `https://www.12377.cn` | 403 | 7,412 B | 反爬挑战页（见下） |
| 2 | `http://www.12377.cn` | 403 | 7,412 B | 同款挑战页（http 不降级） |
| 3 | `https://www.12377.cn/favicon.ico` | 403 | 7,412 B | 同款挑战页 |
| 4 | `http://www.12377.cn/favicon.ico` | 403 | 7,412 B | 同款挑战页 |
| 5 | `https://www.12377.cn/apple-touch-icon.png` | 403 | 7,412 B | 同款挑战页 |
| 6 | `https://12377.cn/favicon.ico` | 连接失败 | 0 B | 裸域不通 |
| 7 | `https://12377.cn/` | 连接失败 | 0 B | 裸域不通 |
| 8 | `https://www.12377.cn/favicon.ico`（全套浏览器头 + --compressed） | 403 | 7,412 B | 同款挑战页，换头无效 |

- 403 体特征：完整 HTML 挑战页（`#notice-jiasule` 样式、`getOffsetLimit` 跑马灯 JS、
  `data['t_msg']/data['t_link']` 跳转逻辑、倒计时注释），即加速乐类 JS 反爬验证页；
  7,412 B 每次完全相同（与路径无关，说明是网关统一拦截，非站内 404）。
- 结论：curl 全路径 403，换头无效。**待浏览器实访**：浏览器打开
  `https://www.12377.cn` 通过验证后，读 head 的 rel=icon 声明，取官方图标直链
  本地化。不建键、不落盘。

## 6. 公安部（mps.gov.cn）—— 阻塞待浏览器实访 ⛔

- navigation：标题 `公安部`，href `https://www.mps.gov.cn`，
  icon `https://www.mps.gov.cn/favicon.ico`。

| # | URL | HTTP | 体字节 | 体判定 |
|---|-----|------|--------|--------|
| 1 | `https://www.mps.gov.cn` | 521 | 882 B | Cloudflare 挑战脚本（见下） |
| 2 | `http://www.mps.gov.cn` | 521 | 752 B | 同款挑战脚本 |
| 3 | `https://www.mps.gov.cn/favicon.ico` | 521 | 874 B | 同款挑战脚本 |
| 4 | `http://www.mps.gov.cn/favicon.ico` | 521 | 716 B | 同款挑战脚本 |
| 5 | `https://www.mps.gov.cn/apple-touch-icon.png` | 521 | 867 B | 同款挑战脚本 |
| 6 | `https://mps.gov.cn/favicon.ico` | 连接失败 | 0 B | 裸域不通 |

- 521 体特征：`<script>document.cookie=('__jsl_clearance='+…);location.href=location.pathname+location.search</script>`
  （Cloudflare `__jsl_clearance` JS 验证 + 跳转），每次体字节不同（882/752/874/716/867 B，
  系挑战 token 随机），说明网关统一拦截、源站内容未返回。521 累计复现，与已知阻塞一致，
  非偶发超时。
- 结论：curl 全路径 521，无法取到任何官方图标。**待浏览器实访**：浏览器打开
  `https://www.mps.gov.cn` 通过 Cloudflare 验证后，读 head 的 rel=icon 声明，
  取官方图标直链本地化。不建键、不落盘。

## 7. 接线核对（全库 388 站）

- 三键 `scs.gov.cn` / `bm.scs.gov.cn` / `subb.scs.gov.cn` 各只命中 1 站
  （navigation.json 全库 grep：`scs.gov.cn` 仅出现于此 3 站的 href 与 1 处 icon 字段），
  无后缀串站、无子域站；`dl.scs.gov.cn` 不是导航站，不受影响。
- `gov.cn` 裸域键绝不加（C12 裁决）；`offcn.com` / `12377.cn` / `mps.gov.cn`
  键均未建（阻塞站）；`github.com` / `adobe.com` 键未碰；navigation.json 不动。
- 标题规则核对：三站标题（国家公务员局 / 2027年国家公务员考试专题 /
  中央机关公开遴选和公开选调专题）不命中 resolveSiteIcon 内任何先于 map 的
  标题规则（含 `中国政府网` → gov.png 规则）；三站均走 map 精确查找。
- 浅/深主题：红底实色圆徽 + 金色星穗，四角透明，双主题均可辨识；
  `resolveLogoTile` 为 null，不做单站底块补丁、不配 LOGO_TILE_MAP（留待统一处理轮）。

## 9. 接线复测轮（2026-11-25 19:35–19:37 CST，接手工 W6，curl，Chrome UA）

- 目的：上一位 worker 丢失后从现场接手；3 站阻塞多为时效性，须复测再定；
  已落地的 scs.png 须验证与线上源仍字节一致。
- 复测原始响应体：`/tmp/w6-retest/`（b 轮询体 + scs.png）。

| 站 | URL | HTTP | 体字节 | 体判定 |
|---|---|---|---|---|
| 中公教育 | `https://www.offcn.com` | 403 | 552 B | 同款 403 openresty WAF，未变 |
| 中公教育 | `https://www.offcn.com/favicon.ico` | 403 | 552 B | 同上 |
| 中公教育 | `https://www.offcn.com/apple-touch-icon.png` | 403 | 552 B | 同上 |
| 中公教育 | `http://www.offcn.com/favicon.ico` | 403 | 552 B | 同上 |
| 中公教育 | `https://m.offcn.com/favicon.ico` | 403 | 552 B | m 站同款 403 |
| 12377 | `https://www.12377.cn` | 403 | 7,412 B | 同款加速乐挑战页，未变 |
| 12377 | `https://www.12377.cn/favicon.ico` | 403 | 7,412 B | 同上 |
| 12377 | `https://www.12377.cn/apple-touch-icon.png` | 403 | 7,412 B | 同上 |
| 12377 | `https://www.12377.cn/manifest.json` | 403 | 7,412 B | 新增路径：同款挑战页 |
| 12377 | `http://www.12377.cn/favicon.ico` | 403 | 7,412 B | 同上 |
| 公安部 | `https://www.mps.gov.cn` | 521 | 867 B | 同款 `__jsl_clearance` 挑战脚本，未变 |
| 公安部 | `https://www.mps.gov.cn/favicon.ico` | 521 | 856 B | 同上 |
| 公安部 | `https://www.mps.gov.cn/apple-touch-icon.png` | 521 | 878 B | 同上 |
| 公安部 | `https://www.mps.gov.cn/manifest.json` | 521 | 855 B | 新增路径：同款挑战脚本 |
| 公安部 | `http://www.mps.gov.cn/favicon.ico` | 521 | 747 B | 同上 |
| 公安部 | `https://www.mps.gov.cn/n2254314/index.html` | 521 | 865 B | 新增路径（内页）：同款挑战脚本 |
| scs 源 | `http://dl.scs.gov.cn/pp/gkweb/core/web/ui/images/common/logo.png` | 200 | 16,233 B | `image/png`，md5 `bc05012735ab6609bdccd258de168d20`，与落地 scs.png **字节一致**（cmp 通过） |
| scs 墙 | `http://www.scs.gov.cn/favicon.ico` | 200 | 988 B | 仍为 EO_Bot_Ssid 挑战页（假 200），未变 |

- 结论：3 阻塞站状态与上一轮完全一致，仍阻塞待浏览器实访，不建键、不落盘；
  scs.png 线上源未变，落地资产有效。
- 定向测试（镜像面 `apps/web/test/site-favicon-iconbatch-remaining-w6.test.ts`，
  `apps/web/*` 为 vendor 生成的 gitignored 镜像，与 overlay 逐字节一致）：
  **11/11 通过**（2026-11-25 19:37 CST，vitest 5.1.0）。
- typecheck：`node scripts/check-frontend-typecheck.mjs`（见 §10）。

## 10. typecheck 与 390px 渲染验证（接手工 W6）

- typecheck：`node scripts/check-frontend-typecheck.mjs`（2026-11-25 19:57–20:06 CST，
  后台跑完，GATE_EXIT=1）：**13 个错误，全部是既存环境问题、与 W6 改动无关**——
  `packages/core/src/job-payloads.ts`、`json-schema.ts`、`mcp-schemas.ts`、
  `modular.ts`、`pinyin.ts`、`rest-responses.ts`（`Cannot find module 'zod' /
  'pinyin-pro'`，TS2307，+ 2 处 TS7006 隐式 any）与
  `packages/store/src/driver.ts`（`Cannot find module 'drizzle-orm' /
  'better-sqlite3' / 'pg'`，TS2307）。**0 条错误指向 site-favicon.tsx 或本组
  测试文件**。根因：本 worktree 的 pnpm 安装不完整——`zod@4.6.7` 等包在
  `node_modules/.pnpm` 里存在，但根 `node_modules/zod` 软链缺失，tsc 解析不到；
  非代码问题，不在本组修复范围（不碰依赖安装、不改无关文件）。
- 390px 渲染验证（C7 替代法：真实卡片 28px + object-contain + Playwright +
  本地 Chromium 截图，浅/深双主题，2026-11-25 19:45 CST）：见 `/tmp/w6-render/`（`scs-light-390.png`、
  `scs-dark-390.png`）；结果：**双主题均清晰可辨**——红底圆徽 + 金色星穗在
  28px 下完整呈现，四角透明、无裁切、无拉伸；浅色底与深色底均无“红块糊成一团”，
  与 EVIDENCE §1 像素实测一致。截图为临时取证（/tmp），不进仓库。

## 11. 复测轮（本任 W6，2026-11-25 19:45 CST，curl，Chrome UA）

- 目的：前任 worker 丢失后从现场接手；先审 diff、先提交落袋（4071f6a1），
  再独立复测全部 5 站（scs 源 + 3 阻塞站），不沿用前人结论。
- 复测原始响应体：`/tmp/w6-retest2/`（01–18.bin + results.tsv）。

| 站 | URL | HTTP | 体字节 | 体判定 |
|---|---|---|---|---|
| 中公教育 | `https://www.offcn.com` | 403 | 552 B | 同款 403 openresty WAF，未变 |
| 中公教育 | `https://www.offcn.com/favicon.ico` | 403 | 552 B | 同上 |
| 中公教育 | `https://www.offcn.com/apple-touch-icon.png` | 403 | 552 B | 同上 |
| 中公教育 | `http://www.offcn.com/favicon.ico` | 403 | 552 B | 同上 |
| 中公教育 | `https://m.offcn.com/favicon.ico` | 403 | 552 B | m 站同款 403 |
| 中公教育 | `https://www.offcn.com/manifest.json` | 403 | 552 B | 新增路径：同款 403 |
| 12377 | `https://www.12377.cn` | 403 | 7,412 B | 同款加速乐挑战页（`notice-jiasule` / `getOffsetLimit`），未变 |
| 12377 | `https://www.12377.cn/favicon.ico` | 403 | 7,412 B | 同上 |
| 12377 | `https://www.12377.cn/apple-touch-icon.png` | 403 | 7,412 B | 同上 |
| 12377 | `https://www.12377.cn/manifest.json` | 403 | 7,412 B | 新增路径：同款挑战页 |
| 12377 | `http://www.12377.cn/favicon.ico` | 403 | 7,412 B | 同上 |
| 公安部 | `https://www.mps.gov.cn` | 521 | 865 B | 同款 `__jsl_clearance` 挑战脚本（逐字混淆拼接），未变 |
| 公安部 | `https://www.mps.gov.cn/favicon.ico` | 521 | 849 B | 同上 |
| 公安部 | `https://www.mps.gov.cn/apple-touch-icon.png` | 521 | 911 B | 同上 |
| 公安部 | `https://www.mps.gov.cn/manifest.json` | 521 | 892 B | 新增路径：同款挑战脚本 |
| 公安部 | `http://www.mps.gov.cn/favicon.ico` | 521 | 742 B | 同上 |
| scs 源 | `http://dl.scs.gov.cn/pp/gkweb/core/web/ui/images/common/logo.png` | 200 | 16,233 B | `image/png`，md5 `bc05012735ab6609bdccd258de168d20`，与落地 scs.png **字节一致**（cmp 通过） |
| scs 墙 | `http://www.scs.gov.cn/favicon.ico` | 200 | 983 B | 仍为 EO_Bot_Ssid 挑战页（假 200），未变 |

- 结论：3 阻塞站状态与前两轮完全一致，仍阻塞待浏览器实访，不建键、不落盘；
  scs.png 线上源未变，落地资产有效。本轮无新增落地站。

## 8. 原始取证保存位置

- curl 原始响应体：`/tmp/w6-probe/`（01–35.bin + results.tsv）、
  `/tmp/w6-probe2/`（01–10.bin + results.tsv）、`/tmp/w6-probe3/`（CSS 与 logo.png 原文件）、
  `/tmp/w6-retest2/`（本任 W6 复测轮，01–18.bin + results.tsv）。
  注意 /tmp 会被周期清理；关键数值（状态码、字节数、md5、尺寸、像素实测）已全部钉死
  在本文件与测试 `site-favicon-iconbatch-remaining-w6.test.ts` 内。
- 落地资产：`apps/web-overlay/public/brand-icons/scs.png`
  （16,233 B，80×84 RGBA，md5 `bc05012735ab6609bdccd258de168d20`，与
  `http://dl.scs.gov.cn/pp/gkweb/core/web/ui/images/common/logo.png` 字节一致）。
