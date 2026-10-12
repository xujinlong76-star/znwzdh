# NavHub 网址导航功能增强开发方案

> 版本：v1.0（2026-10-13）
> 范围：在现有 NavHub 代码库基础上，设计「更先进的网址导航功能」开发方案
> 原则：**先研究后设计、复用优先、接缝不动、降级路径不破、每阶段可验收**

---

## 一、现有代码库研究结论

### 1.1 仓库结构（pnpm monorepo）

| 模块 | 职责 | 关键文件 |
| --- | --- | --- |
| `apps/api` | Fastify 中枢：REST + NavSphere 兼容存储 API + 种子数据 | `src/server.ts`（路由）、`src/storage.ts`（兼容层）、`src/repository` 注入见 `src/context.ts` |
| `apps/web` | Next.js 15 前端（派生自 NavSphere，MIT） | `src/app/page.tsx`（首页 SSR）、`src/lib/github.ts`（存储门面）、`src/lib/storage-adapter.ts`（接缝）、`src/components/search-bar.tsx` |
| `packages/core` | 领域模型 / CJK 分词 / 拼音 / RRF 融合 / 个性化通道 | `src/types.ts`、`src/fusion.ts`、`src/cjk.ts`、`src/pinyin.ts` |
| `packages/store` | Drizzle schema + 双驱动（sqlite\|pg）+ 向量 + FTS | `src/schema.ts`、`src/driver.ts`（手写幂等 DDL×2）、`src/repository.ts`、`src/search.ts` |
| `packages/ai` | 本地 ONNX embedding + SSRF 安全抓取 + LLM/启发式富化 | `src/embedding.ts`、`src/ssrf.ts`、`src/metadata.ts`、`src/enrich.ts` |
| `packages/mcp` | MCP Server（stdio + HTTP），10 个工具 | `src/tools.ts`（schema + scope）、`src/handlers.ts`（实现 + 幂等 + 审计） |
| `docker/` | lite（SQLite 单容器）/ standard（PG + pgvector）双 profile | `docker-compose.yml`、`Dockerfile.api`、`Dockerfile.web` |

### 1.2 已有能力分级（这是方案的出发点）

**🟢 完整可用（直接复用）**

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 四通道混合检索 + RRF 融合 + coverage 加权 | `packages/store/src/search.ts`、`packages/core/src/fusion.ts` | exact / fts / pinyin / semantic，带 `contributions` 可解释性 |
| 个性化**通道**（非事后加成） | `fusion.ts` 的 `personalCandidates` | 权重 0.3，低于相关性通道 0.9~1.4——这是被实测教训校正过的设计，**必须保留** |
| CJK 二元分词 + FTS5 BM25 | `packages/core/src/cjk.ts` | 「启动」可命中「启动脚本」 |
| 拼音全拼/首字母 | `packages/core/src/pinyin.ts` | `zgtqw` → 中国天气网 |
| 本地中文向量（bge-small-zh，24MB，离线） | `packages/ai/src/embedding.ts` | 语义 9/9 命中（见验收报告） |
| SSRF 防护抓取 | `packages/ai/src/ssrf.ts` | 协议白名单 + DNS 后校验 + 重定向逐跳校验 |
| LLM 富化 + 启发式降级 | `packages/ai/src/enrich.ts` | `provenance: llm\|heuristic` 如实标注 |
| 元数据抽取（og/twitter/description/favicon） | `packages/ai/src/metadata.ts` | 零依赖正则实现 |
| MCP 10 工具（scope / 幂等 / dryRun 默认 / 审计） | `packages/mcp` | Agent 可读写导航库 |
| NavSphere 存储接缝（69 处调用点零改动） | `apps/web/src/lib/storage-adapter.ts`、`apps/api/src/storage.ts` | http / github / sqlite 三后端 |
| 双驱动 schema 与方言适配 | `packages/store/src/driver.ts`、`repository.ts` | PG 列名小写归一化、布尔字面量、group_concat/string_agg 分支 |
| 后台 CRUD + 拖拽排序 + 投稿审核 + JSON 编辑器 | `apps/web/src/app/admin/**` | 派生自 NavSphere |
| 事件 / 审计 / 幂等 / 健康度表 | `schema.ts` 的 `events`/`audit_logs`/`idempotency`/`health_checks` | 写操作全部落审计 |
| 测试体系：117 用例 + 真实 HTTP 端到端 + 验收报告 | 各包 `test/`、`docs/acceptance-report.md` | 含「先写错被测试推翻」的真实缺陷记录 |

**🟡 半成品（数据层在，接口/界面缺失）**

| 能力 | 现状 | 缺口 |
| --- | --- | --- |
| 精选专题 collections | `collections` / `collection_items` 表已定义（topic/geo/roadmap） | 无 REST 端点、无前端页面、无 MCP 工具 |
| 行为事件 events | 只记录 `search` / `enrich` 两类 | 无 `click` / `favorite` / `visit`；无聚合 |
| 排序权重 weight | `sites.weight` 字段存在 | **无任何写入方**，browse 排序实际退化为 featured + sort |
| 健康巡检 | `health_checks` 表 + MCP `health_check` 工具（被动触发） | 无定时任务；`jobs` 表只被当 KV 用（存 site-config），无 runner |
| 站点截图 | `sites.screenshot_key` 字段存在 | 无截图服务 |
| 站点详情 | `getSite` 支持 id/URL 查询 | 无前端详情页 |

**🔴 完全缺失（本方案主体）**

1. **前端未接入后端检索引擎**——首页搜索是 `navigation-content.tsx` 里的客户端 `includes()` 子串过滤，拼音/语义/个性化/BM25 全部闲置，⌘K 面板名不副实。
2. **终端用户体系**——`users` 表仅服务管理员登录（next-auth GitHub OAuth），无普通用户身份。
3. **收藏夹**——无任何用户级收藏存储（无表、无 API、无 UI）。
4. **标签浏览**——tags 可被搜索 API 过滤，但无标签云、标签页、标签管理。
5. **推荐/热度排序**——无 trending / 新品 / 个性化推荐列表。
6. **自动抓取的持续性**—— enrichment 只在创建时触发一次，无定时刷新失效元数据。
7. **搜索历史与数据看板**——无历史记录、无 top 查询/零结果查询分析。
8. **`apps/api/package.json` 声明了 `migrate` 脚本但 `src/migrate.ts` 不存在**（`pnpm --filter @navhub/api migrate` 会直接失败）——schema 演进缺基础设施。

### 1.3 研究过程中发现的三个具体缺陷（方案内含对策）

| # | 缺陷 | 证据 | 后果 |
| --- | --- | --- | --- |
| D1 | `writeNavigationData` 采用「全量对齐」语义：快照中未出现的站点/类目一律删除 | `apps/api/src/storage.ts:182-187` | 经 API/MCP 新增的站点，会被前端后台保存 navigation.json 时**静默删除**（数据丢失） |
| D2 | `sites.weight` 无写入方 | 全仓无 `weight =` 更新语句（`repository.ts` 无对应方法） | 浏览排序恒定不变，「推荐排序」需求无地基 |
| D3 | 前端搜索与后端检索引擎双轨 | `navigation-content.tsx:42-67` vs `packages/store/src/search.ts` | 最强能力（语义/拼音/个性化）对终端用户不可见 |

---

## 二、功能需求分析

按「用户点名需求 + 研究发现的必要补充」组织。优先级：P0 = 立即做，P1 = 第二阶段，P2 = 第三阶段，P3 = 持续演进。

### 2.1 分类管理增强（P1）

**需求**：多级分类、分类的改/删/移动、批量重排、分类合并、分类图标与描述管理。

**现状**：数据库层已支持 N 级（`categories.anchor` 物化路径 + `parent_id`），`repository.ts` 已有 `updateCategory` / `deleteCategory`，但 **`server.ts` 只有 `POST /api/categories`，没有 PATCH/DELETE/移动/合并路由**；前端后台只有新增表单（`AddCategoryForm.tsx`）。

**目标形态**：

- `PATCH /api/categories/:id`（改名/换图标/改描述/启用停用/调序）
- `DELETE /api/categories/:id`（级联策略：站点移入「未分类」而非级联删除——修正现有 `deleteCategory` 会删掉站点的问题）
- `POST /api/categories/:id/move`（更换父类，同步维护 `anchor` 及其**全部后代**的 anchor 前缀）
- `POST /api/categories/merge`（源类目站点并入目标类目后删源类目，走审计）
- 前端 `/admin/categories` 树形管理页（拖拽用现成的 `@hello-pangea/dnd`）

**约束提示**：NavSphere 线格式只表达两级（category → subCategory → item），`buildNavigationData` 也只输出两级。**更深层级通过新 API 暴露给新 UI，但兼容快照仍保持两级**——这是字节级兼容契约的边界，文档需明示。

### 2.2 搜索与筛选（P0，最高优先级）

**需求**：前端接入混合检索；多维筛选（分类/标签/状态）；搜索历史与建议；结果可解释；拼音与语义可用。

**现状**：`POST/GET /api/search` 已完整实现（zod coerce 处理 GET query string 的坑已解决），但前端完全没用。

**目标形态**：

- **SearchPalette 组件**（替代 `search-bar.tsx` 的纯客户端过滤）：
  - 输入防抖 200ms + `AbortController` 取消在途请求 + 结果按 query 缓存（TanStack Query，`apps/web` 已依赖 `@tanstack/react-query`）
  - 结果区显示**通道徽标**（exact/fts/pinyin/semantic/personal）与「语义检索不可用」的诚实提示（`channelsUsed` / `semanticAvailable` 已有）
  - ⌘K 聚焦、↑↓ 导航、Enter 新标签页打开（保留现有 `siteConfig.navigation.linkTarget` 逻辑）
  - 空查询走 browse 模式（featured/trend/sort），与 API 行为一致
- **筛选器**：分类侧栏（含子类，anchor 前缀已支持）+ 标签 chips + 「仅看可用」开关（`health.ok`）
- **搜索历史**：本地 localStorage 优先；登录后合并到服务端（见 2.4）
- **相似站点**：站点详情页用向量 KNN（`vectors.search`）取 top-N 近邻——零新依赖的「相关推荐」

**验收标准**：搜「写代码的AI」「zgtqw」「天气」在真实浏览器得到与 API 一致的结果；断网/无模型时 UI 明示降级而非白屏。

### 2.3 标签系统（P1）

**需求**：标签云、标签结果页、标签重命名/合并、标签筛选联动。

**现状**：`tags` / `site_tags` 表完整，`SearchEngine.postFilter` 已支持按 slug 或 name 过滤（中文标签可查）；`slugify` 保留中文已修复。77 个标签已在库中。

**目标形态**：

- `GET /api/tags?limit=` → 标签云（name/slug/count，按 count 降序，SQLite 用 `COUNT` + `GROUP BY`，注意双方言）
- `GET /api/tags/:slug/sites` → 标签结果页（复用 `SearchEngine` 的 tag 过滤或直接 repository 查询）
- 管理端：`PATCH /api/tags/:id`（重命名，slug 同步）、`POST /api/tags/merge`
- 前端：`/tags` 云图页（字号映射 count）、站点卡片上的标签 chips（点击即筛）

### 2.4 收藏夹与个人中心（P0 本地版 / P1 云同步版）

**需求**：一键收藏、收藏夹分组、备注、导入导出、多端同步。

**现状**：无。`users` 表仅管理员。

**目标形态**（两阶段，降低风险）：

- **v1（P0，零后端）**：`useFavorites` hook + localStorage；星标按钮挂在站点卡片；JSON 导入导出。**不登录也能用**——这是导航站转化率的关键。
- **v2（P1，云同步）**：登录用户（复用现有 next-auth GitHub OAuth，identity 取 `session.user.email` 或 `id`，upsert 到 `users` 表并扩展 `role: "user"`）：
  - `GET/POST/DELETE /api/favorites`、收藏夹文件夹 CRUD
  - 首次登录合并策略：本地与云端按 `(siteId)` 取并集，`updatedAt` 新者胜；合并后清本地
  - 收藏事件写入 `events`（kind=`favorite`），同时喂给个性化画像（见 2.6）

**数据模型见第四章**。

### 2.5 自动抓取与信息富化增强（P2）

**需求**：定时刷新失效/过时元数据；图标代理与缓存；健康巡检常态化。

**现状**：`enrichUrl` + `guardedFetch` + `extractMetadata` 已完整且安全；`/api/sites/auto` 一步入库；MCP `create_site` 可自动抓取。但全部是**一次性、被动触发**。`jobs` 表结构适合任务队列但无 runner。

**目标形态**：

- **JobRunner**（`apps/api/src/jobs.ts`，新文件）：
  - `enqueue(kind, payload)` + 轮询循环（默认 30s，可配）
  - kind：`health_check`（复用 MCP handlers 中已有逻辑，抽成共享函数）、`refetch_metadata`（刷新 title/description/icon，仅当现有值为空或超过 N 天）、`reindex`（重建向量与拼音线索，模型升级后用）、`recompute_rank`（重算 trend_score）
  - **单实例锁**：SQLite 用 `BEGIN IMMEDIATE` 抢占、PG 用 `pg_try_advisory_lock`，避免多副本重复执行
  - 失败重试沿用 `jobs.attempts` / `jobs.error`；runner 自身故障不影响主服务（try/catch 包裹 + capabilities.notes 上报）
- **图标代理缓存**：`apps/web/src/app/api/favicon/route.ts` 已存在（需确认其实现后复用），补充 `Cache-Control` 与失败回退（`letter-avatar.tsx` 首字母头像已存在，天然兜底）
- **截图**（P3，可选）：`screenshot_key` 字段已在；playwright 体积大，做成**可选 job kind**，默认关闭

**安全红线**：所有新抓取路径**必须**复用 `guardedFetch`（SSRF 防护有测试覆盖，不得旁路）。

### 2.6 推荐排序（P1 公式 / P2 自动化）

**需求**：热度榜、新品榜、个性化推荐；排序可解释。

**现状**：browse 排序 = `featured DESC, weight DESC, sort ASC`，但 weight 恒 0（D2）。`personal` 通道已存在但**信号需要调用方传入**——服务端不产出信号，闭环是断的。

**目标形态**：

- **排序公式**（`packages/core/src/ranking.ts`，新文件，纯函数 + 单测）：
  ```
  trend = 1.0·log1p(visit_7d) + 1.5·log1p(fav_7d) + 0.5·log1p(searchHit_7d) − 0.1·ageDays
  fresh = −createdAt
  ```
  热度是**独立的排序模式**（`GET /api/rank/trending`），**不是**搜索融合后的乘数——RRF 教训（rank1 与 rank8 仅差 11%，任何事后加成都会翻车）必须被继承为团队纪律，写入文档。
- **个性化闭环**：
  1. 前端上报点击/收藏 → `POST /api/events`（已有端点，扩展 kind 白名单）
  2. `packages/core/src/profile.ts`（新文件）：`buildProfile(events)` → `PersonalizationSignals`，**时间衰减（7 天半衰期）**、topCategories top5、topTags top8、visitedSiteIds 最近 50
  3. 聚合结果落 `user_profiles` 表（见第四章），`/api/search` 服务端按 anonId/userId 读取并注入 `personalize` 字段——**调用方无感知，通道权重仍是 0.3**
- **可解释**：`/api/rank/trending` 返回每个站点的 trend 分量（visits/favs/age），前端 tooltip 展示「为什么排这儿」

### 2.7 投稿与审核（P2）

**需求**：投稿统一入口、审核队列、防垃圾。

**现状**：NavSphere 原生 submissions 走 storage 接缝；`sites.status` 已有 `pending`。

**目标形态**：投稿直接创建 `status=pending, source=submission` 的站点；审核队列 = `GET /api/sites?status=pending`（已支持）；MCP `set_status` 已是审核工具；补充：投稿速率限制（`/api/submissions` 走 `@fastify/rate-limit` 已有插件）+ 重复 URL 409（`findSiteByUrl` 已有）。

### 2.8 数据看板与运营（P2）

**需求**：top 查询、零结果查询、热门站点、失效站点、采集趋势。

**现状**：`events` 表有数据无消费；`apps/web/src/app/api/admin/stats/route.ts` 已存在（需对接）。

**目标形态**：`GET /api/admin/stats/trends?days=30`：top 20 查询、零结果查询列表（指导补录）、点击 top 20、health 分布；前端 `/admin/stats` 图表页（`recharts` 已依赖）。

---

## 三、技术架构设计

### 3.1 总体架构（新增组件以虚线标注）

```
┌────────────────────────────────────────────────────────────────────┐
│  apps/web（Next.js 15，App Router，force-dynamic）                  │
│  ┌──────────────┐ ┌───────────────┐ ┌──────────────┐ ┌───────────┐ │
│  │ 首页 SSR(现有)│ │ SearchPalette │ │ /tags /hot   │ │/favorites │ │
│  │ 侧栏+卡片     │ │ (新,P0)       │ │ (新,P1)      │ │(新,P0/P1) │ │
│  └──────┬───────┘ └───────┬───────┘ └──────┬───────┘ └─────┬─────┘ │
│         │   StorageAdapter 接缝(不动)        │ TanStack Query │       │
└─────────┼──────────────────┼────────────────┼───────────────┼──────┘
          │ getFileContent   │ /api/search    │ /api/favorites│
          ▼                  ▼                ▼               ▼
┌────────────────────────────────────────────────────────────────────┐
│  apps/api（Fastify 中枢）                                           │
│  ┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌───────────────┐ │
│  │ search   ││repo      ││enrich    ││storage   ││ favorites(新) │ │
│  │(现有)    ││(现有+扩展)││(现有)    ││(现有)    ││ tags(新)      │ │
│  └────┬─────┘└────┬─────┘└────┬─────┘└────┬─────┘│ rank(新)      │ │
│       │           │           │           │       │ jobs(新,P2)   │ │
│       │      ┌────┴────┐ ┌────┴─────┐     │       └───────┬───────┘ │
│       │      │JobRunner│ │ProfileAgg│     │               │         │
│       │      │(新,P2)  │ │(新,P1)   │     │               │         │
│       │      └────┬────┘ └────┬─────┘     │               │         │
└───────┼───────────┼───────────┼───────────┼───────────────┼─────────┘
        │           │           │           │               │
┌───────▼───────────▼───────────▼───────────▼───────────────▼─────────┐
│  packages/core    现有: CJK/拼音/RRF/个性化通道  新增: ranking/profile │
│  packages/store   现有: 双驱动schema/向量/FTS   新增: 收藏/画像表+migrate│
│  packages/ai      现有: embedding/SSRF/富化     复用: 定时刷新        │
│  packages/mcp     现有: 10工具                 新增: trending等4工具 │
└───────────────────────────────┬────────────────────────────────────┘
                                 ▼
              SQLite + sqlite-vec + FTS5（lite）
              PostgreSQL + pgvector + tsvector（standard）
```

### 3.2 新增组件职责

| 组件 | 位置 | 职责 | 复用 |
| --- | --- | --- | --- |
| SearchPalette | `apps/web/src/components/search-palette.tsx` | 防抖/abort/缓存/键盘导航/通道徽标 | cmdk（已依赖）、TanStack Query（已依赖） |
| ProfileAggregator | `packages/core/src/profile.ts` + `apps/api` 调用 | events → PersonalizationSignals（时间衰减） | `personalCandidates` 消费契约不变 |
| RankingService | `packages/core/src/ranking.ts` | trend/fresh 纯函数公式 | 被 browse 与 `/api/rank/*` 共用 |
| JobRunner | `apps/api/src/jobs.ts` | 任务队列轮询 + 单实例锁 | MCP handlers 的健康巡检逻辑抽共享 |
| migrate | `apps/api/src/migrate.ts`（补建缺失文件） | 幂等列/表迁移，启动时执行 | `PRAGMA table_info` / information_schema |

### 3.3 三条关键数据流

**点击 → 画像（个性化闭环）**：
```
用户点击站点 → POST /api/events {kind:"click", siteId, anonId}
  → events 表（现有）
  → ProfileAggregator 增量更新 user_profiles（debounce 5s 或每 20 次事件）
  → 下次 /api/search 服务端读 user_profiles → personalize 注入 SearchEngine
  → personal 通道(权重0.3)参与 RRF → contributions 可解释
```

**定时任务（自动化）**：
```
JobRunner 轮询 jobs(status='pending')
  → health_check: HEAD/GET 站点 → 写 health_checks + sites.health_* （复用 guardedFetch）
  → refetch_metadata: 超 30 天未刷新 → extractMetadata+enrichUrl → updateSite + 重新索引
  → recompute_rank: 聚合近 7 天 events → 写 sites.trend_score
  → reindex: 重建 fts_tokens/pinyin/向量（模型升级后）
```

**收藏同步**：
```
本地 localStorage ──首次登录合并──▶ /api/favorites（云端）
   ▲                                    │
   └────── 后续读写以云端为准，本地只作离线缓存 ──┘
```

---

## 四、数据模型设计

### 4.1 设计约束（沿用现有约定）

- 只用 SQLite/PG 都支持的基础列类型；布尔用 `integer({mode:"boolean"})`；时间用 `integer` 毫秒时间戳；向量继续放 `embeddings` 表不进主 schema。
- **新表必须在三处同步**：`packages/store/src/schema.ts`（drizzle 定义）、`packages/store/src/driver.ts` 的 `DDL_SQLITE` **和** `DDL_PG`（手写幂等 DDL）、新增 `apps/api/src/migrate.ts`（对已部署库做列/表补齐）。
- PG 注意：未加引号别名折叠为小写（`rawRows` 已归一化，新查询沿用）；布尔字面量 `TRUE`；聚合 `string_agg` vs `group_concat` 分支。

### 4.2 新增表（schema.ts 片段，遵循现有风格）

```ts
/** 用户收藏（云端）。匿名用户先用 localStorage，登录后合并至此 */
export const favorites = sqliteTable("favorites", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  siteId: text("site_id").notNull(),
  folderId: text("folder_id"),
  note: text("note"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
}, (t) => [
  uniqueIndex("favorites_user_site_idx").on(t.userId, t.siteId), // 防重复收藏
  index("favorites_user_idx").on(t.userId),
]);

/** 收藏夹文件夹 */
export const favoriteFolders = sqliteTable("favorite_folders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [index("favorite_folders_user_idx").on(t.userId)]);

/**
 * 个性化画像：由 events 聚合而来，供 /api/search 注入 personalize 信号。
 * 刻意做成「宽表 + JSON 文本列」而不是规范化的偏好表——读取路径每秒都要用，
 * 聚合是批量的，读写频率极度不对称。
 */
export const userProfiles = sqliteTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  /** JSON: string[]  top 分类 id（时间衰减加权，top 5） */
  topCategories: text("top_categories").notNull().default("[]"),
  /** JSON: string[]  top 标签 slug（top 8） */
  topTags: text("top_tags").notNull().default("[]"),
  /** JSON: string[]  最近点击站点 id（最近 50，保序） */
  visitedSiteIds: text("visited_site_ids").notNull().default("[]"),
  /** JSON: string[]  收藏站点 id */
  favoriteSiteIds: text("favorite_site_ids").notNull().default("[]"),
  searchCount: integer("search_count").notNull().default(0),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

/** 搜索历史：匿名存 anonId（localStorage 生成），登录后按 userId 归一 */
export const searchHistory = sqliteTable("search_history", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),   // 匿名 = "anon:" + localStorage uuid
  query: text("query").notNull(),
  resultCount: integer("result_count").notNull().default(0),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [
  index("search_history_user_idx").on(t.userId),
  index("search_history_created_idx").on(t.createdAt),
]);
```

### 4.3 现有表扩展（ALTER，migrate.ts 负责幂等补齐）

| 表 | 新增列 | 用途 |
| --- | --- | --- |
| `sites` | `visit_count INTEGER NOT NULL DEFAULT 0` | 总点击（热度分子） |
| `sites` | `last_visited_at INTEGER` | 新鲜度/排查 |
| `sites` | `trend_score REAL NOT NULL DEFAULT 0` | recompute_rank 产出，browse 排序用 |
| `users` | `email TEXT`、`avatar TEXT`、`source TEXT DEFAULT 'github'` | 终端用户身份；`role` 复用（`admin`/`user`） |

### 4.4 events.kind 取值扩展

`search`（现有）/ `enrich`（现有）/ **`click`** / **`favorite`** / **`unfavorite`** / **`zero_result`**（零结果搜索，指导补录）。
`recordEvent` 已通用，只需在 `POST /api/events` 的 zod schema 加白名单校验（防脏 kind 污染画像聚合）。

### 4.5 与 NavSphere 兼容层的关系

**线格式（`NavSphereNavigationData`）零变更。** 收藏、画像、历史、趋势全部在新表，不进入 navigation.json 快照——这保证 `storage.ts` 的字节级兼容契约不受影响。

**唯一需要修的兼容性缺陷（D1）**：`writeNavigationData` 的全量对齐删除增加来源过滤：

```ts
// 只删除「由前端快照托管」的站点（source='navsphere' 或 null），
// API/MCP/seed/AI 创建的站点（source='api'|'mcp'|'ai'|'seed'|'submission'）不删
for (const s of existingSites) {
  const managed = s.source === null || s.source === "navsphere";
  if (managed && !seenSiteIds.has(s.id)) await ctx.repo.deleteSite(s.id);
}
```

此改动必须配回归测试（先建 AI 站点 → 再写不含它的快照 → 断言仍存在），并更新 `docs/acceptance-report.md`。

---

## 五、前后端模块划分

### 5.1 后端（apps/api + packages）

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `apps/api/src/server.ts` | 扩展 | 新增路由组：`/api/favorites`、`/api/tags`、`/api/rank/*`、`/api/categories/:id`（PATCH/DELETE/move/merge）、`/api/admin/stats/trends`；`/api/search` 增加 `anonId` 参数并服务端注入 personalize |
| `apps/api/src/jobs.ts` | **新建** | enqueue + runner + 单实例锁 + 四种 kind |
| `apps/api/src/migrate.ts` | **新建** | 幂等迁移（补 `package.json` 里已声明的缺失脚本）；`main.ts` 启动时调用 |
| `apps/api/src/main.ts` | 小改 | 启动顺序：migrate → openDb → seed(如空库) → JobRunner(可选开关 `NAVHUB_JOBS_ENABLED`) |
| `packages/store/src/repository.ts` | 扩展 | `updateCategory` 的 anchor 级联更新（move）、`mergeCategories`、`listTags(withCounts)`、`renameTag`、`mergeTags`、`bumpVisit(siteId)`、`topQueries/zeroResultQueries`、`upsertUser`、favorites CRUD、profile 读写 |
| `packages/store/src/schema.ts` + `driver.ts` | 扩展 | 4.2/4.3 的表与列（三处同步） |
| `packages/core/src/ranking.ts` | **新建** | `trendScore(input)` / `freshness(input)` 纯函数 |
| `packages/core/src/profile.ts` | **新建** | `buildProfile(events, now)` → PersonalizationSignals（半衰期 7 天） |
| `packages/mcp/src/tools.ts` + `handlers.ts` | 扩展 | 新工具：`get_trending`（read）、`list_tags`（read）、`refresh_site`（write，入 refetch job）、`run_job`（write，admin scope） |

### 5.2 前端（apps/web）

| 路由/组件 | 动作 | 说明 |
| --- | --- | --- |
| `src/components/search-palette.tsx` | **新建** | 替代 `search-bar.tsx` 的过滤逻辑；保留其 UI 外壳与 ⌘K/ Esc 交互 |
| `src/components/navigation-content.tsx` | 小改 | 搜索态切换为 palette 数据源；非搜索态 SSR 卡片不变 |
| `src/hooks/useFavorites.ts` | **新建** | localStorage v1 → 云同步 v2（同一 hook 内升级） |
| `src/app/tags/page.tsx`、`src/app/tags/[slug]/page.tsx` | **新建** | 标签云 / 标签结果 |
| `src/app/hot/page.tsx` | **新建** | 热度榜 + 新品榜 tabs |
| `src/app/favorites/page.tsx` | **新建** | 我的收藏（分组/备注/导入导出） |
| `src/app/site/[id]/page.tsx` | **新建** | 站点详情 + 相似推荐（向量 KNN） |
| `src/app/admin/categories/page.tsx` | **新建** | 分类树管理（拖拽/合并/移动） |
| `src/app/admin/jobs/page.tsx` | **新建** | 任务队列面板（状态/ attempts/error） |
| `src/app/admin/stats/page.tsx` | 扩展 | 对接 trends API + recharts |
| `src/lib/api.ts` | 扩展 | 新端点的 typed client（对齐现有风格） |

### 5.3 API 契约示例（对齐 server.ts 现有 zod 风格）

```ts
// GET /api/search?q=&limit=&categoryId=&tag=&anonId=&disableSemantic=
// 变化：anonId → 服务端查 user_profiles 自动注入 personalize；调用方无需再传 signals

const favoriteInput = z.object({
  siteId: z.string().min(1),
  folderId: z.string().nullable().optional(),
  note: z.string().max(200).nullable().optional(),
});
// GET    /api/favorites?userId=        → { items: Favorite[] }
// POST   /api/favorites                 → 201（重复收藏返回 200 + existed:true，语义同 create_site）
// DELETE /api/favorites/:id

// GET /api/tags?minCount=1&limit=100   → { tags: [{ name, slug, count }] }
// GET /api/rank/trending?limit=20      → { hits: [{ site, trend: { visits, favs, agePenalty } }] }
// POST /api/categories/:id/move        → { parentId }（anchor 级联）
// POST /api/categories/merge           → { sourceId, targetId }（站点迁移 + 审计）
```

---

## 六、与现有代码的集成方式

### 6.1 复用映射（能用的绝不重写）

| 新功能 | 直接复用 | 集成点 |
| --- | --- | --- |
| SearchPalette | `SearchEngine.search()` + `/api/search` 路由 | 前端 fetch；零后端改动（除 personalize 注入） |
| 相似推荐 | `VectorStore.search(vec, k+1)` | `repo.getSite` 取向量源：`savedEmbeddings()` 已有 |
| 标签云/标签页 | `siteIdsWithTag` 逻辑 + `slugify` | 提为 repository 公开方法 |
| 收藏夹 | `recordEvent` / `audit` / `findSiteByUrl` | 新 repository 方法 + 新路由 |
| 个性化 | `personalCandidates` + `PersonalizationSignals` 契约 | 只新增「信号生产方」（profile.ts），消费方零改动 |
| 定时刷新 | `enrichUrl` / `guardedFetch` / `extractMetadata` | jobs.ts 编排，`updateSite` 后调 `indexSite`（server.ts 已有私有实现，提为共享） |
| 分类管理 | `repository.updateCategory/deleteCategory` | 补路由 + anchor 级联方法 |
| 健康巡检 | MCP `health_check` 的 SQL 与流程 | 抽到 `packages/store` 或 `apps/api/jobs.ts` 共享 |
| 前端 UI | cmdk / TanStack Query / Radix 组件库 / dnd / recharts / next-auth | 全部已在 `apps/web/package.json` |
| 迁移 | `driver.ts` 的 `openDb` 幂等 DDL | migrate.ts 只做「列是否存在」检查与 ALTER |

### 6.2 明确不动的部分（接缝保护）

1. `NavSphereNavigationData` 线格式与 `storage.ts` 的读写语义（除 D1 修复）。
2. `getFileContent` / `commitFile` 两函数签名与 69 处调用点。
3. `SEARCH_CHANNELS` 的五个通道名与权重（个性化 0.3 的教训是实测财产）。
4. `--experimental-strip-types` 兼容语法（禁参数属性/enum/namespace）。
5. `dynamic = "force-dynamic"` 与首页兜底基线数据策略。
6. capabilities 降级上报契约（缺模型/缺 Key 必须如实可见）。

### 6.3 渐进式替换策略（控制爆炸半径）

- **第一步**：SearchPalette 作为 `search-bar.tsx` 的内部替换，props 不变，`navigation-content.tsx` 只改数据来源一行。
- **第二步**：验证稳定后删除客户端过滤代码路径（保留空查询 browse 的 SSR 渲染）。
- **第三步**：才引入搜索历史/建议等增强。
- 收藏夹先 localStorage 上线（无后端风险），云同步作为独立 PR 合入——任一步可回滚。

---

## 七、开发步骤与优先级

> 每个 Phase 的验收标准对齐现有文化：**真实运行 + vitest 用例 + 验收报告更新**，不写「设计意图」当结论。

### Phase 0 — 零风险 Quick Wins（0.5 天）

- [ ] 补 `apps/api/src/migrate.ts`（声明缺失的脚本）+ `main.ts` 启动时调用
- [ ] `PATCH/DELETE /api/categories/:id`（repo 已有方法，只缺路由）；DELETE 改为「站点移入未分类」而非级联删
- [ ] `GET /api/tags`（带 count）
- [ ] `GET /api/collections` + `GET /api/collections/:slug`（表已存在）
- [ ] `POST /api/events` kind 白名单
- [ ] **D1 修复**（全量对齐删除加 source 过滤）+ 回归测试
- **验收**：`pnpm test` 全绿且新增用例；手工 curl 验证 5 个新端点；验收报告补记 D1 缺陷与修复。

### Phase 1 — 前端体验核心（2~3 天，P0 功能主体）

- [ ] SearchPalette（防抖/abort/缓存/⌘K/通道徽标/降级提示）
- [ ] 点击事件上报（kind=click，带 anonId）
- [ ] `/tags` + `/tags/[slug]`
- [ ] 收藏夹 v1（localStorage + 导入导出 + 星标按钮）
- [ ] browse 排序接入 trend_score（此时为 0 也不破坏现有行为）
- **验收**：真实浏览器验证 6 类查询（中文/拼音/首字母/语义/零结果/空查询）；`agent-browser` 截图存档；前端 `navigation-tree.test.ts` 风格补充单测。

### Phase 2 — 用户与个性化闭环（3~4 天）

- [ ] `users` 扩展 + next-auth 登录 upsert（role=user）
- [ ] 云端收藏夹 + 首次登录合并
- [ ] `profile.ts`（时间衰减）+ `user_profiles` 表 + `/api/search` 服务端注入
- [ ] 搜索历史（anonId → 登录合并）
- [ ] 站点详情页 + 相似推荐（KNN）
- **验收**：`buildProfile` 单测（衰减曲线、上限、空事件）；端到端：连续点击 AI 类站点后搜「工具」验证 personal 通道出现在 `channelsUsed` 且权重受限（不翻车——锁定 RRF 教训的测试）。

### Phase 3 — 自动化与排序（3~5 天）

- [ ] JobRunner（单实例锁 + 四 kind）+ `NAVHUB_JOBS_ENABLED` 开关
- [ ] `recompute_rank` → trend_score；`/api/rank/trending|new`
- [ ] 定时健康巡检 + refetch_metadata（默认仅刷新空值/超期字段）
- [ ] `/admin/jobs` + `/admin/stats`（trends：top 查询/零结果/热门）
- **验收**：真实 SQLite 集成测试跑完整 job 生命周期；并发双 runner 验证锁；Docker lite profile 下 `docker compose up` 全链路通过。

### Phase 4 — 生态与增强（持续）

- [ ] MCP 新工具（get_trending / list_tags / refresh_site / run_job）——遵循 tools.ts 的 scope/mutating/审计模式
- [ ] 浏览器扩展增强（现有 `/api/extension/:id` 只更新导航项；增加「当前页一键收藏」需登录态）
- [ ] PWA（manifest + SW 缓存首页静态资源）
- [ ] 投稿统一到 `status=pending, source=submission` + 速率限制
- [ ] 截图服务（可选 job kind，playwright，默认关）
- **验收**：MCP 测试套件扩充（权限/dryRun/幂等模式不变）；PWA Lighthouse ≥ 90。

### 优先级总览

```
P0 搜索接入/收藏夹v1/标签页/点击事件/分类CRUD/D1修复   ← 价值最高、风险最低，先做
P1 用户系统/云收藏/个性化闭环/热度公式/相似推荐
P2 JobRunner/定时刷新/看板/投稿统一/MCP扩展
P3 PWA/截图/扩展增强
```

---

## 八、可复用 vs 新增清单

### 8.1 可复用（约占工作量 60%，这是本方案成本可控的根据）

- 检索引擎全家桶（SearchEngine / fuse / cjk / pinyin / vectors / fts）
- AI 富化与安全抓取（enrichUrl / guardedFetch / extractMetadata / embedding）
- 存储接缝与双驱动（storage-adapter / driver / repository 基础方法）
- MCP 基础设施（scope / idempotency / audit / dryRun）
- 前端基础设施（cmdk / TanStack Query / Radix / dnd / recharts / next-auth / iron-session）
- 运维基础设施（Docker 双 profile / capabilities 降级 / 测试体系）

### 8.2 需要新增

| 类别 | 项 |
| --- | --- |
| 后端文件 | `jobs.ts`、`migrate.ts`、`ranking.ts`(core)、`profile.ts`(core)、`search-palette.tsx`(web)、`useFavorites.ts`(web) |
| 路由 | favorites / tags / rank / categories 管理 / stats.trends / site 详情 |
| 前端页面 | /tags /tags/[slug] /hot /favorites /site/[id] /admin/categories /admin/jobs |
| 数据表 | favorites / favorite_folders / user_profiles / search_history；sites 与 users 的列扩展 |
| MCP 工具 | get_trending / list_tags / refresh_site / run_job |
| 测试 | 每 Phase 对应套件（对齐现有 5 层分层） |

---

## 九、潜在风险与扩展性考虑

### 9.1 风险登记表

| # | 风险 | 等级 | 影响 | 对策 |
| --- | --- | --- | --- | --- |
| R1 | D1：全量对齐误删 API/MCP 创建的站点 | **高** | 数据丢失 | source 过滤 + 回归测试（Phase 0 第一件事） |
| R2 | 新表/新列的双方言 DDL 漂移 | 中 | standard 模式启动失败 | 三处同步（schema/driver×2）+ migrate 幂等 + store 测试双跑 |
| R3 | 前端搜索请求抖动/竞态 | 中 | 结果闪烁、旧结果覆盖新结果 | 防抖 200ms + AbortController + TanStack Query 按 query 缓存 |
| R4 | 个性化过拟合（RRF 教训重演） | 中 | 「越用越搜不到」 | 个性化只走 personal 通道（0.3）；禁止在融合后乘偏好系数——写入代码评审 checklist |
| R5 | JobRunner 多实例重复执行 | 中 | 重复抓取/重复写库 | SQLite `BEGIN IMMEDIATE` / PG advisory lock + 集成测试 |
| R6 | 新抓取路径绕过 SSRF 防护 | **高** | 内网探测 | 所有出网强制 `guardedFetch`；ai 包测试新增网段用例；code review 硬项 |
| R7 | LLM 批量刷新成本 | 低 | 费用/限流 | refetch 默认启发式优先；LLM 仅手动触发或低优先级队列；`provenance` 如实标注 |
| R8 | PG 列名小写/布尔字面量坑在新查询复发 | 中 | 静默 undefined | 新查询一律走 `repository.raw()`（已归一化），禁止裸写 `db.pg.query` |
| R9 | 收藏夹本地→云端合并冲突 | 低 | 用户困惑 | 并集 + updatedAt 新者胜 + 合并结果 toast 明示 |
| R10 | TS strip-only 语法限制在新文件复发 | 低 | 运行时报错 | 沿用「显式字段声明」模式（StorageError 是范本）；CI 跑 `node --experimental-strip-types` 真实启动 |
| R11 | 已有部署缺列（visit_count 等） | 中 | 旧库新代码报错 | migrate.ts 启动时补齐；docs 提示升级前备份 data/ 目录 |
| R12 | Windows 开发环境坑 | 低 | 脚本失败 | 遵循 README「开发须知」：点源执行、ps1 禁中文、allowBuilds 白名单 |

### 9.2 扩展性设计（为下一步留位，不过度设计）

1. **检索通道注册表**：`SEARCH_CHANNELS` 目前是 const 数组，新增通道（如「收藏频率」「协同过滤」）需改 core 导出。建议升级为 `registerChannel()` 注册表 + 默认权重表——P2 实施，改动集中在 `fusion.ts`，消费方（search.ts / MCP）不变。
2. **多租户预留**：`users.role` / `apiTokens.scopes` 已具备权限骨架；租户隔离（tenant_id）**不做**——等出现真实多租需求再加，避免全表改造成本。
3. **向量模型升级通道**：`embeddings` 表已存 `model` + `dim`；`reindex` job 重建；新旧模型并存期按 `model = ?` 过滤检索，升级不停机。
4. **读写分离**：standard 模式下 `Repository` 已按 `Db` 接口编程，未来加只读副本只需在 `AppContext` 注入第二个 `Db` 给统计类查询。
5. **导航源插件化**：`StorageAdapter` 已是接缝，后续可加 `notion` / `browser-import`（HTML 书签导入）/ `rss` 适配器，不动业务代码。
6. **i18n 预留**：`title_en` / `description_en` / `titleEn` 字段已在 schema 与领域模型——英文 UI 是数据就绪度 100%、工时问题，可作 P4 彩蛋。

### 9.3 质量门禁（每个 Phase 强制执行）

- `pnpm test`（现有 117 + 新增）全绿
- `pnpm typecheck` 0 错误
- 真实环境验证（lite 模式端到端；standard 模式跑 `scripts/pg-check.mts`）
- 新端点补 `apps/api/test/api.test.ts` 真实 HTTP 用例
- 降级路径必须测：关 embedding / 关 LLM 后功能仍可用
- 更新 `docs/acceptance-report.md`（实测数字，不写设计意图）

---

## 十、一页总结

| 维度 | 结论 |
| --- | --- |
| 现状 | 检索/富化/MCP/存储接缝/双驱动已完整且经过实测；前端体验、用户体系、收藏夹、标签浏览、推荐排序、定时任务是缺口 |
| 策略 | 接缝不动、复用优先、渐进替换；新能力全部走新端点 + 新表，NavSphere 线格式零变更 |
| 数据 | 新增 4 表（favorites/folders/user_profiles/search_history）+ sites/users 列扩展 + migrate.ts |
| 前端 | SearchPalette 接入混合检索是 P0 最高杠杆；收藏夹 localStorage 先行、云同步第二阶段 |
| 后端 | categories 管理路由、tags/rank/favorites API、jobs runner（单实例锁）、profile 聚合（时间衰减） |
| 纪律 | RRF 个性化只走低权重通道；所有出网过 guardedFetch；双方言差异收敛在 driver/repository；每阶段真实验收 |
| 工作量估算 | Phase 0: 0.5 天；Phase 1: 2~3 天；Phase 2: 3~4 天；Phase 3: 3~5 天；Phase 4: 持续 |
