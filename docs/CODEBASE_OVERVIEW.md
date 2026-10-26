# 山羊胡 4.0 代码库架构总览

> 本文基于对仓库 **778 个代码/配置文件（155,150 行）** 的静态扫描与关键模块源码通读写成（扫描时间 2026-10-18 15:35，仓库当时处于活跃改动中），所有数量、路由、表结构、依赖边均来自实际代码，而非 README 转述。逐文件的职责/导出/依赖见 [`CODEBASE_FILE_INDEX.md`](./CODEBASE_FILE_INDEX.md)，也可用可搜索的单页版 [`codebase-index.html`](./codebase-index.html)。

---

## 目录

1. [项目定位与规模](#1-项目定位与规模)
2. [运行时拓扑](#2-运行时拓扑)
3. [包依赖规则](#3-包依赖规则)
4. [五条核心数据流](#4-五条核心数据流)
5. [分层详解](#5-分层详解)
6. [关键设计决策](#6-关键设计决策)
7. [安全体系](#7-安全体系)
8. [工程质量体系](#8-工程质量体系)
9. [文档与实现的一致性核对](#9-文档与实现的一致性核对)
10. [风险清单与改进建议](#10-风险清单与改进建议)
11. [新人阅读路线](#11-新人阅读路线)

---

## 1. 项目定位与规模

山羊胡是一个 **AI 原生网址导航与开发者知识工作台**：以「站点收藏」为数据底座，向外叠加五路混合检索、Bento 自由排版工作台、端侧 0-RTT 微工具、技术关系图谱，并通过 MCP 协议把同一套能力开放给外部 AI Agent。

代码形态是 **pnpm Workspace Monorepo**：4 个后端库（core / store / ai / mcp）+ 1 个 Fastify 服务（api）+ 1 个 Next.js 前端（web，事实源在 web-overlay）+ 2 个端侧扩展 + 21 个工程脚本。

| 模块 | 源文件 | 测试文件 | 源码行数 | 角色 |
| :--- | ---: | ---: | ---: | :--- |
| `packages/core` | 59 | 23 | 11,646 | 纯算法与领域契约，零 IO |
| `packages/store` | 40 | 15 | 8,595 | 双方言存储 + 混合检索引擎 |
| `packages/ai` | 7 | 4 | 1,382 | 本地 embedding、富化、SSRF 防护 |
| `packages/mcp` | 14 | 2 | 1,593 | MCP 工具服务（stdio / HTTP） |
| `apps/api` | 47 | 13 | 8,140 | REST 中枢 + 任务队列 |
| `apps/web-overlay` | 202 | — | 45,689 | 前端**事实源**（自研部分） |
| `apps/web` | 310 | — | 60,287 | 构建运行目录（上游底座 + overlay 回放） |
| `extensions` | 8 | — | 766 | Chrome / Raycast 扩展 |
| `scripts` | 21 | — | 2,431 | vendor、漂移校验、备份、数据治理 |
| **合计** | **708** | **66** | **155,150** | 另含 4 个工程/文档文件；测试占比约 9.2%（14,345 行） |

规模最大的 6 个文件（也是维护成本集中点）：

| 行数 | 文件 | 性质 |
| ---: | :--- | :--- |
| 2,212 | `apps/web-overlay/src/components/algorithm-lab.tsx` | 算法演示工作台（多面板） |
| 2,063 | `apps/web-overlay/src/app/admin/sitelist/page.tsx` | 站点列表管理（CRUD + 批量 + 导入导出） |
| 1,735 | `apps/api/test/api.test.ts` | REST 全链路集成测试 |
| 1,365 | `apps/web-overlay/src/components/home-diy-toolbar.tsx` | DIY 排版工具栏 |
| 1,212 | `apps/web-overlay/src/components/navigation-content.tsx` | 首页主体 |
| 1,212 | `apps/web-overlay/src/lib/modular/use-home-diy.ts` | DIY 状态机 |

---

## 2. 运行时拓扑

三个可独立部署的进程 + 两类外部调用方：

```
┌──────────────────────── 客户端 ────────────────────────┐
│ 浏览器 :3000 · Chrome 扩展 · Raycast 扩展              │
│ AI Agent（Claude Desktop / Cursor / MCP 客户端）       │
└──────────────┬──────────────────────┬──────────────────┘
               │ 同源 /api/hub/*（BFF 代理）   │ MCP stdio / HTTP（Bearer）
               ▼                      ▼
┌──────────────┴──────────────────────┴──────────────────┐
│ Fastify 中枢 :8787                                     │
│ · 28 个路由插件 / 117 个 REST 端点 / OpenAPI           │
│ · AppContext 装配（能力可选、失败不致命）              │
│ · JobRunner（9 类任务 / 6 条默认 cron）                │
│ · 横切：CORS 限流 安全头 请求ID 指标 缓存 鉴权         │
└──────────────┬─────────────────────────────────────────┘
               ▼
┌──────────────┴─────────────────────────────────────────┐
│ @navhub/store · 25 表 / 混合检索 / 向量 / FTS          │
│ @navhub/ai    · embedding / 富化 / SSRF 沙箱           │
│ @navhub/core  · 纯算法与契约（59 文件）                │
└──────────────┬─────────────────────────────────────────┘
               ▼
┌──────────────┴─────────────────────────────────────────┐
│ SQLite(lite) / PostgreSQL(standard)                    │
│ sqlite-vec | pgvector(HNSW)                            │
│ FTS5 | tsvector + GIN                                  │
└────────────────────────────────────────────────────────┘
```

关键点：**前端进程不直接连数据库**，所有数据都经 BFF 代理到中枢；**MCP 与 REST 共用同一个 `AppContext`**，因此网页搜索与 Agent 搜索的结果必然一致。

---

## 3. 包依赖规则

### 3.1 后端依赖图（严格单向，无环）

```
@navhub/mcp                     （可执行：stdio / Streamable HTTP）
├── @navhub/api                 （可执行：Fastify :8787）
│   ├── @navhub/store
│   │   └── @navhub/core
│   ├── @navhub/ai
│   │   └── @navhub/core
│   └── @navhub/core
├── @navhub/store
├── @navhub/ai
└── @navhub/core
```

缩进即依赖层级：子项是父项的直接依赖。核心约束是 **core 不依赖任何 workspace 包**，因此它可以同时被服务端与浏览器复用。

| 包 | 依赖 | 不依赖 | 说明 |
| :--- | :--- | :--- | :--- |
| core | `zod`、`pinyin-pro` | 任何 workspace 包 | 纯函数，可在浏览器直接复用 |
| store | `@navhub/core`、drizzle、better-sqlite3、pg、sqlite-vec | ai / api / mcp | 只管持久化与检索 |
| ai | `@navhub/core`、`@huggingface/transformers` | store / api / mcp | 抓取与推理，不落库 |
| api | core + store + ai、fastify | mcp | 装配上下文、暴露 REST |
| mcp | **api** + core + store + ai、MCP SDK | — | 复用 api 的上下文，避免第二套业务逻辑 |

> `@navhub/mcp` 依赖 `@navhub/api` 是刻意的：MCP 工具直接调用与 REST 相同的仓储与检索函数。代价是 api 不能反向 import mcp，因此 **MCP 的入参 zod 契约被下沉到 `core/src/mcp-schemas.ts`**，REST 的 OpenAPI 也从同一份定义生成——这是全仓唯一的「契约单一事实源」设计。

### 3.2 前端依赖：**故意不依赖 core**

`apps/web/package.json` 中没有任何 `@navhub/*` 依赖。原因是前端需要保持「上游 NavSphere 可 vendor 覆盖」的独立性，无法引用 workspace 包。于是出现一条重要约定：

> 纯算法在 `packages/core` 实现并单测，前端在 `apps/web-overlay/src/lib/` 保留一份**运行时副本**。
> **2026-10-19 起副本不再是手工同步的**：由 `scripts/sync-core-mirrors.mjs` 从 core 生成，
> 并以 `--check` 模式进 `verify.mjs` 与 CI 做字节级守门（清单：`scripts/core-mirrors.json`）。

镜像分三类，全部登记在同一份清单里：

| 类型 | 含义 | 条目 |
| :--- | :--- | :--- |
| `verbatim` | 逐字节镜像，`sync-core-mirrors.mjs` 生成 + `--check` 守门 | 13 个：architecture-recipe / batch-operations / comparison / crdt-sync / dynamic-tool-synthesizer / federated-recommendation / knowledge-graph / prefetch / speculative-prerender / vault / visual-fingerprint / wayback-resolver / webmcp-bridge |
| `adapter` | 前端有意保留浏览器适配层，不自动同步，需人工复核 | `lib/modular/layout-sync.ts`（localStorage 通道层）、`lib/modular/diy-presets.ts`（`diy-layout/` 8 模块的聚合体，结构不同） |
| `external` | 已有独立 parity 守门 | `lib/plugins/plugin-manifest.ts`（`test/plugin-manifest-parity.test.ts`） |

**历史教训（为什么要有 `--check`）**：在引入自动同步前，13 个 verbatim 镜像里有 9 个已经悄悄漂移——
`knowledge-graph` 前端版缺 `computeGraphCentrality`、`visual-fingerprint` 缺 `colorDistance`、
`dynamic-tool-synthesizer` 缺 IP 编码（octal / IPv4-mapped IPv6）防护，全靠 `check:overlay`
（只比 web ↔ overlay，不比 core ↔ 前端副本）根本发现不了。改动算法请只改 core 再跑同步：

```bash
node scripts/sync-core-mirrors.mjs          # 生成 overlay 与 apps/web 两份镜像
node scripts/sync-core-mirrors.mjs --check  # 校验（CI 同款）
node scripts/check-web-overlay.mjs          # 镜像与 vendored 底座一致性
```


---

## 4. 五条核心数据流

### 4.1 检索：五路召回 → RRF 融合 → LinUCB 调权 → personal 微调

```
GET /api/search?q=写代码的AI
        │
        ▼
SearchEngine.search()                       packages/store/src/search.ts
        │
        ├─ exact    LIKE '%q%'（中文精确子串，短查询最可信）
        ├─ fts      FTS5 + CJK 二元分词，BM25 排序
        ├─ pinyin   全拼/首字母（qdjb → 启动脚本）
        ├─ semantic sqlite-vec / pgvector KNN（bge-small-zh 向量）
        └─ personal 点击/收藏/置顶画像加权
        │
        ▼
fuse()  RRF：score = Σ w_c / (60 + rank_c) × coverage 乘子
        │
        ▼
LinUCB  predictArmWeights(context) → 每通道动态权重
        │   context = [长度, CJK 比, 字母比, 拼音似然, 数字比]
        ▼
SearchResult { hits[], tookMs, channels, capability, suggestions }
```

三个设计要点（均可在源码注释中验证）：

1. **RRF 而非分数加权**：BM25、余弦相似度、LIKE 命中数尺度不可比，RRF 只看排名，天然可融合。
2. **coverage 乘子**：多路共同命中的站点被额外加权，这是抑制「语义答非所问」的主要手段。
3. **Query Planner early-exit**：`exact` 命中 ≥ 5 条时跳过 semantic，省一次 ONNX 推理（`earlyExitExactHits` 可关）。

闭环学习：`POST /api/events` 上报 click/favorite → `profile-service` 60s 节流聚合 `user_profiles` → 下一次检索注入 personal 通道；同时 `computeDwellTimeReward`（<1.5s 记 -0.5，复制/收藏记 +2.0）更新 LinUCB 的 A/b 矩阵（γ=0.98 折扣）。

### 4.2 写入与富化：URL → 安全抓取 → LLM 结构化 → 入库 → 建索引 → 审计

```
POST /api/sites/auto { url }
   │
   ├─ ① zod httpUrl 校验（拒绝 javascript:/data:/file:）
   ├─ ② guardedFetch：协议白名单 → DNS 解析 → 真实 IP 网段校验
   │      → 每次重定向重新解析（防 DNS Rebinding / 302 跳内网）
   ├─ ③ metadata.ts：title / og:* / twitter:* / description / icon
   ├─ ④ enrich.ts：LLM 结构化输出（zod 校验 + 一次重试）
   │      无 Key 或失败 → 规则启发式，provenance=heuristic
   ├─ ⑤ repo.createSite()（事务内写 sites + site_tags）
   ├─ ⑥ indexSite()：批量向量化 + 向量表 upsert + embedding 持久化
   │      （FTS / 拼音线索由 Repository 的 create/update 写路径维护）
   │      向量失败只记 capabilities.notes，不影响主写入
   └─ ⑦ repo.audit()：actor / action / target / diff（失败不外抛）
```

`indexSite` 被抽成 `apps/api/src/index-site.ts` 共享函数，供 HTTP 写路径与 JobRunner 的 `refetch_metadata` 复用，避免两份索引逻辑漂移。

### 4.3 前端渲染：SSR 读快照 + CSR 读 REST

```
浏览器 GET /
   │
   ├─ Next Server Component（app/page.tsx, force-dynamic）
   │     └─ getFileContent('navigation.json') ─┐
   │        getFileContent('site.json')       ─┴─ StorageAdapter(http)
   │                                              └─ /api/hub/* 代理 → 中枢 /api/storage
   │     └─ getProcessedData() → <NavigationContent>（SSR 出首屏 HTML）
   │
   └─ 客户端水合后
         ├─ lib/navhub-api.ts → /api/hub/api/search|tags|rank|favorites...
         ├─ 收藏/布局/DIY 状态 → localStorage（含损坏备份与多端 Lamport 合并）
         └─ 实时数据 → SSE（/api/jobs/stream、/api/admin/dashboard/stream）
```

**为什么首页要 `force-dynamic`**：若参与构建期预渲染，`generateMetadata` 的标题会被固化在产物里（源码注释记录了实测事故：库里标题已改，页面 `<title>` 仍是旧值）。

### 4.4 MCP 调用：工具清单 → scope 过滤 → 处理器 → 同一套仓储

```
MCP Client ──initialize/tools/list/tools/call──► mcp-server.ts
                                                     │
                                        ┌────────────┴────────────┐
                                        ▼                         ▼
                              tools.ts（32 个定义）        handlers.ts（按域组装）
                              scope: read 22 / write 9 / admin 1        │
                                                                        ▼
                                            handlers/{sites,catalog,jobs,algorithms,discovery,state-sync,developer-tools}
                                                                        │
                                                                        ▼
                                                      AppContext（与 REST 完全相同的 repo/search/ai）
```

写工具的硬约束（有测试锁定）：权限校验 → 幂等键去重（idempotency 表）→ 审计落库；批量导入默认 `dryRun=true`；数组入参有 `.max()` 上限。

### 4.5 后台任务：cron → 抢占 → 执行 → 事件 → SSE

```
JobRunner.tick()（定时）
   ├─ cronDue(schedule, now) 判断到期
   ├─ 单实例锁：lite=idempotency 持久锁行(TTL 120s) / standard=PG advisory lock
   ├─ claimNextJob() → 执行（9 类任务）
   │     health_check       SSRF 安全抓取 + Weibull 生存分析 → health_checks
   │     refetch_metadata   重抓标题/描述/图标，可选 LLM 富化
   │     recompute_rank     重算 trend_score（时间半衰期，默认每小时）
   │     reindex            重建 FTS / 拼音 / 向量
   │     site_self_healing  坏链诊断 + Wayback 镜像 + 平替建议
   │     token_audit        长期未使用/即将过期的 API Token 巡检
   │     purge_trash        清理超过 N 天的回收站条目
   │     taxonomy_audit     分类/标签健康度审计并生成治理提案
   │     data_retention     rollup / retention（默认 dry-run，不自动删数据）
   ├─ 失败 → 指数退避重试（MAX_JOB_ATTEMPTS=3）→ 超限 failed
   └─ jobEventBus.emit() → GET /api/jobs/stream (SSE) → 后台任务页实时刷新
```

---

## 5. 分层详解

### 5.1 `packages/core`：领域契约与纯算法

59 个源文件按域分组，全部无 IO、无框架依赖：

| 域 | 代表文件 | 作用 |
| :--- | :--- | :--- |
| 检索基础 | `types.ts`、`channels.ts`、`cjk.ts`、`pinyin.ts`、`fusion.ts` | 通道注册表、CJK 二元分词、拼音归一化、RRF 融合 |
| 排序与学习 | `ranking.ts`、`linucb.ts`、`profile.ts` | 半衰期热度、Discounted-LinUCB、画像聚合 |
| 几何与图谱 | `hyperbolic.ts`、`knowledge-graph.ts`、`semantic-clustering.ts` | 双曲距离、HITS 中心度、多跳路径、聚类 |
| 意图与生成 | `speculative-intent.ts`、`comparison.ts`、`architecture-recipe.ts` | Cron/JWT/Curl 解析、A vs B 对比、架构配方 |
| 协同与布局 | `crdt-sync.ts`、`layout-sync.ts`、`diy-layout/*`、`modular.ts` | LWW 操作日志、Lamport 插槽合并、排版算法 |
| 体验增强 | `prefetch.ts`、`speculative-prerender.ts`、`deterministic-favicon.ts`、`keyboard-nav.ts` | 卡尔曼轨迹预取、Speculation Rules、确定性图标 |
| 治理与安全 | `facets.ts`、`taxonomy-governance.ts`、`relations.ts`、`vault.ts`、`health-sentinel.ts` | 分面词表、治理提案、关系类型、E2EE、软 404 检测 |
| 契约 | `mcp-schemas.ts` | 32 个 MCP 工具的 zod 入参 + 元数据（REST/OpenAPI 同源） |

### 5.2 `packages/store`：双方言 + 双索引

**25 张表**（`schema.ts`，只用两库都支持的基础列类型）：

`categories`、`sites`、`tags`、`tag_aliases`、`site_tags`、`site_facets`、`site_relations`、`collections`、`collection_items`、`users`、`sessions`、`api_tokens`、`events`、`health_checks`、`audit_logs`、`jobs`、`idempotency`、`embeddings`、`favorites`、`favorite_folders`、`user_profiles`、`search_history`、`user_vault_sync`、`system_states`、`taxonomy_proposals`

方言差异被收敛到 3 个位置：

| 关注点 | SQLite（lite） | PostgreSQL（standard） |
| :--- | :--- | :--- |
| 驱动 | better-sqlite3（同步） | node-postgres（异步，可选事务连接） |
| 全文 | FTS5 虚拟表 + unicode61 + CJK 二元组 | tsvector + GIN 表达式索引（同分词语料） |
| 向量 | sqlite-vec vec0 表（BigInt 主键、KNN 必带 LIMIT） | pgvector `vector` 列 + HNSW |
| 占位符 | `?` | `$n`（`toPgSql` 转换） |
| 迁移 | 幂等 `CREATE TABLE IF NOT EXISTS` + `migrateColumns` 补列 | 同一份列清单，类型分支 |

`Repository`（798 行）只是 `repository/` 下 24 个模块的装配门面（其中 `records` 是类型、`io` 是执行辅助、`dialect` 是行映射）：`repository/sites.ts`（756 行，最大域）、`categories.ts`、`tags.ts`、`jobs.ts`、`dashboard.ts`、`taxonomy-governance.ts` 等。所有 SQL 都经 `bindSqlite` / `toPgSql`，业务层看不到方言。

数据治理侧还有两个独立模块：`retention.ts`（逐行归档后删除）与 `rollup.ts`（压成日统计后删明细），共用注入式 `RetentionAdapter` 端口，因此方言无关、可用假 adapter 单测。

### 5.3 `packages/ai`：能力可降级

| 文件 | 关键实现 |
| :--- | :--- |
| `embedding.ts` | bge-small-zh-v1.5 惰性加载、HF 镜像 endpoint、LRU + singleflight、Worker 模式与主线程降级、`ready()/stats()/close()` |
| `embedding-worker.ts` | 独立线程推理，Transferable ArrayBuffer 零拷贝回传 |
| `ssrf.ts` | 三层防护：协议白名单 → 解析后 IP 网段 → 重定向逐跳复检 |
| `metadata.ts` | 正则抽取 og/twitter/icon，按抓取器优先级排序并绝对化 URL |
| `enrich.ts` | LLM 结构化输出 + zod 校验 + 一次重试，失败降级 heuristic |
| `with-timeout.ts` | Promise 超时，落地即清定时器 |

### 5.4 `apps/api`：117 个端点 / 28 个插件

| 插件 | 端点数 | 端点 |
| :--- | ---: | :--- |
| `sites.ts` | 7 | GET/POST `/api/sites`、GET/PATCH/DELETE `/api/sites/:id`、POST `/api/sites/bulk`、`/api/sites/batch` |
| `categories.ts` | 9 | `/api/categories` CRUD、`/skos`、`/:id/related`、`/:id/move`、`/merge` |
| `recipes.ts` | 9 | `/api/recipes`、`/comparisons`、`/graph/path`、`/graph/compatibility`、`/graph/centrality`、`/favicon/:id`、`/sites/:id/heal`、`/sites/:id/wayback`、`/sites/cluster` |
| `stats.ts` | 10 | `/api/admin/dashboard/*`（overview/security/search-ai/stream）、`health/trend`、`stats/trends`、`maintenance/*` |
| `jobs.ts` | 8 | `/api/jobs` CRUD、`/:id/cancel`、`/:id/retry`、`/prune`、`/stream`、`/:id/events` |
| `tokens.ts` | 6 | `/api/tokens` CRUD、`/:id/rotate`、`/:id/revoke` |
| `rank.ts` | 6 | `/api/rank/trending`、`/new`、`/similar/:siteId`、`/alternatives/:siteId`、`/search/linucb`、`/rank/federated` |
| `tags.ts` | 7 | `/api/tags`、`/resolve`、`/:id`、`/merge`、`/:id/aliases` |
| `favorites.ts` | 5 | `/api/favorites`、`/favorites/folders` |
| `taxonomy.ts` | 5 | `/api/taxonomy/proposals`、`/audit`、`/:id/apply`、`/:id/dismiss`、`/batch` |
| `health.ts` | 4 | `/api/health`、`/ready`、`/metrics`、`/warmup` |
| `relations.ts` | 4 | `/api/relations/types`、`/sites/:id/relations`、`/sites/:id/graph` |
| `agents.ts` | 3 | `/api/speculation/rules`、`/tools/synthesize`、`/p2p/signal` |
| `crdt.ts` | 3 | `/api/crdt/sync` GET/POST/DELETE |
| `vault.ts` | 3 | `/api/vault/sync` GET/PUT/DELETE |
| `trash.ts` | 3 | `/api/trash`、`/:id/restore`、`/:id` |
| `submissions.ts` | 3 | `/api/submissions` POST/GET、`/:number` PATCH |
| `facets.ts` | 3 | `/api/facets`、`/sites/:id/facets` |
| `search.ts` | 2 | GET/POST `/api/search` |
| `enrich.ts` | 2 | `/api/enrich`、`/api/sites/auto` |
| `collections.ts` | 2 | `/api/collections`、`/:slug` |
| `audit.ts` | 2 | `/api/admin/audit`、`/export` |
| `telemetry.ts` | 2 | `/api/stats`、`/api/events` |
| `history.ts` | 2 | `/api/search-history` |
| `profile.ts` | 2 | `/api/profile` |
| `visual.ts` | 2 | `/api/design/harmony`、`/api/mcp` |
| `navsphere.ts` | 2 | `/api/storage` GET/PUT（JSON 快照兼容层） |
| `identity.ts` | 1 | `/api/users/sync` |
| **合计** | **117** | 另有 `/api/openapi.json`、`/api/docs` 由 `server.ts` 提供 |

横切关注点全部在 `server.ts`（384 行）：`onRoute` 收集 OpenAPI、`onRequest` 做请求 ID + 分级鉴权、`onSend` 做安全头 + 路由级缓存/ETag、`onResponse` 记指标、`setErrorHandler` 兜底。

### 5.5 `packages/mcp`：35 个工具

24 个 read、11 个 write（其中 `run_job` 为 admin 专属，会触发全站扫描）。按域拆在 `handlers/`：

| 域 | 工具 |
| :--- | :--- |
| sites | `search_sites`、`get_site`、`create_site`、`update_site`、`set_status`、`batch_import`、`export_sites`、`health_check`、`refresh_site`、`delete_site` |
| catalog | `list_categories`、`list_tags`、`get_stats`、`get_trending`、`list_collections` |
| plugins | `list_plugins`、`search_plugins`、`install_plugin` |
| jobs | `run_job`、`list_jobs` |
| algorithms | `get_architecture_recipe`、`compare_technologies`、`heal_broken_site`、`find_tech_path`、`analyze_stack_compatibility`、`cluster_sites` |
| discovery | `get_alternatives`、`resolve_wayback` |
| state-sync | `sync_crdt_operations`、`exchange_p2p_mesh` |
| developer-tools | `evaluate_developer_intent`、`analyze_color_harmony`、`get_federated_recommendations`、`compile_speculation_rules`、`synthesize_agent_tool` |

传输：`stdio.ts`（本地进程）、`http-server.ts`（标准 Streamable HTTP，有状态会话 + SSE，默认仅监听 127.0.0.1，必须 Bearer，校验 Origin）。

### 5.6 `apps/web-overlay`：前端事实源

**App Router 路由表**（前台）：

| 路由 | 页面 | 主要组件 |
| :--- | :--- | :--- |
| `/` | 首页 Bento 画布 | `navigation-content.tsx`、`home-diy-toolbar.tsx`、`search-palette.tsx` |
| `/hot` | 热度榜 | 服务端取数 + 客户端切换 |
| `/tags`、`/tags/[slug]` | 标签云 / 标签详情 | — |
| `/collections`、`/collections/[slug]` | 专题列表 / 详情 | — |
| `/site/[id]` | 站点详情 | `site-peek-dialog.tsx`、`ecosystem-graph.tsx` |
| `/favorites` | 我的收藏 | `hooks/useFavorites.ts`、`batch-operation-dock.tsx` |
| `/preferences` | 偏好与画像 | `density-*`、`profile-view.ts` |
| `/submit`、`/import` | 投稿 / 书签导入 | `submission-form.tsx`、`bookmark-importer.tsx` |
| `/graph`、`/algorithms` | 生态图谱 / 算法实验室 | `ecosystem-graph.tsx`、`algorithm-lab.tsx` |
| `/videos`、`/videos/player` | 视频导航 / 播放 | `video-content.tsx`、`video-player-page.tsx` |
| `/custom` | 自定义工作区 | `workspace-filter.tsx` |
| `/auth/signin` | 登录 | `signin-failure.ts` |
| `/admin/*` | 16 个后台路由页 | `AdminLayoutClient`、`sitelist/page.tsx` 等 |

**模块化工作台（Bento-Flow）三层**：

1. `lib/modular/registry.ts` — 15 个内置模块的元数据（尺寸约束、分类、配置 schema）与组件映射。
2. `lib/modular/use-modular-layout.ts` — 面板/模块的增删改排、持久化、损坏恢复。
3. `components/modular/*` — 画布、模块容器、错误边界、配置弹窗。

**DIY 排版状态机**（`lib/modular/use-home-diy.ts`，1212 行）是最复杂的前端逻辑：共享快照订阅、提交/撤销/重做、跨标签页 Lamport 合并、存储失败分类、损坏数据备份。它的所有纯算法都在 `lib/modular/diy-presets.ts`（768 行，core 镜像）。

**BFF 代理**（`app/api/hub/[...path]/route.ts` + `lib/hub-proxy.ts`）承担 6 件事：运行时解析中枢地址、透传白名单头、会话委托注入凭据、身份 HMAC 签名、流式/二进制透传、超时区分 504/502。

---

## 6. 关键设计决策

| # | 决策 | 为什么（源码可验证） |
| :--- | :--- | :--- |
| 1 | 只替换 `getFileContent` / `commitFile` 两个函数，不改 69 处调用点 | NavSphere 全站持久化只经过这两个函数；替换实现即可整体切到数据库，前端业务代码零改动，也便于跟进上游 |
| 2 | 前端保留算法副本而不依赖 core | 前端必须能独立 vendor 上游，workspace 依赖会破坏这条流水线 |
| 3 | RRF 融合而非分数加权 | 异构通道分数尺度不可比；RRF 只看排名，无需调参 |
| 4 | 能力可选、失败不致命 | 缺模型/缺 Key 时服务仍可用，只在 `/api/health` 如实上报 `capabilities` |
| 5 | OpenAPI 从路由表生成 | 手写清单必然漂移，`onRoute` 收集保证文档与真实路由同源 |
| 6 | 鉴权默认关闭 | 个人/NAS 部署零配置可用；公开部署显式开 `NAVHUB_AUTH_REQUIRED` |
| 7 | 身份 HMAC 与鉴权解耦 | 即便开放模式，只要配了 `NAVHUB_IDENTITY_SECRET`，带身份的请求必须签名，否则可自称任意用户 |
| 8 | 降级必须「如实说」 | 多个纯函数模块（`degrade.ts`、`hub-health.ts`、`offline-banner.ts`、`profile-view.ts`）专门把「失败」与「空」分开，禁止用 `?? 50` 编数据 |
| 9 | 损坏数据先备份再回退 | 收藏/布局的解析失败若直接回退默认值，下一次写盘会覆盖用户原数据；因此先备份再降级 |
| 10 | 审计失败不外抛 | `audit_logs` 写失败不得把已成功的写操作变成 500 |

---

## 7. 安全体系

| 层 | 机制 | 实现位置 |
| :--- | :--- | :--- |
| 传输/头 | CORS 白名单、300/min 限流、nosniff、SAMEORIGIN、Referrer-Policy、Permissions-Policy、HTTPS 时下发 HSTS | `server.ts` onSend |
| 鉴权 | Bearer token + scope 分级（read<write<admin）+ bootstrap/session 特权 + 失败审计（10s 节流、不记录凭据） | `auth.ts` + `server.ts` onRequest |
| 身份 | HMAC-SHA256(secret, identity)，恒定时间比较 | `identity-signature.ts`（中枢）/ `lib/identity-signature.ts`（代理） |
| 出站抓取 | 协议白名单 → DNS 解析后 IP 网段 → 重定向逐跳复检；拒绝 `127/8`、`10/8`、`172.16/12`、`192.168/16`、`169.254/16`、IPv6 映射 | `ai/src/ssrf.ts`、`lib/ssrf-guard.ts` |
| 渲染 XSS | 入库 `httpUrl` schema + 渲染期 `safeHref/safeSrc` 双重防护；扩展用 `textContent` 渲染 | `lib/safe-url.ts`、扩展 `popup.js` |
| 数据隐私 | WebCrypto AES-GCM + PBKDF2(100k) 客户端加密，服务端只存密文 | `lib/vault.ts` + `routes/vault.ts` |
| 输入边界 | zod 校验 + 数组 `.max()` 上限 + bodyLimit 4MB + 分页参数夹紧 | `routes/*`、`mcp-schemas.ts` |
| 审计 | 所有写操作 + 鉴权失败落 `audit_logs`，支持导出 | `repository/events.ts` |

---

## 8. 工程质量体系

- **单元/集成测试 66 个文件、14,345 行**：core 23、store 15、api 13、ai 4、mcp 2、e2e 9。
- **测试取向是「防回归」而非「覆盖率」**：几乎每个测试文件头部都写明「修的是什么缺陷」以及「去掉修复后哪个断言会失败」（非空性验证）。
- **真实依赖优先**：`jobs.test.ts` 跑真实 SQLite 与真实 tick；`mcp-http.test.ts` 用真实端口；`pg-dialect.e2e.test.ts` 连真实 PG，未配置则整套 skip。
- **验证流水线**：`pnpm verify`（类型 + overlay 一致性 + 扩展校验 + 单测）→ `pnpm lint` → `playwright test`。
- **Git 门禁**：`scripts/install-git-hooks.mjs` 安装 pre-commit，拦截 overlay 未同步与扩展配置错误。

---

## 9. 文档与实现的一致性核对

扫描中发现 README/wiki 与实际代码存在若干数字漂移，建议以代码为准更新文档：

| 文档说法 | 实际代码 | 位置 |
| :--- | :--- | :--- |
| 「62 条 REST 路由」 | **117 个端点**（28 个路由插件） | `README.md`、`wiki.md` §2.2 |
| MCP「15 个 / 17 个工具」 | **32 个**（22 read / 9 write / 1 admin） | `README.md`、`wiki.md` §7 |
| 「19 张核心表」 | **25 张** | `wiki.md` §5.2 |
| 「洛伦兹双曲超曲面 / 闵可夫斯基内积」 | 实现为**庞加莱球模型**（`poincareDistance`、`mobiusAdd`、`expMap0`）；两者数学等价但术语不一致 | `README.md` §5 vs `core/src/hyperbolic.ts` |
| 「web 与 web-overlay 保持 100% 同步」 | 当前确实一致（272 个文件通过 `check:overlay`），但这是脚本强制的结果；扫描期间曾观测到 74 个漂移 + 25 个缺失，说明机制脆弱 | `wiki.md` §3.1 |
| 「24 个路由插件」 | **28 个**（`server.ts` 的 register 调用） | `server.ts` 头注释 |

---

## 10. 风险清单与改进建议

按影响排序，均来自实测：

### P0 — 双目录同步机制（当前一致，但极易再次漂移）

`node scripts/check-web-overlay.mjs` 当前通过（272 个覆盖层文件与 `apps/web` 一致），但本次扫描过程中曾实测到 **74 个漂移 + 25 个缺失**，几分钟后由外部同步收敛。这说明：

- 影响：Docker 构建与 `vendor-web` 以 overlay 为准，一旦漂移，**部分自研改动不会进入镜像**；反向漂移则会让本地开发看不到已部署的逻辑。
- 根因：同一份代码存在两个物理副本（`apps/web` 与 `apps/web-overlay`），同步完全依赖人工执行脚本。
- 处置：把 `check:overlay` 设为 CI 必过项与 pre-commit 钩子（`install-git-hooks.mjs` 已具备能力，需确认实际启用）；长期考虑以构建期注入替代双副本。

### P1 — 算法双份维护

14 个纯算法在 core 与前端各一份，无自动校验。建议：

- 短期：在 `check:overlay` 旁增加 `check:algo-parity`，对镜像文件做 AST/哈希比对；
- 长期：把 core 编译为独立 ESM 产物，前端以 npm 包或构建期注入方式引用，消除手工副本。

### P1 — 巨型文件

`algorithm-lab.tsx`（2212）、`sitelist/page.tsx`（2063）、`home-diy-toolbar.tsx`（1365）、`navigation-content.tsx`（1212）。这些文件把「取数 + 状态 + 布局 + 交互」混在一起，改动风险高。建议按「容器 / 视图 / hooks / 纯函数」四层拆分，纯逻辑先下沉到 `lib/`（已有成功先例：`diy-presets.ts`、`latest-request.ts`）。

### P2 — 后台双份实现

`apps/web/src/app/admin/navigation/**`（6 页 + 7 组件）与 overlay 的 `admin/sitelist`、`admin/categories` 并存，是上游遗留后台与新后台两套入口。建议明确「新后台为准」，旧入口加跳转或下线。

### P2 — 默认 CI 不覆盖 PostgreSQL

`pg-dialect.e2e.test.ts` 与 `rollup-pg.e2e.test.ts` 在未设置 `NAVHUB_TEST_DATABASE_URL` 时整套 skip，standard 模式的 SQL 回归依赖 CI 的 `test-postgres` job。建议在合并前强制跑该 job。

### P3 — 死代码与占位文件

- `apps/web/src/components/NavigationToggleButton.tsx`（1 行空文件）
- `apps/web/src/app/components/*` 与 `apps/web/src/components/Navigation*.tsx` 为旧版遗留，与 overlay 新版组件重复
- `apps/web-overlay/src/lib/session.ts` 是刻意置空的模块（iron-session 已移除），需保留注释避免误删

### P3 — 中间件位置

Next 只识别 `src/middleware.ts`。`apps/web/src/app/middleware.ts` 不会生效；overlay 已提供正确的 `src/middleware.ts` 但未同步到 `apps/web`。当前管理面仍有 `admin/layout.tsx` 的服务端会话校验兜底，但中间件这层纵深实际缺失。

---

## 11. 新人阅读路线

**第一天：跑起来 + 建立地图**

1. `README.md` 快速开始（`pnpm install` → `seed` → `dev` / `dev:web`）
2. `apps/api/src/main.ts`（12 行）→ `context.ts`（172 行）→ `server.ts`（384 行）
3. `apps/web-overlay/src/app/page.tsx`（61 行）→ `components/navigation-content.tsx`

**第二天：搞懂检索与存储**

1. `packages/core/src/fusion.ts` → `linucb.ts`
2. `packages/store/src/search.ts` → `repository.ts` → `schema.ts`
3. `packages/store/src/vector/{types,sqlite-vec,codec}.ts`

**第三天：搞懂写入链路与安全**

1. `apps/api/src/routes/enrich.ts` → `index-site.ts`
2. `packages/ai/src/ssrf.ts` → `enrich.ts`
3. `apps/api/src/auth.ts` + `identity-signature.ts`

**第四天：前端工作台**

1. `lib/modular/registry.ts` → `use-modular-layout.ts`
2. `lib/modular/use-home-diy.ts` → `diy-presets.ts`
3. `app/api/hub/[...path]/route.ts` + `lib/hub-proxy.ts`

**第五天：对外能力**

1. `packages/mcp/src/tools.ts` → `handlers.ts` → `handlers/sites.ts`
2. `packages/mcp/src/http-server.ts`
3. `scripts/vendor-web.mjs` + `check-web-overlay.mjs`（理解前端双目录）

**改动前的三条硬规则**

1. 纯算法先进 `packages/core` 并补单测，再同步前端副本。
2. 前端改动先改 `apps/web-overlay`，再 `sync` 回 `apps/web`（否则镜像构建丢改动）。
3. 新增路由必须声明 `config.scope`（public/read/write/admin），否则默认 public 且 OpenAPI 文档会标错。
