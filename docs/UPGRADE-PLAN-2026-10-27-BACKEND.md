# 后端深度扫描与升级方案（2026-10-27）

> 执行模式：全仓只读扫描 + 定点复核
> 扫描范围：`apps/api`、`packages/{store,core,ai,mcp}`、测试/CI/容器/脚本
> 代码规模（实测）：后端 5 个包 **83,116 行 TS**，路由 **152 个**，表 **40 张**，MCP 工具 **41 个**，测试文件 **218 个**
> 与上一份 [`UPGRADE-PLAN-2026-10-23.md`](./UPGRADE-PLAN-2026-10-23.md) 的关系：那份的 P0/P1 已基本落地；本文只记录**在那之后仍然存在、或新引入**的问题，不重复已收口项。
>
> **实施状态（2026-10-27）**：P0-1 / P0-3 / P0-4、P1-1、P1-6 已落地（另将个人令牌整体挡在 `/api/jobs` 之外，部分覆盖 P1-8）。**P0-2（迁移事务化）未做**；P1-2 / P1-3 / P1-4 / P1-5 / P1-7 / P1-9 与 P1-8 的按 kind 分级仍待办。执行记录与完整未完成清单见 [`UPGRADE-EXECUTION-2026-10-27.md`](./UPGRADE-EXECUTION-2026-10-27.md) §8。

---

## 0. 结论（TL;DR）

四路扫描 + 逐条复核后，保留 **4 条 P0、8 条 P1、13 条 P2**。P0 的共同特征是**「对外承诺」与「实际执行」不一致**，而且都不报错——系统看起来一切正常：

| # | 缺陷 | 一句话后果 | 证据等级 |
|---|---|---|---|
| P0-1 | 用户自设的历史保留期**从未执行** | 用户选「30 天后自动删除」，数据永久保留；任务每轮静默记一条 error | A 已复核 |
| P0-2 | 工作区明文迁移**先删后确认** | INSERT 失败时 DELETE 照跑，`workspaces:*` 明文永久丢失 | A 已复核 |
| P0-3 | 个人 `write` 令牌**越出用户域** | 任一登录用户可自助签发令牌，改全站站点/类目、入队任务 | A 已复核 |
| P0-4 | PostgreSQL 全文通道**静默失效** | `to_tsquery` 收到 FTS5 语法，异常被吞成空结果；标准模式检索少一路 | A 已复核（需 PG 实测复现） |

**建议节奏**：P0 四条共约 **2–3 人日**，其中 P0-1 / P0-3 / P0-4 各半天内可完成。P1 约 **4–6 人日**。P2 按主题分批，不单独排期。

---

## 1. 方法与证据等级（诚实声明）

| 等级 | 含义 | 本文占比 |
|---|---|---|
| **A 已复核** | 我逐行打开源文件核对过语义与行号，证据可直接照着改 | P0 全部、P1 的 1/2/3/6/7 |
| **B 子扫描** | 并行扫描给出精确行号，我核对了调用链但未逐行验证每个分支 | P1-4/5/8、P2 大部分 |
| **C 待复核** | 有明确线索但未验证，**不排入 P0**，单列在 §6 | 少量 |

> 为什么单列：上一轮最严重的缺陷（NextAuth 字面量 `null` 被当故障）恰恰是单测与源码断言都测不出来的。方案如果建立在未复核的转述上，会把同样的错误复制一遍。

---

## 2. 现状快照（实测，用于纠正文档漂移）

| 指标 | 文档说法 | 实测 | 差异 |
|---|---:|---:|---|
| REST 端点 | 117 | **152** 个路由声明 | 文档落后 35 个 |
| 数据表 | 25 | **40** 张（`driver.ts` DDL）/ 41 个 drizzle 定义 | 文档落后 15 张 |
| MCP 工具 | 32 | **41** 个（28 read / 12 write / 1 admin） | 文档落后 9 个 |
| 后端代码 | 155,150（全仓） | **83,116** 行（仅后端 5 包） | 口径不同，不可直接比 |
| scope 分布 | — | public 90 / read 29 / write 40 / admin 43 | public 占比偏高，见 P1-1/P1-2 |
| 类型检查 | — | **5 包全过**（TS 7.0.2 native，28.6s） | 说明下列缺陷都是**语义层**，编译器拦不住 |

> 这些数字不是重点，重点是：**文档已经不能作为「当前行为」的依据**。`CODEBASE_OVERVIEW.md` 写于 10-18，之后有 100+ 提交。建议在 W1 顺手把该文档的数字改成实测值（半小时）。

---

## 3. P0 — 承诺与执行不一致

### P0-1【高】用户自设的历史保留期从未执行

**证据（A）**

| 位置 | 事实 |
|---|---|
| `packages/store/src/repository/settings.ts:125` | `SELECT user_id, preferences_json FROM user_settings ...` |
| `packages/store/src/migrate.ts:210-211` | `user_settings` 的主键列是 **`identity`**，没有 `user_id` |
| `packages/store/src/repository/settings.ts:145` | 同文件另一处查询用的是 `WHERE identity = ?`——证明列名是 `identity` |
| `apps/api/src/jobs.ts:1570-1594` | 调用 `listCustomHistoryRetention()`，整段包在 `try/catch` 里，失败写入 `summary.userRetention = { error }` |

**实际行为**：`listCustomHistoryRetention` 每次都抛 `no such column: user_id`（PG 是 `column "user_id" does not exist`），被 `jobs.ts` 吞掉，任务继续「成功」结束，只在 `data_retention` 事件的 `meta` 里留一条 error。**用户在 `/me/settings` 选的 30/90/365 天从未生效**。

**运行时复现（2026-10-27，在真实库 `data/navhub.db` 上执行）**

```
columns: identity,personalization_enabled,favorite_signal_cutoff,created_at,updated_at,preferences_json
current REPRO: no such column: user_id
fixed OK rows= 1
```

这不是静态推断：当前 SQL 在本机真实库上直接报错，改成 `identity` 后立刻返回 1 行。

**影响**：这不是「清理不干净」，是隐私承诺未履行。用户明确选择了保留期，系统却按默认 180 天（且默认路径还要人工 CLI）处理。个保法「保存期限最短必要」意义上的合规缺口。

**最小改法**（S，约 30 分钟）

```sql
-- settings.ts:125
SELECT identity, preferences_json FROM user_settings
 WHERE preferences_json LIKE '%historyRetentionDays%'
```
同步把 `row.user_id` 改成 `row.identity`（`:133`）。

**验收**（两层，缺一不可）
1. store 层：写一行 `preferences_json='{"historyRetentionDays":30}'` → 调 `listCustomHistoryRetention` → 断言返回 `[{identity, retentionDays:30}]`。**先跑一次确认红**（当前实现会抛错），改后转绿。
2. API 层：`apps/api/test/maintenance-optimize.test.ts` 补一条——带自定义保留期的用户，`POST /api/admin/maintenance/optimize` 后 `search_history` 中早于 cutoff 的行被删，且 `summary.userRetention.usersAffected === 1`（不是 `{error}`）。

---

### P0-2【高】工作区明文迁移「先删后确认」

**证据（A）**

| 位置 | 事实 |
|---|---|
| `packages/store/src/migrate.ts:232-238` | 先 `INSERT INTO user_workspace_blobs ... SELECT ... FROM user_vault_sync`，紧接着一条独立 `DELETE FROM user_vault_sync WHERE user_id LIKE 'workspaces:%' ...` |
| `packages/store/src/migrate.ts:309-323` | 两条语句在同一个 `for` 循环里**各自** `try/catch`，catch 体是空的（注释：「允许跳过，下次启动兜底」） |

**实际行为**：INSERT 与 DELETE 没有事务包裹，也不校验 INSERT 的行数。只要 INSERT 因任何原因失败（表不存在、列类型不匹配、权限不足、PG 扩展缺失导致前面的 DDL 整批回滚），DELETE 仍会执行——`workspaces:*` / `ws_members:*` 的**明文工作区数据永久消失**，而且下一次启动时已经无行可迁。

**影响**：数据丢失不可逆。触发条件窄（需要迁移语句失败），但后果是最高等级；且失败被空 catch 吞掉，日志里连痕迹都没有。

**最小改法**（S/M）

```ts
// 方案 A（推荐）：把这一对语句移出通用循环，单独在一个事务里执行
await db.transaction(async (tx) => {
  const inserted = await tx.run(insertSql);      // 返回 changes/rowCount
  if (inserted.changes === 0) return;            // 没有可迁数据，不删
  await tx.run(deleteSql);
});
```
- 若 `db` 抽象没有事务入口，用 `BEGIN` / `COMMIT` + 失败 `ROLLBACK`（SQLite 与 PG 都支持）。
- 关键不变量：**DELETE 的前提是 INSERT 成功且行数匹配**；不匹配就保留旧行并打 `console.warn`，绝不静默。

**验收**：store 测试——建 `user_vault_sync` 行 → 让 INSERT 失败（例如临时把目标表改名/加约束）→ 调迁移 → 断言旧行**仍在**；正常路径断言旧行被删且新表有数据。

---

### P0-3【高】个人 `write` 令牌越出用户域

**证据（A）**

| 位置 | 事实 |
|---|---|
| `apps/api/src/routes/me.ts:905-906` | 注释明确：「读写……**自己的用户域数据**」 |
| `apps/api/src/routes/me.ts:927-934` | `permission === "write"` → `scopes: "read,write"`，任何通过 `identityTrusted` 的非匿名身份都能签发 |
| `apps/api/src/auth.ts:89-93` | `scopeSatisfies` 把 `write` 当作**全局**等级 2：`have >= rank[required]` |
| `apps/api/src/routes/sites.ts:85,170` | `POST /api/sites`、`PATCH /api/sites/:id` 只要求 `scope: "write"`，**不检查 `ownerIdentity`** |

**实际行为**：一个普通登录用户（GitHub OAuth 或任意受信身份）可以：

```
POST /api/me/tokens {"permission":"write"}   → 拿到 read,write 令牌
POST /api/sites {...}                        → 创建/修改全站导航站点
POST /api/jobs  {"kind":"purge_trash",...}   → 入队破坏性任务（见 P1-8）
```

令牌注释承诺的是「自己的用户域」，实际拿到的是**实例级写权限**。在 `NAVHUB_AUTH_REQUIRED=true` 的公开部署上，这是纵向越权。

**最小改法**（M，二选一）

- **方案 A（推荐，改动小）**：新增 `user_write` scope（rank 仍为 2，但 `scopeSatisfies` 只让它在用户域路由通过）。个人令牌签发 `read,user_write`；实例级令牌才发 `write`。用户域路由把 `required` 从 `write` 改成 `user_write`。
- **方案 B（更快，但语义粗）**：在 `server.ts` 的 scope 门槛里加一条——`auth.ownerIdentity` 非空且 `required === "write"` 且路由不在用户域白名单 → 403。需要维护白名单，容易漏。

**验收**：`apps/api/test/token-scope-tiers.test.ts` 补三条——
1. 个人 `write` 令牌 `POST /api/sites` → **403**；
2. 同一令牌 `POST /api/me/favorites` → **200**（用户域仍可用）；
3. 实例级 `write` 令牌（owner 为 null）`POST /api/sites` → **200**（不误伤 MCP/扩展）。

---

### P0-4【高】PostgreSQL 全文通道静默失效

**证据（A）**

| 位置 | 事实 |
|---|---|
| `packages/core/src/cjk.ts:80-81` | 拉丁词构造 `quote(w) + "*"` → `"copilot"*` |
| `packages/core/src/cjk.ts:87-89` | `quote()` 返回**双引号**包裹：`"term"` |
| `packages/store/src/fts-pg.ts:65-70` | 直接复用同一个字符串，只把 `" OR "` 换成 `" | "`，然后传给 `to_tsquery` |
| `packages/store/src/fts-pg.ts:88-92` | `catch { return [] }`——语法异常被吞成「无命中」 |

**实际行为**：`to_tsquery` 的前缀语法是 `term:*`，不是 `"term"*`；双引号也不是 tsquery 的短语分隔符。构建出的查询串在 PG 上会报 `syntax error in tsquery`，异常被 catch 吞掉，`fts` 通道**恒返回空**。

**影响**：标准模式（PostgreSQL）下五路召回少一路（BM25 全文），而搜索是产品核心能力。因为不报错、只是结果变差，线上很难被发现。**默认 lite 模式不受影响**（FTS5 语法是对的），所以这个缺陷能长期存活。

**为什么一直没被发现**：`packages/store/test/pg-dialect.e2e.test.ts:9` 在未设置 `NAVHUB_TEST_DATABASE_URL` 时**整套 skip**；默认 CI 不跑 PG，等于没有回归网。

**最小改法**（S/M）

```ts
// fts-pg.ts：按方言重建，而不是复用 FTS5 串
function buildPgTsQuery(q: string): string | null {
  // 中文：to_tsquery 接受单引号短语 '词'
  // 拉丁：前缀 term:*
  // 连接符： |
}
```
- 保留 `buildFtsQuery` 给 SQLite；新增 `buildPgTsQuery` 给 PG，两者共享分词（`hanRuns` / 拉丁正则），只换**组装语法**。
- catch 里至少 `console.warn` 一次（限流），不要静默。

**验收**：`pg-dialect.e2e.test.ts` 补两条**必须命中**的用例——
1. 中文二元词（如「启动」）→ `fts` 通道 `hits.length > 0`；
2. 英文前缀（如 `cop` 命中 `copilot`）→ `hits.length > 0`。
并在 CI 的 `test-postgres` job 里设为必过（当前该 job 存在，但需确认不是软门禁）。

---

## 4. P1 — 会造成故障或难以发现的错误

### P1-1【中高】`/api/mcp` 公开 + 工具注册表可被任意 token 覆盖

| 位置 | 事实 |
|---|---|
| `apps/api/src/routes/visual.ts:291-311` | `POST /api/mcp` 声明 `scope: "public"`，**无身份闸门** |
| `apps/api/src/routes/agents.ts:148-152` | `POST /api/tools/synthesize` 也是 `public`，只要求 `identityAllowed`（**任意 token，包括 read**） |
| `packages/core/src/webmcp-bridge.ts:59-62` | `registerTool` 对同名工具**直接 `set` 覆盖**，不校验 owner |
| `apps/api/src/routes/agents.ts:235` | 注册的工具后续由 `guardedFetch` 执行，但**注册时**不校验目标 URL |

**实际行为**：持 read 令牌（或开放模式下匿名）可以注册一个名为 `list_categories` 的工具，覆盖内置实现；随后任何调用 `/api/mcp` 的客户端都会执行攻击者指定的 URL/方法。这是 **tool poisoning + SSRF 跳板**。

**改法**：注册表按 `ownerIdentity` 分区；同名覆盖仅允许同 owner；注册要求 `write`（实例级）或 `admin`；`/api/mcp` 在鉴权模式下要求 Bearer；注册时对 URL 做一次 `guardedFetch` 预检。

**验收**：read 令牌注册 → 403；两个不同 owner 注册同名 → 第二个被拒（409）；`/api/mcp` 匿名在 `authRequired=true` 下 → 401。

---

### P1-2【中】`/api/storage` 快照绕过可见性过滤

`apps/api/src/routes/navsphere.ts:23` 的 `GET /api/storage` 只要 `read`，返回 `buildNavigationData` 全量投影；`apps/api/src/storage.ts:169-179` 的注释明确「类目与站点都不做可见性预过滤」，而 `canSeeUnpublishedSites`（`routes/shared.ts:241`）只在 `/api/sites` 生效。结果：read 令牌能看到 pending/archived/disabled 的站点与类目。

**注意**：注释解释了为什么不能在 `buildNavigationData` 里过滤——快照写回会把「快照里没有」当成「用户删了」。所以**不能改 builder**，要在路由边界按调用方 scope 过滤投影，或给非 admin 调用方走另一个只读投影函数。

**验收**：read 令牌 GET `/api/storage?path=navigation.json` → 断言不含 `enabled=false` 站点；admin → 仍含（写回语义不变）。

---

### P1-3【中】`/api/users/sync` 的签名校验只对匿名生效

`apps/api/src/routes/identity.ts:54`：`if (identitySecret && auth.kind === "anonymous")` 才验签。持**任一 read 令牌**的调用方可以 `POST /api/users/sync` upsert 任意 `provider:providerId` 的 username/email/avatar（`:66-72`）。令牌只证明「你是某个持票人」，不证明「你是这个身份」。

**改法**：只要 `identitySecret` 配置了就验签，除非 `auth.ownerIdentity === targetId`（个人令牌写自己）。**验收**：read 令牌 + 无签名 → 401；同令牌 + 正确签名 → 200。

---

### P1-4【中】LLM 配额 check-then-act 竞态

`apps/api/src/llm-quota.ts:96-125` 先读历史用量再判断；`apps/api/src/llm-usage.ts:76` 在响应返回后才落库。N 个并发请求会**同时通过**检查；开放模式下 `identityTrusted` 恒真（`routes/shared.ts:371`），逐请求换 `anonId` 即可重置身份档。

**改法**：调用前写一条 `reserved` 占位行（唯一键 `requestId`），失败再回滚/标记；未签名身份只计「合池」额度，不按身份分桶。**验收**：并发 10 个请求、额度 5 → 恰好 5 个 200、5 个 429。

---

### P1-5【中】插件体检无独立限流

`apps/api/src/plugin-audit.ts:663-676`：`sample ≤ 200`、`timeout ≤ 30s`；`routes/plugin-audit.ts` 的 `POST /api/plugins/:slug/audit` 没有 `rateLimit`。单请求可挂数分钟、出网 200 次；`ai-heal` 同理（`:860-975`）。

**改法**：加 `rateLimit { max: 2, timeWindow: "1 minute" }` + 每次请求的出网预算（总 URL 数上限），并把超时从「每 URL 30s」改为「整请求预算」。**验收**：连续两次 audit → 第二次 429；预算耗尽 → 提前返回部分结果并标记 `truncated`。

---

### P1-6【中】分页缺少唯一键兜底

`packages/store/src/repository/sites.ts:63-64`：`ORDER BY s.sort ASC, s.weight DESC LIMIT ? OFFSET ?`；`packages/store/src/search.ts:831` 同类。`sort`/`weight` 大量重复，跨页会出现**重复行或漏行**（PG 不保证同键顺序）。

**改法**：末尾追加 `, s.id ASC`（search 用 `site_id`）。**验收**：造 100 条同 `sort/weight` 的站点，逐页取 10 条，断言并集 = 100 且无重复。

---

### P1-7【中】唯一索引「先 DROP 后建」，失败静默

`packages/store/src/migrate.ts:187-188`：`DROP INDEX IF EXISTS sites_url_idx` 紧跟 `CREATE UNIQUE INDEX ...`，外层逐语句 `try/catch`。若存量有重复 URL，CREATE 失败 → **URL 唯一性从此刻起失效**，下次启动再试、再失败。

**改法**：先建新名索引（`sites_url_uniq_v2`），成功后再 DROP 旧索引；或先 `SELECT url, COUNT(*) ... HAVING COUNT(*)>1` 检测并告警。**验收**：插入重复 URL 的两行 → 第二次插入必须失败；迁移在有重复数据的库上 → 保留旧索引且打 warn。

---

### P1-8【中】`write` 令牌可入队破坏性任务

`apps/api/src/routes/jobs.ts:30-50` 的 `POST /api/jobs` 只要 `write`，但 `purge_trash`（最小 1 天）与 `data_retention`（`apply:true`）会物理删除数据；而单条永久删除要 `admin`（`routes/trash.ts:77`）。权限等级与破坏力不匹配。

**改法**：在 `POST /api/jobs` 内按 `kind` 分级——`purge_trash` / `data_retention(apply)` / `backup_restore` 要求 `admin`，其余 `write`。**验收**：write 令牌入队 `purge_trash` → 403；`recompute_rank` → 200。

---

## 5. P2 — 可维护性、可观测性、性能

| # | 问题 | 证据 | 改法 |
|---|---|---|---|
| P2-1 | `/api/health` 恒 `ok:true`，compose 用它探活 | `routes/health.ts:16-33`；`docker-compose.yml:23` | 探活改指 `/api/ready`（已真实 ping + 503）；`/api/health` 保留为 liveness |
| P2-2 | `cancelJob` 无条件返回 `true` | `repository/jobs.ts:155-159` | 返回 `changes > 0`；路由回真实结果 |
| P2-3 | `reapStaleJobs` 把 running 直接改 failed，不重试不告警 | `repository/jobs.ts:207-217` | 走正常重试路径；连续失败触发 alert |
| P2-4 | 任务无硬超时、tick 串行 | `jobs.ts:177-187`、`:435-443` | 每个 kind 声明 `timeoutMs` 并用 `Promise.race`；独立 kind 并行 |
| P2-5 | 499（客户端取消）计入 4xx 错误率 | `metrics.ts:105`、`routes/copilot.ts:287` | 单列 `cancelled` 计数 |
| P2-6 | `identityOf` 对非字符串 body 值原样返回 → 500 | `routes/shared.ts:307` | 非字符串一律 `null` |
| P2-7 | `/api/events` 无独立限流、字段无长度上限 | `routes/telemetry.ts:50-115` | 加 `rateLimit` + `.max()` |
| P2-8 | `POST /api/sites/:id/archive` 是 public 且写库 | `routes/archive.ts:101-179` | 改 `write` 或校验签名 |
| P2-9 | `/api/me/import` 逐条写，上限 2 万 | `routes/me.ts:596-633` | 批量 INSERT / 事务 |
| P2-10 | better-sqlite3 同步调用在请求热路径 | `repository/io.ts:13-22` | lite 模式接受（单机），但需在文档标注「慢查询会阻塞事件循环」；或迁 `node:sqlite` 异步 API |
| P2-11 | `purgeSite` 不清向量表 | `repository/sites.ts:483-499` | 同步 `vectorStore.remove`，否则 KNN 名额被僵尸行占用 |
| P2-12 | 向量主键 FNV32 碰撞无消解 | `vector/types.ts:50-59` | 碰撞探测或改稳定自增键 |
| P2-13 | `schema.ts` 与 DDL 漂移、drizzle 实际未被使用 | `schema.ts`（41 表）vs `driver.ts`（40 表）；全仓 0 处 `orm` 调用 | 二选一：删 `schema.ts`，或改为 drizzle-kit 生成迁移 |

---

## 6. 已证伪 / 不采纳

| 断言 | 复核结果 |
|---|---|
| 「`/api/health` 永远 200 是缺陷」 | ⚠️ **需修正表述**。这是**刻意**的 liveness 设计（注释：DB 故障时返回 500 会让容器反复重启）；真正的缺陷是 compose 探活指错了端点。已按修正后的表述列为 P2-1。 |
| 「`toPgSql` 占位符转换有 bug」 | ❌ 未发现。现有 SQL 中没有字符串字面量内的 `?`；`SQL_IN_CHK=500` 远低于 PG 65535 参数上限。 |
| 「core 引入了 node 内置模块，破坏浏览器复用」 | ❌ 证伪。`grep 'from "node:' packages/core/src` = **0** 个文件。 |
| 「`dist/` 被误提交」 | ❌ 证伪。`git ls-files packages/*/dist` = 0。 |
| 「MCP 工具 32 个」 | ⚠️ 文档过时，实测 **41 个**（28/12/1）。 |

---

## 7. 升级路线图

| 批次 | 内容 | 预估 | 前置 / 约束 |
|---|---|---|---|
| **W1 止血** | P0-1（列名）· P0-3（令牌域）· P0-4（PG tsquery）· P1-7（索引重建顺序） | **1.5–2 人日** | P0-4 需真实 PG 复现；P0-3 要同时改测试，避免误伤实例令牌 |
| **W2 数据与边界** | P0-2（事务化迁移）· P1-1（MCP 注册表）· P1-2（快照可见性）· P1-3（sync 验签）· P1-8（任务分级） | **2–3 人日** | P1-2 不能改 `buildNavigationData`（写回语义） |
| **W3 稳定性** | P1-4（配额占位）· P1-5（体检限流）· P1-6（分页唯一键）· P2-1/2/3/4 | **2–3 人日** | P1-4 需要一次 schema 变更（reservation 行） |
| **W4 治理** | P2-5~13 · `schema.ts` 决策 · 文档数字回填 | **3–5 人日** | P2-13 单独立项评审 |

**批次原则**：W1 四条必须同批验收——它们都是「小改动、高收益、可独立回滚」，分开上只会拉长验证窗口。W2 的 P0-2 是唯一的数据丢失风险，优先于其余 P1。

---

## 8. 验证清单

```bash
# P0-1：保留期真的执行
node node_modules/vitest/vitest.mjs run packages/store/test/user-settings-retention.test.ts

# P0-2：INSERT 失败时旧行仍在
node node_modules/vitest/vitest.mjs run packages/store/test/workspace-blob-migration.test.ts

# P0-3：个人 write 令牌不得改全站
node node_modules/vitest/vitest.mjs run apps/api/test/token-scope-tiers.test.ts

# P0-4：PG 全文必须命中（需要 DSN）
NAVHUB_TEST_DATABASE_URL=postgres://... node node_modules/vitest/vitest.mjs run packages/store/test/pg-dialect.e2e.test.ts

# P1-6：分页无重复/漏行
node node_modules/vitest/vitest.mjs run packages/store/test/sites-pagination.test.ts

# 全量回归 + 类型
node scripts/typecheck.mjs
node node_modules/vitest/vitest.mjs run
```

> 提醒：`pnpm verify` 默认不跑 PG 套件。P0-4 修完后，**必须**在 `test-postgres` job 里跑一次真实 DSN，否则等于没修。

---

## 9. 文档漂移修正（顺手做）

| 文件 | 要改的数字 |
|---|---|
| `docs/CODEBASE_OVERVIEW.md` §1、§5.4、§5.5 | 117 → 152 端点；25 → 40 表；32 → 41 MCP 工具 |
| `README.md` §架构 | 同上；另「洛伦兹双曲」实际是庞加莱球实现（历史遗留表述） |
| `wiki.md` §2.2 / §5.2 / §7 | 同上 |
| `docs/INDEX.md` | 增加本文条目（状态：提案） |

---

## 10. 附：本次扫描未覆盖的面

- **前端**（`apps/web-overlay` / `apps/web`）：只核对了镜像一致性机制，未做组件级审计。
- **SEO / ISR**：有独立门禁与文档，本次未重复。
- **备份恢复**：`docs/ASYNC-RESTORE-REVIEW-2026-10-25.md` 的 A1–A11 未逐条复核。
- **真实 PG 行为**：本机无 psql/docker，P0-4 的「全量失效」结论基于 SQL 语法推导，**需一条真实 PG 用例确认**（这也是把它列为 P0 而非「已证实」的原因）。

---

> 本报告由 AI 深度研究团队生成。P0 四条均已给出可复现的证据与最小改法；P1/P2 中标注 B 级的条目建议在动手前先跑一次复现用例。重要决策请经项目维护者复核。
