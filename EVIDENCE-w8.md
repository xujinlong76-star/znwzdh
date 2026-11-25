# W8 开发者资源组 — 图标取材与落地证据（2026-11-25）

- 工作组：W8（开发者资源组，6 站：V2EX、百度知道、CS自学指南、JavaGuide、W3Schools、Exercism）
- 克隆：`~/workspace/znwzdh-icons-remaining-w8`，分支 `feat/icons-remaining-w8`，基线 `bef26ed3`
- 接手：前几任 worker 在守护进程重启后丢失；本轮从 worktree 现场接手，先核实、立即提交落袋，再补验证与证据
- 取材：站方官方 favicon / 首页声明 icon，curl（Chrome UA）取回；W8 轮复核 2026-11-25 12:08 CST，6 个来源 URL 全部复测 200，字节数与取材记录逐字节一致（见下）
- 落盘目录：`apps/web-overlay/public/brand-icons/`；接线：`apps/web-overlay/src/components/site-favicon.tsx`（LOCAL_LOGO_ENTRIES 追加 6 键，1 字符后缀编码照 C7 做法）；测试：`apps/web-overlay/test/site-favicon-iconbatch-remaining-w8.test.ts`
- navigation.json 未动；未碰 17K小说网、书旗小说、Adobe Color、Batch 0、Batch 1 及其他 worker 分工站
- `apps/web/` 下的同名测试/图标/接线是 gitignored 镜像（与 overlay 逐字节一致，仅供根 vitest 配置跑定向测试用），不提交

## 落地 6 站

### 1. V2EX — 落地：`v2ex.png`，键 `v2ex.com`
- 来源 URL：`https://www.v2ex.com/static/icon-192.png`（首页声明的最大尺寸 icon）
- 取回：200、image/png、13,257 B、192×192 RGBA；根 `/static/favicon.ico` 为 32×32 PNG 内容 1,313 B、同一 V 标，未用
- 设计说明：Pillow LANCZOS 192→128。落盘 128×128 RGBA、5,091 B、md5 `e7bbea518f98769a149ece0b76eaba2c`。白底不透明浅灰渐变方块 + V 标，浅/深主题均可见。

### 2. 百度知道 — 落地：`zhidao.png`，键 `zhidao.baidu.com`
- 来源 URL：`https://zhidao.baidu.com/favicon.ico`（站方自有 favicon）
- 取回：200、image/x-icon、5,686 B、ICO 双帧 16×16 8bpp + 32×32 32bpp；首页声明的 `//www.baidu.com/favicon.ico` 是百度主标 64×64 白底蓝标，未用——本站用知道自有蓝底白标版
- 设计说明：最大帧 32×32 原样落盘，绝不放大。落盘 32×32 RGBA、1,067 B、md5 `2f5126e5d17f5b72a1e90cf4c79ed727`。蓝底 #2932E1 + 白色百度“du”爪标，不透明实色方块，双主题均可见。

### 3. CS自学指南 — 落地：`csdiy.png`，键 `csdiy.wiki`
- 来源 URL：`https://csdiy.wiki/images/favicon.ico`（站方唯一官方源；首页无 icon 声明）
- 取回：200、image/vnd.microsoft.icon、4,286 B、ICO 单帧 32×32 32bpp
- 设计说明：32×32 原样落盘，绝不放大。落盘 32×32 RGBA、1,610 B、md5 `da3720eb5ac301834ee78d62157dd0ed`。透明底 + 蓝色 #3F8CB9 学位帽标。

### 4. JavaGuide — 落地：`javaguide.png`，键 `javaguide.cn`
- 来源 URL：`https://javaguide.cn/favicon.ico`（首页声明）
- 取回：200、image/x-icon、19,184 B、ICO 单帧 256×256 PNG 内嵌
- 设计说明：内容 bbox (41,50,213,187)，仅去透明留白（+4px 边，180×145，不重绘）后 LANCZOS 宽缩至 128。落盘 128×103 RGBA、11,740 B、md5 `87e5f1352ed8c8f8a221d7753b8bab9b`。红 #D32F2F 图形 + 蓝 #006699/#1E88E5 + 底部 JavaGuide 字标，透明底。非方形系原标图文版式所致，有先例（brand-icons/ 内多个非方形文件）。

### 5. W3Schools — 落地：`w3schools.png`，键 `w3schools.com`
- 来源 URL：`https://www.w3schools.com/apple-touch-icon.png`（首页声明的最大尺寸 icon）
- 取回：200、image/png、3,065 B、180×180 8-bit colormap，白底；根 `/favicon.ico` 最大帧 48×48 透明底同标未用（首页声明最大尺寸优先，W2 芒果TV先例，改用 48 版由复审裁决）
- 设计说明：Pillow LANCZOS 180→128。落盘 128×128 RGBA、5,377 B、md5 `82ad7e2882548b4cd179958883982c92`。白底不透明 + 绿 #009A68 W3 标。

### 6. Exercism — 落地：`exercism.png`，键 `exercism.org`
- 来源 URL：`https://assets.exercism.org/meta/apple-touch-icon.png`（首页声明的最大尺寸 icon）
- 取回：200、image/png、21,752 B、180×180 RGBA；nav icon 字段的 `favicon-32x32.png` 为同标透明底 32×32，未用
- 设计说明：128 版 19,778 B 超 ~15KB 参考线，故取 96×96 LANCZOS 落盘（96px 在 28px 卡片与 64px 详情徽标下均 ≥1.5× 仍清晰，非放大、非重绘）。落盘 96×96 RGBA、11,537 B、md5 `3dcd62acf771f088a0396490fb784047`。深紫渐变底 + 白色 E 形标，不透明，双主题均可见。

## 键的精确性（navigation.json 全库 388 站核对，W8 轮复核）

- 6 键各只命中 1 站：`v2ex.com`→V2EX、`zhidao.baidu.com`→百度知道、`csdiy.wiki`→CS自学指南、`javaguide.cn`→JavaGuide、`w3schools.com`→W3Schools、`exercism.org`→Exercism；无后缀串站、无子域站
- `baidu.com` 裸域键绝不加（map 内已有 yiyan/wenxin/comate/map/dumate 五个 `*.baidu.com` 精确键，精确查找优先于后缀循环；百度主站无精确键，仍回落字母徽标，测试有守卫断言）
- 6 站 icon 字段均为远端 favicon（含 Exercism 的 `…/favicon-32x32.png`，路径含 favicon），均被 `isRemoteRawFavicon` 拦截后回落 map；navigation.json 不动
- 6 站 `resolveLogoTile` 均为 null（规范 §9，不做单站底块补丁、不配 LOGO_TILE_MAP，留待统一处理轮）

## 验证（2026-11-25 12:07–12:08 CST，W8 轮实测）

- 定向测试：`./node_modules/.bin/vitest run apps/web/test/site-favicon-iconbatch-remaining-w8.test.ts`（根 vitest 配置 include 只覆盖 `apps/web/test`，故走 gitignored 镜像路径跑；镜像与 overlay 逐字节一致）——**11/11 通过**
- typecheck：`apps/web-overlay` 下 `tsc --noEmit -p tsconfig.json`，本轮前后各 37,719 个错误、`site-favicon.tsx` 各 232 个，**零新增**；错误全是环境性既有噪声（`Cannot find module 'react'` 等，node_modules 为指向 dev-stack 的 symlink，模块解析不到），新增的 58 行（字符串表 + 注释）所在行号区间无任何错误
- 390px 双主题渲染：Playwright + 本地 Chromium，真实卡片 28px + `object-fit: contain`，浅/深各一图（`/tmp/w8-render/w8-light.png`、`/tmp/w8-render/w8-dark.png`）——6 标双主题均可见。诚实注记：JavaGuide 底部深蓝字标在深色主题 28px 下对比度偏低（图形主标清晰可见）；按规范 §9 不做单站底块补丁，留待统一处理轮
- 来源复测：6 个来源 URL 2026-11-25 12:08 CST 全部 200，字节数与取材记录一致（13,257 / 5,686 / 4,286 / 19,184 / 3,065 / 21,752 B）

## 提交

- 落袋提交 `913c1277`：`feat(icons): W8 开发者组 6 站落地`（6 图标 + `site-favicon.tsx` + 定向测试，8 文件，+199 行）
- 本证据文件追加提交同一分支（见 git log）
- 未推分支、未合入 main、未碰其他分支与文件
