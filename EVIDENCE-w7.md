# W7 学习成长组 — 图标取材与落地证据（2026-11-25）

- 工作组：W7（学习成长组，7 站：廖雪峰教程、The Odin Project、网易云课堂、edX、Project Gutenberg、Internet Archive、Open Library）
- 克隆：`~/workspace/znwzdh-icons-remaining-w7`，分支 `feat/icons-remaining-w7`，基线 `feat/icons-remaining-2026-11-25` @ `bef26ed3`
- 取材时间：2026-11-25 11:18–11:21 CST；工具：curl（Chrome UA `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`）；像素核对：Pillow 10.2.0 + 目视
- 落盘目录：`apps/web-overlay/public/brand-icons/`；接线：`apps/web-overlay/src/components/site-favicon.tsx`（LOCAL_LOGO_ENTRIES 末尾追加 6 键）；测试：`apps/web-overlay/test/site-favicon-iconbatch-remaining-w7.test.ts`
- navigation.json 未动；未碰 17K小说网、书旗小说、Adobe Color、Batch 0、Batch 1、llms.txt、复盘自动化文件。

## 落地 6 站

### 1. 廖雪峰教程 — 落地：`liaoxuefeng.png`，键 `liaoxuefeng.com`
- 来源 URL：`https://liaoxuefeng.com/static/logo.svg`（裸域；页眉 `<img src="/static/logo.svg" class="inline-block max-w-none h-6">` 两处引用）
- 取回：200、image/svg+xml、3,963 B、md5 `ea8a12b461ebae6d69c6641bfa35ae61`、SHA-256 `670128b1c5d2d31538a8af85f0a94802f6a4a7af0d288eeaf41f425121023ed7`
- 陷阱：站根 `/favicon.ico` 不存在——取回的是 35,474 B 首页 HTML 壳；www 域取 `/static/logo.svg` 会 302 跳回 `https://liaoxuefeng.com/?src=redirect` 再取回首页 HTML，必须用裸域取。
- 设计说明：SVG 文件头自注 `Uploaded to: SVG Repo, www.svgrepo.com`，但确为官网页眉在用的 logo 文件本身（非我方另找的第三方图）。800×800 方形帆船标：深青 `#334D5C` 圆底 + 橙色帆 `#EA6307` + 黄星 `#DBBB00`。ImageMagick `-background none` 渲染 128×128（首版 `-background none` 位置放错、误出白底，已废弃重渲）。落盘 128×128 RGBA、8,568 B、md5 `955d0d94b9b511a0e6e2f94a539b9157`，四角透明。

### 2. The Odin Project — 落地：`theodinproject.png`，键 `theodinproject.com`
- 来源 URL：`https://www.theodinproject.com/apple-touch-icon.png`（首页声明，`rel="apple-touch-icon" sizes="180x180"`）
- 取回：200、image/png、180×180 RGBA、11,333 B、md5 `b3f8ddff210b08bdb2eaa88c18071ba4`；四角透明，主色金棕 `#E2B167` + 浅灰 `#E6E6E6`
- 未用：根 `/favicon.ico`（200、15,086 B、3 帧 ICO，最大帧 48×48）、`/favicon-32x32.png`（1,320 B）
- 设计说明：金棕奥丁标，Pillow LANCZOS 180→128。落盘 128×128 RGBA、9,305 B、md5 `0b764bff8fb8beac7a98b1c3f13dd8d2`，四角透明。

### 3. 网易云课堂 — 落地：`study-163.png`，键 `study.163.com`
- 来源 URL：`https://s2.stu.126.net/res/images/common/logo/logo_mascot.png`（官网首页引用的唯一 logo 图）
- 取回：200、image/png、204×137 RGBA、7,009 B、md5 `b6e90fc0ed857b6f3210f16136a19bf3`；四角透明
- 阻塞排除：站方 favicon 仅 16×16（1,150 B、单帧 ICO、主色红 `#F8232B`）不达标，按铁律绝不放大冒充；站点头衔“网易云课堂”为 HTML 文字、无图片 logo；首页无其他 logo 图（仅 `logo_mascot.png` 与课程缺省图等）。
- 设计说明：吉祥物大头（米粉底 `#F2E5DF` + 棕眼 + 粉舌）全身等比缩至最长边 128，不裁切——方形中心裁切 137×137 会切掉下巴黑块，已试裁后弃用。落盘 128×86 RGBA、7,722 B、md5 `e0dd4fb501129e08d22fc6a33ba3fe18`，四角透明。非方形有先例（brand-icons/ 内 15 个非方形文件，如 alipay.png 128×109）。

### 4. edX — 落地：`edx.png`，键 `edx.org`
- 来源 URL：`https://www.edx.org/favicon.ico`（首页唯一声明，`rel="icon" sizes="16x16"`）
- 取回：200、image/x-icon、26,283 B、md5 `936bf0a6f8450c13df9e7cfff5c5c7db`；4 帧 ICO（16/32/48/256），最大帧 256×256 为 PNG 帧（6,544 B，md5 `fc2fb5efbe3f7745a02c0dbf38b0c94a`）
- 未用：`/apple-touch-icon.png`（404，返回 1,958,357 B 首页 HTML）；`/trademark-logos/edx-by-2u-white.svg`（3,987 B，白色版商标，不宜作浅色主题图标）
- 设计说明：最大帧即官方 edX 标——白字 `edX` + 深青 `#02262B` 平行四边形底，内容 bbox (0, 56, 256, 200)。Pillow LANCZOS 256→128 整幅缩放（不裁切宽版字标）。落盘 128×128 RGBA、8,779 B、md5 `a1cd8289db569e983ecfba8958ab2e20`，四角透明。

### 5. Internet Archive — 落地：`archive.png`，键 `archive.org`
- 来源 URL：`https://archive.org/offshoot_assets/apple-touch-icon.png`（新版首页声明，`rel="apple-touch-icon"`）
- 取回：200、image/png、180×180 灰阶 L、1,313 B、md5 `43a6e2892f24dbaab688293b607d0fd1`；四角不透明深灰 `#222222`
- 未用：`/offshoot_assets/favicon.ico` 与根 `/favicon.ico` 为同一文件（md5 `55ffa49961256cb4512e5c77ff6a1fd3`，3 帧 ICO 最大 32×32）
- 设计说明：灰阶圆柱廊柱标（底 `#222222` + 白柱 `#FFFFFF`），ASCII 渲染与 48×48 ICO 帧核对为同一 artwork。Pillow LANCZOS 180→128。落盘 128×128 灰阶 L、2,191 B、md5 `0df9f9d7028ba8c00f231ace05530437`。深灰底 + 白柱在浅/深主题下均可辨，无底块。

### 6. Open Library — 落地：`openlibrary.png`，键 `openlibrary.org`
- 来源 URL：`https://openlibrary.org/static/images/openlibrary-128x128.png`（首页声明，`rel="apple-touch-icon"`）
- 取回：前两次 nginx 500（579 B 报错页）、第三次 200、image/png、128×128 RGBA、3,405 B、md5 `bf25e3b64ae4af435fc1df672d92ba80`
- 未用：根 `/favicon.ico` 仅 16×16（1,406 B）；宽版 wordmark SVG `openlibrary-logo-tighter.svg`（7,683 B，viewBox `55 15 1045.2 260`）非方形标未用
- 设计说明：米底 `#E2DCC5`（四角半透明 a~198）+ 蓝 `#518ABE` 书标，原样落盘（字节与源一致，同 md5）。落盘 128×128 RGBA、3,405 B、md5 `bf25e3b64ae4af435fc1df672d92ba80`。

## 阻塞 1 站

### 7. Project Gutenberg — 阻塞，未落地、未接线
- 复测记录（curl，Chrome UA）：
  - 11:18：`https://www.gutenberg.org/` 首页 503、913 B；`https://www.gutenberg.org/favicon.ico` 503、913 B
  - 11:20：`https://www.gutenberg.org/` 503、913 B；`https://gutenberg.org/`（裸域）503、913 B；favicon 503、913 B
  - （提交前将再做一次复测，见“收尾复测”）
- 503 正文（逐字关键句）："Temporarily Down for Maintenance" / "Project Gutenberg is temporarily unavailable while we perform maintenance." / "Please check back soon."——全站维护页，非单路径故障、非反爬挑战页，C10 的 503 时效性已复测三次仍未恢复。
- 处理：不造假、不从第三方找图、不接线；`brand-icons/gutenberg.png` 不存在（测试已断言）；待站方恢复后另行取材。

## 接线核对
- 全库 388 站 href 核对：`liaoxuefeng.com` / `theodinproject.com` / `study.163.com` / `edx.org` / `archive.org` / `openlibrary.org` 各只命中 1 站；`gutenberg.org` 只命中 Project Gutenberg 一站（阻塞未接线）。
- 后缀串站检查：`study.163.com` 键不命中 `tianyin.163.com`（163.com 另有网易天音站）；`archive.org` 无子域站；其余键无子域站。
- 6 标 `resolveLogoTile` 均为 null（测试断言），按规范 §9 不做单站底块补丁。

## 390px 渲染验证（待填）
- 方法：C7 替代法——真实卡片 28px + object-contain + Playwright + 本地 Chromium 截图，浅/深双主题。
- 结果：（跑完后填）

## 测试与 typecheck（待填）
- 定向测试：（跑完后填）
- typecheck：（跑完后填）
