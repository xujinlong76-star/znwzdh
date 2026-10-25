# 备份恢复异步化 · 设计（已实现）

> 状态：**全链路已实现**（任务侧 + 两个端点 + 端点测试 + 管理端进度轮询）
>
> - 已落地：`jobs` 两列（含 `COLUMN_ALTERS` 补列）、`JobKind.backup_restore`、
>   `runBackupRestore`（分片 2000、staging 读取、进度上报、成功后删文件）、
>   `repo.updateJobProgress`、`planRestore`（同步/异步共用计划计算）、
>   `POST /api/backup/restore/async`、`GET /api/backup/restore/status/:jobId`。
> - 测试：任务侧 4 例（含 2100 条跨分片）、端点侧 6 例（含端到端 status=done）、
>   前端守卫 15 例、E2E 7 例（同步 3 + 异步 4）。
> - 前端：`/admin/data/restore` 在**预演算出的站点数 > 5000** 时自动走后台任务，
>   展示 `done/total` 进度、可「转到后台」离开页面，刷新后从 sessionStorage 接回。
>
> 实现过程中与本文档的差异（以代码为准）：
> - 完成态是 **`done`**，不是 `completed`；
> - `jobId` 不进 `payload`（入队时才生成），由 `process()` 注入；
> - status 不返回 `result`（任务不持久化结果），只返回 `progress` + `error` + `retryable`。
>
> 📌 **2026-10-25 深度审阅**：[`ASYNC-RESTORE-REVIEW-2026-10-25.md`](ASYNC-RESTORE-REVIEW-2026-10-25.md)。
> 结论是「结构正确、可用，但**任务重试会产生重复站点行**」——方案的幂等论证只在
> 请求级成立。审阅列出的 A1–A9 已全部落地，A10/A11 未做。

## 0. 实现现状（2026-10-25 补充，与下文早期设计有差异时以本节为准）

| 机制 | 现在的行为 | 为什么 |
|---|---|---|
| 重试幂等 | 每片写入前用 `findExistingSiteUrls` 过滤；分类按 id 跳过已存在 | `insertSitesBulk` 是裸 INSERT、`sites.url` 无唯一约束；`createCategory` 有同级同名检查（重试会直接抛错） |
| 断点续跑 | 从 `progress_done` 按分片对齐继续 | 重放已提交分片虽已安全，但白跑一遍且进度会从 100% 退回 0% |
| 进度语义 | `progress.done` = **已处理条数**（分片偏移），不是实际插入数 | 续跑要对齐分片边界；两者正常情况相等，只在并发/重放时有差 |
| 并发 | 已有 `pending/running/retrying` 任务 → 409 `CONFLICT_RESTORE_RUNNING`；心跳超 15 分钟视为僵尸放行 | 前端禁用按钮只是界面约束，curl 绕过就交错写入 |
| 零增量 | 计划为空 → **200 + `nothingToDo`**，不建任务 | RFC 9110：无事可做应 200，而不是 202 一个永远 0/0 的任务 |
| 契约头 | 202 带 `Location` + `Retry-After`；status 未终态带 `Retry-After` + body `retryAfterMs` | 异步模式的通行实践；让服务端指挥轮询节奏 |
| URL 归一化 | `planRestore` 与写入侧统一用 `canonicalizeUrl` | 原先两套口径，会「预演当重复、真写当新站」 |
| staging 清理 | 提交时扫过期文件，**跳过仍被非终态任务引用的** | 删掉的话那份任务重跑读不到计划，报 retryable 却永远失败 |
| 前端轮询 | 自调度 `setTimeout`，读 `retryAfterMs`，出错翻倍退避，10 分钟转后台 | 长任务不该高频轮询，也不该钉死标签页 |

---


---

## 1. 问题

### 1.1 现状（实测）

| 规模 | 备份包 | 预演 | 同步恢复 | 每千条 |
|---|---:|---:|---:|---:|
| 10,000 条 | 1.80 MB | 388 ms | **7,379 ms** | 738 ms |

线性外推到上限 50,000 条约 **37 秒**。

### 1.2 为什么这是缺陷而不是「慢」

- BFF 代理读超时 30 秒（`DEFAULT_UPSTREAM_TIMEOUT_MS`）；
- 客户端 `READ_TIMEOUT_MS` 也是 30 秒。

于是 5 万条的恢复会先拿到 **504**，而中枢事务**实际上已经提交**。用户看到失败 → 重试 → 恢复幂等所以不会重复写，但白等一次，且永远不确定到底成没成。

已做的缓解（`c7edeff`）：把 `backup` 纳入 `LONG_RUNNING_ROOTS`（120 秒）。这仍然只是「把阈值往后挪」，不是根治——数据量再翻一倍就再次失效。

### 1.3 目标

1. 恢复**不再占用 HTTP 请求时长**，无论多少条都不会因超时失败；
2. 调用方能**看到进度**（处理到第几条 / 是否在跑）；
3. 失败可归因（哪一片、什么原因），且**状态如实**（留下了几片就说几片）；
4. 与现有同步端点**共存**，不破坏任何调用方。

> ⚠️ 目标 3 的初稿写的是「不留半套数据」，**与分片方案直接矛盾**（选分片的前提就是
> 承认失败时可能留下前几片）。已按实现改正。完整的问题分析见
> [`ASYNC-RESTORE-REVIEW-2026-10-25.md`](ASYNC-RESTORE-REVIEW-2026-10-25.md)。

### 1.4 明确不做

- 不改 `insertSitesBulk` / `createdAt` 等存储语义（那是另一条线）；
- 不做断点续传（恢复本身幂等，重跑即可，收益不值复杂度）。

> 已过期：初稿这一节还写了「不改前端 admin 页面」——前端 `/admin/data/restore`
> 已经做完了（选文件 → 预演 → 勾选 → 执行/后台进度），见 §7。

---

## 2. 契约

### 2.1 提交恢复任务

```
POST /api/backup/restore/async
Content-Type: application/json
<与同步端点完全相同的备份包>
```

> 实现与初稿的两处差异：端点**不接受** `dryRun` 参数（预演另有 `?dryRun=true` 的
> 同步端点，异步提交必然是真写）；202 响应**没有** `stagedBytes`，返回的是
> `skipped` 与 `message`。

- `scope: admin`、`rateLimit: max 10 / 1 minute`（比同步端点更严：每次都会产生持久化任务）；
- 备份包校验、URL 规整、分类计划计算**全部在请求内完成**（这几步是毫秒级，见实测的 388 ms 预演）；
- 通过校验后：把规范化后的条目写入 staging 文件 → 入队 → 返回 `202`。

```json
{
  "ok": true,
  "jobId": "01j...",
  "accepted": { "categories": 12, "sites": 50000 },
  "skipped": { "duplicateCategories": 0, "invalidUrls": 0, "duplicateUrls": 0 },
  "statusUrl": "/api/backup/restore/status/01j...",
  "message": "已入队：将恢复 12 个分类与 50000 个站点（进度见 statusUrl）"
}
```

> 未实现（初稿 §6 的设计）：响应里的 `asyncRecommended` 字段**从未加上**。
> 实际的切换方式是前端按「预演算出的将写入站点数 > 5000」自行决定走哪个端点，
> 后端不提示。这比后端提示更直接，但意味着 curl 调用方需要自己判断。

**为什么校验必须在请求内**：把一份非法备份入队，用户要等到任务跑起来才知道「版本号不对」。校验是廉价的，错误应该立即返回 400。

### 2.2 查询进度

```
GET /api/backup/restore/status/:jobId
```

```json
{
  "jobId": "01j...",
  "status": "running",          // pending | running | done | failed | retrying | cancelled
  "progress": { "done": 12000, "total": 50000 },
  "startedAt": 1792836000000,
  "finishedAt": null,
  "result": null,               // done 时：{ categories, sites, durationMs, reindexQueued }
  "error": null                 // failed 时：{ reason, message, failedAt }
}
```

> ⚠️ 状态枚举以 `JobRecord.status` 为准：完成态是 **`done`**，不是 `completed`
> （本文件初稿写错过一次，实现时被测试抓到）。

- 权限：端点要求 `scope: "admin"`。**比初稿写的「发起者或 admin」更严**——job 行没有
  记录 owner identity，任何 admin 都能查任何恢复任务；jobId 是 UUID，不可枚举。
  要真做到「只有发起者能查」，得给 jobs 加 owner 列（本次没做，收益不抵复杂度）；
- 可查期：任务行**不会自动过期**。`pruneJobs` 只在手动调用 `POST /api/jobs/prune` 时
  删除 7 天前的 `done` / `failed` / `cancelled` 行。所以不存在初稿写的「24 小时后
  410 Gone」——行没了就是 404。前端不要假设一个固定可查窗口。

---

## 3. 载荷策略：为什么不能放 `jobs.payload`

`jobs.payload` 是 `TEXT/JSONB`，1.8 MB 的备份包塞进去有三个问题：

1. 队列表体积失控（每次恢复一条 1.8 MB 行，5 万条上限时更大）；
2. `claimNextJob` 每条都要读整行 → 轮询成本随历史任务数增长；
3. 备份内容含全部站点数据，让它长期留在队列表里是**数据驻留风险**。

**方案：staging 文件**

```
data/restore-staging/<uuid>.json    # 规范化后的条目（不是原始上传体）
```

- 文件名是**随机 UUID，不含 jobId**。jobId 在入队时才生成，而文件要先写才轮得到入队——
  顺序决定了名字不可能带 jobId。**代价**：任何「按 jobId 拼文件名去断言文件是否存在」的
  测试都会恒真（这是实际踩过的坑，第一版测试因此假通过）。要拿真实路径只能读
  `jobs.payload.stagingPath`。
- 路径由 `NAVHUB_RESTORE_STAGING_DIR` 覆盖（默认 `data/restore-staging`）；
- `jobs.payload` 只放 `{ stagingPath }`（< 200 字节）。**jobId 不进 payload**——
  入队那一刻才生成 id，写进 payload 必然要多一趟「入队后改 payload」；
  `JobRunner.process(kind, payload, jobId, attempts)` 本来就带 id，
  任务直接用它上报进度（已实现的 `runBackupRestore(payload, jobId)` 就是这么取的）；
- 任务成功后**立即删除** staging；失败保留供复盘/重跑；
- **过期清理**：最初写「由 `data_retention` 清理」，但那个清理从未实现——等于文档
  承诺了一个不存在的机制，失败恢复的 staging 会永久堆积（每份最多约 4MB）。
  现在改为**每次提交异步恢复时顺手扫一遍**，删掉 mtime 超过 24 小时的文件
  （`sweepStaleStaging`）。不依赖定时任务，也不新增配置项；刚失败的文件不会被删，
  因为用户很可能立刻点「重跑」；
- 写入用 `await writeFile`（异步，不阻塞事件循环）。**没有**显式 `fsync`：
  进程崩溃丢掉的是「这次恢复」，不会产生脏数据（任务还没入队或已被回收）；
  真要做到掉电安全，代价是每次恢复多一次 fsync 系统调用，收益不抵。

**多实例注意**：staging 目录必须是共享存储（PG 部署下通常是同一挂载卷）。若部署在多机且无共享卷，改用 `staging` 表（`BLOB`）+ 任务读表，二选一，**不要混用**。

---

## 4. 任务实现

新增 `JobKind: "backup_restore"`。

```ts
// apps/api/src/jobs.ts
case "backup_restore":
  // jobId 由 process() 注入，不来自 payload（入队时才生成）
  await this.runBackupRestore((payload ?? {}) as { stagingPath?: string }, jobId);
  break;

private async runBackupRestore(payload: { stagingPath?: string }, jobId: string): Promise<void> {
  const { stagingPath } = payload;
  if (!stagingPath) throw new Error("backup_restore 缺少 stagingPath");

  // 1) 读 staging（不存在 = 已被处理或过期，按失败上报而不是静默成功）
  const raw = await readFile(stagingPath, "utf8");
  const plan = JSON.parse(raw) as { categories: PlannedCategory[]; sites: PlannedSite[] };

  // 1.5) staging 里的站点必须都已解析出 categoryId——端点入队前就该做完。
  //      任务侧不做「兜底塞进未分类」：一条脏数据静默改变用户的分类结构，
  //      比明确失败更难发现。
  const missing = plan.sites.find((s) => !s.categoryId);
  if (missing) throw new Error(`staging 里有站点缺少 categoryId（例如 ${missing.url}）`);

  // 2) 分片提交：每 2000 条一个事务
  //    为什么分片而不是单事务：单事务 5 万条要持写锁 30 秒以上，
  //    而这期间所有读请求都可能排队。分片的代价是「失败时可能已提交前几片」——
  //    所以必须依赖恢复本身的幂等性（同一备份重跑只会跳过已存在的 URL）。
  const CHUNK = 2000;
  let done = 0;
  for (let i = 0; i < plan.sites.length; i += CHUNK) {
    const slice = plan.sites.slice(i, i + CHUNK);
    await this.ctx.repo.withTransaction(async () => {
      await this.ctx.repo.insertSitesBulk(slice.map(toInput), { hydrate: false });
    });
    // ⚠️ done 记的是「本片条数」，不是实际插入条数，且**本片不去重**——
    // 重试时会把已提交的片再插一遍。这是已知缺口，修复方案见审阅文档 A1。
    done += slice.length;
    await this.ctx.repo.updateJobProgress(jobId, { done, total: plan.sites.length });
  }

  // 3) 收尾：入队 reindex（语义检索补齐）+ 清理 staging
  if (plan.sites.length > 0) {
    await this.ctx.repo.enqueueJob("reindex", { vectors: true });
  }
  // 只有成功才走到这里：失败时 staging 保留，供复盘与重跑
  await unlink(stagingPath).catch(() => undefined);
}
```

### 4.1 分片 vs 单事务：一次取舍

| | 单事务 | 分片（2000/片） |
|---|---|---|
| 原子性 | 全有全无 | 失败时可能留下前几片 |
| 写锁时长 | 30 秒+（外推） | 每片约 1.5 秒（**未实测**，见下） |
| 失败恢复 | 重跑整包 | 重跑整包（幂等，已导入的跳过） |

> ⚠️ 「每片约 1.5 秒」是估的，没有基准数据。现有唯一实测点是「2100 条跨两片 9 秒」，
> 折算单片约 4.5 秒——是文档值的 3 倍。2000 这个片大小也从未做过 knee 测量。
> 这两个数字都待 A11（分片基准）补齐，别把它当事实引用。

选分片：**写锁时长是可用性问题，幂等性可以兜住原子性**。

> 初稿这句话当时只对「重新提交一次恢复」成立。任务被**自动重试**时，`runBackupRestore`
> 会从 `i=0` 重放冻结的计划，而 `insertSitesBulk` 不去重、`sites.url` 无唯一约束，
> 已提交的分片会被再插一遍；更早一步，`createCategory` 的同类目同名检查会让第二次尝试
> 直接抛错。现在分片级去重（每片写前按 URL 过滤）+ 分类按 id 跳过 + 断点续跑补上了这一层，
> 两条路径都幂等。见审阅文档 R1 / R1b。

必须保证：

1. `insertSitesBulk` 的 URL 去重是真的幂等（已验证：`findExistingSiteUrls` 只认 `deleted_at IS NULL`）；
2. 失败时**不删** staging（否则重跑没数据）；
3. 状态接口明确报 `failed` + `reason`，前端提示「已导入 N 条，重试将跳过它们」。

### 4.2 进度上报

`jobs` 表加两列：

```sql
ALTER TABLE jobs ADD COLUMN progress_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN progress_total INTEGER NOT NULL DEFAULT 0;
```

**实施注意（已核实机制）**：补列不是「自动比对 schema」，而是清单驱动——
`packages/store/src/migrate.ts` 的 `COLUMN_ALTERS` 数组 + `migrateColumns()` 逐条判存在。
所以必须加**三处**：`driver.ts` 的 `DDL_SQLITE` / `DDL_PG` 的 `CREATE TABLE`、以及
`COLUMN_ALTERS` 里两条（`sqlite` 与 `pg` 两种写法）。只改 DDL 的话老库永远拿不到新列。

不用 `recordEvent` 记进度：事件表是按时间追加的，5 万条会产生几十条噪音，而进度是
「最新值」语义。

### 4.3 心跳与僵尸判定（已核实）

`JobRunner` 的执行中心跳是 60 秒（`JOB_HEARTBEAT_DEFAULT_MS`），
`reapStaleJobs` 的僵尸判定是 `updated_at < now - 15min`。两条推论：

1. **本任务不会误判**：5 万条约 40 秒，远小于 15 分钟；
2. **但进程被杀后，任务会在 `running` 状态停留最多 15 分钟**才会被回收重试。
   所以 `GET status` 在进程刚死的窗口里只能如实报 `running`——**不要**在客户端
   自己加「超过 N 分钟就报失败」的推断，那会和真实状态打架。前端提示写
   「仍在运行，若长时间无进展请联系管理员」即可。

---

## 5. 失败语义

| 场景 | 行为 |
|---|---|
| 备份包非法 | 请求内 400，**不入队** |
| staging 写入失败 | 500，不入队（磁盘满 / 权限） |
| 任务执行抛错 | job 记 `failed` + `reason`（复用 `classifyRestoreError`），staging 保留（清理由 `sweepStaleStaging` 在下次提交时顺手做，见 §3） |
| 任务超时（`timeoutMs`） | 由 JobRunner 标记失败并放行下一轮（既有语义：超时后僵尸 handler 可能仍在跑，见 `jobs.ts` 注释） |
| 进程被杀 | 任务停留在 `running`，**最多 15 分钟**后被 `reapStaleJobs` 回收重试（判定 `updated_at < now-15min`）；staging 仍在，重跑幂等 |

`classifyRestoreError` 已是纯函数（`duplicate_key` / `foreign_key` / `not_null` / `schema` / `unknown`），直接复用。

---

## 6. 与同步端点的关系

保留 `POST /api/backup/restore`（同步），作为「小备份的快速通道」
（`LONG_RUNNING_ROOTS` 已给到 120 秒）。不强制切换——已有脚本/CI 依赖同步语义。

> 未实现：初稿计划给同步响应加 `asyncRecommended` 字段来提示调用方。**没有做**，
> 也不打算做：唯一的调用方是管理端，它在**预演之后**就知道条数，自己判断即可，
> 多一个服务端字段只是多一处要维护的口径。
>
> 实际切换规则（前端）：`preview.wouldRestore.sites > 5000` 时走异步，否则同步。
> 用「预演算出的将写入条数」而不是包里的原始条数——重复率高的包实际只写很少，
> 推给后台任务是浪费。

---

## 7. 前端（已实现）

初稿在这里写的是「当前没有入口，只能手工 curl」——那个缺口已经补上了：
`/admin/data/restore`（选文件 → 预演 → 勾选确认 → 执行/后台进度）。

实际行为（与初稿设想的三处不同）：

1. 选文件 → 本地解析并显示分类数/站点数/导出时间/大小 → 点「预演」才发请求；
2. 预演结果给出将新增与跳过项；**必须先勾选确认**才能执行；
3. 站点数 > 5000 时自动提交 `.../async`，展示 `done/total` 进度条；
4. 轮询间隔 **1.5 秒**（初稿写 2 秒），终态自动停；
5. 「转到后台，先离开本页」停止轮询但**不中断任务**；jobId 存 sessionStorage，
   刷新/换标签回来能接上（24 小时内）；
6. 完成后**不跳转**（初稿设想跳 `/admin/sitelist`）——原地展示结果，
   避免用户被带走后不知道刚才做了什么。

未做（初稿提议过）：轮询的 10 分钟上限与退避。见审阅文档 A9。

失败措辞刻意与同步路径不同：后台任务说「已写入 N 条后失败，这些会保留」，
**不说**「已整体回滚」——分片提交回不去。

---

## 8. 验收标准

实施完成后必须全绿：

1. `POST .../async` 返回 202 + jobId，`jobs` 表出现 `backup_restore` 行，staging 文件存在；
2. 非法备份返回 400，且**没有**创建任务与 staging（断言两张表/目录都无变化）；
3. 任务跑完：站点数正确、`reindex` 任务已入队、staging 文件已删除；
4. 中途抛错：job 为 `failed`、`reason` 正确、staging **保留**、已提交分片不丢；
5. 重跑同一备份：第二次 `skipped` 全命中，不产生重复站点（**请求级**幂等）；
6. 进度：运行中 `progress.done` 单调不减，`done`（终态）时 `done === total`；
7. `GET status` 对非 admin 被 scope 拦截（403），对不存在的 id 返回 404
   （初稿写的「非发起者 404」不成立：job 行没有 owner，权限是 admin-only）；
8. 1 万条端到端 < 30 秒且请求本身 < 1 秒（核心指标：**请求时长与数据量解耦**）。

> 第 5 条原来有个**未被覆盖的缺口**（本次审阅最重要的发现）：请求级幂等成立，
> 但**任务重试级不成立**——重放冻结计划会重复插入；而且带分类的备份在重试第一步
> 就会因分类撞名失败。两者均已修复，验收入口见 `backup-restore-job.test.ts` 的
> 「同一 staging 跑两遍」与「断点续跑」两例。

---

## 9. 工作量与顺序（全部已完成）

| 步骤 | 文件 | 规模 |
|---|---|---|
| 1. `jobs` 加两列 + `updateJobProgress` | `migrate.ts` / `repository/jobs.ts` | 小 |
| 2. `backup_restore` 任务 | `jobs.ts` | 中 |
| 3. staging 读写 + 两个端点 | `routes/backup.ts` | 中 |
| 4. 测试 | `apps/api/test/backup-async*.test.ts` / `backup-restore-job.test.ts` | 中 |
| 5. admin 页面 | `app/admin/data/restore/page.tsx` | 中 |

这一节保留是作为「当时怎么拆的」的记录。后续改进不在这里追加——
见 [`ASYNC-RESTORE-REVIEW-2026-10-25.md`](ASYNC-RESTORE-REVIEW-2026-10-25.md) 的 A1–A11。

---

## 10. 回滚

新增能力，不改既有语义：

- 删掉两个新端点 + `backup_restore` 任务 case；
- `jobs` 两列保留无害（`NOT NULL DEFAULT 0`）；
- staging 目录清空即可。

同步端点不受影响，任何时刻都能回退到它。
