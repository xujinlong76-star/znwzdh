# 升级执行报告（2026-10-27）——六方向落地

> 输入：[`UPGRADE-PLAN-2026-10-27-BACKEND.md`](./UPGRADE-PLAN-2026-10-27-BACKEND.md) 的 4 条 P0 + 8 条 P1
> 范围：权限域、检索方言、任务执行器、数据主权、查询治理、MCP 供应链
> 原则：每项都要有「红→绿」路径；改不动的写进「未完成」，不用注释冒充实现。

---

## 0. 结论

六个方向全部落地了**可运行的核心机制**，共新增 **9 个测试文件 / 36 条用例**，并更新了 2 个旧用例文件（其中一个把漏洞写成了契约）。

| 方向 | 核心改动 | 新增用例 |
|---|---|---:|
| [1] 权限域 | `core/authz.ts` 纯函数 + `server.ts` 双分支闸门 | 10 |
| [2] 检索方言 | `buildPgTsQuery` + `fts-pg` 接线 | 9 |
| [3] 任务执行器 | 真实取消 / 僵尸重排队 / `runWithBudget` 硬超时 | 8 |
| [4] 数据主权 | 保留期列名修复 + `data-inventory` 清单 + 注销通用路径 | 5 |
| [5] 查询治理 | 语句缓存 / 3 个索引 / 排序唯一键 / 向量清理 | 0（由回归覆盖） |
| [6] MCP 安全 | owner 隔离 / 冲突拒绝 / 注册与调用闸门 | 4 |

**验证**：`node scripts/typecheck.mjs` 5 包全过；后端三包全量 **1966 passed / 0 failed / 28 skipped**（196 个文件）；`pnpm lint:backend` 两包 `--max-warnings 0` 通过；`sync-core-mirrors --check` 13 条逐字节一致；`check-web-overlay` 714 文件一致。

> 前端 `apps/web` / `apps/web-overlay` 合计 **4134 passed / 47 failed**，失败**全部集中在 `apps/web-overlay/test`（17 个文件）**，根因是 overlay 未安装 Next 运行时（`Cannot find package 'next/server'`）与本地身份 mock 缺失；`apps/web` 侧全绿。本次对前端的唯一改动是 `webmcp-bridge` 的逐字节镜像，而前端测试没有任何文件引用该模块——这些失败与本次改动无关，属环境性基线。

---

## 1. 权限域：个人令牌不得越权到实例写面（P0-3）

### 改了什么

| 文件 | 改动 |
|---|---|
| `packages/core/src/authz.ts`（新） | `evaluateInstanceWrite` / `isPersonalWritePath` / `pathnameOf`。规则只有一条：**owner 非空的令牌，`write` 不得落在实例写面**；`read/admin` 不收窄 |
| `packages/api/src/server.ts` | 鉴权分支与**开放模式早退分支**各调用一次。开放模式原先直接 `return`，不拦的话个人令牌在开放部署里比鉴权模式更宽松 |
| `packages/core/src/index.ts` | 导出 authz |
| `apps/api/src/routes/me.ts` | 令牌签发注释补充边界说明 |

### 为什么不是改 scope 词表

用户域路由（收藏/历史/画像/金库/工作区/CRDT）的 scope 是 `public`，真正的闸门是 handler 里的 `userDomainWriteAllowed`。所以不需要新增 `user_write` 等级，也不需要在 30 个路由文件里改 `scope`——**一个路径闸门就够**，且规则集中在一处。

### 验收

- `packages/core/test/authz.test.ts`：9 条实例路径拒绝、投稿修改放行、实例令牌不受影响、query/hash 不能绕过、绝对 URL 拒绝。
- `apps/api/test/personal-token-boundary.test.ts`：真实签发个人 write 令牌 → `POST /api/sites` **403 且未落库**；同令牌 `POST /api/favorites` **201**；实例 write 令牌 `POST /api/sites` **201**；个人令牌 `POST /api/jobs` **403**。
- 旧用例 `auth.test.ts` 里「read 令牌 synthesize 返回 200」被改写为「read → 403，write → 200」——那条断言本身就是 P1 的漏洞。

---

## 2. 检索方言：PostgreSQL 全文通道（P0-4）

### 改了什么

| 文件 | 改动 |
|---|---|
| `packages/core/src/cjk.ts` | 新增 `buildPgTsQuery`：中文 `'二元组'`、拉丁 `'term':*`、连接符 `|`、单引号双写转义 |
| `packages/store/src/fts-pg.ts` | 改用 `buildPgTsQuery`，删除 `OR → |` 的字符串替换；catch 里**只告警一次**，不再静默 |

### 关键差异（此前整条通道失效的原因）

```
FTS5    → "copilot"*      （双引号短语 + 尾星号）
tsquery → 'copilot':*     （单引号词元 + :*）
```

`to_tsquery` 收到双引号会抛语法错误，`fts-pg` 的 `catch { return [] }` 把它吞成「零命中」。默认 lite 模式走 FTS5 不受影响，所以这个缺陷能长期存活。

### 验收

- `packages/core/test/cjk-pg-query.test.ts`：中文/英文/混合/标点/单字母，并断言与 FTS5 构造器**产出不同**（防止有人再合并）。
- `packages/store/test/fts-pg-query.test.ts`：用假 db 捕获真实 SQL 参数，断言传给 `to_tsquery` 的是 `'copilot':*`，纯标点不发起查询。

> ⚠️ 真实 PG 命中率仍需一条带 DSN 的用例确认。本机没有 psql/docker，`pg-dialect.e2e` 在无 `NAVHUB_TEST_DATABASE_URL` 时整套 skip——这也是它能潜伏这么久的原因。

---

## 3. 任务执行器：取消、僵尸回收、硬超时（P1）

| 文件 | 改动 |
|---|---|
| `packages/store/src/repository/jobs.ts` | `cancelJob` 改 `RETURNING id`，返回真实结果；`reapStaleJobs(repo, timeoutMs, maxAttempts=3)` 按 attempts 分流：有额度 → `pending` + 立即到期，耗尽 → `failed` |
| `apps/api/src/jobs.ts` | 新增 `JobBudgetExceededError` + `runWithBudget`；`process()` 用预算包裹整个 switch；超时**不重试**（handler 可能仍在后台跑，立刻重试会并发执行），落 failed 并告警 |

### 为什么超时不重试

`handler` 没有贯穿 AbortSignal，`Promise.race` 只能让 Runner 脱身，掐不掉正在跑的抓取/嵌入。若把超时当普通失败重试，同一任务会被两个执行流并发处理——比重置为 retrying 更糟。因此超时是**终态**，人工确认后从管理端 retry。

### 验收

- `packages/store/test/jobs-lifecycle.test.ts`：pending 可取消 / done 返回 false；`attempts=1` 的僵尸回到 pending 且 `next_run_at` 有值；`attempts=3` 落 failed；心跳新鲜的不被回收。
- `apps/api/test/job-budget.test.ts`：预算内原样返回、超时抛带 kind 的错误、业务异常不被误报成超时、`budget<=0` 直通、超时后快速返回（定时器已清理）。

---

## 4. 数据主权：清单化与保留期（P0-1 / P1）

### 改了什么

| 文件 | 改动 |
|---|---|
| `packages/store/src/repository/settings.ts` | `SELECT user_id` → `SELECT identity`（真实库已复现：`no such column: user_id`） |
| `packages/store/src/data-inventory.ts`（新） | 19 个用户数据域 + 24 张显式豁免表；`delete` / `nullify` / `key-prefix` / `custom` 四种处置 |
| `packages/store/src/repository/user-data.ts` | 注销时对 `delete` 域走通用循环（11 张表），特例（金库/CRDT/别名/合并/插件计数/工作区/users）保留显式实现 |
| `packages/store/src/index.ts` | 导出清单 |

### 清单的牙齿在哪

`packages/store/test/data-inventory.test.ts` 遍历**真实库**的 `sqlite_master` + `PRAGMA table_info`：

1. 任何带 `user_id/identity/owner_identity/alias/canonical/source/target` 列、却既没登记也没豁免的表 → 红；
2. 清单里登记了不存在的表/列 → 红（防拼写错误）；
3. 双列归属的域必须是 `custom`（否则通用循环只删一半）。

并加了「防空跑」断言：表数 > 20、归属表数 ≥ 15，避免迁移失败时循环零命中通过。

### 验收

- `packages/store/test/user-retention.test.ts`：30/90 天被返回，默认 180 与非法 0 被跳过，坏 JSON 不中断整轮。
- `packages/store/test/data-inventory.test.ts`：3 条。
- 既有 `user-data.test.ts` / `user-data-crdt.test.ts` 全绿（证明通用循环没有改变删除范围）。

---

## 5. 查询治理

| 文件 | 改动 |
|---|---|
| `packages/store/src/repository/io.ts` | SQLite prepared statement LRU 缓存（WeakMap 按 db 实例隔离，上限 200；PG 不做，避免命名语句与迁移冲突） |
| `packages/store/src/migrate.ts` | 新增 `favorites_site_idx`、`favorites_user_folder_idx`、`llm_usage_identity_idx` |
| `packages/store/src/repository/sites.ts` | `ORDER BY ... , s.id ASC` |
| `packages/store/src/search.ts` | exact / pinyin / browse 三处排序补 `id ASC` |
| `packages/store/src/repository/jobs.ts` + `repository.ts` + `apps/api/src/jobs.ts` | `purgeExpiredDeletedSites` 返回 `{purged, ids}`；`runPurgeTrash` 同步 `ctx.vectors.remove(ids)` |

### 为什么只给 SQLite 做语句缓存

better-sqlite3 每次 `prepare()` 都编译 SQL，仓储一次请求会走十几个 `raw/run`，缓存收益直接。node-postgres 的命名预处理语句绑定在连接上，迁移/重启后容易出现 `prepared statement already exists`，风险大于收益，交给服务端 plan cache。

### 未完成

- **Keyset 分页**只做了「唯一键兜底」，没有把 OFFSET 改成 `WHERE (sort,id) > (?,?)`。原因：列表端点有 `offset` 公共参数与前端分页契约，改动需要同步 API 文档与前端；先修正确性（重复/漏行），性能优化单独立项。

---

## 6. MCP 工具供应链

| 文件 | 改动 |
|---|---|
| `packages/core/src/webmcp-bridge.ts` | 注册项带 `owner`；`registerOwnedTool` 返回 `{ok}` 或 `{ok:false, reason:"full"|"conflict"}`；`listTools(caller)` 与 `handleRpc(request, caller)` 按 owner 过滤；不可见与不存在返回同一错误 |
| `apps/api/src/routes/agents.ts` | 鉴权模式下注册要求 `write`；`owner = requestIdentityOf`；冲突 → 409，表满 → 429；openapi 批量注册统计 `conflicts` |
| `apps/api/src/routes/visual.ts` | `/api/mcp` 鉴权模式要求持票；`handleRpc` 传 caller |
| `apps/web-overlay/src/lib/webmcp-bridge.ts`、`apps/web/src/lib/webmcp-bridge.ts` | 由 `sync-core-mirrors.mjs` 生成，13 条镜像逐字节一致 |

### 验收

`packages/core/test/webmcp-owner-isolation.test.ts`：私有工具只对注册者可见/可调用；跨 owner 同名 → conflict；同 owner 可覆盖；内置工具对所有人可见；表满只影响新工具。

### 未完成

- **签名清单（manifest + Sigstore）**与 **capability ticket** 未做。当前只做到「owner 隔离 + 注册需写权限」，足以挡住 tool poisoning 与跨用户覆盖；签名体系需要密钥管理与发布流程，属独立立项。
- 开放模式下 owner 来自未验签的自称头——这是开放模式的既有前提（无鉴权），已在文档标注。

---

## 7. 行为变更与兼容性

| 变更 | 影响 | 处理 |
|---|---|---|
| 个人 `write` 令牌访问实例写面 → 403 | 依赖该越权行为的客户端会失败 | 这是修复本身；实例级自动化应改用实例令牌（owner 为空） |
| `/api/tools/synthesize` 鉴权模式下要求 `write` | read 令牌不能再注册工具 | 旧测试断言已改写；UI 若用 read 令牌注册需换 write |
| `/api/mcp` 鉴权模式下要求持票 | 匿名调用 401 | 与「工具表是进程级共享状态」一致 |
| `purgeExpiredDeletedSites` 返回 `{purged, ids}` | 内部 API | 唯一调用点已同步 |
| `reapStaleJobs` 僵尸任务回 `pending` | 管理端会看到重试而非 failed | 与 `MAX_JOB_ATTEMPTS` 语义一致 |
| `cancelJob` 终态返回 false | 管理端回执变诚实 | 前端若忽略返回值则无感 |

---

## 8. 未完成清单（下一轮输入）

按影响排序，均为本轮**明确没做**、不是「忘了」：

1. **P0-2 迁移事务化**：`migrate.ts:232-238` 的 `INSERT...SELECT` + `DELETE` 仍是两条独立语句、各自 try/catch。本轮没有动它——迁移属于启动路径，改动需要单独的故障注入测试（让 INSERT 失败、断言旧行仍在），不能和六方向混在一批里上。**这是当前唯一未处理的 P0。**
2. **P1-7 唯一索引重建顺序**：`migrate.ts:187-188` 仍是先 `DROP INDEX` 再 `CREATE UNIQUE INDEX`，失败会静默丢唯一性。改法（先建新名、成功后再删旧名）已写在方案里，未实施。
3. **P1-8 任务按 kind 分级**：个人令牌已被整体挡在 `/api/jobs` 外（本轮闸门的副作用），但**实例 write 令牌**仍可入队 `purge_trash` / `data_retention(apply)`。按 kind 要求 admin 的分级未做。
4. **真实 PG 验证**：`buildPgTsQuery` 的命中率需要 `NAVHUB_TEST_DATABASE_URL` 跑一次 `pg-dialect.e2e`；CI 的 `test-postgres` 应为必过。
5. **AbortSignal 贯穿**：`runWithBudget` 只是 watchdog，抓取/嵌入仍在后台跑。要真正省资源，需把 signal 传进 `runHealthCheck` / `runRefetch` / `guardedFetch`。
6. **Keyset 分页**：见 §5。
7. **LLM 配额原子占位**：`checkLlmQuota` 仍是 check-then-act，N 并发全放行。
8. **插件体检限流**：`POST /api/plugins/:slug/audit` 仍无独立额度（单请求可出网 200 次）。
9. **`/api/storage` 快照可见性**：read 令牌仍能读到未发布站点。
10. **`/api/users/sync` 验签**：仍只对 anonymous 生效，持票者可改任意身份资料。
11. **MCP 签名清单 / capability ticket**：见 §6。
12. **`schema.ts` 与 DDL 漂移**：41 个 drizzle 定义 vs 40 张实际表，全仓 0 处使用 `orm`。
13. **导出仍显式**：清单驱动了注销，导出仍是手写 loader；`exportField` 目前只做文档与测试锚点。

---

## 9. 验证命令

```bash
node scripts/typecheck.mjs
node scripts/sync-core-mirrors.mjs --check
node scripts/check-web-overlay.mjs

# 后端三包全量（本次实测：1966 passed / 0 failed / 28 skipped）
node node_modules/vitest/vitest.mjs run packages/core packages/store apps/api --maxWorkers=2

node node_modules/vitest/vitest.mjs run \
  packages/core/test/authz.test.ts \
  packages/core/test/cjk-pg-query.test.ts \
  packages/core/test/webmcp-owner-isolation.test.ts \
  packages/store/test/data-inventory.test.ts \
  packages/store/test/user-retention.test.ts \
  packages/store/test/jobs-lifecycle.test.ts \
  packages/store/test/fts-pg-query.test.ts \
  apps/api/test/personal-token-boundary.test.ts \
  apps/api/test/job-budget.test.ts

# 受影响面回归
node node_modules/vitest/vitest.mjs run \
  apps/api/test/auth.test.ts \
  apps/api/test/token-scope-tiers.test.ts \
  apps/api/test/jobs.test.ts \
  packages/store/test/user-data.test.ts
```

---

> 本报告由 AI 深度研究团队生成。六项改造均已跑过定向测试与类型检查；真实 PostgreSQL 的全文命中率仍需一次带 DSN 的验证，未完成项见 §8。
