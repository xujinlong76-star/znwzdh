# 05 · packages/store —— 存储层

> 包名 `@navhub/store`。职责：**Drizzle schema + 双驱动抽象 + Repository + 混合检索引擎 + 向量/全文实现**。
> 设计原则：只用 SQLite 与 PostgreSQL 都原生支持的列类型，方言差异收敛到 `driver.ts`、`vector/`、`fts*.ts` 三处。

## 1. 模块文件清单

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| [index.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/src/index.ts) | 8 | 桶导出 |
| [schema.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/src/schema.ts) | 283 | **19 张表**的 Drizzle 定义（双驱动共享） |
| [driver.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/src/driver.ts) | 436 | `Db` 接口 + 手写幂等 DDL（sqlite/pg 两份）+ `openDb()` |
| [migrate.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/src/migrate.ts) | ~90 | **列级增量迁移**（幂等补列） |
| [repository.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/src/repository.ts) | 1121 | **`Repository` 类**：全部 CRUD + 标签/收藏/画像/任务/审计 |
| [search.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/src/search.ts) | 326 | **`SearchEngine`**：四通道召回 + 过滤 + 融合入口 |
| [fts.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/src/fts.ts) | ~120 | `SqliteFtsStore`（FTS5 虚拟表） |
| [fts-pg.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/src/fts-pg.ts) | ~130 | `PgFtsStore`（tsvector + GIN 表达式索引） |
| [vector/types.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/src/vector/types.ts) | 76 | **`VectorStore` 契约** + `hashSiteId` / `normalize` / blob 转换 |
| [vector/memory.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/src/vector/memory.ts) | ~50 | 内存实现（降级用） |
| [vector/sqlite-vec.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/src/vector/sqlite-vec.ts) | ~140 | `SqliteVecStore`（vec0 虚拟表） |
| [vector/pgvector.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/src/vector/pgvector.ts) | ~130 | `PgVectorStore`（HNSW） |

测试：`test/store.test.ts`（向量双实现一致性 + 真实 SQLite 集成 + 分类管理/收藏/画像/任务/迁移）、`test/dialect.test.ts`（方言差异）。

## 2. 数据库 schema（19 张表）

**设计取舍**：只使用 `integer / real / text / blob`，**不引入方言特定类型**。向量与全文索引由适配器层用虚拟表/扩展对象实现，不放进主 schema。

### 2.1 核心业务表

#### `categories` —— 类目（物化路径）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | |
| `anchor` | TEXT NOT NULL | **物化路径 `"a/b/c"`**——避免「插入子类时父类可能不存在」的循环外键问题 |
| `parent_id` | TEXT | |
| `title` / `title_en` / `description` / `icon` | TEXT | |
| `enabled` | INTEGER(0/1) | 默认 1 |
| `sort` | INTEGER | 默认 0 |
| `source` | TEXT | `navsphere \| api \| ai \| seed`；**`null` 视为前端托管**（兼容旧数据） |
| `created_at` / `updated_at` | INTEGER | 毫秒时间戳 |

索引：`categories_anchor_idx(anchor)`、`categories_parent_idx(parent_id)`

#### `sites` —— 站点（信息最丰富的表）

| 分组 | 列 |
| --- | --- |
| 基础 | `id`(PK)、`url`(UNIQUE)、`title`、`title_en`、`description`、`description_en`、`icon_key`、`screenshot_key` |
| 归属 | `category_id`(NOT NULL)、`sub_category_id` |
| 状态 | `status`（默认 `active`）、`enabled`、`sort`、`weight`、`featured`、`source` |
| **行为统计** | `visit_count`、`last_visited_at`、`trend_score`（`recompute_rank` 重算，浏览排序第二键） |
| **检索线索（写入期预计算）** | `fts_tokens`（CJK 二元分词语料）、`pinyin_full`（如 `qidongjiaoben`）、`pinyin_initials`（如 `qdjb`） |
| 健康度 | `http_status`、`health_ok`、`latency_ms`、`redirect_to`、`health_error`、`last_checked_at` |
| **软删除（回收站）** | `deleted_at`（NULL=正常，非 NULL=删除时刻） |
| 时间 | `created_at`、`updated_at` |

索引：`sites_url_idx`(**部分唯一** `WHERE deleted_at IS NULL`)、`sites_category_idx`、`sites_status_idx`、`sites_pinyin_full_idx`、`sites_pinyin_initials_idx`、`sites_deleted_at_idx`(部分，回收站探针)

> **「写入期预计算、查询期零成本」**是本表的核心设计：拼音与 FTS 语料在 `updateSite` 时算好，检索时直接 `LIKE`/索引命中。

> **软删除（回收站）**：`DELETE /api/sites/:id` 只打 `deleted_at` 戳，行/标签/向量全保留 → 恢复是瞬时的。**`url` 唯一性是部分索引**（`WHERE deleted_at IS NULL`）——否则删完同 URL 站点后无法重新添加，回收站里的旧记录会挡住。索引创建放在 `migrateSiteIndexes()`（必须在列迁移之后，因为旧库还没有 `deleted_at` 列，放 DDL 里会失败）。

#### 标签与关联

| 表 | 列 | 说明 |
| --- | --- | --- |
| `tags` | `id`(PK)、`name`、`slug`(UNIQUE)、`created_at` | 展示名与 slug 分离 |
| `site_tags` | `site_id`、`tag_id` | 关联表，索引在两列各一份 |

#### `collections` / `collection_items` —— 精选专题

`collections`：`id`(PK)、`slug`(UNIQUE)、`title`、`description`、`kind`（默认 `topic`，可 `geo`/`roadmap`）、`icon`、`sort`、`enabled`
`collection_items`：`collection_id`、`site_id`、`sort`、`note`

### 2.2 账号与安全

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `users` | `id`(PK)、`username`(UNIQUE)、`password_hash`、`role`(默认 `admin`)、`email`、`avatar`、`source`(默认 `local`，可 `github`) | 管理员账号 email/avatar 为空 |
| `sessions` | `token`(PK)、`user_id`、`expires_at` | |
| `api_tokens` | `id`(PK)、`name`、`token_hash`(UNIQUE)、`scopes`(默认 `read`，逗号分隔 `read,write,admin`)、`last_used_at`、`expires_at` | **只存哈希，永不落明文** |
| `audit_logs` | `id`(自增 PK)、`actor`、`actor_kind`(默认 `user`)、`action`、`target`、`diff`、`ip`、`created_at` | 索引 `created_at` + `actor` |

### 2.3 行为与运维

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `events` | `id`(自增 PK)、`kind`、`site_id`、`query`、`category_id`、`meta`、`identity`、`created_at` | 索引 kind/site/created + **`identity`**（`events_identity_idx`） |

> **`events.identity`（身份独立列）**：行为归属身份（`userId` / 匿名 `anonId`）原本只藏在 `meta` JSON 里（`{"identity":"..."}`），按 `behaviorEvents` / `deleteBehaviorEvents` 用 `meta LIKE '%"identity":"..."%'` 过滤——**走不了索引、随表增长变慢**。现迁为独立列 + 索引，两处查询改为**等值** `identity = ?`。老库由启动迁移补列（`COLUMN_ALTERS`）并**回填**历史行（`migrateEventIdentity`：SQLite 用 `json_extract` + `json_valid` 守护，PG 用子串提取避免 `::jsonb` 对坏 JSON 抛错）；`recordEvent` 显式收 `identity`，并兼容从 `meta.identity` 提取（既有调用点无需改）。索引不在 DDL 里建——旧库此时还没有 `identity` 列，放 DDL 会 `no such column` 炸整个 exec，故与 `sites_hot_idx` 同理放在 `migrateSiteIndexes()`（列迁移之后）。
| `health_checks` | `id`(自增)、`site_id`、`checked_at`、`ok`、`http_status`、`latency_ms`、`redirect_to`、`error` | 巡检历史 |
| `jobs` | `id`(PK)、`kind`、`payload`、`status`(默认 `pending`)、`attempts`、`error`、`created_at`、`updated_at` | 索引 `status` |
| `idempotency` | `key`(PK)、`response`、`created_at` | **MCP/API 写操作去重** + lite 模式任务锁行 |
| `embeddings` | `site_id`(PK)、`model`、`dim`、`vector`(BLOB)、`updated_at` | **向量存这里而非 sites 表**：lite 用 vec0 虚拟表、standard 用 pgvector，vec0/pgvector 只是它的索引 |

### 2.4 终端用户

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `favorites` | `id`(PK)、`user_id`、`site_id`、`folder_id`、`note`、`created_at`、`updated_at` | **UNIQUE(user_id, site_id)**；匿名先存 localStorage，登录后合并 |
| `favorite_folders` | `id`(PK)、`user_id`、`name`、`sort` | |
| `user_profiles` | `user_id`(PK)、`top_categories`、`top_tags`、`visited_site_ids`、`favorite_site_ids`（均 JSON 文本）、`search_count`、`updated_at` | **宽表 + JSON 文本列**——读取路径每次搜索都用、聚合是批量的，读写频率极度不对称 |
| `identity_aliases` / `identity_merges` | 合并别名（5 跳上限）与幂等凭据 |
| `user_vault_sync` | E2EE 密文（版本冲突 409）|
| `user_workspace_blobs` | 工作区明文（独立表，非 E2EE）|
| `user_settings` / `user_llm_configs` | 画像开关与收藏信号水位 / 个人 LLM 配置（密钥加密信封）|
| `search_history` | `id`(自增 PK)、`user_id`、`query`、`result_count`、`created_at` | append-only；自增主键解决同毫秒多条的稳定排序 |

## 3. 双驱动抽象（driver.ts）

```ts
export type Dialect = "sqlite" | "pg";

export interface Db {
  readonly dialect: Dialect;
  readonly orm: any;            // drizzle 实例（业务查询用）
  readonly sqlite?: SqliteRunner;
  readonly pg?: PgRunner;
  close(): Promise<void>;
}
```

| 函数 | 行为 |
| --- | --- |
| `openDb({dialect, sqlitePath?, databaseUrl?})` | **动态 import** 对应驱动 → 执行幂等 DDL → 挂 drizzle → `migrateColumns()` |
| `DDL = { sqlite, pg }` | 手写幂等 DDL（`CREATE TABLE/INDEX IF NOT EXISTS`） |

**SQLite 路径**：`journal_mode = WAL`（提升并发读）+ `foreign_keys = ON` + `exec(DDL_SQLITE)`
**PG 路径**：`new pg.Pool({connectionString})` + `pool.query(DDL_PG)`

**为什么不用 drizzle 迁移器生成两套 DDL**：schema 只用两种数据库都支持的基础列类型，DDL 本身方言无关，直接手写并保持幂等，**避免维护两套迁移文件的漂移风险**；`drizzle-kit` 仅用于类型生成与离线校验。

### 3.1 方言差异的三个处理点

| 差异 | 处理 |
| --- | --- |
| `enabled` 布尔值 | SQLite 用 `1`，PostgreSQL 用 `TRUE` → `enabledValue(dialect)`（直接写 `= 1` 在 PG 报 `operator does not exist: boolean = integer`） |
| 占位符 | SQLite `?`，PG `$1..$n` → `bindSqlite(params)` / `toPgSql(sql)` |
| **列名大小写** | PG 把未加引号的别名**折叠为小写**（`AS categoryid` 返回 `categoryid`）→ `rawRows()` 统一把列名小写化，读取侧一律用小写属性名 |
| 聚合函数 | `group_concat` (SQLite) vs `string_agg` (PG) → 按 dialect 拼表达式 |
| 布尔参数 | PG 必须 `true/false`，不能传 `0/1` |

## 4. 增量迁移（migrate.ts）

```ts
export interface ColumnAlter { /* 表、列、类型、默认值、方言差异 ... */ }
export const COLUMN_ALTERS: ColumnAlter[] = [ /* ... */ ];

export async function migrateColumns(db): Promise<string[]>   // 返回本次实际补的列
```

- **幂等**：先查 `PRAGMA table_info` / `information_schema.columns` 判断列是否已存在
- 旧库自动补列，`pnpm --filter @navhub/api migrate` 执行
- 加了列后各表数据不受影响——`openDb()` 每次启动都会调用一次

## 5. Repository（repository.ts，1121 行）

`export class Repository`，`constructor(db: Db)`。按功能分组的完整方法清单：

### 5.1 站点

| 方法 | 行为 |
| --- | --- |
| `listSites({categoryId?, status?, limit?})` | 列表（默认 limit 100、上限 1000 防慢查询） |
| `listAllSites(limit?)` | **全量站点，不分页**——仅快照层（`storage.ts`）使用：navigation.json 读/写都要求全量投影，截断会导致写回时误删或主键冲突 |
| `getSite(idOrUrl)` | **支持 id 或 URL** 查详情 |
| `findSiteByUrl(url)` | URL 去重查询 |
| `createSite(input)` / `createSiteWithId(input)` | 创建（后者由调用方指定 id，用于导入/种子）。**同 id 的软删行会被「复活」**（清 `deleted_at` 并覆盖内容）——快照写回用原 id 重建时不主键冲突 |
| `updateSite(id, patch)` | 部分更新——**同时重算 `fts_tokens` / `pinyin_full` / `pinyin_initials`** |
| `deleteSite(id)` | **软删除**：打 `deleted_at` 戳，不动行/site_tags/embeddings |
| `restoreSite(id)` | 恢复：清 `deleted_at`（标签/向量仍在，无需重建索引） |
| `purgeSite(id)` | 永久删除：连带 site_tags / embeddings |
| `getDeletedSite(id)` / `listDeletedSites(limit)` | 回收站读取（只含软删站点，倒序） |
| `reorderSites(order[])` | 拖拽排序批量写 `sort` |
| `setSiteTags(siteId, tagNames[])` | 全量对齐标签关联（自动建 `tags` 行） |
| `updateSiteHealth(siteId, {...})` | 写健康列 + `health_checks` 历史行 |
| `healthCheckSeries(since, limit=5000)` | 取巡检历史原始行（`health_checks` 表）——**按天聚合交给 API 层的 JS**，避开 SQLite/PG 日期函数方言分支 |
| `bumpVisit(siteId)` | `visit_count + 1`，更新 `last_visited_at`（热度原始信号） |
| `setTrendScores(scores[])` | 批量写 `trend_score`（`recompute_rank` 任务用） |

### 5.2 类目

| 方法 | 行为 |
| --- | --- |
| `listCategories()` / `getCategory(id)` | 读取 |
| `createCategory(input)` | 创建，维护 `anchor` |
| `ensureCategory(title, source?)` | **幂等**按标题取或建（种子/富化用） |
| `moveCategory(id, parentId)` | 换父级 → **`anchor` 级联更新** |
| `mergeCategories(sourceId, targetId)` | 源（含后代）站点迁入目标 → 删源子树，返回 `{movedSites, removedCategories}` |
| `updateCategory(id, patch)` | 更新字段 |
| `deleteCategory(id)` | **站点移入「未分类」（不级联删），子类目提升到父级** |

### 5.3 标签

`listTagsWithCounts(minCount=1)`、`renameTag(id, newName)`、`deleteTag(id)` → `{unbound}`（解绑全部站点 + 就地重算受影响站点的 `fts_tokens`/`pinyin_*`）、`mergeTags(sourceId, targetId)` → `{moved}`

### 5.4 收藏夹

`listFavorites(userId)`、`addFavorite({...})` → `{favorite, existed}`（**返回 `existed` 让 API 区分 201/200`）、`removeFavorite(userId, siteId)`、`listFavoriteFolders(userId)`、`createFavoriteFolder(userId, name)`、`deleteFavoriteFolder(userId, folderId)`

### 5.5 行为、画像与搜索历史

| 方法 | 行为 |
| --- | --- |
| `recordEvent(kind, payload)` | 写 `events`（白名单由 API 层控制） |
| `behaviorEvents(identity, since, limit=500)` | 取行为事件（含站点类目与标签） |
| `countSearches(userId)` | 搜索次数 |
| `clickCountsSince(since)` / `favoriteCountsSince(since)` | 返回 `Map<siteId, count>`（热度输入） |
| `getUserProfile(userId)` / `saveUserProfile(userId, profile)` | 画像读写（JSON 列序列化） |
| `deleteUserProfile(userId)` / `deleteBehaviorEvents(identity)` | 画像重置：删画像行 + 按 meta 里的 identity 删 click/favorite 事件（不碰匿名热度统计） |
| `recordSearch(userId, query, resultCount)` | 写 `search_history` |
| `listSearchHistory(userId, limit=10)` / `clearSearchHistory(userId)` | 历史管理 |

### 5.6 向量与统计

`saveEmbedding(siteId, model, vector)`、`savedEmbeddings()`（**进程重启后重建 key→siteId 映射**）、`getEmbedding(siteId)`
`stats()` → `{sites, categories, tags, broken, pending, trashed}`（sites 排除软删；trashed 计回收站）、`hotSites(limit)`、`newestSites(limit)`、`topQueries(days, limit)`、`zeroResultQueries(days, limit)`

### 5.7 任务队列与用户

`enqueueJob(kind, payload)`、`claimNextJob()`、`completeJob(id, error?)`、`listJobs(status?, limit=50)`
`upsertOauthUser(input)`、`getUser(idOrUsername)`
`audit({actor, actorKind?, action, target?, diff?, ip?})`
`listAuditLogs({limit?, offset?, action?, actor?})` → `{items, hasMore}`（倒序 + 多取 1 条探针；`diff` 解析，损坏原样返回）
`listAuditActions(limit=50)` → 出现过的 action 全集（按最新 id 倒序，供过滤下拉）
`listCollections(onlyEnabled=true)`、`getCollectionBySlug(slug)`、`listCollectionSites(slug)`

### 5.8 模块级工具函数

| 函数 | 用途 |
| --- | --- |
| `slugify(input)` | 标题 → slug（标签用） |
| `bindSqlite(params)` | 参数绑定适配 |
| `toPgSql(sqlText)` | `?` → `$1..$n` |

## 6. 混合检索引擎（search.ts）

```ts
export interface SearchEngineDeps {
  db: Db;
  fts: FullTextStore | null;
  vectors: VectorStore | null;
  embed?: ((text: string) => Promise<Float32Array>) | null;
  weights?: FusionWeights;
}
export interface SearchEngineOptions { perChannel?: number }  // 默认 50

export class SearchEngine {
  constructor(deps, opts?)
  get semanticAvailable(): boolean
  async search(q: SearchQuery): Promise<SearchResult>
}
```

### 6.1 检索流程

```ts
async search(q) {
  const pool = Math.max(limit * 3, 60);        // RRF 需要足够的候选池

  // ① 空查询 = 浏览模式：按 featured/weight/sort 出列表，不经过 RRF
  if (!raw) return this.browse(q, limit);

  // ② 四路并行召回（每路 50 条）
  const [exact, ftsHits, pinyin, semantic] = await Promise.all([...]);

  // ③ 个性化作为独立通道（只对已被相关性通道召回的站点施加）
  if (q.personalize && !q.disablePersonal && candidates.length) {
    const sites = await this.loadPersonalizable(recalled);
    candidates.push(...personalCandidates(sites, q.personalize));
  }

  // ④ RRF 融合
  const hits = fuse(candidates, weights, pool);
  return { hits: hits.slice(0, limit), channelsUsed, semanticAvailable, tookMs };
}
```

### 6.2 四路通道实现

| 通道 | 实现 | 解决什么 |
| --- | --- | --- |
| `channelExact` | `LIKE '%q%'` on `title/url/description/pinyin_full/pinyin_initials`，`ORDER BY weight DESC, sort ASC` | **中文子串——必要通道**。搜「天气」时"中国天气网"的精确子串命中比语义近似更可信 |
| `channelFts` | `fts.search(q, perChannel)` → 按 id 回表 → 过滤 | **BM25 相关性排序 + 多词支持**；`catch` 后返回 `[]`（索引损坏不影响整次搜索） |
| `channelPinyin` | 仅当 `looksLikeLatinQuery(q)` 或含 CJK；`pinyin_full LIKE 'q%'` / `pinyin_initials LIKE 'q%'`，精确匹配优先排序 | 「qidong」「qdjb」→ 启动脚本 |
| `channelSemantic` | `embed(q)` → `vectors.search(vec, perChannel)` → 回表过滤，`rawScore = distance` | 「写代码的AI」→ GitHub Copilot；**模型不可用/维度不匹配时静默降级** |

### 6.3 零结果兜底（两级放宽）

四路全空时**不直接返回空白**，按顺序做两级重试（[search.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/src/search.ts#L110-L133)）：

| 级别 | 触发条件 | 放宽动作 | `fallback` 标记 |
| --- | --- | --- | --- |
| 第 1 级 | 原查询带 `categoryId`/`tag` 且过滤后为空 | 去掉过滤重跑四路 | `"filter"` |
| 第 2 级 | 放宽过滤后仍为空 | 拼音前缀→**包含**；英文多词→逐词 OR | `"fuzzy"` |

**为什么是这个顺序**：最常见的「明明有却不显示」是类目过滤太窄（用户在类目内搜索后换了词），第 1 级就该解决；模糊匹配放宽面更大、误召回风险更高，放在最后。

**诚实降级**：命中放宽后，`SearchResult.fallback` 如实标记，前端渲染提示横幅——
「已放宽到全库匹配」/「以下是放宽匹配后的结果」，**不假装这是精确结果**。
有正常结果时该字段缺席，前端无需判断。

> FTS 通道本身已对英文做逐词前缀 OR（`buildFtsQuery`），因此 fuzzy 级别主要在 **FTS 不可用/中文场景**发挥价值——测试特意用 `fts: null` 的引擎验证兜底重试本身，而非搭 FTS 的便车。

### 6.4 分页（offset + hasMore）

| 字段 | 含义 |
| --- | --- |
| `SearchQuery.offset` | 结果偏移，0 = 第一页（zod 上限 1000） |
| `SearchResult.offset` | 回显本次偏移 |
| `SearchResult.hasMore` | **本次召回池内**是否还有余量——**不是全库总数**（每通道各召回 50 条，池子有上限）；叫 `total` 会误导，故用布尔 |

**RRF 侧**：融合是纯函数（同输入同输出）→ 融合结果按 `offset` 切片即可，无需游标。
召回池 `pool = (offset + limit) × 3`，保证覆盖「已取走的 + 本页要展示的」。
翻页间隙底层数据被修改会有轻微漂移——对导航检索可接受，换取免维护游标语义（注释写在 [types.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/types.ts#L239-L251)）。

**浏览侧**（`browse()`）是排行榜而非 RRF：`OFFSET` 直接下推 SQL，并**多取 1 条**作 hasMore 探针（避免 COUNT 往返）。

**防灌水**（API 层）：`offset > 0` 不记 `search` / `zero_result` 事件、不写 `search_history`、不返回 suggestions——翻页是同一次查询的延续，否则加载更多 3 次就把 `topQueries` 计数灌水 3 倍。

### 6.5 通道内过滤 `postFilter(rows, opt)`

| 过滤 | 规则 |
| --- | --- |
| 状态 | 显式 `statuses` 优先；否则默认**排除 `archived`** |
| 分类 | `categoryWithDescendants(categoryId)`——用 `anchor` 物化路径取全部后代 |
| 标签 | `siteIdsWithTag(tag)`——**同时匹配 `slug` 与 `name`**（调用方可能传「天气」这种展示名，只匹配 slug 会查不到） |

> **历史 BUG 记录**（代码注释保留）：`categoryWithDescendants` 曾漏写 `AS categoryid` 别名，导致子类目 id 全是 `undefined`，「父类目包含子类目」在子类目没有直属站点时返回空结果。

### 6.6 浏览模式 `browse()`

排序键：`featured DESC → trend_score DESC → weight DESC → sort ASC`
`trend_score` 由 `recompute_rank` 写入，**为 0 时自然退化为旧行为**，对存量数据零影响。

### 6.7 `rawRows(sql, params)` —— 方言无关查询入口

- SQLite：同步 `prepare().all()`
- PG：`toPgSql()` 转占位符 + 异步 `query()`，**返回列名统一小写化**

## 7. 全文检索

### 7.1 契约

```ts
export interface FullTextStore {
  init(recreate?: boolean): Promise<void> | void;
  upsert(records: ...): Promise<void> | void;   // 写入期
  remove(ids: string[]): Promise<void> | void;
  search(query: string, limit: number): Promise<FtsHit[]>;  // { siteId, score }
}
```

### 7.2 两个实现

| 实现 | 语料 | 索引 | 特点 |
| --- | --- | --- | --- |
| `SqliteFtsStore` | `sites.fts_tokens`（`hanToTokens` 输出） | FTS5 虚拟表 `unicode61` | 查询期用 `buildFtsQuery()` 生成 `MATCH` 表达式 |
| `PgFtsStore` | 同一份 CJK 二元分词语料 | **tsvector + GIN 表达式索引** + `pg_trgm` | `pgTokens(text)` 生成 PG 侧语料 |

> **语料一致**是关键：`standard` 模式的 PostgreSQL 全文通道**仍使用 NavHub 的 CJK 二元分词**，而不是 PG 自带的中文分词——保证两种模式的召回行为一致。

## 8. 向量存储（`vector/`）

### 8.1 契约 `VectorStore`

```ts
export interface VectorStore {
  readonly kind: "sqlite-vec" | "pgvector" | "memory";
  readonly dim: number;
  upsert(records: VectorRecord[]): Promise<void>;   // 幂等
  remove(siteIds: string[]): Promise<void>;
  search(query: Float32Array, limit: number): Promise<VectorMatch[]>;  // limit 必填
  count(): Promise<number>;
  clear(): Promise<void>;
}
export interface VectorMatch { siteId: string; distance: number }  // 余弦距离，0 = 完全相同
export interface VectorRecord { key: number; siteId: string; vector: Float32Array }
```

### 8.2 三个实现

| 实现 | 用途 | 特点 |
| --- | --- | --- |
| `MemoryVectorStore` | **降级兜底**（sqlite-vec/pgvector 加载失败时） | 线性扫描，进程内 |
| `SqliteVecStore` | `lite` 模式 | `vec0` 虚拟表；`init()` 建表，`rehydrate()` 重建 key→siteId 映射 |
| `PgVectorStore` | `standard` 模式 | **HNSW** 索引；`toPgVector(v)` 生成 `'[1,2,...]'::vector` 文本 |

### 8.3 关键工具

| 函数 | 说明 |
| --- | --- |
| `hashSiteId(siteId)` | **FNV-1a 32 位**哈希 → 正整数（避开 0）。用哈希而非自增，保证「同一 siteId 在任何进程/任何时刻映射到同一 key」——否则重建索引后 key 变化会污染 vec0 表 |
| `vectorToBlob` / `blobToVector` | `Float32Array` ↔ `Buffer`（SQLite BLOB） |
| `normalize(v)` | **L2 归一化**——语义检索要求归一化，使余弦距离等价于点积 |

### 8.4 ⚠️ 实测踩到的坑（封装在实现内）

来自 [vector/types.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/src/vector/types.ts#L6-L13) 的注释：

1. **sqlite-vec 的 vec0 虚拟表主键必须传 BigInt**——传 JS number 报 `Only integers are allows for primary key values`（拼写错误来自上游）
2. **vec0 的 KNN 查询必须带 `LIMIT` 或 `k = ?` 约束**，否则 `prepare` 阶段直接抛错
3. 因此不能写「join sites ... where embedding match ? order by distance limit N」之外的花样；**CTE + 外层 join 是安全的**（已验证），但把 `LIMIT` 放在外层 join 之后会失败

这些约束被封装在实现内部，调用方只看到 `search(query, limit)`。

## 9. 依赖关系

```
@navhub/store
  ├── workspace: @navhub/core（fuse / cjk / pinyin / ranking / profile / 类型）
  ├── drizzle-orm 0.45.4 + drizzle-kit（仅类型生成与离线校验）
  ├── better-sqlite3 13.0.3 + sqlite-vec 0.1.9  （lite）
  ├── pg 8.23.1                                   （standard）
  ├── pinyin-pro 3.29.5
  └── 被依赖：@navhub/api、@navhub/mcp
```

**测试覆盖**（`test/store.test.ts` + `test/dialect.test.ts`）：
向量存储（内存/真实 sqlite-vec **双实现一致性**）、真实 SQLite 集成、分类管理（移动/合并/删除归类）、收藏夹、画像、任务队列、**schema 迁移幂等**、方言差异。
