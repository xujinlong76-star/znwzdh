# NavHub 全仓开发进度扫描（2026-10-28 23:45）

> **扫描口径**：只依据仓库里真实存在的文件、路由注册、数据库表与数据行、依赖清单判断。
> 每条结论都附可复现的判据（路径 / 命令 / 计数），不做推断式补白。
> 扫描时点：`main` @ `bba56a6b`，工作区 389 个未提交改动（其中 143 个是 `deliverables/` 审计产物，非代码）。

---

## 0. 一页速览

| 维度 | 实测数字 | 判据 |
|---|---|---|
| 前端页面路由（唯一） | **78** | `find apps/web/src/app -name page.tsx` |
| 前端 BFF 路由 | **45** | `find apps/web/src/app/api -name route.ts` |
| 后端 REST 端点 | **271** / 41 个路由模块 | 解析 `apps/api/src/routes/*.ts` 的 `(app\|router).{get,post,...}` |
| 数据库表 | **69**（dev 库） | `sqlite_master` |
| 前端组件 | **250** 个 `.tsx`（其中 `ui/` 27 个基础件） | `find apps/web/src/components -name '*.tsx'` |
| 源码行数 | **约 11.4 万行**（web 11.1k / api 49.7k / core 18.8k / store 17.3k / ai 2.7k / mcp 2.1k / overlay 12.1k） | `find … \| xargs wc -l` |
| 测试行数 | **约 6.1 万行**（web 12.7k / api 28.2k / core 7.9k / store 9.6k / e2e 2.8k） | 同上 |
| 工程脚本 | **142 个文件 / 2.7 万行** | `scripts/` |
| 全仓 `TODO/FIXME` | **2 处**（均在前端，见 §2.1） | 忽略大小写全仓扫描 |
| 提交总数 | **816**（近 30 天全覆盖，10-28 当天 86 次） | `git rev-list --count HEAD` |

---

## 1. 已实现的功能模块与页面清单

### 1.1 前台（内容消费）

| 模块 | 页面路由 | 关键实现 | 数据支撑 |
|---|---|---|---|
| 首页导航墙 | `/` | `app/page.tsx`（214 行，ISR `revalidate=60`）+ `navigation-content.tsx` + 渐进披露（每组首屏 6 张） | `navigation.json` 13 个一级类目（含 `subCategories`）；DB `sites` **1020**、`categories` **234** |
| 分类浏览 | `/category`、`/category/[slug]`、`/category/[slug]/p/[n]` | 分页 + SEO 阈值（`MIN_SITES_FOR_CATEGORY_INDEX`） | 同上 |
| 站点详情 | `/site/[id]` | `site-detail-view.tsx`、`site-peek-dialog.tsx` | `site_tags` 2201、`site_fts` 1020 |
| 站点总览 | `/sites`、`/sites/p/[n]` | 分页列表 | 同上 |
| 标签 | `/tags`、`/tags/[slug]` | `tag-cloud.tsx`、`tag-results-board.tsx` | DB `tags` **1080** |
| 收藏 | `/favorites`（1259 行，最重的前台页之一） | `useFavorites`、文件夹管理、合并、同步、保险库 | `favorites` / `collection_items` |
| 合集 | `/collections`、`/collections/[slug]` | `collection-board.tsx` | `collections` 6 / `collection_items` 38 |
| 搜索 | 全局（`/search` BFF + `/api/search`） | 五路召回 RRF 融合：`exact / fts / pinyin / semantic / personal`（`packages/core/src/channels.ts`，权重 1.4/1.0/0.9/1.15/0.3）；`search-palette`、`spotlight-modal` | `sites_vec` 向量 1020、`embeddings` 1020、`search_history` 99 |
| 热点 | `/hot`（69 行） | 拉 `/api/rank/trending?limit=30` + fresh，带 `degraded` 降级位 | `rank` 模块 6 端点 |
| 知识图谱 | `/graph`（87 行） | `ecosystem-graph.tsx`、`knowledge-graph.ts` | `/api/graph/*`、`/api/sites/:id/graph` |
| 算法实验室 | `/algorithms`（40 行壳） | `algorithm-lab/` 12 个组件：LinUCB、Poincaré 双曲、Shannon 熵、0-RTT 预执行 | `rank.ts` 的 `/api/search/linucb` |
| DIY 自定义首页 | `/custom`、`components/modular/`（24 个组件） | 模块化画布、24 种挂件（天气/快捷工具/自定义分类/快搜…） | DIY 布局 `packages/core/src/diy-layout/` |
| 视频中心 | `/videos`、`/videos/player` | **`video-*` 组件 52 个 + `video-*` lib 70 个**（播放器、弹幕、OCR、思维导图、闪卡、P2P、WASM 沙箱…） | DB `video_categories` **12**、`video_items` **5578**；`videos.json` 6.3 MB |
| 离线 | `/offline` | `offline-banner`、`offline-recent`、`offline-video-cache` | PWA：`public/sw.js`、`app/manifest.ts` |
| 书签导入 | `/import` | `bookmark-importer.tsx` + `bookmarks-import.ts` | `/api/backup/*` |
| 投稿 | `/submit` | `submission-form.tsx` | `/api/submissions`（POST/GET/PATCH） |
| 偏好设置 | `/preferences`（410 行） | 主题/密度/动效/快捷键 | `user_settings` |
| 短链 | `/s/[code]` | `shortlink-target.ts` | `/api/shortlinks` |

### 1.2 插件市场（`/marketplace`，9 个页面）

| 页面 | 能力 |
|---|---|
| `/marketplace` | 列表 + 搜索 + 分类 |
| `/marketplace/[slug]` | 详情（版本/评价/相似/徽章 `/badge.svg`） |
| `/marketplace/[slug]/preview` | 安装前预览 |
| `/marketplace/publish` | 发布（含校验、预检、URL 检查、自动修复） |
| `/marketplace/installed`、`/mine`、`/import`、`/author/[key]` | 已装 / 我的 / 导入 / 作者页 |

**后端支撑：`plugins.ts` 一个模块 50 个端点**（全仓最大），加 `plugin-audit.ts` 13、`plugin-overlap.ts`、`plugin-presentation.ts`。
数据：DB `plugins` **77**、`plugin_versions` **81**、`plugin_installs` 13、`plugin_embeddings` 77；
种子库 `apps/api/src/seed-data/`：网址包 **34** + 搜索包 **3** + 主题 **8** + 预设 **5** + 组合包 **9**。

### 1.3 用户中心（`/me`，10 个页面）

`/me`（概览）、`account`、`data`（导出/导入/注销，783 行）、`history`、`notifications`、`plugins`、`settings`、`vault`、`workspaces`。
后端 `me.ts` **26 个端点**：设置、资料、令牌签发、通知收件箱、会话管理、LLM 用量、活动流、收藏同步、导出书签、账号注销与合并。
数据主权：`packages/store/src/data-inventory.ts` 登记每张带归属列的表，注销时按表处置（已有专门的守卫测试）。

### 1.4 管理后台（`/admin`，**31 个页面**，全站最重的模块）

| 分组 | 页面 |
|---|---|
| 概览/运行 | `/admin`（控制台）、`stats`、`jobs`（798 行）、`plugin-health` |
| 内容治理 | `sitelist`（**1537 行**，最大页面）、`categories`、`tags`、`taxonomy`、`facets`、`collections`、`navigation/*`（5 个） |
| 插件治理 | `plugins`（**1345 行**）、`submissions`（投稿审批） |
| AI | `ai`、`audit` |
| 数据 | `data`（708 行）、`data/restore`（919 行，异步恢复）、`resources`（1008 行）、`resources/download`、`trash`、`videos/*`（4 个） |
| 系统 | `tokens`（710 行）、`site`、`page.impl.tsx` |

后端支撑端点：`stats` 12、`jobs` 12、`categories` 13、`plugin-audit` 13、`ai-config` 12、`collections` 10、`facets/tags/taxonomy/trash/tokens/backup` 等。
运维设施：备份/恢复（`backup.ts` 5 端点 + `BACKUP-RUNBOOK.md`）、维护（checkpoint/optimize/vacuum）、审计日志（DB `audit_logs` **6129**）、健康巡检（`health_checks` 1240）。

### 1.5 后端能力（按路由模块，271 端点）

| 能力域 | 模块（端点数） |
|---|---|
| 插件生态 | `plugins` 50、`plugin-audit` 13、`plugin-overlap` 1、`plugin-presentation` 0 |
| 用户与身份 | `me` 26、`identity` 1、`profile` 3、`tokens` 6、`vault` 3 |
| 内容 | `sites` 7、`categories` 13、`tags` 7、`taxonomy` 5、`collections` 10、`facets` 3、`relations` 4、`archive` 2 |
| 检索与排序 | `search` 2、`rank` 6、`recipes` 10、`graph` 2、`enrich` 2 |
| AI | `ai-config` 12、`copilot` 1、`agents` 3 |
| 运营治理 | `stats` 12、`jobs` 12、`health` 4、`health-audit` 4、`audit` 2、`submissions` 3、`trash` 3、`navsphere` 5、`backup` 5 |
| 其他 | `favorites` 9、`history` 4、`workspaces` 5、`crdt` 3、`telemetry` 3、`errors` 3、`visual` 2 |

### 1.6 跨端与扩展

- **MCP 服务**：`packages/mcp`（2.1k 行，stdio + HTTP 双通道，`/api/mcp`）
- **浏览器扩展**：`extensions/`（13 个文件）
- **PWA**：`public/sw.js`、`manifest.ts`、`install-prompt.tsx`
- **E2E**：`e2e/` 23 个 spec（admin 系列 7、前台、搜索、插件市场、工作台、暗色模式…）
- **工程化**：`scripts/` 142 个（verify / typecheck / overlay 一致性 / bundle 预算 / HTML 预算 / SEO 审计 / CI 门禁 / 提交闭包校验 等）

---

## 2. 进行中或未完成

### 2.1 代码内的 TODO / 占位（实测只有 2 处 TODO，且都不严重）

| 位置 | 内容 | 判定 |
|---|---|---|
| `apps/web/src/app/api/site-config/route.ts:23` | `// TODO: 从数据库或文件系统获取配置`，当前 `return NextResponse.json(defaultConfig)` 返回硬编码默认配置 | **真占位**，但影响面小：真正的配置读取走 `lib/site-config-source.ts` + `/api/hub/*`；该路由返回的是 logo/favicon/theme/linkTarget 的兜底默认值 |
| `apps/web/src/app/middleware.ts:7` | `// TODO: 添加身份验证逻辑`，函数体是空的 `return NextResponse.next()` | **死代码**：Next 16 的中间件约定位置是 `src/proxy.ts`（已存在且实现了 `/admin` 页面级守卫：`isAdminAccessAllowed` + 未登录跳登录页）；该文件位于 `src/app/` 下、未被任何地方 import，`src/middleware.ts` 不存在。**建议删除，避免误导** |

关于「占位」关键词：全仓 642 处命中（中文占位 / placeholder），逐条抽查后**全部是正常用法**——路由骨架屏（`loading.tsx` 10 个）、加载中的省略号占位、URL 占位符说明。没有发现「功能未实现而用占位顶替」的情况。

**唯一语义性偏差**：`apps/web/src/app/videos/page.tsx:55`

```
// 视频库仍是占位内容：保持 noindex,follow 并留在 sitemap 之外（I4 收录策略）
```

这条注释**已经过期**：数据库里 `video_items` 有 **5578** 条真实条目（含 `platform / external_id / author / duration_sec / quality_score / health_status`），`video_categories` 12 个类目且带 `harvest_policy`。
含义：一个已具备 5578 条真实内容的频道，仍被 `noindex` 且不进 `sitemap.ts`（sitemap 里确实没有 videos 相关条目）。这不是「功能没做完」，而是**收录策略没跟上内容现状**。

### 2.2 未提交的工作区改动（389 个文件，按目录）

| 目录 | 数量 | 说明 |
|---|---|---|
| `deliverables/` | 143 | 审计/巡检产物（截图、日志、报告），非产品代码 |
| `apps/web-overlay/src` | **76** | 进行中的自研改动，见 §2.3 |
| `apps/web/test` | 48 | 配套测试 |
| `apps/web-overlay/test` | 32 | 配套测试 |
| `apps/api/src` | **17** | 进行中的后端改动 |
| `apps/api/test` | 16 | 配套测试 |
| `packages/store` / `core` | 12 / 10 | 数据层与核心域 |
| `apps/web/src` | 3 | `videos/page.tsx`、`github.ts`、`storage-adapter.ts` |
| `packages/ai` / `mcp` / `scripts` | 3 / 2 / 6 | — |

### 2.3 进行中的模块（从改动文件名还原，共 7 条线）

| # | 线 | 涉及文件（摘） | 状态 |
|---|---|---|---|
| 1 | **AI Copilot 前后端** | `lib/copilot-stream.ts`、`ai-entry.ts`、`client-auto-auth.ts`、`api/src/copilot-grounding.ts`、`routes/copilot.ts`、`ai-copilot-drawer`、`global-ai-gateway`、`ai-observability-panel`；测试 `copilot-citations-guard` / `copilot-stream-guard` / `copilot-entry-contract` | 有测试在写，未提交 |
| 2 | **通知系统（前端补齐）** | `notification-badge.tsx/.ts`、`notifications-client.ts`、`use-notification-unread.ts`、`useUnreadNotifications.ts`、`me/notifications/page.tsx`、`admin/notification-delivery-panel.tsx` | 后端 outbox/收件箱已入库，前端在补 |
| 3 | **视频模块续作** | `video-bilibili-hd-parser.ts`、`api/videos/bili-parse`、`bili-stream`、`video-multi-source-connector.ts`、`video-autonomous-ai-harvester.ts`、`navsphere/content/video-topics.json`、`videos/feed.xml`、`videos/sitemap.xml`、`VideoTelemetryDashboard.tsx` | 活跃（21:30 仍有落盘） |
| 4 | **站点静态资源** | `lib/site-assets.ts`、`api/site/asset/*`、`site-settings.ts`、`site-config-source.ts` | 进行中 |
| 5 | **搜索降级契约** | `lib/search-degrade.ts` + `search-degrade-contract.test.ts` | 进行中 |
| 6 | **后端 AI/LLM 治理** | `llm-config.ts`、`llm-usage.ts`、`candidate-probe.ts`、`routes/ai-config.ts`、`routes/plugin-audit.ts`、`routes/plugins.ts`、`ai-plugin-auditor.ts` | 进行中 |
| 7 | **分类影响面 / Facet 编辑** | `lib/admin-category-impact.ts`、`lib/facet-editing.ts`、`components/…` | 进行中 |

> ⚠️ 这些是**并行会话的活跃 WIP**，`data-inventory` 与提交纪律要求：热区只报告不改。

### 2.4 已声明但未落地的能力

- **通知外发渠道**：`NotificationChannel = "inapp" | "email" | "push"`（`packages/store/src/repository/notifications.ts:18`），outbox 表与投递记录已入库；但全仓**未见 SMTP / 邮件服务商 / 推送服务商适配器**（`nodemailer` / `sendgrid` / `resend` 仅出现在种子数据的网址条目里）。即：`email` / `push` 是**已声明、可入队、无实际外发**的状态。
- **LLM 配额**：`apps/api/src/llm-quota.ts` 已有 `checkLlmQuota` / `replyQuotaBlocked`，`llm_usage` 表有 99 条记录，但配额的执行面与前端展示是否打通，需在该切片落地后确认。

---

## 3. 尚未开始或缺失的模块（按证据）

| # | 缺失项 | 判据 |
|---|---|---|
| 1 | **用户注册 / 邮箱验证 / 密码找回** | `apps/web/src/app/auth/` 只有 `signin` 与 `error`；`auth.ts` 只有 `CredentialsProvider`（口令）+ `GithubProvider`；后端 `me.ts` / `identity.ts` 无 `signup / register / verify-email / reset-password` 任何端点。`users` 表只有 **3** 行。当前账号体系 = 「管理员口令 + GitHub OAuth + 个人令牌」 |
| 2 | **多语言（i18n）** | 全仓无 `next-intl` / `i18next` / `react-i18next` 依赖；命中 locale 的文件只是 `date-fns` 的格式化用法。全站单一中文 |
| 3 | **商业化（计费 / 订阅 / 支付）** | 无 Stripe 等支付依赖；`stripe` 字样只出现在种子数据的站点描述与文案里。有 LLM 用量计量（`llm_usage`）但无收费链路 |
| 4 | **邮件/推送真实外发** | 见 §2.4 |
| 5 | **移动端原生 / 小程序** | 无；只有 PWA（`public/sw.js` + `manifest.ts` + `install-prompt`） |
| 6 | **视频频道收录** | 5578 条内容仍 `noindex` 且不在 `sitemap.ts`（§2.1） |
| 7 | **`/admin` 页面级错误边界覆盖不均** | 全站 `loading.tsx` 10 个、`error.tsx` 7 个、`not-found.tsx` 1 个，而页面有 78 个——多数路由没有独立的骨架/错误边界 |
| 8 | **死代码 `apps/web/src/app/middleware.ts`** | §2.1，含一条永不执行的 TODO |
| 9 | **团队协作前端** | `workspaces` 有 5 个后端端点（`GET/POST /api/workspaces`、`members` CRUD），前端只有 `/me/workspaces` 一个入口，无独立协作空间页面 |

> 说明：`packages/store` 已有 PostgreSQL 方言（`pg` 8.23 + `drizzle-orm`）与 SQLite 双支持，`scripts/pg-check.mts` / `run-pg-suite.mjs` 也有跨方言测试入口——**多方言存储不是缺失项**。

---

## 4. 技术栈与目录结构

### 4.1 技术栈（全部来自 `package.json` 实测）

| 层 | 选型 |
|---|---|
| 前端框架 | **Next.js 16.4.2**（App Router）+ **React 19.3.1** |
| 语言 | **TypeScript 5.9.3**（另装 `typescript7` 供脚本用）；Node **>=24**（`native strip-types`） |
| 样式 | **Tailwind CSS 4**（`@tailwindcss/postcss`）+ `tailwind-merge` / `cva` / `clsx` |
| UI | **Radix UI 27 个包** + 自研 `components/ui/` 27 个基础件（shadcn 风格）；`lucide-react`、`sonner`、`vaul`、`cmdk`、`embla`、`recharts`、`monaco-editor` |
| 状态/数据 | `swr`、React 19 Server Components + ISR（`revalidate`）、Server Actions（`app/actions`） |
| 表单/校验 | `react-hook-form` + `@hookform/resolvers` + **zod 4.6.7**（全仓统一 v4） |
| 认证 | **next-auth 5.0.0-beta.32**（Credentials + GitHub）；后端 `scope` 分级的令牌体系（read/favorites/write/admin） |
| 后端 | **Fastify 5.12.5**（`@fastify/cors` 11、`@fastify/rate-limit` 10） |
| 存储 | **SQLite**（`better-sqlite3` 13 + `sqlite-vec` 向量扩展）+ **PostgreSQL**（`pg` 8.23、`drizzle-orm`）；FTS5 + sqlite-vec 双索引 |
| AI | `packages/ai`（2.7k 行）：LLM 客户端、embedding（ONNX 本地）、出站 SSRF 防护、超时与 deadline |
| 测试 | **vitest 5.0.5**（单测）、**Playwright 1.64**（E2E）、`axe-core` 可访问性门禁 |
| 工程 | **pnpm 11.7**（workspace，隔离布局）、ESLint、142 个自研 `scripts/` |
| 部署 | Docker（`docker/Dockerfile.api`、`Dockerfile.web`）+ `docker-compose.yml`；CI `.github/workflows/ci.yml` + `video-harvest.yml` |

### 4.2 目录结构

```
web/
├─ apps/
│  ├─ web/              # Next 前端（vendored 上游 NavSphere + NavHub 覆盖）  11.1k 行
│  │  ├─ src/app/       # 78 个页面 + 45 个 BFF route.ts
│  │  ├─ src/components/# 250 个组件（ui 27 / modular 24 / user-center 20 / plugins 19 / video-* 52）
│  │  ├─ src/lib/       # ~180 个模块（video-* 70、seo/、server/、plugins/、p2p/）
│  │  └─ test/          # 236 个测试文件 / 12.7k 行
│  ├─ web-overlay/      # 自研改动的镜像（事实源，915 文件）               12.1k 行
│  ├─ api/              # Fastify 中枢                                     49.7k 行
│  │  ├─ src/routes/    # 41 个路由模块 / 271 端点
│  │  ├─ src/seed-data/ # 网址包 34 / 搜索包 3 / 主题 8 / 预设 5 / 组合包 9
│  │  └─ test/          # 126 个测试文件 / 28.2k 行
│  └─ data/             # navhub.db（36 MB，69 表）
├─ packages/
│  ├─ core/  18.8k 行   # 领域逻辑：检索融合、授权、健康、CRDT、DIY 布局、插件清单契约
│  ├─ store/ 17.3k 行   # 仓储层：driver / migrate / repository/* / FTS / 向量 / 保留策略
│  ├─ ai/     2.7k 行   # LLM / embedding / 出站防护
│  └─ mcp/    2.1k 行   # MCP stdio + HTTP 服务
├─ scripts/   27.1k 行  # 142 个工程脚本（verify / 门禁 / 生成器 / 审计）
├─ e2e/        2.8k 行  # 23 个 Playwright spec
├─ docs/                 # 91 篇文档（架构、审计、升级执行、运维手册）
└─ deliverables/         # 审计与巡检产物（454 文件）
```

**架构特征**：前端通过 `/api/hub/*` BFF 代理访问 Fastify 中枢（`hub-route-policy.generated.ts` 是自动生成的路由白名单）；中枢不可用时有降级链路（`hub-health.ts`、`search-degrade.ts`、`degrade.ts`）。

---

## 5. 下一步开发建议（按优先级）

| 优先级 | 建议 | 具体动作 | 预期收益 |
|---|---|---|---|
| **P0** | **收口并行 WIP（7 条线 / 约 250 个文件）** | 用 `scripts/check-commit-closure.mjs` 按依赖闭包逐条切分提交；切分判据是「HEAD 缺哪些符号」而不是「改了哪些文件」。**测试文件必须手工列入**（该工具只跟 import 走，会漏测试，已踩过一次） | 把 389 个未提交文件降到接近 0；消除「新行为 + 旧断言」的历史污染 |
| **P0** | **删掉死代码 `apps/web/src/app/middleware.ts`** | 确认 `src/proxy.ts` 已覆盖 `/admin` 守卫后删除该文件 | 消除一条永不执行的 TODO 与「以为有中间件」的误判 |
| **P1** | **修正视频频道的收录策略** | 改 `videos/page.tsx` 的 `robots` 与那句过期注释，并把 `/videos`、`/videos/[category]` 接入 `sitemap.ts` | 5578 条真实内容可被引擎收录；同时避免「注释说占位、实际有内容」的认知错位 |
| **P1** | **补 `/admin` 与高频路由的 loading / error 边界** | 现状 78 页 vs 10 个 loading / 7 个 error。优先给 `sitelist`、`plugins`、`data/restore` 这三个最重的页面加骨架 | 慢加载后台不再白屏；错误不再冒泡到全局 |
| **P1** | **给 `email` / `push` 通知渠道做外发适配器，或显式降级为 inapp** | 二选一：接 SMTP/推送服务商；或在写入层拒绝非 inapp 渠道并写明原因 | 消除「入队了但永远不投递」的静默失败 |
| **P2** | **决定是否做注册/找回密码** | 若要开放注册：加 `/auth/signup` + 邮箱验证 + 找回密码，并同步 `identity` 归属与 `data-inventory` 登记；若定位是「单管理员 + GitHub 登录」，在文档里写死这个定位 | 消除当前「只有登录没有注册」的语义空白 |
| **P2** | **多语言与商业化** | 二者都尚未开始。i18n 需要引入 `next-intl` 并改造 78 个页面的文案；商业化需要配额→计费→支付整条链 | 属于产品方向决策，不是技术缺口 |
| **P2** | **补齐路由级可访问性与 E2E 覆盖** | 现有 23 个 E2E spec 主要覆盖 admin 与前台主干；`/videos`、`/marketplace/publish`、`/preferences` 尚无对应 spec | 与既有 a11y 门禁同口径 |

---

## 6. 整体完成度

**按代码事实判断：核心产品功能已完整落地，处于「功能齐备 + 多线并行收尾」阶段，估计完成度约 85%。**

支撑这个判断的事实：

- **已完成**：78 个前台/后台页面、271 个后端端点、45 个 BFF 路由、250 个组件全部有真实实现；数据库 69 张表装了真实数据（1020 站点 / 1080 标签 / 77 插件 / 5578 视频条目）；全仓只剩 **2 处 TODO**，且无一处在核心链路上；816 次提交、近 30 天零空档（10-28 当天 86 次）。
- **未完成的部分**：不是「没做」，而是**「做了但还没提交」**（约 250 个代码文件、7 条并行线）与**「做了但产品决策未定」**（注册、i18n、计费、邮件外发）。
- **真正的缺口只有 4 类**：账号自助（注册/找回）、多语言、商业化、通知外发渠道。

**最大的风险不是功能缺失，而是未提交改动的堆积**：389 个文件里 7 条线并行，任何一条线落地时都可能与另一条线在同一个共享文件（`server.ts`、`repository.ts`、`hub-route-policy.generated.ts`、`rest-contracts.generated.ts`）上冲突。建议优先执行 P0 的收口。

---

## 附录：本次扫描用到的判据命令

```bash
# 页面与路由
find apps/web/src/app -name "page.tsx" | wc -l
find apps/web/src/app/api -name "route.ts" | wc -l
# 后端端点（解析路由注册）
#   python 正则 (?:app|router)\.(get|post|put|patch|delete)\(\s*['\"`]([^'\"`]+)
# 数据量
sqlite3 data/navhub.db "SELECT name FROM sqlite_master WHERE type='table'"
# TODO
grep -rniE "\bTODO\b|\bFIXME\b" apps packages scripts --include=*.ts --include=*.tsx --include=*.mjs
# 代码规模
find <dir> -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.mjs" \) | xargs wc -l
```

---

## 7. 附录：扫描后的收口执行（2026-10-28 23:53 – 00:55）

扫描给出 P0「收口 7 条并行线」。执行前先做活性判定：**无 node 进程，最近落盘
21:30（视频线），停摆约 2.5 小时**，因此按依赖闭包逐条切分提交。

### 7.1 本轮 14 个提交

| commit | 切片 | 文件 | 测试 |
|---|---|---|---|
| `5eaee71f` | 搜索通道降级口径 | 3 | 12 |
| `a4bdd8c8` | 通知前端（徽标/收件箱/投递面板） | 11 | 6 |
| `cf9b3327` | 站点品牌资源与设置写入 | 13 | 41 |
| `89a20b42` | Facet 标注就地修订 + 类目停用影响 | 7 | 42 |
| **`2b8a7495`** | **移除客户端硬编码管理员口令 + 守卫** | 3 | 3 |
| `59434a77` | Copilot 前端（流式 + 入口契约） | 13 | 79 |
| `08431ff4` | Copilot 后端（引用校验/流式/用量） | 10 | 38 |
| `c8bb03da` | 候选平替探活 + thinking 配置断链 | 8 | 47 |
| `4aab058e` | B 站高清流解析 + 播放遥测 | 8 | 27 |
| `744cdd1c` | /videos 收录注释更正（不改行为） | 2 | — |
| `d51f6d07` | 存储适配器读缓存分流 + hub 策略契约 | 12 | 23 |
| `6205c721` | 媒体代理（签名+白名单）+ 视频 OG | 2 | — |
| `c983180c` | 导航卡片可达性与健康度表述 | 23 | 64 |
| `8ed8ef58` | 两处 5 秒默认超时造成的假红 | 2 | — |

未提交文件：**389 → 158**（其中约 120 个是 `deliverables/` 产物）。

### 7.2 拦下的真漏洞：客户端硬编码管理员口令

`apps/web-overlay/src/lib/client-auto-auth.ts` 里写死 `username=admin /
password=admin` 并直接 POST `/api/auth/callback/credentials`。它能提权的关键
在服务端：`auth.ts:82` 的 `username = rawUsername || 'admin'`，且
**未配置 `NAVHUB_ADMIN_PASSWORD` 的实例上这段请求会真的成功**
——任意访客点开视频采集控制台即拿到管理员会话。此外口令常量进客户端 bundle
等于公开默认凭证对。已改为「只如实回答当前是否管理员会话」，并加守卫
`client-hardcoded-credentials.test.ts`（3 例，含正反例自证）。

### 7.3 两处对上一轮建议的更正（重要）

| 上一轮建议 | 更正 |
|---|---|
| 删除死代码 `apps/web/src/app/middleware.ts` | **不成立**。该文件 **UNTRACKED**：`apps/web/*` 被 gitignore 且只逐条 negation 放行，上游 vendored 文件根本不在版本控制内，删了也会被 `vendor-web.mjs` 重建。它确实惰性（Next 16 中间件约定在 `src/proxy.ts`，已实现 `/admin` 守卫），但只能记文档、不能删。 |
| 改 `/videos` 收录策略 | **不该由我做**。视频线已在做 `app/videos/sitemap.xml/route.ts`（WIP），抢方向会打架。本次只改那条过期注释，并把**事实**（5578 条真实内容）与**决策**（noindex 的真实理由是外链指向第三方；是否放开取决于 sitemap 路由，二者必须同口径）分开写清。 |

### 7.4 新环境事实：overlay 镜像多为 UNTRACKED

`apps/web/src/**` 里 overlay 的镜像文件（如 `lib/search-degrade.ts`、多数
`components/video-*`）是 **UNTRACKED**——gitignore 只逐条放行少数文件。
闭包工具会报「不在 HEAD，必须加入提交集」，这类**无法入库也无需入库**：
新 checkout 由 `vendor-web.mjs` + `apply-web-overlay` 重建。
**提交集只放 overlay 源 + `apps/web/test` 镜像测试。**

### 7.5 当前基线（实测）

```
apps/api      126 文件 / 1212 例   0 红（全量实跑 2m44s）
apps/web      pre-commit 全绿（含 236 文件前端套件的选测）
```

修 api 那 2 红的方法与仓库既有经验一致：两条报错都是
`Test timed out in 5000ms`，单文件复跑全绿 ⇒ 是超时不是逻辑错，给显式 30s。
