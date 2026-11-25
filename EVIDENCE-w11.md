# EVIDENCE — 图标剩余轮 W11（学术 / 影视 / 其他组）

- 分支：`feat/icons-remaining-w11`（worktree `~/workspace/znwzdh-icons-remaining-w11`）
- 基线：`bef26ed`（`feat(brand): 山羊胡 Logo 换为亮正红 #E03131 羊角矢量标`）
- 实测时间：2026-11-25 12:07–12:16 CST，Chrome UA
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36`
- 结果：**落地 5 站，阻塞 1 站（伊对）**；未推分支、未合入 main
- 说明：`/tmp/w11/` 里发现前任 worker 的残留研究文件（11:19–11:37），
  但 worktree 零进度；本轮全部事实均以本次 fresh curl 重新验证，
  尺寸 / 哈希以下列本轮实测为准，未采信残留文件。

## 逐站证据

### 1. Scopus — 落地 ✅（commit 23f8d173）
- 站方 favicon 不可用：`https://www.scopus.com/favicon.ico` → 307，
  重定向至 `id.elsevier.com` SSO，curl 50 次重定向未果；首页同样 302 进 SSO。
  C10 旧阻塞原因（SSO 循环）仍成立。
- 采用来源：Simple Icons 官方 Scopus 字标
  `https://cdn.simpleicons.org/scopus` → 200、`image/svg+xml`、808 B，
  SHA-256 `93e51dcc9ac94ba29df4b09338dc4958f75bb881ab27ef1b789e7e2292841447`。
  橙色 `#E9711C` Scopus 字标（非 Elsevier 字母标，C10 禁令不适用）。
- 落盘：`apps/web-overlay/public/brand-icons/scopus.svg`（808 B，SVG 原样，
  viewBox 0 0 24 24）；映射键 `scopus.com=scopuss`。
- 附带改动：C10 阻塞断言 3 站 → 2 站（Scopus 解堵，见测试文件头注释）。

### 2. 读秀 — 落地 ✅（重绘，commit 0fdce0eb）
- 站方 favicon 是错标：`https://www.duxiu.com/favicon.ico` → 200、
  `image/x-icon`、1,150 B，单帧 16×16，
  SHA-256 `fe2857071105ef9a6f92308aa957ee9218a8bbc7d994065f503cf437f5a2e5f9`，
  目视确认为微软 IE 蓝色“e”+ 金环，**绝不能用**。
- 登录页无可用 logo 资产：`https://www.duxiu.com` → 200（`login.jsp`，
  18,767 B，标题“读秀学术搜索”）；全页唯一图片为 `/images/newduxiu/gab.png`
  （备案小图标）；`https://www.duxiu.com/images/logo.png` → 200、10,105 B，
  但内容实为“图书馆联合参考咨询服务中心”拼图标志，与读秀无关，**未用**。
- 重绘依据（来源写清）：登录页主品牌蓝 `#2872E2`（`login.css` 出现 7 次，
  辅蓝 `#0066cc` 链接色 3 次）+ 标题“读秀学术搜索”首字“读”。
  画法：128×128 圆角方块（R26）+ 白色“读”字（Noto Sans CJK SC Bold 84px，
  `/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc`），四角透明，
  目视确认（白读字蓝底，双主题可读）。
- 落盘：`apps/web-overlay/public/brand-icons/duxiu.png`
  （128×128 RGBA，3,693 B，md5 `a8d47d644344fdf58ac41a94832e61dd`）；
  映射键 `duxiu.com=duxiup`。
- 附带改动：C10 阻塞断言 2 站 → 1 站（仅剩 Project Gutenberg）。

### 3. Rotten Tomatoes — 落地 ✅（commit df88ac01）
- 来源：首页声明 `https://www.rottentomatoes.com/assets/pizza-pie/images/favicon.ico`
  → 200、`image/vnd.microsoft.icon`、3,310 B；**内容实为 96×96 PNG 单帧**
  （红番茄绿蒂标，四角透明，目视确认），按内容解码原样落盘，
  md5 `12e316e31d261f8dde18ca7d70c0ff65`（与源字节一致）。
- 未用：`apple-touch-icon-180.jpg`（180×180 JPEG 白底，非透明标）。
- 落盘：`apps/web-overlay/public/brand-icons/rottentomatoes.png`
  （96×96 RGBA，3,310 B）；映射键 `rottentomatoes.com=rottentomatoesp`。

### 4. Metacritic — 落地 ✅（commit 046a502a）
- 来源：首页声明 `https://www.metacritic.com/a/img/favicon.svg`
  → 200、`image/svg+xml`、1,381 B，SVG 原样落盘，
  md5 `bc8586653ad856be71189d415b170a93`。
  内容：深海军蓝圆 `#001B36` + 黄圈 `#FC0` + 白色 M 字标
 （`width="88" height="88"`，无 viewBox；测试尺寸断言兼容 viewBox 与
  width/height 两种写法）。
- 未用：`favicon.ico`（16/32 两帧 ICO，3,638 B）。
- 落盘：`apps/web-overlay/public/brand-icons/metacritic.svg`（1,381 B）；
  映射键 `metacritic.com=metacritics`。深色主题下黄圈定形、白 M 可读，
  按规范 §9 不配 `LOGO_TILE_MAP`，留待统一处理轮。
- 注意：测试文件 `site-favicon-iconbatch-remaining-w11.test.ts` 的 SVG 尺寸
  断言因此放宽为“viewBox 或 width/height 任一匹配”，Scopus 仍走 viewBox。

### 5. Windy — 落地 ✅（commit 404541fd）
- 来源：`https://www.windy.com/img/favicon.png` → 200、`image/png`、3,629 B，
  原样落盘，md5 `1c8e9f691f883a5cf33e70032af9fa10`。
  内容：128×128 调色板 PNG，红圆底 + 白色风形 W 标，四角透明（像素实测
  四角 alpha 均为 0，中心 `(160, 0, 0, 255)`），目视确认。
- 未用：`favicon.ico`（16/32 两帧 ICO，15,086 B）与 `logo-full.png`
  （180×180 宽版字标，28px 卡片内不可读）。
- 落盘：`apps/web-overlay/public/brand-icons/windy.png`（128×128，3,629 B）；
  映射键 `windy.com=windyp`。

### 6. 伊对 — 阻塞 ⛔（无落盘、无映射键）
- `https://www.yidui.net/favicon.ico` → **403**（`text/html; charset=UTF-8`，
  4,554 B，md5 `a09a5b38d2c050fc25ea419241e03ca3`；C12 复试仍 403，
  本轮为第三次确认）。
- `https://www.yidui.com/favicon.ico` → 空回复（curl 52）。
- 注意域名出入：任务单写 yidui.com，但 `navigation.json` 里伊对的 href 与
  icon 均为 **yidui.net**（`https://www.yidui.net`，标题“伊对”），
  断言与阻塞结论均按 yidui.net；两域均不可达。
- 结论：无可用官方标，待浏览器实访，不造假。`resolveSiteIcon` 仍返回 `''`
  （字母徽标兜底），C12 阻塞断言未动，本轮 W11 测试另行钉死该事实。

## 统一事实

- 5 落地站均 ≤ 15 KB；SVG 原样、PNG ＜128 原样不放大（读秀重绘 128×128 除外）。
- 映射键与 `navigation.json` 域名 / 标题逐站核对；每站全库只命中一站，
  无后缀串站、无子域冲突。
- 接线文件：`apps/web-overlay/src/components/site-favicon.tsx`
  （`LOCAL_LOGO_ENTRIES` 末尾 W11 注释块 + 5 条目，1 字符后缀编码）；
  测试文件：`apps/web-overlay/test/site-favicon-iconbatch-remaining-w11.test.ts`
  （新建，CASES 必须传三参数 url/title/customIcon）。
- 镜像说明：vitest 配置只收集 `apps/web/test/**`（vendor 镜像），overlay
  目录无自己的 node_modules；每站落地后均跑
  `node scripts/generate-web-mirror.mjs`（overlay → apps/web，gitignored
  目标目录，不污染提交）再跑镜像测试。C10 的改动同步进镜像。
- 附带改动（仅限被本轮解堵直接推翻的旧断言）：C10“阻塞 3 站”测试
  3 → 2 → 1 站，最终仅剩 Project Gutenberg；C12（伊对阻塞）未动。

## 验证结果

- 定向图标测试（镜像 `apps/web/test`）：W11 9 测试 + C10 26 + C12 26
  = **61/61 通过**；全量图标批次回归 56 文件 **730/730 通过**。
- Typecheck：`pnpm typecheck:web`（`tsc --noEmit`，阈值 0）→ **0 错误**，
  无新增错误。
- ESLint：`eslint --max-warnings 0`（镜像内 3 个改动文件：
  `site-favicon.tsx`、W11 测试、C10 测试）→ **干净，exit 0**。
- 390px 双主题渲染验证（C7 替代法：真实卡片 28px + `object-contain` +
  Playwright + 本地 Chromium 1255，浅/深色各一区）：
  截图 `/tmp/w11/render/cards-390-dual.png`，5 站浅/深双主题均清晰可辨
  （Scopus 橙字标、读秀蓝底白读字、RT 番茄、Metacritic 黄圈白 M、
  Windy 红圆白 W）。
- 依赖准备：本 worktree 初始无 node_modules，`pnpm install --frozen-lockfile`
  一次装好（37 秒，store 命中）；未改任何依赖与锁文件。
- 未推分支、未合入 main；工作区干净（本文件为最后一笔提交）。

## Commit 列表

| # | 站 | Commit |
|---|----|--------|
| 1 | Scopus | `23f8d173` |
| 2 | 读秀（重绘） | `0fdce0eb` |
| 3 | Rotten Tomatoes | `df88ac01` |
| 4 | Metacritic | `046a502a` |
| 5 | Windy | `404541fd` |
| — | 本证据文件 | （见 `git log` 最后一笔） |
