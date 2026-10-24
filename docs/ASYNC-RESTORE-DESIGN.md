# 备份恢复异步化 · 设计（待实施）

> 状态：**任务侧已实现，端点未实施**
>
> - 已落地：`jobs` 两列（`progress_done` / `progress_total`，含 `COLUMN_ALTERS` 补列）、
>   `JobKind.backup_restore`、`runBackupRestore`（分片 2000、staging 读取、进度上报、
>   成功后删文件）、`repo.updateJobProgress`、4 例任务测试（含 2100 条跨分片）。
> - 未落地：两个 HTTP 端点、staging 写入、status 的 owner 校验、前端轮询。
> - 阻塞原因：`apps/api/src/routes/backup.ts` 当前在并行会话的未提交改动中
>   （修复「恢复丢失 `enabled`」）。
>
> 本文档的目标是让剩余部分变成「照单落地」，而不是重新讨论方案。

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
3. 失败可归因（哪一批、什么原因），且**不留半套数据**；
4. 与现有同步端点**共存**，不破坏任何调用方。

### 1.4 明确不做

- 不改 `insertSitesBulk` / `createdAt` 等存储语义（那是另一条线）；
- 不做断点续传（恢复本身幂等，重跑即可，收益不值复杂度）；
- 不改前端 admin 页面（当前**没有恢复入口**，见 §7）。

---

## 2. 契约

### 2.1 提交恢复任务

```
POST /api/backup/restore/async?dryRun=false
Content-Type: application/json
<与同步端点完全相同的备份包>
```

- `scope: admin`、`rateLimit: max 10 / 1 minute`（比同步端点更严：每次都会产生持久化任务）；
- 备份包校验、URL 规整、分类计划计算**全部在请求内完成**（这几步是毫秒级，见实测的 388 ms 预演）；
- 通过校验后：把规范化后的条目写入 staging 文件 → 入队 → 返回 `202`。

```json
{
  "ok": true,
  "jobId": "01j...",
  "accepted": { "categories": 12, "sites": 50000 },
  "stagedBytes": 1887436,
  "statusUrl": "/api/backup/restore/status/01j..."
}
```

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

- 只允许**发起者或 admin** 查询（job 记录 owner identity）；
- `done` 后 24 小时内可查，之后返回 `410 Gone`。

---

## 3. 载荷策略：为什么不能放 `jobs.payload`

`jobs.payload` 是 `TEXT/JSONB`，1.8 MB 的备份包塞进去有三个问题：

1. 队列表体积失控（每次恢复一条 1.8 MB 行，5 万条上限时更大）；
2. `claimNextJob` 每条都要读整行 → 轮询成本随历史任务数增长；
3. 备份内容含全部站点数据，让它长期留在队列表里是**数据驻留风险**。

**方案：staging 文件**

```
data/restore-staging/<jobId>.json     # 规范化后的条目（不是原始上传体）
data/restore-staging/<jobId>.meta.json # { accepted, uploadedBy, createdAt }
```

- 路径由 `NAVHUB_RESTORE_STAGING_DIR` 覆盖（默认 `data/restore-staging`）；
- `jobs.payload` 只放 `{ stagingPath }`（< 200 字节）。**jobId 不进 payload**——
  入队那一刻才生成 id，写进 payload 必然要多一趟「入队后改 payload」；
  `JobRunner.process(kind, payload, jobId, attempts)` 本来就带 id，
  任务直接用它上报进度（已实现的 `runBackupRestore(payload, jobId)` 就是这么取的）；
- 任务成功后**立即删除** staging 文件；失败保留供复盘/重跑，由 `data_retention` 清理；
- 写入用 `writeFileSync` + `fsync`，入队成功后才返回 202——否则任务可能读到半截文件。

**多实例注意**：staging 目录必须是共享存储（PG 部署下通常是同一挂载卷）。若部署在多机且无共享卷，改用 `staging` 表（`BLOB`）+ 任务读表，二选一，**不要混用**。

---

## 4. 任务实现

新增 `JobKind: "backup_restore"`。

```ts
// apps/api/src/jobs.ts
case "backup_restore":
  await this.runBackupRestore((payload ?? {}) as { stagingPath?: string; jobId?: string });
  break;

private async runBackupRestore(payload: { stagingPath?: string; jobId?: string }): Promise<void> {
  const { stagingPath, jobId } = payload;
  if (!stagingPath || !jobId) throw new Error("backup_restore 缺少 stagingPath / jobId");

  // 1) 读 staging（不存在 = 已被处理或过期，按失败上报而不是静默成功）
  const raw = await readFile(stagingPath, "utf8");
  const plan = JSON.parse(raw) as { categories: PlannedCategory[]; sites: PlannedSite[] };

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
    done += slice.length;
    await this.ctx.repo.updateJobProgress(jobId, { done, total: plan.sites.length });
  }

  // 3) 收尾：入队 reindex（语义检索补齐）+ 清理 staging
  await this.ctx.repo.enqueueJob("reindex", { vectors: true });
  await unlink(stagingPath).catch(() => undefined);
}
```

### 4.1 分片 vs 单事务：一次取舍

| | 单事务 | 分片（2000/片） |
|---|---|---|
| 原子性 | 全有全无 | 失败时可能留下前几片 |
| 写锁时长 | 30 秒+ | 每片约 1.5 秒 |
| 失败恢复 | 重跑整包 | 重跑整包（幂等，已导入的跳过） |

选分片：**写锁时长是可用性问题，幂等性可以兜住原子性**。但必须保证：

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
| 任务执行抛错 | job 记 `failed` + `reason`（复用 `classifyRestoreError`），staging 保留 24h |
| 任务超时（`timeoutMs`） | 由 JobRunner 标记失败并放行下一轮（既有语义：超时后僵尸 handler 可能仍在跑，见 `jobs.ts` 注释） |
| 进程被杀 | 任务停留在 `running`，**最多 15 分钟**后被 `reapStaleJobs` 回收重试（判定 `updated_at < now-15min`）；staging 仍在，重跑幂等 |

`classifyRestoreError` 已是纯函数（`duplicate_key` / `foreign_key` / `not_null` / `schema` / `unknown`），直接复用。

---

## 6. 与同步端点的关系

保留 `POST /api/backup/restore`（同步），并在响应里加一个提示字段：

```json
{ "ok": true, ..., "asyncRecommended": true }
```

规则：条目数 > `NAVHUB_RESTORE_ASYNC_THRESHOLD`（默认 5000）时 `asyncRecommended: true`。不强制切换——已有脚本/CI 依赖同步语义，破坏它们不值当。

同步端点保持现状（`LONG_RUNNING_ROOTS` 已给到 120 秒），作为「小备份的快速通道」。

---

## 7. 前端（当前没有入口）

`grep -r "backup/restore" apps/web-overlay/src` 的结果为空——**admin 冷备目前只能手工 curl**。这本身是一个独立缺口。

异步化之后补一个最小页面 `/admin/data/restore`：

1. 选文件 → 预演（现有 `dryRun=true`）→ 显示「将新增 N 分类 / M 站点」；
2. 确认 → `POST .../async` → 拿到 jobId；
3. 每 2 秒轮询 status，展示 `done/total` 进度条；
4. 完成 → 跳转 `/admin/sitelist` 并提示「已恢复 N 条，语义索引正在后台重建」。

轮询要有上限（例如 10 分钟）与「继续在后台跑」的出口——长任务不应该把标签页钉死。

---

## 8. 验收标准

实施完成后必须全绿：

1. `POST .../async` 返回 202 + jobId，`jobs` 表出现 `backup_restore` 行，staging 文件存在；
2. 非法备份返回 400，且**没有**创建任务与 staging（断言两张表/目录都无变化）；
3. 任务跑完：站点数正确、`reindex` 任务已入队、staging 文件已删除；
4. 中途抛错：job 为 `failed`、`reason` 正确、staging **保留**、已提交分片不丢；
5. 重跑同一备份：第二次 `skipped` 全命中，不产生重复站点（幂等）；
6. 进度：运行中 `progress.done` 单调不减，`completed` 时 `done === total`；
7. `GET status` 对非发起者返回 404（不泄漏 job 存在性）；
8. 1 万条端到端 < 30 秒且请求本身 < 1 秒（核心指标：**请求时长与数据量解耦**）。

---

## 9. 工作量与顺序

| 步骤 | 文件 | 规模 |
|---|---|---|
| 1. `jobs` 加两列 + `updateJobProgress` | `migrate.ts` / `repository/jobs.ts` | 小 |
| 2. `backup_restore` 任务 | `jobs.ts` | 中 |
| 3. staging 读写 + 两个端点 | `routes/backup.ts` | 中 |
| 4. 测试（上表 8 条） | `apps/api/test/backup-async*.test.ts` | 中 |
| 5. admin 页面 | `app/admin/data/restore/page.tsx` | 中 |

前 4 步完成即可用于生产（用 curl 触发）；第 5 步是体验补齐。

---

## 10. 回滚

新增能力，不改既有语义：

- 删掉两个新端点 + `backup_restore` 任务 case；
- `jobs` 两列保留无害（`NOT NULL DEFAULT 0`）；
- staging 目录清空即可。

同步端点不受影响，任何时刻都能回退到它。
