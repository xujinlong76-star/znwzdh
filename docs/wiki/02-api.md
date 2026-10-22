# 02 · apps/api —— Fastify 中枢

> 包名 `@navhub/api`，端口默认 **8787**。
> 职责：REST API + NavSphere 兼容存储 API + 种子数据 + 定时任务队列。
> 它同时是 `@navhub/mcp` 的依赖——MCP 与 HTTP 入口共用同一套上下文装配。

## 1. 模块文件清单

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| [main.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/main.ts) | 46 | **服务入口**：装配 config → context → server → JobRunner → listen + 优雅关闭 + 启动横幅 |
| [auth.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/auth.ts) | ~110 | **REST 鉴权**：Bearer token 解析、sha256 哈希、scope 校验（admin ⊇ write ⊇ read）、timingSafeEqual |
| [server.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/server.ts) | ~285 | **装配与横切关注点**（CORS / 限流 / bodyLimit / trustProxy / 指标 / 错误兜底 / OpenAPI 收集 / 缓存 / 鉴权）；业务路由按域拆至 [routes/](file:///c:/Users/许进龙/Desktop/web/apps/api/src/routes) 24 个插件，共 **85 条 REST 路由** |
| [openapi.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/openapi.ts) | ~230 | **OpenAPI 3.1 文档生成**：从 Fastify `onRoute` 收集的路由表自动生成 `/api/openapi.json` + `/api/docs` HTML 视图 |
| [storage.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/storage.ts) | ~410 | **存储适配层**：NavSphere 的「JSON 文件」语义 → 数据库语义 |
| [context.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/context.ts) | 144 | **应用上下文装配**：双模式差异的唯一消化点，能力可选、失败不致命 |
| [config.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/config.ts) | 112 | 运行配置 `loadConfig()`：环境变量解析与默认值 |
| [jobs.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/jobs.ts) | ~280 | `JobRunner`：4 种定时任务 + 单实例锁 + 防重入 |
| [index-site.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/index-site.ts) | 30 | `indexSite()`：站点写入后的向量索引共享函数 |
| [profile-service.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/profile-service.ts) | 62 | `refreshUserProfile()`：画像聚合刷新（60s 节流） |
| [seed.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/seed.ts) | ~105 | `runSeed()`：50 个精选中文站点播种 + 向量生成 |
| [seed-main.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/seed-main.ts) | ~22 | 种子独立入口（`pnpm --filter @navhub/api seed`） |
| [migrate.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/migrate.ts) | ~45 | schema 迁移 CLI 入口（幂等补列） |
| [seed-data.json](file:///c:/Users/许进龙/Desktop/web/apps/api/src/seed-data.json) | 12KB | 50 个真实中文站点种子数据 |
| [index.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/index.ts) | 10 | **可复用出口**：`export * from config/context/server/storage` |

## 2. 启动流程

[main.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/main.ts) 导入即启动（**不使用主模块判断**，规避 Windows 路径形式不一致导致的静默退出）：

```ts
const config = loadConfig();            // 1. 环境变量 → AppConfig
const ctx    = await createContext(config);  // 2. 装配 DB / 向量 / 全文 / embedding / 检索
const app    = await buildServer(ctx);       // 3. Fastify + 85 条路由（按域 register）

const jobsEnabled = process.env.NAVHUB_JOBS_ENABLED !== "0" && ... ;
const runner = jobsEnabled ? new JobRunner(ctx) : null;
if (runner) runner.start();                  // 4. 任务队列（30s 轮询，单实例锁）

process.on("SIGINT"|"SIGTERM", shutdown);    // 5. 优雅关闭：runner → app → ctx
await app.listen({ port: config.port, host: config.host });
console.log("=".repeat(64));                 // 6. 启动横幅：模式 / 语义 / 全文 / LLM / 队列
```

**启动横幅**会直接打印「能不能用 AI」，便于排障：

```
================================================================
NavHub 已启动
  监听    http://0.0.0.0:8787
  模式    lite
  语义检索 可用
  全文检索 可用
  LLM 富化 不可用（降级为启发式）
  任务队列 已启动（30s 轮询，单实例锁）
  · sqlite-vec 已加载，向量维度 512
  · FTS5 全文索引就绪（CJK 二元分词）
================================================================
```

### 2.1 `AppContext` —— 全局依赖容器

[context.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/context.ts#L25-L35)：

```ts
export interface AppContext {
  config: AppConfig;
  db: Db;                      // 打开的数据库（sqlite | pg）
  repo: Repository;            // 仓储层（全部 CRUD）
  search: SearchEngine;        // 混合检索引擎
  vectors: VectorStore;        // 向量存储（Memory | SqliteVec | PgVector）
  fts: FullTextStore | null;   // 全文存储（SqliteFts | PgFts | null）
  embedding: EmbeddingService | null;
  capabilities: Capabilities;  // { semantic, fts, llm, notes[] }
  close(): Promise<void>;
}
```

`createContext()` 按模式装配，**每个能力都有 try/catch 降级**：

| 模式 | 装配顺序 |
| --- | --- |
| `lite` | `openDb(sqlite)` → `sqlite-vec.load()` + `SqliteVecStore.init()` + `rehydrate()` 保存的 key→siteId 映射 → `SqliteFtsStore.init(true)` → embedding 服务（惰性） |
| `standard` | `openDb(pg)` → `PgVectorStore.init()`（HNSW）→ `PgFtsStore.init()`（GIN 表达式索引）→ embedding 服务 |

任一步失败都只往 `notes` 里写一条原因，**不抛错**——系统照常启动并在 `/api/health` 如实上报。

### 2.2 Fastify 全局配置

[server.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/server.ts#L22-L41)：

| 配置 | 值 | 说明 |
| --- | --- | --- |
| `logger.level` | `NAVHUB_LOG_LEVEL`，测试时 `silent` | |
| `bodyLimit` | 4 MB | |
| `trustProxy` | 默认**关闭**（`NAVHUB_TRUST_PROXY=0`/未设）；`1`/`true` 信任整条链；其它字符串按 proxy-addr 网段列表 | 前端 `/api/hub/*` 代理透传 `X-Forwarded-For`；完全不信任会退化成整站共享一个限流桶。`1` 取的是客户端自报的最左值（可伪造绕限流），反代后应写网段列表如 `"loopback, 172.16.0.0/12"` |
| CORS | `NAVHUB_CORS_ORIGINS`（默认 `*`），`credentials: true` | |
| 全局限流 | 300 次/分钟 | 路由级可覆盖 |

> **安全提示**：若中枢**直接**暴露公网（不经自家代理），必须设 `NAVHUB_TRUST_PROXY=0`，否则客户端可伪造 XFF 绕过限流。

> **多实例部署注意（限流存储）**：`@fastify/rate-limit` 默认把计数放在**进程内存**里。
> 单实例（Docker / 个人 NAS）行为正确；一旦水平扩展多个 api 实例（每个实例独立计数），
> 全局限流会放大为 `300 × 实例数`，按 IP 的严格策略（如投稿 5 次/小时）同样失效。
> 多实例场景需要改用共享存储（Redis）的限流实现——这是已知限制，**未引入 Redis 依赖**
> （单实例部署不受影响；引外部依赖前须单独立项评估）。
>
> **可观测性**：`GET /api/metrics`（Prometheus 文本格式，scope: read）暴露请求计数、
> 耗时、能力开关与数据规模——限流是否被打满可从 `navhub_http_requests_total` 观测。
> 注意指标采集同样是进程内状态，多实例下各抓各的。

### 2.3 REST 鉴权（auth.ts + onRequest hook）

**背景**：`api_tokens` 表在 schema 里一直存在，但 REST 层从未接线——管理面（站点 CRUD / 类目管理 / 任务入队 / 存储写入）在公网部署时是裸奔的。

#### 三条设计约束

1. **默认关闭**（`NAVHUB_AUTH_REQUIRED` 未设时为开放模式）——个人/NAS 部署零配置可用，公开站显式开启，**不破坏存量部署**。
2. **只保护管理面**，不碰终端用户功能：搜索、事件上报、收藏夹、投稿、榜单本来就是匿名可用的产品能力（投稿另有 5 次/小时/IP 限流），全局强制会误伤访客。
3. **库里只存 sha256**，明文只在创建时返回一次；比对用 `timingSafeEqual` 防时序攻击。

#### 路由分级

| 级别 | 覆盖 | 说明 |
| --- | --- | --- |
| `public` | 搜索、事件、收藏夹、投稿、榜单、搜索历史、`/api/health`、`/api/users/sync` | 匿名可用，不参与鉴权 |
| `read` | 站点/类目/标签/专题列表、`/api/stats`、`/api/jobs`(GET)、`/api/admin/stats/trends`、`/api/admin/audit`、`/api/storage`(GET) | 管理面只读 |
| `write` | 站点与类目 CRUD、标签改名/合并、任务入队、`/api/enrich`、`/api/sites/auto`、`/api/warmup`、`/api/storage`(PUT)、`POST /api/trash/:id/restore` | 管理面写入 |
| `admin` | `DELETE /api/sites/:id`、`DELETE /api/categories/:id`、`DELETE /api/trash/:id`、token 管理 | 高危 |

实现：每个路由声明 `config: { scope: "read"|"write"|"admin" }`（不声明即 `public`），`onRequest` hook 统一读取 `req.routeOptions.config.scope` 拦截。

#### 核心函数（auth.ts）

| 函数 | 行为 |
| --- | --- |
| `hashToken(raw)` | sha256 十六进制——`api_tokens.token_hash` 列的存储形态 |
| `generateToken()` | `nh_` 前缀 + 24 字节随机（192 位熵），`base64url` 编码 |
| `parseScopes(raw)` | 解析 `"read,write"` → 受控字面量，**非法值静默丢弃**（不放大权限） |
| `scopeSatisfies(scopes, required)` | **admin ⊇ write ⊇ read**：持 admin 视同持全部 |
| `secureEqual(a, b)` | `timingSafeEqual` 常量时间比对（长度不同直接失败） |
| `bearerOf(req)` | 从 `Authorization` 头取 Bearer 值 |

#### 引导路径（解决「启用鉴权后库里还没有 token」的鸡生蛋问题）

```
1. NAVHUB_AUTH_REQUIRED=true NAVHUB_BOOTSTRAP_TOKEN=<自定义串> 启动
2. 用该串作为 Bearer 调 POST /api/tokens 创建正式库内 token
3. 删除 NAVHUB_BOOTSTRAP_TOKEN 重启
```

`bootstrapToken` 不入库、只在内存比对，视同 `admin`，actor 记为 `bootstrap`。

#### 审计身份升级

鉴权接入后，管理面写操作的审计 `actor` 从笼统的 `"api"` 变为**真实身份**：

| 场景 | actor | actorKind |
| --- | --- | --- |
| token 调用 | token 名称 | `token` |
| bootstrap 调用 | `bootstrap` | `static` |
| 开放模式（默认） | `api` | `anonymous`（与历史语义一致） |

成功鉴权还会 `touchApiToken()` 刷新 `last_used_at`（失败不影响主流程）。

#### token 管理端点（全部要求 admin）

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| POST | `/api/tokens` | `{name, scopes?, expiresAt?}` → 201 + **明文只返回一次** + 提示语；**409**（同名未吊销凭据已存在 / 未吊销数达 `NAVHUB_TOKEN_MAX_ACTIVE`） |
| PATCH | `/api/tokens/:id` | 更新 name / scopes / expiresAt（省略的字段不动）；改名撞名 **409**（排除自身） |
| POST | `/api/tokens/:id/rotate` | 轮换明文（旧明文立即失效），可顺带更新有效期 |
| POST | `/api/tokens/:id/revoke` | 软吊销：立即失效但保留记录留痕 |
| GET | `/api/tokens` | 列表（**不含明文也不含 hash**） |
| DELETE | `/api/tokens/:id` | 204，删除后立即失效 |

`expiresAt`（毫秒时间戳）按输入分三种语义：**省略** = 落策略上限 `NAVHUB_TOKEN_MAX_LIFETIME_DAYS`（默认 365 天）；**显式 `null`** = 请求永不过期，仅 `NAVHUB_TOKEN_ALLOW_PERMANENT=true`（默认 false）时放行；**数字** = 必须未来且不超上限。PATCH / rotate 省略 `expiresAt` 则保留原有效期（改个名字不顺带改期）。

**名称唯一性**：未吊销凭据之间 `name` 精确匹配必须唯一（大小写敏感；已吊销 / 已删除的不占用名称）。创建与 PATCH 改名撞名返回 **409**，错误信息点名冲突项。这层拦截缺失时，重复创建同名 token 会全部成功，列表里多条同名记录无法区分是谁，吊销时也难以定位。

**审计容错**：token 五类写操作的审计写入失败只降级为错误日志，不吞掉主操作响应——轮换场景下旧明文已失效，若审计故障把响应变成 500，新明文会随响应一起丢失，凭据彻底报废。

scopes 支持过期（`expires_at` 过期即视为无效）；`last_used_at` 每次成功鉴权刷新。

测试：[apps/api/test/auth.test.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/test/auth.test.ts)——42 个用例覆盖开放模式回归、逐级拦截、scope 含义、生命周期（含省略落上限 / 显式永久被拒 / 放行实例）、名称冲突拦截（409 / 吊销后复用 / PATCH 撞名 / 超长名）、审计故障容错、审计身份。

## 3. REST 路由完整清单（62 条）

### 3.1 健康与能力

| 方法 | 路径 | 功能 | 备注 |
| --- | --- | --- | --- |
| GET | `/api/health` | 模式 + `capabilities` + `stats` | 降级状态唯一权威出口；仅表进程存活 |
| GET | `/api/ready` | 就绪探针：`semantic` / `embeddingReady` / `fts` | compose `depends_on` 应指此；迁移水位 + embedding 就绪 |
| GET | `/api/metrics` | Prometheus 文本指标 | scope: **read**（开放模式匿名可抓；开启 `NAVHUB_AUTH_REQUIRED` 后需 read 及以上 token）；只暴露有界基数维度（method × 路由模板 × 状态码），不含站点内容/身份 |
| POST | `/api/warmup` | 显式预热 embedding 模型 | 默认惰性加载，部署后可主动调用 |

### 3.2 检索

| 方法 | 路径 | 功能 | 备注 |
| --- | --- | --- | --- |
| GET | `/api/search` | 混合检索 | **限流 120/min**；`searchBody` zod 用 `coerce` 兼容 query string |
| POST | `/api/search` | 同上（JSON 体） | 与 GET 共用 schema |

**检索流程**（[runSearch](file:///c:/Users/许进龙/Desktop/web/apps/api/src/server.ts#L103-L140)）：
1. 解析身份 `userId` / `anonId` → 触发 `refreshUserProfile`（节流 60s，`void` 不阻塞）
2. 若调用方未显式传 `personalize`，从 `user_profiles` 表读取画像注入
3. `ctx.search.search()` → hits 补全 `site` 对象
4. **事件只记第一页**（`offset === 0`）：记 `search` 事件、零结果记 `zero_result`、有身份写 `search_history`——翻页是同一次查询的延续，否则「加载更多」会把 `topQueries` 计数灌水
5. **零结果兜底**（仅第一页）：从 `topQueries(180d)` 取历史搜索词，用 `zeroResultQueries(180d)` 差集**剔除同样搜不到的词**，返回 `suggestions`（前 5）与 `popular`（前 8）

> **零结果且第一页时才携带 `suggestions` / `popular`**（字段缺席 = 正常结果，前端无需判断）。
> 检索引擎侧另有**两级放宽兜底**（`fallback: "filter" | "fuzzy"`）与 **offset 分页**（`offset` / `hasMore`），见 [05-store.md §6](./05-store.md)。

> **设计要点**：个性化信号由**服务端**从身份解析，调用方只传身份不传信号——避免伪造与多端不一致；显式传 `personalize` 的调用方（测试/MCP）优先，保持向后兼容。

**`searchBody` 参数**：`q`、`limit`(1-100)、`offset`(0-1000，分页)、`categoryId`、`tag`、`disableSemantic`、`disablePersonal`、`userId`、`anonId`、`personalize{topCategories,topTags,visitedSiteIds}`

### 3.3 站点 CRUD

| 方法 | 路径 | 功能 | 状态码 |
| --- | --- | --- | --- |
| GET | `/api/sites` | 列表（`categoryId` / `status` / `limit`） | 200 |
| GET | `/api/sites/:id` | 详情，支持 id **或 URL**（URL 需 `encodeURIComponent`） | 200/404 |
| POST | `/api/sites` | 创建 | 201；URL 重复 **409** |
| PATCH | `/api/sites/:id` | 部分更新 | 200/404 |
| DELETE | `/api/sites/:id` | 删除（**软删除** → 回收站，见 §3.14） | 204 |
| POST | `/api/sites/bulk` | **批量操作**（`op: delete\|setCategory\|setStatus`，`ids` ≤200，**`dryRun` 默认 true**）：不存在的 id 计入 `plan.skip` 不整批失败；执行后落 `site.bulk` 汇总审计；`scope: admin`（操作集含删除，按最危险成员定级） | 200/400 |

写操作统一模式：**zod 校验 → 去重 → 写库 → `indexSite()` 向量索引 → `repo.audit()` 审计**。

> URL 形态查询实测：`/api/sites/https%3A%2F%2Fchatgpt.com` → 200；未编码的原始 URL 会被切成多段 → 404（HTTP 路由固有行为）。

### 3.4 类目管理

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| GET | `/api/categories` | 全部类目 |
| GET | `/api/categories/:id` | 详情 |
| POST | `/api/categories` | 新建（`source: "api"`） |
| PATCH | `/api/categories/:id` | 更新（title/titleEn/icon/description/enabled/sort） |
| DELETE | `/api/categories/:id` | 删除：**站点移入「未分类」（不级联删），子类目提升到父级** |
| POST | `/api/categories/:id/move` | 换父级，`anchor` 物化路径级联更新 |
| POST | `/api/categories/merge` | 合并：源（含后代）站点迁入目标后删源子树，返回 `{movedSites, removedCategories}` |

### 3.5 标签

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| GET | `/api/tags` | 标签云（真实计数，`minCount` 过滤，热度降序） |
| PATCH | `/api/tags/:id` | 重命名（name ≤ 24 字符） |
| DELETE | `/api/tags/:id` | 删除标签：解除全部站点关联后删标签行，并**就地重算受影响站点的检索索引**（否则搜已删标签仍命中）；不存在 → 404 |
| POST | `/api/tags/merge` | 合并标签，返回 `{moved}` |

### 3.6 精选专题

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| GET | `/api/collections` | 专题列表 |
| GET | `/api/collections/:slug` | `{ collection, sites }` |

### 3.7 收藏夹（终端用户）

> **身份方案**：由调用方传 `userId`（登录 canonical id）或 `anonId`（前端 localStorage）——个人导航站的轻量方案，**不引入终端用户鉴权体系**；多用户公开场景应改用 Bearer token（`api_tokens` 表已具备能力）。

| 方法 | 路径 | 功能 | 状态码 |
| --- | --- | --- | --- |
| GET | `/api/favorites` | 收藏列表 + 文件夹（含 site 对象） | 200 |
| POST | `/api/favorites` | 添加收藏，联动 `favorite` 事件 | 201（重复 200） |
| DELETE | `/api/favorites/:siteId` | 取消收藏，联动 `unfavorite` 事件 | 200 |
| POST | `/api/favorites/folders` | 新建文件夹（name ≤ 30） | 201 |
| DELETE | `/api/favorites/folders/:id` | 删除文件夹 | 200 |

缺身份统一返回 `{ error: "缺少 userId 或 anonId" }`（GET 除外，返回空列表）。

### 3.8 推荐排序

| 方法 | 路径 | 功能 | 备注 |
| --- | --- | --- | --- |
| GET | `/api/rank/trending` | 热度榜 | 返回 `trend{visits, trendScore, lastVisitedAt}` 供前端 tooltip 解释排序 |
| GET | `/api/rank/new` | 新品榜 | `limit ≤ 100` |
| GET | `/api/rank/similar/:siteId` | 相似站点 | **向量 KNN**；语义不可用时返回 `semanticAvailable:false` + `reason`，**不 5xx** |

### 3.9 搜索历史

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| GET | `/api/search-history` | `limit ≤ 50`，无身份返回空 |
| DELETE | `/api/search-history` | 清空 |

### 3.10 身份、运营与审计

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| POST | `/api/users/sync` | OAuth 登录后 upsert GitHub 身份 → 返回 canonical `userId`（id 格式 `github:<providerId>`） |
| GET | `/api/admin/audit` | **审计日志**：倒序分页（`limit` ≤200 / `offset` / `hasMore`）+ `action`/`actor` 过滤 + `actions` 全集（过滤下拉）。`diff` 已解析为对象，损坏 JSON 原样返回字符串（不 500）。scope: read |
| GET | `/api/admin/stats/trends` | 运营看板：热门搜索 / 零结果搜索 / 热度榜（`days` 1-365） |
| GET | `/api/admin/health/trend` | **健康巡检趋势**（`days` 1-90，默认 14）：按天分桶 `{date, checked, failed, rate, avgLatencyMs}`。桶在 **JS 里做**（避开 SQLite `strftime` / PG `to_char` 的方言差异）；无巡检的日期 `rate` 为 **null 而非 100%**（「没巡检」≠「很健康」）；前端 `/admin/stats` 用轻量 SVG 折线渲染（null 断点，不引入图表库）。scope: read，`maxAge: 30` |
| GET | `/api/stats` | 基础统计 `{sites, categories, tags, broken, pending}` |

> **审计闭环**：所有管理面写操作落 `audit_logs`（含 `ip`），`actor` 在鉴权模式下是 token 名、开放模式是 `api`——配合 `GET /api/admin/audit` 与 `/admin/audit` 页面即可回答「谁在什么时候改了什么」。

### 3.11 投稿与 AI

| 方法 | 路径 | 功能 | 限流 / scope |
| --- | --- | --- | --- |
| POST | `/api/submissions` | 匿名投稿 → `status=pending, source=submission` 入审核队列；重复 URL **409** | **5 次/小时/IP** |
| GET | `/api/submissions` | **审核队列数据源**（`status=pending\|approved\|rejected\|all`，非法值 400）：只返回 `source=submission` 的站点，返回与 GitHub 通道同形状（`success` + `submissions`，`number` = `site.id` 的数值 hash），非法 → 400 | read |
| PATCH | `/api/submissions/:number` | **审核**（`action: approve\|reject`，`reason?`）：按 hash number 反查真实 site id → 改 `active/archived` → 落 `submission.approve/reject` 审计；`:number` 找不到 → 404 | write |
| POST | `/api/enrich` | 仅抓取 + 富化（不入库），返回 `provenance` | 20/min |
| POST | `/api/sites/auto` | **一步到位**：抓取 + 富化 + 分类解析 + 入库（`source: "ai"`） | 15/min |

> **收编意义**：审核队列原走 Next 自己的 `/api/submissions/[number]` 路由（GitHub 通道），NavHub 回退通道此前直接拿 hash number 调 `/api/sites/:id` → **必然 404，审核按钮静默失效**。现在两端统一走中枢的 GET/PATCH，审核动作**落审计**（此前无审计）。
> hash 规则两端必须一致：中枢 `submissionNumber()` 与前端 `hashNumericId()` 同为 djb2 变体（`((hash<<5)-hash)+ch`），有测试锁定（见 `投稿审核收编中枢` describe）。

`/api/sites/auto` 的分类解析链：调用方指定 → 富化建议**唯一**匹配已有类目（标题或 SKOS altLabel）→ 否则落「未分类」并记一条 `category_gap` 提案。
建议名不再自动建成类目：那是层级坍塌的入口（模型每次发挥就多一根一级根），改由人工在 `admin/taxonomy` 选定父级后采纳；重名歧义（实测「语言」×3）也走提案而不是静默挑一个。

### 3.12 任务与事件

| 方法 | 路径 | 功能 | 限流 |
| --- | --- | --- | --- |
| POST | `/api/jobs` | 入队（kind ∈ 4 种任务） | 30/min |
| GET | `/api/jobs` | 任务列表（`status` / `limit ≤ 200`） | — |
| POST | `/api/events` | 行为上报（kind 白名单见下） | — |

**事件白名单**：`click | favorite | unfavorite | impression | dismiss`
- `click` 联动 `bumpVisit()`（热度排序的原始信号）
- `click/favorite/unfavorite` 触发 `refreshUserProfile()`（节流 60s）

### 3.13 NavSphere 兼容存储 API（架构核心）

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| GET | `/api/storage?path=...` | 读取 NavSphere JSON 语义内容 |
| PUT | `/api/storage` | `{path, content, message?}` 写入，落 `storage.write` 审计 |

> 注释原话（[server.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/server.ts#L706-L711)）：**「这两个端点就是『不修改前端 69 处调用点』的全部秘密。」** `path` 沿用前端原值（如 `src/navsphere/content/navigation.json`），前端连常量都不用改。

### 3.14 回收站（软删除）

| 方法 | 路径 | 功能 | scope | 状态码 |
| --- | --- | --- | --- | --- |
| GET | `/api/trash` | 回收站列表（软删站点，按删除时间倒序，`limit ≤500`） | read | 200 |
| POST | `/api/trash/:id/restore` | 恢复软删站点 | write | 200 / **409**（同 URL 已有新站点，含 `existingSiteId`）/ 404 |
| DELETE | `/api/trash/:id` | 永久删除（连带 site_tags / embeddings / 向量） | admin | 204 / 404 |

**删除语义升级**：`DELETE /api/sites/:id` 现在是**软删除**——只打 `deleted_at` 戳，行、标签、向量全部保留。恢复是瞬时的，无需重建索引。

**关键约束**：
- 正常查询（`getSite` / `listSites` / 搜索四通道 / 榜单 / stats.sites）一律排除软删站点
- `stats` 新增 `trashed` 计数，让运营者知道还有可恢复的数据
- **url 唯一性改为部分索引**（`WHERE deleted_at IS NULL`）——删完同 URL 站点后可立即重新添加，旧记录不再挡住
- 恢复时若同 URL 已被新站点占用 → **409**（避免恢复出重复 URL）
- **快照写回用原 id 重建软删站点时不冲突**：`createSiteWithId` 遇到同 id 软删行时直接"复活"（清 `deleted_at` 并覆盖内容），语义等价于重建
- 审计：`site.delete`（软删）/ `site.restore` / `site.purge`（永久），均带 `ip` 与真实 `actor`

> 前端注意：NavSphere 原管理端（`/admin/sitelist`）的删除对话框文案仍是「此操作无法撤销」——现已是软删除可恢复，文案待更新。

详见 [05-store.md §2.1](./05-store.md)（`deleted_at` 列与部分索引）与 [§5.7](./05-store.md)（Repository 方法）。

### 3.15 API Token 管理（scope: admin）

| 方法 | 路径 | 功能 | 状态码 |
| --- | --- | --- | --- |
| POST | `/api/tokens` | `{name, scopes?, expiresAt?}` 创建，**明文只返回一次** | 201 / **409**（同名未吊销凭据已存在，或未吊销数达上限） |
| PATCH | `/api/tokens/:id` | 更新 name / scopes / expiresAt（省略不动）；改名撞名 409（排除自身） | 200 / **409** |
| POST | `/api/tokens/:id/rotate` | 轮换明文，旧明文立即失效 | 200 |
| POST | `/api/tokens/:id/revoke` | 软吊销（留痕，可恢复查询） | 200 |
| GET | `/api/tokens` | 列表（不含明文/hash） | 200 |
| DELETE | `/api/tokens/:id` | 删除，立即失效 | 204 |

`expiresAt`：省略落策略上限（`NAVHUB_TOKEN_MAX_LIFETIME_DAYS`，默认 365 天）；显式 `null` = 请求永久，仅 `NAVHUB_TOKEN_ALLOW_PERMANENT=true`（默认 false）放行；数字须未来且不超上限。名称唯一性：未吊销凭据间 `name` 精确匹配必须唯一（已吊销/已删除的不占用名称）。

详见 [§2.3 REST 鉴权](#23-rest-鉴权authts--onrequest-hook)。

### 3.16 个性化画像（「我的偏好」）

| 方法 | 路径 | 功能 | 身份 |
| --- | --- | --- | --- |
| GET | `/api/profile` | 读画像 `topCategories` / `topTags` / `visitedSiteIds` / `favoriteSiteIds` / `searchCount`；缺身份 → `{error}` | `userId` 或 `anonId` |
| DELETE | `/api/profile` | **重置画像**：清 `user_profiles` 行 + 该身份的 `events`（click/favorite，按独立列 `events.identity` 等值删除），返回 `{ok, profileCleared, eventsRemoved}` | 同上 |

**重置语义**（[profile-service.ts `resetUserProfile`](file:///c:/Users/许进龙/Desktop/web/apps/api/src/profile-service.ts)）：两件都清——只删画像行没用，下次搜索的 `refreshUserProfile` 会从残留事件重建。**收藏夹与搜索历史不动**（用户自己的数据，不是被推断的偏好）；同时清掉节流表条目，避免新行为延迟生效。前端入口：`/preferences`（我的偏好页）。

### 3.17 响应缓存头（onSend hook）

所有 GET 与写操作都会经统一的 `onSend` hook 落 `Cache-Control`，策略在路由 config 里声明 `cache: { maxAge, etag }`：

| 档位 | `Cache-Control` | 覆盖路由 |
| --- | --- | --- |
| 声明了 `maxAge > 0` | `private, max-age=<秒>`（可选 ETag + 304） | `health`(15s)、`search`(20s, etag)、`sites` / `categories` / `tags` / `collections(+slug)` / `rank/trending` / `rank/new`（均 60s, etag） |
| **未声明策略的 GET** | `no-store` | 站点详情、收藏、审计、job、stats 等 |
| **所有写操作（非 GET / 非 200）** | `no-store` | 一律 |

**为什么 `private`**：避免共享代理（CDN/nginx）把不同 token / 不同用户的数据串到一起，TTL 只省浏览器端重复请求。
**为什么默认 `no-store`**：GET 缺缓存头时浏览器走「启发式缓存」，可能缓存含身份或管理面数据——静默的正确性风险，所以刻意收紧为安全默认。

**ETag 语义**：对序列化后的 payload 取 sha1（base64url），处理 `If-None-Match`（含 `W/` 前缀与逗号列表）→ 命中回 **304 且不带 body**（同时移除 `content-type`/`content-length`，否则残留头与空 body 冲突）。未命中照常 200。

测试：`apps/api/test/api.test.ts > 响应缓存头`（TTL、304、no-store 默认各一条）。

### 3.18 OpenAPI 文档（自动生成）

| 方法 | 路径 | 功能 | scope |
| --- | --- | --- | --- |
| GET | `/api/openapi.json` | **OpenAPI 3.1** 文档（`maxAge: 60`） | public |
| GET | `/api/docs` | 文档 HTML 视图（深色端点表格 + 鉴权标注，**不依赖外部 CDN**，内网可直接看） | public |

**为什么自动生成**（[openapi.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/openapi.ts)）：`buildServer` 里注册 `onRoute` 钩子，在每条路由注册时收集 `{method, url, scope}` ——文档与真实路由**同源**，新增/删除路由时同步变化，不存在手写清单漂移（手写清单必然漂移，而本文档存在的唯一目的就是防漂移）。

生成内容：
- `:name` → `{name}` path 模板 + `parameters`（`id` 标注「站点可传 URL，需 encodeURIComponent」）
- scope → `security`：`public` 空数组；`read/write/admin` → `[{bearerAuth: []}]`（`components.securitySchemes.bearerAuth`）
- 错误响应按语义补：非 public 补 401/403；带 path 参数/POST 补 400/404；`POST /api/sites`、`POST /api/trash/:id/restore` 补 409
- 请求体给 `{type:"object", additionalProperties:true}`——**不在没人保证的细节上编造**，字段语义指向各 zod schema 源码

测试：`api.test.ts > OpenAPI 文档`——18 个代表性路径覆盖断言（各分区均有）+ public/read security 断言 + HTML 视图断言。

## 4. storage.ts —— 存储适配层

### 4.1 路径常量

```ts
NAVIGATION_PATH       = "src/navsphere/content/navigation.json"
SITE_PATH             = "src/navsphere/content/site.json"
RESOURCE_PATH         = "src/navsphere/content/resource-metadata.json"
DEFAULT_NAVIGATION_PATH = "src/navsphere/content/navigation-default.json"
VIDEOS_PATH           = "src/navsphere/content/videos.json"
```

### 4.2 核心函数

| 函数 | 行号 | 职责 |
| --- | --- | --- |
| `buildNavigationData(ctx)` | [#L68](file:///c:/Users/许进龙/Desktop/web/apps/api/src/storage.ts#L68) | DB → NavSphere `navigation.json` 形状；类目严格按 `sort` 排序，保证拖拽结果可复现 |
| `writeNavigationData(ctx, data)` | [#L149](file:///c:/Users/许进龙/Desktop/web/apps/api/src/storage.ts#L149) | 前端快照 → **全量对齐**写回 DB，**按 `source` 过滤删除范围** |
| `readSiteConfig / writeSiteConfig` | [#L284](file:///c:/Users/许进龙/Desktop/web/apps/api/src/storage.ts#L284) | `site.json` ↔ KV 存储 |
| `readResourceMetadata / writeResourceMetadata` | [#L297](file:///c:/Users/许进龙/Desktop/web/apps/api/src/storage.ts#L297) | `resource-metadata.json` |
| `readVideosData / writeVideosData` | [#L313](file:///c:/Users/许进龙/Desktop/web/apps/api/src/storage.ts#L313) | `videos.json` |
| `pathToKey(path)` | [#L370](file:///c:/Users/许进龙/Desktop/web/apps/api/src/storage.ts#L370) | 路径 → 通用 JSON 文档的存储键 |
| `readStoragePath(ctx, path)` | [#L375](file:///c:/Users/许进龙/Desktop/web/apps/api/src/storage.ts#L375) | **内容路径分发**：按 path 分派到上述具体读写器 |
| `writeStoragePath(ctx, path, content)` | [#L387](file:///c:/Users/许进龙/Desktop/web/apps/api/src/storage.ts#L387) | 同上（写），返回 `{ok, note}` |

### 4.3 ⚠️ D1 缺陷与 source 过滤（重要）

`writeNavigationData` 做的是**全量对齐**（前端提交的快照里没有的就删）。曾经的缺陷：经 API / MCP / AI 创建的站点，会被前端保存 `navigation.json` 时**静默删除**。

修复：删除范围按 `source` 列过滤——

| `source` 值 | 行为 |
| --- | --- |
| `null` / `navsphere` / `seed` | 视为前端快照托管，**按快照管理（可删）** |
| `api` / `mcp` / `ai` / `submission` | **不参与快照删除**，保留 |

回归测试与脚本：`scripts/d1-regression.mjs`。

**快照层的三条不变量**（读的投影必须和写的全量对齐严格互逆，否则必然丢数据）：

1. **不做可见性预过滤**：`buildNavigationData` 输出全部类目/站点（含 `enabled:false`），隐藏由渲染层负责（web 端 `data-loader.filterNavigationData` 统一过滤三级）。读侧预过滤会导致后台看不到停用类目、且下一次保存把它们**硬删**（`deleteCategory` 是真 DELETE，站点进回收站）。
2. **不分页截断**：快照层必须用 `repo.listAllSites`（全量）；`repo.listSites` 默认 limit 100 —— 读侧被截断时，写侧匹配不到存量行会走 `createSiteWithId` 对活行 INSERT，直接**主键冲突 500**。
3. **删除只在「可见集」内生效**：类目的可见集 = 顶级类目 + 其直接子类目（NavSphere 线格式只表达两级，见 [navigation-enhancement-plan.md §94](../navigation-enhancement-plan.md)）。更深层级类目、孤儿 `categoryId` 的站点本就不进快照，写回不能顺手清掉。

回归测试：`apps/api/test/navigation-snapshot.test.ts`（>100 站点全量投影与写回、停用类目往返、三级类目/孤儿站点保护）。

### 4.4 NsItem 扩展字段

NavSphere 站点项在 NavHub 侧扩展了 4.0 动态特性（见 [types.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/types.ts#L113-L151) 的 `Site`）：
`tags[]`、`actions[]`（深链微动作）、`relations[]`（生态/替代品）、`liveMetrics`（GitHub Star / 版本 / license）、`workspaces[]`（场景工作台）、`health`。

## 5. jobs.ts —— 任务队列

### 5.1 四种任务

| 任务 | 作用 | 触发产物 |
| --- | --- | --- |
| `health_check` | 可用性巡检（SSRF 安全抓取） | 写 `health_checks` + `sites` 健康列（`httpStatus` / `latencyMs` / `redirectTo` / `healthError`） |
| `refetch_metadata` | 刷新标题/描述/图标，可选手动 LLM 富化 | 更新站点元数据 |
| `recompute_rank` | 重算全站热度分 | `sites.trend_score` |
| `reindex` | 重建检索线索（拼音/FTS 由 `updateSite` 负责；向量按需重建） | 向量索引 |

### 5.2 JobRunner

```ts
new JobRunner(ctx, { intervalMs = envInterval(), maxPerTick = 10, holder = "pid-<pid>", onAlert? })
```

| 机制 | 实现 |
| --- | --- |
| **轮询（可配置）** | `intervalMs` 缺省读环境变量 **`NAVHUB_JOBS_INTERVAL_MS`**（毫秒，≥1000 才有效，否则回退 30000）；`setInterval` + `timer.unref()` 不阻塞进程退出；启动横幅打印实际间隔 |
| **防重入** | `ticking` 标志：上一轮未完成则本轮跳过（任务错过等下一轮） |
| **单实例锁（lite）** | `idempotency` 表持久锁行 `lock:job-runner`，**TTL 120s，崩溃自动释放** |
| **单实例锁（standard）** | PostgreSQL advisory lock `728501001` |
| **锁语义** | 两者都**不持有长事务**，不阻塞正常读写；拿不到锁就跳过本次循环 |
| **失败退避重试** | 首次失败**不再直接终态**：回 `pending` 并写 `jobs.next_run_at = now + backoffMs(attempts)`（指数 1min → 2min → 4min…，**封顶 1h**）。`claimNextJob` 只认领 `(next_run_at IS NULL OR <= now)` 的任务——**到点前不抢占队列**，避免必失败的坏任务每 30s 抢占、饿死正常任务。复合索引 `(status, next_run_at)` 覆盖该查询 |
| **重试耗尽** | attempts ≥ **`MAX_JOB_ATTEMPTS`（3）** → 落 `failed` 终态并**告警一次**（`console.error "[navhub-job-alert]"` + 可注入 `onAlert` 回调）。只在耗尽时喊，不搞每次失败都喊的告警风暴 |
| **三态语义** | `done`（成功）/ `pending`（退避中，带 `next_run_at`）/ `failed`（重试耗尽）。此前只有 done/failed 且失败即终态——瞬时抖动一击毙命 |
| **手动触发** | `runner.tick()`（测试用） |
| **开关** | `NAVHUB_JOBS_ENABLED=0` 关闭 |

> **列迁移**：`jobs.next_run_at` 登记在 [migrate.ts `COLUMN_ALTERS`](file:///c:/Users/许进龙/Desktop/web/packages/store/src/migrate.ts)，老库启动自动补列；DDl 里也带（新建库），并加 `(status, next_run_at)` 索引。
> 测试：`apps/api/test/jobs.test.ts`——退避回 pending、到点前不认领、3 次耗尽 + 恰好 1 次告警、`backoffMs` 指数与封顶、`NAVHUB_JOBS_INTERVAL_MS` 配置与非法值回退。

## 6. 其他关键函数

### 6.1 `indexSite()` —— 向量索引共享函数

[index-site.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/index-site.ts#L12-L29)：站点创建/更新后调用，
`embedding.encode(siteEmbeddingText({title, description, url}))` → `vectors.upsert()` → `repo.saveEmbedding()`。
**失败不阻断主流程**，原因记入 `capabilities.notes`。

### 6.2 `refreshUserProfile()` —— 画像刷新

[profile-service.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/profile-service.ts)：
- `isProfileStale(identity, now)`：60s 节流判断（内存 Map）
- `refreshUserProfile(ctx, identity)`：从 `events` 聚合 → `buildProfile()` → 写 `user_profiles`
- `resetProfileThrottle()`：测试用

### 6.3 `runSeed()` —— 种子数据

[seed.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/seed.ts#L49-L105)：读 `seed-data.json`（50 个真实中文站点）→ 按 URL 去重创建 → 写站点配置 → `withEmbeddings` 时生成向量（首次会下载 24MB 模型）。

### 6.4 配置：`loadConfig()`

见 [config.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/config.ts#L68-L112)，全部环境变量见 [09-run-and-test.md](./09-run-and-test.md)。

关键约束：
- `NAVHUB_MODE` 只能是 `lite` / `standard`，否则启动报错
- **`standard` 模式必须提供 `NAVHUB_DATABASE_URL`**，否则启动即抛错
- 所有外部依赖都可缺省——这是**硬性要求，有测试覆盖**

## 7. 测试

| 文件 | 覆盖 |
| --- | --- |
| [apps/api/test/api.test.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/test/api.test.ts) | **真实 HTTP 端到端**：检索、CRUD、去重、索引同步、降级、审计、收藏夹、榜单、D1 快照误删回归 |
| [apps/api/test/jobs.test.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/test/jobs.test.ts) | JobRunner 四任务 + 单实例锁 |
