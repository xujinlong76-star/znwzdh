# NavHub 全功能深度扫描与升级建议方案（2026-11-08）

> **扫描口径**：只依据本机真实运行的产物、源码计数与浏览器实测数据判断；每条结论都附可复现判据。不做推断式补白，未验证的一律标注「未测」。
> **运行环境**：`main` 工作区（`源码镜像/`），Next.js 16.4.2 dev（`pnpm dev:web` @ `http://localhost:3000`），无头 Edge 1440×900 / 390×844，Playwright 1.64.1。
> **数据快照**：`data/navhub.db`（79 张表）。

---

## 0. 一页速览（全部为本机实测）

| 维度 | 实测值 | 判据 |
|---|---|---|
| 前台页面路由 | **78** | `apps/web/src/app/**/page.tsx` 计数 |
| 前台 BFF 路由 | **50** | `apps/web/src/app/**/route.ts` 计数 |
| 后端 REST 端点 | **354**（45 个路由模块） | 正则统计 `apps/api/src/routes/*.ts` 的 `.get/.post/.put/.patch/.delete(` |
| 数据库表 | **79**（dev 库） | `sqlite_master` |
| 源码规模 | web 162.8k 行 / overlay 153.0k / api 50.8k / core 17.7k / store 18.9k / scripts 49.3k | `wc -l` 分域统计 |
| 测试基线 | 641 文件 / 7235 用例，行覆盖 **85.68%** | `coverage-thresholds.json` stage=W1 |
| 主数据量 | sites **4921** / categories **236** / tags **2286** / site_tags **4337** / video_items **6014** / events **1717** | 逐表 `COUNT(*)` |
| 向量覆盖 | embeddings **1038** / sites 4921 ≈ **21%** | `embeddings` vs `sites` |
| 空表（0 行） | **16** 张 | 见 §2.6 |
| 首页 DOM | 卡片 **873** / 节点 **42,803** / 移动端页高 **22,426px** / 「展开全部」按钮 **217** 个 | 浏览器实测 |
| 首页键盘停留点 | **936**（主内容 **418**） | 浏览器实测 |
| 小于 24px 点击目标 | **64** 个（最小 22×22） | 浏览器实测 |
| 移动端 DIY 入口 | **12,824 ms 才出现，且被底部导航 100% 遮挡** | 轮询 + `elementFromPoint` |
| `/videos` | 卡片 **365** / 节点 **16,383** / 页高 **45,616px** / **无分页** | 浏览器实测 |
| 5 大主路由健康 | 17 条路由全部 HTTP 200，0 个 pageerror | 逐路由扫描 |
| 搜索五路召回 | exact/fts/pinyin/semantic 正常；`kimi`/`jianli` 均召回 | UI 实测 + `/api/search` |
| i18n 基础设施 | **0 个** i18n/locale 文件（但库里已有 `title_en`/`description_en`） | 全仓文件名 + 列扫描 |
| 路由三态覆盖 | loading **19** / error **19** / not-found **1**（对 78 个页面） | 文件计数 |
| a11y 豁免 | **37** 条 / 3 批（有到期机制） | `scripts/a11y-exemptions.json` |

### 结论一句话
**这是一个工程纪律极高的仓库（TODO 仅 1 处、隔离清单为空、双向覆盖层 1042 文件零漂移、门禁体系完备），但存在三类系统性缺口：①首屏/长列表的渲染规模失控；②移动端关键入口不可用；③「有表无数据 / 有字段无能力」的功能空壳与数据覆盖断层。**

---

## 1. 功能地图（已实现能力清单）

### 1.1 前台（内容消费）
首页导航墙（ISR 60s + 渐进披露 + DIY 排版工坊）、分类树浏览（`/category/[slug]/` + 分页 + SEO 阈值）、站点详情（`/site/[id]`）、站点总览（`/sites`）、标签云（`/tags`）、收藏（`/favorites`）、合集（`/collections`）、五路召回搜索（全局 Spotlight ⌘K + `/search`）、热榜（`/hot`）、知识图谱（`/graph`）、算法实验室（`/algorithms`：LinUCB / Poincaré / Shannon 熵）、模块化工作台（`/custom`）、书签导入（`/import`）、投稿（`/submit`）、离线阅读（`/offline` + SW）、视频中心（`/videos` + 播放页 + 多平台解析）。

### 1.2 用户中心（`/me`）
账户、数据、历史、通知、插件、设置、保险库、工作区 —— 8 个子页。

### 1.3 管理端（`/admin`，实测未登录访问 `/admin` → 302 到 `/auth/signin`，鉴权有效）
概览、AI 配置、审计、分类、合集、数据与恢复、分面、任务、导航（4 级嵌套）、插件健康、插件、资源、站点、站点列表、统计、投稿、标签、分类治理、令牌、回收站、视频（3 级嵌套）—— 26 个子页。

### 1.4 插件市场（`/marketplace`，7 个子页 + 40+ 后端端点）
发布、安装、卸载、星标、版本时间线、AI 审计、预审、自动修复、URL 体检面板、评论/举报/回复、Tap 同步。

### 1.5 AI 能力
AI 副驾抽屉（SSE 流式）、语义检索、知识图谱对标、架构配方、平替推荐、插件 AI 审计、视频自动采集、LLM 配额/价格/用量治理。

### 1.6 工程体系（本仓库最强项）
70 个 npm 脚本；`verify.mjs` 三档门禁（默认/--guards/--full）；覆盖层双向同步校验（1042 文件）；首屏 JS 预算棘轮（`bundle-budget.json`）；HTML 预算哨兵；REST 契约类型生成与覆盖率校验；导入边界检查；a11y 扫描；SEO 审计；DB 备份/演练；PG 方言套件；E2E 23 个 spec。

---

## 2. 深度扫描发现的问题清单（按优先级）

### P0-1 首屏渲染规模失控：873 卡片 / 42,803 DOM 节点 / 移动端 22,426px 高
- **实测**：首页 DOM 节点 **42,803**，`[data-navhub-site-id]` **873** 个，`content-visibility:auto` 只对**绘制**生效，**DOM 节点与 React Fiber 数量不变**；移动端页高 **22,426px**。
- **影响**：Lighthouse「excessive DOM size」必然判红（阈值 1,500 警戒 / 3,000 上限，实测超 14 倍）；低端机滚动掉帧、内存 36MB→更大、移动端交互延迟（见 P0-3 的 12.8s）。
- **根因**：`navigation-category-section.tsx` 的渐进披露只按「每组前 N 张」截断，但首页有 **217 个分组**，N=4 时总量仍是 873；且分组 XML 全量挂载。
- **可复现**：`node scripts/scan-mobile-vs-desktop.mjs`

### P0-2 `/videos` 无分页：365 卡片 / 16,383 节点 / 45,616px 高
- **实测**：单页渲染 365 张卡片、页高 **45,616px**、**无分页或虚拟滚动**（`hasPagination: false`）；封面全部来自 `images.unsplash.com`(`w=800`) 远程热链，2.5 秒内仅 **16/360** 张完成加载。
- **影响**：首屏后长时间网络争抢；第三方图片源不可控（限流/下线即大面积空白）；用户无法定位内容。
- **可复现**：`node scripts/scan-videos-dom.mjs`

### P0-3 移动端 DIY 入口 12.8 秒才出现，且被底部导航完全遮挡
- **实测**：390×844 下轮询等待，DIY 按钮在 **12,824 ms** 才进入可见态；出现后 `elementFromPoint(按钮中心)` 命中的是 **移动端底部导航的链接**（`isSelf: false`），即按钮被 `h-14` 的底部导航覆盖，**物理上点不到**。
- **根因**：DIY 静息位 `fixed right-4 bottom-4`（距底 16px）落在移动端底部导航（`fixed bottom-0 h-14` = 56px 带）之下；同时懒加载 chunk 与 42k DOM 首屏争抢主线程。
- **可复现**：`node scripts/scan-mobile-diy-timing.mjs`

### P0-4 知识图谱对匿名访客静默降级为「演示数据」
- **实测**：`/graph` 匿名访问产生 **2 次 401**（`/api/hub/sites?limit=60`，需鉴权），`ecosystem-graph.tsx:156` 判断 `!r.ok` 后 `return`，**静默回退到硬编码 `DEFAULT_NODES`**。
- **影响**：公开页面宣称「技术生态与平替拓扑图谱」，访客实际看到的是内置示例集而非 4,921 条真实站点 —— 属于**对外承诺与事实不符**（同仓库 `docs` 里多处强调「诚实降级」原则）。
- **可复现**：`node scripts/scan-graph-401.mjs`

### P1-1 语义检索只覆盖 21% 的站点
- **实测**：`embeddings` **1038** 行 vs `sites` **4921** 行。五路召回中的 `semantic` 通道对约 **79%** 的站点无从召回，且**前端无任何「该站未建向量」提示**。
- **影响**：用户按语义搜索时，绝大多数中小站点等于不存在；召回质量随数据增长持续劣化。

### P1-2 移动端可用性问题：键盘停留点与点击目标
- **实测**：首页可 Tab 元素 **936** 个（主内容 **418** 个）；小于 24×24 的可点击目标 **64** 个（最小 22×22，多为「复制分类直达链接」与标签 chip）。
- **影响**：WCAG 2.5.8（Target Size AA，24×24）不达标；WCAG 2.1.1 键盘可达但成本极高（418 次 Tab 才能走完主内容）。

### P1-3 路由三态覆盖不足
- **实测**：78 个页面只有 **19 个 loading.tsx / 19 个 error.tsx / 1 个 not-found.tsx**（根级）。
- **影响**：约 3/4 路由在慢网或异常时没有骨架屏与错误边界，只有全局兜底；Notion 式「局部失败不拖垮整页」未落实。

### P1-4 双语文案能力缺位
- **实测**：全仓 **0 个** i18n/locale 文件；但数据库已有 `sites.title_en` / `sites.description_en` / `categories.title_en` 列（当前全为 null）。
- **影响**：schema 已为双语预留，能力却没接上——属于「为将来的迁移付了成本，却没有拿到收益」。

### P2-1 功能空壳：16 张表 0 行
| 空表 | 对应的已存在能力 |
|---|---|
| `plugin_reviews` / `plugin_reports` | 市场已有评论/举报/回复共 4 个端点与前端表单 |
| `short_links` | `POST /api/shortlinks` 已注册（匿名限流 30/小时） |
| `site_archives` | `POST /api/sites/:id/archive` 离线快照端点 |
| `video_replacements` | 视频替换历史与前端对话框 |
| `llm_model_prices` / `llm_quota_reservations` | LLM 成本与配额治理面板读数全为 0 |
| `auth_tokens` / `idempotency` / `user_llm_configs` / `user_vault_sync` / `user_workspace_blobs` / `user_settings`(1 行) / `favorite_folders` / `tag_aliases` / `app_settings` / `submission_owners` | 各自功能入口存在但生产路径从未写入 |
- **判据**：逐表 `COUNT(*)`（`scripts/db-table-counts.mjs`）。
- **说明**：不得据此直接删表——需先判定「端点从未被调用」还是「调用后写入失败」，二者处置相反。

### P2-2 双端覆盖层与 apps/web 的 343 个「反向候选」
- **实测**：`pnpm check:overlay` 通过（1042 文件一致），但持续告警「apps/web 有 343 个文件不在 overlay 中」。
- **影响**：告警长期存在会钝化注意力；其中若混有自研改动，一旦执行 `mirror:web` 会被上游内容覆盖。

### P2-3 第三方资源依赖集中
- **实测**：GitHub 头像（`github.com/{owner}.png`）单请求 **0.6–1.6s**；`runwayml.com/icon.png` 0.56s；视频封面全部依赖 `images.unsplash.com`。
- **影响**：首屏最慢请求几乎全部来自第三方；站点图标虽有 `/api/hub/assets/icon` 代理，但**代理无持久缓存层**（未测 CDN/磁盘缓存策略）。

**正面验证（无需整改，防止过度优化）**：图片 `alt` 缺失 **0**、无名按钮/链接 **0**、无标签表单控件 **0**、标题层级跳跃 **0**、每张卡片 Tab 停留点 **1**、`h1` 唯一；17 条主路由 0 个 `pageerror`；`/admin` 鉴权重定向有效；搜索五路召回与拼音均真实可用。

---

## 3. 升级建议方案（四阶段，建议按序执行）

### 阶段一：性能与渲染规模（预计收益最大，风险可控）
1. **首页分组级虚拟化（P0-1）**
   - 把「217 个分组」改为**按分组懒挂载**：`IntersectionObserver` + `content-visibility` 已就绪的前提下，未进入视口 ±1 屏的分组**不渲染卡片子树**，只渲染标题骨架。
   - **验收**：首页 DOM 节点 ≤ 8,000；首屏卡片 ≤ 120；「滚动到第 10 个分类」无白屏。
   - **风险**：CLS —— 必须配合 `contain-intrinsic-size` 给出分组高度估值（当前卡片已带 `auto 92px`，需补分组级）。
2. **`/videos` 分页 + 封面代理（P0-2）**
   - 改为分页（每页 24–36）或无限滚动；封面统一走站内代理 + `next/image` 尺寸收敛（`w=800` → 按列宽 `sizes` 下发 320/480）。
   - **验收**：单页 DOM ≤ 3,000；封面首屏完成率 ≥ 80%（2.5s 内）；第三方域名请求数下降 ≥ 90%。
3. **补齐 `contain` 显式声明（可选）**
   - 实测 `.nav-card-deferred` 的 `content-visibility: auto` 已生效（`contain-intrinsic-size: auto 92px` 同时生效），`getComputedStyle().contain` 返回 `none` 属规范表现，**无需额外声明**。

### 阶段二：移动端可用性（P0-3）
1. **入口重新布局**：DIY 静息位改为 `bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)]`（抬到底部导航之上），或直接并入底部导航第 5 个 Tab。
2. **修复 12.8s 延迟**：把 `HomeDIYToolbar` 从 `dynamic({ssr:false})` 改为**首屏后空闲加载**（`requestIdleCallback`），并使其不依赖 873 卡片的渲染完成。
3. **验收**：390×844 下 DIY 入口 ≤ 2s 可见，`elementFromPoint` 命中自身（`isSelf: true`），点击可进入编辑态并正常退出。

### 阶段三：数据完整性与诚实降级（P0-4 / P1-1 / P2-1）
1. **`/graph` 换用公开数据源**：改用 `/api/home/navigation`（公开、`s-maxage=60`）或新增只读公开图谱端点；若确实拿不到数据，**显式显示「示例数据」角标**，不允许静默冒充真实图谱。
2. **向量补全任务**：把 `embeddings` 从 1038 补到全量 4921（增量 + 幂等 + 限速），并在搜索面板对未建向量的结果加「未覆盖」提示，避免用户误判召回为全量。
3. **空表分类处置**：对 16 张空表逐张判定「端点未被调用 / 写入失败 / 设计预留」，产出结论表（删除 / 修复 / 保留并加注释）；`plugin_reviews` 若属写入失败，应优先修复——它对应的是**用户可见的评论能力**。

### 阶段四：可访问性、三态与双语（P1-2 / P1-3 / P1-4）
1. **点击目标达标**：把 22×22 的「复制分类直达链接」等图标按钮提到 24×24（`h-6 w-6`），标签 chip 高度 23px → 24px；用现有 `a11y-sweep.mjs` 复测并把 37 条豁免逐批清零（豁免机制已有到期日，按批推进即可）。
2. **键盘成本收敛**：为分类区块引入「区块级跳转」（`role=region` + 跳转按钮），把 418 个停留点按分区折叠为「进入区块 → 内部导航」，与卡片已有的复合控件模型保持一致。
3. **三态补齐**：为缺少 `loading.tsx`/`error.tsx` 的路由补齐（优先 `/me/*`、`/marketplace/*`、`/admin/*` 三组），并在错误边界内提供「重试 / 回首页」出口。
4. **双语能力接线**：以已存在的 `title_en`/`description_en` 为起点，最小实现 `zh-CN`/`en` 两语；先做**数据层 + 元信息层**（`<title>`/OG/hreflang），UI 文案后置，避免一次性大改。

---

## 4. 验收与度量（建议固化为门禁）

| 指标 | 当前实测 | 目标 | 判定方式 |
|---|---|---|---|
| 首页 DOM 节点 | 42,803 | ≤ 8,000 | Playwright `getElementsByTagName('*').length` |
| 首页卡片数（首屏） | 873 | ≤ 120 | `[data-navhub-site-id]` 计数 |
| `/videos` 单页卡片 | 365 | ≤ 36 | 同上 |
| 移动端 DIY 可见耗时 | 12,824 ms | ≤ 2,000 ms | 轮询脚本（`scan-mobile-diy-timing.mjs`） |
| 移动端 DIY 可点击 | 否（被遮挡） | 是 | `elementFromPoint` → `isSelf: true` |
| `/graph` 匿名 401 | 2 次 | 0 次 | 响应监听 |
| 向量覆盖率 | 21% | ≥ 95% | `embeddings` / `sites` |
| < 24px 点击目标 | 64 | 0 | 浏览器实测 |
| 路由三态覆盖 | 19/78 | ≥ 60/78 | 文件计数 |
| 首页键盘停留点（主内容） | 418 | ≤ 200 | Tab 序列统计 |

**建议**：把上表前 5 项写成 `scripts/check-perf-budgets.mjs` 并接入 `verify.mjs` 默认档——本仓库门禁文化成熟（预算棘轮、覆盖层校验、契约门禁都在），把「渲染规模」纳入同一套棘轮，收益可长期锁住而不回退。

---

## 5. 风险与取舍（先说清代价）

1. **分组虚拟化 vs SEO**：首页卡片是内链入口（仓库历史上已因此把 `DIRECTORY_CATEGORY_LINKS` 从 8 上调到 50）。虚拟化会减少内链，必须保留**分类目录带的纯文本内链**作为补偿，否则是拿 SEO 换性能。
2. **`/videos` 分页 vs 爬虫**：分页需保留 `rel=next/prev` 与 `/videos/sitemap.xml` 覆盖，避免把 6,014 条视频从索引里挤出去。
3. **向量补全成本**：4,921 − 1,038 = 3,883 条待嵌入，按本仓 LLM 配额治理（`llm-quota`）需评估预算与限速，建议走本地嵌入模型（仓库已有 `embedding-worker`）。
4. **空表处置不可一刀切**：删除一张「设计预留」表会丢掉未来能力位，删除一张「写入失败」表则掩盖真 Bug——必须先分类判定。
5. **本方案未覆盖的部分（明确标注未测）**：真实弱网/3G 表现、真实低端安卓设备帧率、Lighthouse 官方评分、PG 方言下的性能、第三方图标的 CDN 命中率、`/me` 全量功能在登录态下的行为。

---

## 6. 附：本次扫描用到的可复现脚本

| 脚本 | 用途 |
|---|---|
| `scripts/scan-routes-health.mjs` | 17 条主路由 HTTP 状态 / h1 / console error |
| `scripts/scan-mobile-vs-desktop.mjs` | 移动端 vs 桌面 卡片数 / DOM 节点 / 页高 |
| `scripts/scan-videos-dom.mjs` | `/videos` 卡片数、节点数、是否有分页 |
| `scripts/scan-graph-401.mjs` | `/graph` 匿名 401 取证 |
| `scripts/scan-mobile-diy-timing.mjs` | 移动端 DIY 出现耗时 + 遮挡判定 |
| `scripts/scan-tabbables.mjs` | Tab 停留点、卡片停留点、<24px 目标 |
| `scripts/scan-a11y-heuristics.mjs` | alt / 名称 / 标签 / 层级 / 目标尺寸 |
| `scripts/scan-search-ui.mjs` | 搜索面板与拼音链路 |
| `scripts/tmp-db-count.cjs` | 79 张表逐表行数（含空表识别） |

> 文档生成时点：2026-11-08；所有数字均为当次实测，若数据继续增长（sites 4921 → …），§0 表格需重跑上述脚本刷新。

---

# 执行结果（同日收口，全部为本机实测）

> 验收脚本：`node scripts/verify-all-fixes.mjs`（一次跑完首页 / 编辑态 / videos / graph / 移动端五项）。
> 门禁：`pnpm check:overlay` ✅、`npx tsc --noEmit` ✅、`verify.mjs --guards` ✅（211 用例）、
> 相关单测 117 用例 ✅（含 `home-card-render-budget`/`card-single-tab-stop`/`card-tag-links`/`route-state-coverage`）。

## 一、指标对照

| 指标 | 改造前 | 改造后 | 结论 |
|---|---|---|---|
| 首页 DOM 节点 | 42,803 | **7,820** | 达标（目标 ≤8,000，−82%） |
| 首页卡片数 | 873 | **120** | 达标（目标 ≤120，−86%） |
| 首页主内容 Tab 停留点 | 418 | **317** | **未达标**（目标 ≤200，−24%） |
| 进入编辑态耗时 | 22,644 ms | **990 ms** | 达标（23× 提速） |
| 编辑态 DOM 节点 | 33,241 | **10,230** | 达成 |
| 编辑态分类原地操控条 | 19 | **49** | 超预期（占位分类也带操控条） |
| `/videos` DOM 节点 | 16,383 | **3,905** | **略超**（目标 ≤3,000，−76%） |
| `/videos` 页高 | 45,616 px | **9,762 px** | 达标（−79%） |
| `/graph` 匿名失败请求 | 2 × 401 | **0** | 达标 |
| `/graph` 数据来源标注 | 无（静默演示数据） | **「实时 24 个站点」** | 达标 |
| 移动端 DIY 可点耗时 | 12,824 ms | **1,591 ms** | 达标（目标 ≤2,000 ms，−88%） |
| 移动端 DIY 可点击 | ❌ 被底部导航遮挡 | ✅ 距底 68px | 达标 |
| 移动端横向溢出 | +144 px | **0** | 达标 |
| < 24px 点击目标 | 64 | **18** | **部分达标**（余 18 个为行内文本链接，属 WCAG 2.5.8 Inline 豁免） |
| 有局部错误边界的路由 | 34 条落全局 `app/error.tsx` | **69/69 全覆盖** | 达标 |

## 二、各项改动的落点

1. **首页分组级懒挂载**（新 `components/lazy-mount-section.tsx` + `navigation-content.tsx`）
   - 首 2 个分类立即挂载，其余进入视口前 800px 才挂；占位块保留分类标题、计数与锚点 id。
   - 编辑态**不再一次性展开全部**：占位块直接给出分类级操控条（上移/下移/隐藏/形态/添加站点）。
2. **编辑态保留分组截断**（`navigation-category-section.tsx` 的 `forceFull` 由 `isEditingLayout || selectionMode` 收窄为 `selectionMode`）
   - 这是「进入编辑态要 22 秒」的真正主因：解除截断后两个分类就展开成 634 张卡。
   - 被折叠的卡仍由每组自带的「展开全部 N 个」揭示，功能未减。
3. **DIY 触发器拆分**（新 `components/home-diy-trigger.tsx`）
   - 轻量静息入口静态导入随首屏渲染；重量级 HUD 只在编辑态按需加载，并在 hover/focus/touchstart 时预热 chunk。
4. **移动端定位**：静息入口与 HUD 均抬到 `bottom: calc(3.5rem + env(safe-area-inset-bottom) + 0.5~0.75rem)`，避开 `h-14` 的底部导航；移动端靠左，避开右下角竖排的浮动快捷导航。
5. **`/videos` 分类级渐进披露**（`video-content.tsx`，`INITIAL_VISIBLE_CATEGORIES = 2`）
   - 12 个分类仍全部保留 `<section id>` 锚点与计数，超出的降级为「分类摘要卡 + 浏览此分类」。
   - SEO 兜底已核实：`/videos/sitemap.xml` 实测 **6,014** 条 `<loc>`，站点级内链不依赖首屏卡片。
6. **`/graph` 换公开数据源**（`ecosystem-graph.tsx`）
   - 由鉴权路由 `/api/hub/sites` 改为公开只读 `/api/home/navigation`；展平 19 个类目、按 stride 均匀抽样 24 个动态节点（原实现取前 60 条，图谱永远只反映第一个类目）。
   - 新增 `dataSource` 状态：真实数据打「实时 N 个站点」，拿不到数据打「示例数据（未接入站点库）」。
7. **错误边界收口**：新增 `admin/error.tsx`、`me/error.tsx`、`algorithms/error.tsx`、`graph/error.tsx`、`preferences/error.tsx`，并从门禁 `STATE_EXEMPT` 删除 **35 条**已闭合的豁免（门禁要求清单与现状双向一致，残留豁免即红）。
8. **点击目标放大**：分类直达复制/图谱链接改 `h-6 w-6`；分类筛选 chip 加 `min-h-6`；目录带胶囊与卡片标签 chip 同理。

## 三、明确未完成 / 未做

- **首页 Tab 停留点 317 > 200**：卡片的「单一 Tab 入口」模型已生效（门禁 `card-single-tab-stop` 绿），
  剩下的量来自分类筛选按钮、子分类 tab、目录带胶囊等**每类一组**的控件。要再降需要引入「区块级跳转」
  （`role=region` + 跳转按钮），属于结构性改动，未在本次执行。
- **`/videos` DOM 3,905 略高于 3,000**：本次只做了分类级披露，未做卡片级虚拟滚动。
- **<24px 目标 18 个**：均为页脚/导航里的行内文本链接，WCAG 2.5.8 对「行内」有明确豁免，未强行放大以免破坏排版。
- **语义向量覆盖 1,038 / 4,921（21%）**：补全需要跑嵌入任务（LLM 配额 + 限速策略），本次未执行。
- **i18n**：未动。这是需要产品决策的大改动（先数据层还是先 UI 层），不宜在性能批次里夹带。
- **空表判定**：已完成静态判定（见下），但**没有删任何表**——删除与否需要产品/运维拍板。
- **未测**：真实弱网/3G、真实低端安卓帧率、Lighthouse 官方评分、生产构建产物（本次全部基于 dev server；dev 端按需编译会让「首次进入某路由」的数字偏大）。

## 四、空表静态判定（P2-1，仅判定不动手）

对 16 张 0 行表做了「是否存在写入代码路径」的静态检索（`packages/store/src` + `apps/api/src`）：

| 表 | 引用它的文件数 | 判定 |
|---|---|---|
| `app_settings` | **0** | **孤儿表**：schema 里有、代码里无人读写。可考虑删除或显式标注为预留 |
| `auth_tokens` | 5 | 已接线（邮箱验证/重置需要 SMTP），本地无邮件链路 → 未产生数据 |
| `favorite_folders` | 8 | 已接线；本地 `favorites` 只有 2 行、`users` 3 行 → 冷启动未触发 |
| `idempotency` | 4 | 已接线（写请求幂等键），本地写路径未命中 |
| `llm_model_prices` / `llm_quota_reservations` | 6 / 6 | 已接线（LLM 治理），未配置价格表/未触发配额预留 |
| `plugin_reviews` / `plugin_reports` | 8 / 5 | 已接线（评论 4 个端点 + 前端表单）→ 无人写过，属冷启动 |
| `short_links` | 5 | 已接线（`POST /api/shortlinks`）；生成本地短链才会写 |
| `site_archives` | 5 | 已接线（`POST /api/sites/:id/archive`）；未触发快照 |
| `video_replacements` | 4 | 已接线（替换历史），未做过视频替换 |
| `submission_owners` / `tag_aliases` / `user_llm_configs` / `user_vault_sync` / `user_workspace_blobs` | 4–10 | 均已在 repository 层接线；本地数据量过小或功能未使用 |

**结论：只有 `app_settings` 是真孤儿，其余 15 张是「接好了但本地从没被走过」。**
但这不能证明它们在**生产**也是空的——本机数据快照是 `users=3 / favorites=2 / sites=4921`，
拿它推断生产行为不成立。需要在生产库上重跑 `node scripts/db-table-counts.mjs` 才能定论。

---

# 第二轮：自动化问题排查与修复（2026-11-08 晚）

> 目标：不靠人工翻代码，用脚本自动发现问题并修掉。
> 手段：4 支自动化探针 + 1 次生产构建对照。

## 一、探针与结论

| 探针 | 覆盖 | 结果 |
|---|---|---|
| `scripts/auto-crawl-problems.mjs` | 57 条路由（含真实动态 id/slug：site/tags/collections/category/videos/marketplace/me/admin/auth） | **3 条上报**，逐条判定见下 |
| `scripts/auto-link-check.mjs` | 8 个种子页收集的 **826 条站内链接** | **0 条死链** |
| `scripts/auto-hub-smoke.mjs` | 12 个 hub 只读端点 | 全部符合预期（401/403 均为策略设计），无客户端调用未登记路由 |
| `scripts/auto-api-smoke.mjs` | 25 个 web BFF 端点 | 404 的均为「后端端点、本不该出现在 web 前缀下」，非缺陷 |
| `scripts/db-table-counts.mjs` | 79 张表逐表行数 | 16 张空表，判定见上一轮 §四 |

## 二、3 条上报的逐条判定

1. **`/videos/v/*' 页面 `net::ERR_CONNECTION_RESET` ×9**
   - 逐条抓 URL：全部是 `data.bilibili.com/log/web`、`data.bilibili.com/v2/log/web` ——
     **B 站播放器 iframe 内部的第三方埋点信标**被网络重置，发生在跨域 iframe 里，
     本站既无法拦截也不该拦截。附带发现：嵌入 B 站播放器会把访客的观看行为发给第三方，
     这属于**隐私面**的产品决策（是否改用无埋点的自建播放器），不是代码 bug。
   - 判定：**非本站缺陷，不改代码**，记录为待评估项。

2. **`/this-route-does-not-exist-xyz`（404 页）加载了一个 404 的 JS chunk**
   - `/_next/static/chunks/apps_web_src_components_1lr0cnzjmvwim._.js` → 404。
   - 溯源：`react-loadable-manifest.json` 中 `search-palette.tsx` 的 dynamic entry
     列了 3 个文件，其中**这个文件在磁盘上不存在**（另两个共 924KB 存在）。
   - 页面本身**功能正常**：404 页的搜索框渲染成功（placeholder「没找到？直接搜导航…」），
     6 个恢复链接齐全 —— 说明真正承载代码的 chunk 已加载，缺失的是一个附属分块。
   - **重启 dev server 后仍然复现**，所以不是「热更新残留」。
   - 决定性验证：跑了一次**生产构建**（`NEXT_DIST_DIR=.next-autofix next build`，退出码 0），
     在**整个生产产物里搜不到这个 hash** —— `.next-autofix` 下 297 个 chunk 无一处引用它。
   - 判定：**Turbopack dev 的 manifest 与产物不一致**，生产不受影响，**不改代码**。
     （若要根治，只能等 Turbopack 侧修复；本地可忽略。）

3. **其余 54 条路由零问题**：无 console error、无 hydration mismatch、无 pageerror、无空白页。

## 三、本轮实际修复

- **`target="_blank"` 缺 `rel`（5 处）** —— 静态扫描命中，逐条人工确认后修复：
  `admin/plugins/page.tsx` ×3、`admin/stats/page.tsx` ×1、
  `admin/videos/[id]/categories/[categoryId]/items/page.tsx` ×1。
  统一补 `rel="noopener noreferrer"`，与仓库既有的 `externalLinkRelAttr` / `safeWindowOpen`
  口径一致（前者只作用于对外站点链接，管理台内部跳转此前漏掉了）。

## 四、生产构建实测（补齐上一轮「未测生产产物」的缺口）

跑了一次真实生产构建并在 `next start`（:3100）下复测同一套指标：

| 指标 | dev | **生产** |
|---|---|---|
| 首页 DOM 节点 | 7,820 | **7,695** |
| 首页卡片 | 120 | 120 |
| 首页 HTML 传输 | 561 KB | **556 KB**（项目预算 4,096 KB） |
| 首页 DOMContentLoaded | 12,086 ms | **3,201 ms** |
| 首页 load | 23,913 ms | **3,325 ms** |
| 进入编辑态（HUD 出现） | 2,348 ms | **1,712 ms** |
| `/videos` DOM | 2,917 | **2,793** |
| `/videos` load | 6,661 ms | **3,087 ms** |
| 移动端 DIY 可点 | 9,630 ms | **1,894 ms** |

**一处需要更正上一轮的说法**：`/videos` 的 DOM 目标是 ≤3,000，
上一轮基于 dev 测到 3,905 判为「未达标」；**生产实测 2,793，实际达标**。
dev 的额外开销来自开发期叠加层（HMR、devtools 提示、错误浮层容器等）。同理，
上一轮所有 dev 数字都是**保守上界**，生产只会更好。

## 五、仍然存在、但**不属于代码缺陷**的项

- **B 站播放器带第三方埋点**：隐私面产品决策（是否自建无埋点播放器）。
- **`/api/hub/stats`、`/api/hub/sites` 对匿名 401**：路由策略设计如此；
  已确认前端**没有任何地方**调用它们（全仓 grep 只命中注释）。
- **Turbopack dev 的 dangling chunk**：dev-only，生产无此引用。
- **`app_settings` 孤儿表**：schema 有、代码无人引用，是否删除待定。

## 六、本轮新增的自动化探针（保留为长期工具）

| 脚本 | 用途 |
|---|---|
| `scripts/auto-crawl-problems.mjs` | 57 条路由扫 console error / hydration mismatch / pageerror / 空白页 / 4xx+ |
| `scripts/auto-link-check.mjs` | 从 8 个种子页收集站内链接并并发探测死链（本轮 826 条 → 0 死链） |
| `scripts/auto-hub-smoke.mjs` | hub 只读端点冒烟（区分「策略拒绝」与「真故障」） |
| `scripts/verify-prod-vs-dev.mjs` | 同一套指标在 dev 与生产构建上对照（消除 dev 开销误判） |
| `scripts/db-table-counts.mjs` | 79 张表逐表行数 + 空表清单 |

清理：删除了 29 个本轮及上一轮留下的一次性调试脚本（probe-/patch-/find- 等），
保留上述可复跑工具。清理后 `docs/docs-index.json` 已重新生成，门禁通过。

---

# 第三轮：挖到一个正在每小时失败的线上级缺陷（2026-11-08 晚）

## 一、发现过程

第二轮的五支探针把「页面级」问题扫干净了，于是这一轮换了方向：**看后台任务表**。
`jobs` 表按 kind/status 分组一拉，异常立刻显形：

```
recompute_rank / done   = 384
recompute_rank / failed = 25   ← 最近 8 条任务里 6 条是它
```

失败原因（jobs.error 逐条读取，25 条全部一致）：

```
NOT NULL constraint failed: sites.weight
```

## 二、根因链（四层，逐层实证）

1. **脏数据**：`sites.created_at` 声明是 `INTEGER NOT NULL`，但 SQLite 动态类型允许存 TEXT。
   实测 **3 行**是日期串 `"2026-11-07 06:47:11"`
   （Physical Intelligence (Pi) / LeRobot (HuggingFace) / 1X Technologies）。
   来源：批量写入用的是 `input.createdAt ?? now` —— **调用方给什么存什么**。
2. **NaN 外泄**：`Number("2026-11-07 06:47:11")` → NaN →
   `ageInDays` 返回 NaN（`Math.max(0, NaN)` 仍是 NaN）→ `trendScore` 返回 NaN。
   原实现看着在兜底（`Math.max` + `toFixed` + `Number`），**对 NaN 三步全部无效**：
   `NaN.toFixed(6)` 得到字符串 `"NaN"`，`Number("NaN")` 还是 NaN。
3. **绑参变 NULL**：NaN 进 SQLite 绑定参数被当作 NULL，
   撞上 `sites.weight NOT NULL`（`setTrendScores` 同时写 `trend_score` 与 `weight`）。
4. **整任务失败**：一条脏行 → 整个批次的 UPDATE 回滚 →
   **全站 trend_score 长期停在 0**（实测 4905 个活跃站，`trend_score <> 0` 的只有 **0 个**），
   热度榜等于没有排序。

**影响面**：不是「某个页面报错」，而是**全站热度排序静默失效**，且每小时重试一次、每小时再失败一次。

## 三、修复（四道，缺一不可）

| 层 | 改动 | 作用 |
|---|---|---|
| 数据 | 新增迁移 `20261108_normalize_site_created_at`（`normalizeSiteCreatedAt`） | 修存量：3 行 TEXT → epoch 毫秒，幂等 |
| 算法 | `core/ranking.ts`：`ageInDays` / `trendScore` 加有限性闸门 + 入参净化 | 不再崩：任何 NaN/Infinity 收敛为 0，绝不外泄 |
| 任务 | `rank-recompute.task.ts`：`toEpochMs()` 兜底解析日期串 | 容错：脏行按「新站」处理，任务不被它拖垮 |
| 写入边界 | `repository/sites.ts`：新增 `normalizeCreatedAt()`，用于站点与关系两处写入 | 不再产生：增量数据无法再污染该列 |

**一处刻意没做**：`setTrendScores` 里 `weight = CASE ... END` 我一度删掉了，理由是
`repository/sites.ts` 注释说 weight 已退出所有 ORDER BY。但 `store.test.ts` 里有一条
**已提交的契约测试**断言 `weight ≈ trendScore`，删掉会红。按本仓库「尊重已提交锁」的规矩，
**已还原**，只保留根因侧的三处修复 —— 事实也证明够了：NaN 才是病根，weight 只是放大器。

## 四、验证证据

| 验证 | 结果 |
|---|---|
| 迁移执行 | `[migrate] normalizeSiteCreatedAt 完成：修正 3 行非数值 created_at`；迁移台账已登记 |
| 数据状态 | 脏行 **3 → 0**，`created_at` 全部为 `integer` |
| 直接跑任务 | `recompute_rank` 成功，**217 ms**（此前每跑必败） |
| **活体验证** | 往 `jobs` 表插一条 pending 任务，**由运行中的中枢进程（旧代码，pid 4156）领取并跑完**：`status=done, attempts=1, error=null, 831ms` → 证明数据层修复本身就是充分条件 |
| 结果数据 | `trend_score <> 0` 从 0 → 1（本地几乎无点击/收藏数据，符合公式预期） |
| 回归测试 | 新增 9 条（`ranking-nan-guard` 6 条、`migrate-site-created-at` 4 条、`site-created-at-write-guard` 5 条，含 1 条用「允许 NULL 的同构表」覆盖无法在一线 schema 打出的分支） |
| 全量套件 | `packages/store` + `packages/core`：**1263 通过 / 35 跳过**（127 文件）；api 任务相关 4 文件 37 条全绿 |

## 五、要重启才生效的部分

运行中的中枢进程是**旧代码**（由 `scripts/dev-all.mjs` 拉起，非本会话启动，我没有动它）。
- **数据修复已即时生效**：它现在每小时的任务会成功（上面活体验证已证）。
- **代码闸门需重启才加载**：NaN 防护、`toEpochMs` 兜底、写入归一这三处要等下次重启。
  重启不是修复的必要条件，只是让「以后不会再产生脏值」这一层也上线。

## 六、本轮新增的运维/诊断脚本

| 脚本 | 用途 |
|---|---|
| `scripts/db-job-failures.mjs` | 按 kind/status 汇总 jobs 表并打印失败原因（本轮就是靠它定位到 25 条 `recompute_rank` 失败） |
| `scripts/db-rank-diagnose.mjs` | 站点 `created_at` 类型分布 + weight/trend_score 异常统计 |
| `scripts/db-embedding-coverage.mjs` | 向量覆盖率（当前 1038/4905 = **21.2%**，语义通道只覆盖两成站点，待补） |
| `scripts/db-apply-migrations.mts` | 显式跑一次版本化迁移（与服务启动同一条代码路径），并打印迁移台账 |
| `scripts/run-rank-recompute.mts` | 直接跑一次 `recompute_rank` 任务本体，验证这条链路能否跑通 |

## 七、本轮**未**处理、需要你决策的项

1. **向量覆盖 21.2%**（1038/4905）：仓库已有官方路径
   （`jobs.ts` 注释：`POST /api/jobs {kind:"reindex", payload:{vectors:true}}`），
   但全量重建要跑 3800+ 次本地 embedding 推理。要不要现在跑、什么时候跑，需要你定。
2. **B 站播放器第三方埋点**：隐私面产品决策（是否自建无埋点播放器）。
3. **`app_settings` 孤儿表**：schema 有、代码无人引用，删还是留。
4. **首页 Tab 停留点 283、目标 ≤200**：要引入区块级跳转，属结构性改动。
