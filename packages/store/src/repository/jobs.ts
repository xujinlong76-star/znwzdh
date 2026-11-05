import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import type {
  JobRecord,
} from "./records.ts";
import {
  rowToJob,
} from "./dialect.ts";

/**
 * 上报长任务进度（异步恢复等）。
 *
 * 两条刻意的约束：
 *
 * 1. **只写 running 的任务**。已完成/失败的任务不该再被进度写回，否则 status
 *    接口会看到「completed 但 progress 还在变」这种自相矛盾的状态。
 * 2. **顺带刷新 updated_at**。`JobRunner` 的僵尸判定就是看 updated_at
 *    （`< now-15min`），进度心跳顺带延长了存活期——长任务因此不需要额外的
 *    「我在跑」信号。
 *
 * 不返回影响行数：调用方（任务自身）已经知道自己该不该报进度，
 * 为一次 UPDATE 再补一次 SELECT 不划算。
 */
export async function updateJobProgress(
  repo: Repository,
  id: string,
  progress: { done: number; total: number },
): Promise<void> {
  const done = Math.max(0, Math.floor(progress.done));
  const total = Math.max(0, Math.floor(progress.total));
  await repo.run(
    "UPDATE jobs SET progress_done = ?, progress_total = ?, updated_at = ? WHERE id = ? AND status = 'running'",
    [done, total, Date.now(), id],
  );
}

export async function enqueueJob(repo: Repository, kind: string, payload: unknown): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await repo.run(
    // next_run_at 显式置 NULL：重试/重入同一语义 = 立即可被认领
    "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at, next_run_at) VALUES (?,?,?, 'pending', 0, ?, ?, NULL)",
    [id, kind, payload === undefined ? null : JSON.stringify(payload), now, now],
  );
  return id;
}

/**
 * 幂等入队：同 kind 已有「没跑完」的行就跳过，返回 null。
 *
 * 给独立的 cron 定时器用（`JobRunner.startCronTimer`）。它不能再搭在任务消费的
 * tick 里：串行 tick 会被一个长任务占住整轮，5 分钟一次的排期实际要等 10 分钟才
 * 入队——排期到点这件事不该依赖「上一轮任务跑完了」。
 * 去掉锁依赖的代价必须由这里补回来：多实例各自有定时器，没有去重就是每个周期
 * 每个实例投一条同样的任务（重复抓取、重复重算）。
 *
 * 「查重 + 插入」在同一事务里：SQLite 的写锁保证同进程内不交错，PG 靠
 * `NOT EXISTS` 的子查询在同一语句内完成（两个实例仍可能同时判定「没有」，
 * 最多多一条重复任务——与引入定时器之前的行为一致，不会更差）。
 */
export async function enqueueJobIfAbsent(repo: Repository, kind: string, payload: unknown): Promise<string | null> {
  const id = randomUUID();
  const now = Date.now();
  const payloadJson = payload === undefined ? null : JSON.stringify(payload);
  const live = "('pending', 'running', 'retrying', 'cancelling')";
  if (repo.db.dialect === "pg") {
    const rows = await repo.raw(
      "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at, next_run_at) " +
        "SELECT ?, ?, ?, 'pending', 0, ?, ?, NULL " +
        "WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE kind = ? AND status IN " + live + ") RETURNING id",
      [id, kind, payloadJson, now, now, kind],
    );
    return rows[0]?.id ? String(rows[0].id) : null;
  }
  return repo.withTransaction(async () => {
    const existing = await repo.raw(
      "SELECT id FROM jobs WHERE kind = ? AND status IN " + live + " LIMIT 1",
      [kind],
    );
    if (existing.length > 0) return null;
    await repo.run(
      "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at, next_run_at) VALUES (?,?,?, 'pending', 0, ?, ?, NULL)",
      [id, kind, payloadJson, now, now],
    );
    return id;
  });
}

export interface ClaimJobOptions {
  /** 只认领这些 kind（PG 按 kind 并发时每个 lane 用自己的 kind）；缺省 = 不限 */
  kinds?: string[];
  /**
   * 这些 kind 排到队尾（串行消费时的「短任务优先」）。
   * 长任务（重建索引、恢复备份、保留策略）一旦被认领就占满整个执行体，
   * 让排在最前面的 5 秒巡检等 10 分钟毫无意义；反过来长任务等一个巡检不痛。
   */
  deferKinds?: string[];
}

function claimFilters(opts: ClaimJobOptions): { kindFilter: string; order: string } {
  const kindFilter = opts.kinds?.length
    ? " AND kind IN (" + opts.kinds.map(() => "?").join(",") + ")"
    : "";
  const order = opts.deferKinds?.length
    ? "CASE WHEN kind IN (" + opts.deferKinds.map(() => "?").join(",") + ") THEN 1 ELSE 0 END, created_at ASC"
    : "created_at ASC";
  return { kindFilter, order };
}

export async function claimNextJob(repo: Repository, opts: ClaimJobOptions = {}): Promise<JobRecord | null> {
  const { kindFilter, order } = claimFilters(opts);
  // 占位符顺序必须按 SQL 文本顺序：先 WHERE（now + kinds），再 ORDER BY（deferKinds）
  const filters = [...(opts.kinds ?? []), ...(opts.deferKinds ?? [])];
  if (repo.db.dialect === "pg") {
    const now = Date.now();
    const rows = await repo.raw(
      "WITH next AS (" +
        "SELECT id FROM jobs WHERE status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?)" + kindFilter + " " +
        "ORDER BY " + order + " LIMIT 1 FOR UPDATE SKIP LOCKED" +
        ") UPDATE jobs SET status = 'running', attempts = attempts + 1, next_run_at = NULL, updated_at = ? " +
        "FROM next WHERE jobs.id = next.id RETURNING jobs.*",
      [now, ...filters, now],
    );
    const row = rows[0];
    return row ? rowToJob(row) : null;
  }
  return repo.withTransaction(async () => {
    const rows = await repo.raw(
      "SELECT * FROM jobs WHERE status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?)" + kindFilter +
        " ORDER BY " + order + " LIMIT 1",
      [Date.now(), ...filters],
    );
    const row = rows[0];
    if (!row) return null;
    await repo.run(
      "UPDATE jobs SET status = 'running', attempts = attempts + 1, next_run_at = NULL, updated_at = ? WHERE id = ? AND status = 'pending'",
      [Date.now(), String(row.id)],
    );
    // 返回更新后的行（attempts 已 +1），调用方拿到的就是最新状态
    const updated = (await repo.raw("SELECT * FROM jobs WHERE id = ?", [String(row.id)]))[0];
    return updated ? rowToJob(updated) : rowToJob(row);
  });
}

export async function completeJob(
  repo: Repository,
  id: string,
  error?: string | null,
  opts: { retryAt?: number | null; exhausted?: boolean; durationMs?: number } | null = null,
): Promise<boolean> {
  const now = Date.now();
  /**
   * 本次执行耗时。与 `updated_at - created_at` 的区别：后者含**排队等待**——
   * 一个在队列里躺了 3 分钟才被认领的任务，用它算出来是 180 秒，看着像执行很慢。
   * 排查「tick 为什么慢」时必须用这一列，否则会去优化错的任务。
   */
  const durationMs = Math.max(0, Math.floor(opts?.durationMs ?? 0));
  // CAS 到 running：任务被取消 / 被 reaper 回收 / 已被另一个实例接管后，
  // 迟到的执行结果不得再改写终态。旧实现无条件 UPDATE，一个跑超时的 handler
  // 醒来后能把 cancelled 覆盖成 done，甚至把别人重跑后的 failed 改回 done。
  if (error && !opts?.exhausted && opts?.retryAt) {
    const rows = await repo.raw(
      "UPDATE jobs SET status = 'pending', error = ?, next_run_at = ?, updated_at = ?, duration_ms = ? WHERE id = ? AND status = 'running' RETURNING id",
      [error, opts.retryAt, now, durationMs, id],
    );
    return rows.length > 0;
  }
  const rows = await repo.raw(
    "UPDATE jobs SET status = ?, error = ?, next_run_at = NULL, updated_at = ?, duration_ms = ? WHERE id = ? AND status = 'running' RETURNING id",
    [error ? "failed" : "done", error ?? null, now, durationMs, id],
  );
  return rows.length > 0;
}

/**
 * 执行中任务的心跳：刷新 updated_at，供 reapStaleJobs 区分「真僵尸」与「长任务」。
 *
 * 没有它时 reapStaleJobs 只能按 updated_at 一刀切 15 分钟：巡检/重索引/嵌入
 * 这类合法长任务会被另一实例当僵尸回收，随后原 handler 还在跑，同一任务被并发执行。
 * 返回 false 表示任务已不在 running（被取消或已被回收），调用方可据此提前收手。
 */
/**
 * 执行心跳：给「仍在跑」的任务续期，并回报它此刻处于哪个执行态。
 *
 * 返回值刻意不是布尔——Runner 要区分三种情况：
 *   - `running`   ：一切正常，继续跑；
 *   - `cancelling`：有人按了取消，handler 需要在下一个分片边界主动收手；
 *   - `null`      ：行已离开执行态（被 reaper 回收 / 别的实例接管 / 已落终态），
 *                   再跑就是双写，必须立即停手。
 * 旧实现只回 true/false 且调用方把返回值丢掉，于是后两种情况都要等完成回写的
 * CAS 失败才被发现——最坏要拖满一整轮任务。
 *
 * 覆盖 `cancelling` 同样重要：收尾期间进程还活着，`updated_at` 必须继续前进，
 * 否则 reaper 会在 handler 还没停手时就把任务重新排队（又造出一次并发执行）。
 *
 * 方言判据写「非 pg」（与 migrate.ts 一致）：libsql 与 sqlite 共用同步 runner，
 * 旧代码的 `=== "sqlite"` 在 libsql 上会掉进 pg 分支取 `db.pg` 而抛错，
 * 调用方的 catch 把它吞掉——等于 libsql 部署上任务心跳从未生效过。
 */
export async function heartbeatJob(repo: Repository, id: string): Promise<"running" | "cancelling" | null> {
  const rows = await repo.raw(
    "UPDATE jobs SET updated_at = ? WHERE id = ? AND status IN ('running', 'cancelling') RETURNING status",
    [Date.now(), id],
  );
  const status = String(rows[0]?.status ?? "");
  return status === "running" || status === "cancelling" ? status : null;
}

/**
 * 任务历史列表（分页）。
 *
 * 排序必须是 `created_at DESC, id DESC` 而不是只按时间：批量入队（导入/巡检）
 * 会让大量行落在同一毫秒，单键排序在跨页时既不稳定（方言可自由选择并列顺序），
 * 也会把同一行在两页里各返回一次。id 作为第二键给出全序，翻页才真的无重复无遗漏。
 * 对应索引见 migrate.ts 的 jobs_created_idx / jobs_status_created_idx。
 */
export async function listJobs(repo: Repository, status?: string, limit = 50, offset = 0): Promise<JobRecord[]> {
  // `kind = 'kv'` 是 KV 存储借住在 jobs 表里的行，不是任务：管理端列表不该出现
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 50;
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  const rows = status
    ? await repo.raw(
        "SELECT * FROM jobs WHERE status = ? AND kind <> 'kv' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
        [status, safeLimit, safeOffset],
      )
    : await repo.raw(
        "SELECT * FROM jobs WHERE kind <> 'kv' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
        [safeLimit, safeOffset],
      );
  return rows.map(rowToJob);
}

/**
 * 队列积压读数：按 kind 统计待跑任务数（`/metrics` 的 jobs_pending）。
 *
 * 只数 `pending`：`retrying` 在退避窗口里也会被重新认领，但它的「等待」是设计行为，
 * 混进来会让积压看板把退避读成堵塞。`kind = 'kv'` 是借住 jobs 表的 KV 行，排除。
 * 走 GROUP BY 而不是逐 kind 一条 COUNT：抓取时只打一次表。
 */
export async function pendingJobsByKind(repo: Repository): Promise<Map<string, number>> {
  const rows = await repo.raw(
    "SELECT kind, COUNT(*) AS c FROM jobs WHERE status = 'pending' AND kind <> 'kv' GROUP BY kind",
  );
  return new Map(rows.map((r) => [String(r.kind), Number(r.c ?? 0)]));
}

export async function getJob(repo: Repository, id: string): Promise<JobRecord | null> {
  const rows = await repo.raw("SELECT * FROM jobs WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? rowToJob(rows[0]) : null;
}

/**
 * 请求取消：按「有没有人在跑它」分成两条路。
 *
 * - `pending` / `retrying`：没有执行体，直接落 `cancelled` 终态。
 *   允许取消 `retrying` 是刻意的：退避中的任务仍会被重新认领，不取消就只是
 *   「等它再来一次」（恢复任务最长退避 4 分钟 × 3 次 ≈ 干等 7 分钟）。
 * - `running`：**只能标成 `cancelling`**。执行体还在写数据，此刻写 `cancelled`
 *   等于界面撒谎，而用户看到「已取消」会立刻重新提交——正好制造两组分片并发写
 *   同一批数据（这就是审计报告说的「假取消」）。真正的终态由 Runner 在 handler
 *   于分片边界确认停手后通过 `settleCancellingJob` 写入。
 *
 * `cancelling` 既不被 `claimNextJob`（只认 pending）认领，也不被 `retryJob`
 * （只认 failed/cancelled）接受，所以「取消中」天然挡住了重复执行。
 *
 * 返回**真实结果**而不是布尔：调用方（路由）据此决定要不要顺带中止本地执行，
 * 以及回给管理端「已取消」还是「正在收尾」。
 */
export async function cancelJob(repo: Repository, id: string): Promise<"cancelled" | "cancelling" | null> {
  const now = Date.now();
  const running = await repo.raw(
    "UPDATE jobs SET status = 'cancelling', updated_at = ? WHERE id = ? AND status = 'running' RETURNING id",
    [now, id],
  );
  if (running.length > 0) return "cancelling";
  const idle = await repo.raw(
    "UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('pending', 'retrying') RETURNING id",
    [now, id],
  );
  return idle.length > 0 ? "cancelled" : null;
}

/**
 * 把执行中的任务标成「已要求停手、尚未确认」，并留下原因。
 *
 * 与 `cancelJob` 的区别只有触发者：这里由 Runner 自己调用（单次预算到点），
 * 语义相同——执行体可能仍在跑，不能提前写终态。
 * CAS 条件要求 `running`：任务已被用户取消（`cancelling`）时不覆盖对方的原因。
 */
export async function markJobCancelling(repo: Repository, id: string, note: string): Promise<boolean> {
  const rows = await repo.raw(
    "UPDATE jobs SET status = 'cancelling', error = ?, updated_at = ? WHERE id = ? AND status = 'running' RETURNING id",
    [note, Date.now(), id],
  );
  return rows.length > 0;
}

/**
 * 收尾：把 `cancelling` 收成真正的终态。
 *
 * 调用时机是「handler 的执行体已结算」——这是这套状态机唯一的确认点，所以
 * `cancelled`（用户取消）与 `failed`（预算超时且已停手）都从这里出。
 * CAS 条件要求 `cancelling`：进程崩溃后 reaper 已经把行改成 pending/failed，
 * 迟到的收尾不能把它覆盖回去。
 */
export async function settleCancellingJob(
  repo: Repository,
  id: string,
  terminal: "cancelled" | "failed",
  opts: { error?: string | null; durationMs?: number } = {},
): Promise<boolean> {
  const now = Date.now();
  const sets: string[] = ["status = ?"];
  const params: unknown[] = [terminal];
  if (opts.error !== undefined) {
    sets.push("error = ?");
    params.push(opts.error);
  }
  if (opts.durationMs !== undefined) {
    sets.push("duration_ms = ?");
    params.push(Math.max(0, Math.floor(opts.durationMs)));
  }
  sets.push("updated_at = ?");
  params.push(now);
  const rows = await repo.raw(
    "UPDATE jobs SET " + sets.join(", ") + " WHERE id = ? AND status = 'cancelling' RETURNING id",
    [...params, id],
  );
  return rows.length > 0;
}

export async function retryJob(repo: Repository, id: string): Promise<JobRecord | null> {
  const now = Date.now();
  // 只有失败/已取消的终态可以重试。pending 重试会把 attempts 清零（等于白送重试次数）；
  // running 重试会让同一任务被两个 Worker 同时执行；done 重试则静默抹掉历史结果。
  const rows = await repo.raw(
    "UPDATE jobs SET status = 'pending', attempts = 0, error = NULL, next_run_at = NULL, updated_at = ? WHERE id = ? AND status IN ('failed', 'cancelled') RETURNING *",
    [now, id],
  );
  if (rows[0]) return rowToJob(rows[0]);
  return repo.getJob(id);
}

export async function pruneJobs(repo: Repository, olderThanDays = 7, statuses: string[] = ["done", "failed", "cancelled"]): Promise<{ pruned: number }> {
  const cutoff = Date.now() - olderThanDays * 86400_000;
  if (statuses.length === 0) return { pruned: 0 };
  const placeholders = statuses.map(() => "?").join(",");
  // KV 行（kind='kv'，status='done'）低频写入，超过 7 天就会被当成「已完成任务」清掉：
  // 品牌配置/site.json 会静默消失。COUNT 与 DELETE 必须同口径排除，否则回执说谎。
  const countRow = (await repo.raw(
    "SELECT COUNT(*) AS c FROM jobs WHERE status IN (" + placeholders + ") AND updated_at <= ? AND kind <> 'kv'",
    [...statuses, cutoff],
  ))[0];
  const pruned = Number(countRow?.c ?? 0);
  if (pruned > 0) {
    await repo.run(
      "DELETE FROM jobs WHERE status IN (" + placeholders + ") AND updated_at <= ? AND kind <> 'kv'",
      [...statuses, cutoff],
    );
  }
  return { pruned };
}

export async function purgeExpiredDeletedSites(
  repo: Repository,
  olderThanMs: number,
): Promise<{ purged: number; ids: string[] }> {
  const threshold = Date.now() - olderThanMs;
  const rows = await repo.raw("SELECT id FROM sites WHERE deleted_at IS NOT NULL AND deleted_at < ?", [threshold]);
  const ids: string[] = [];
  for (const r of rows) {
    if (r.id) {
      await repo.purgeSite(String(r.id));
      ids.push(String(r.id));
    }
  }
  // 返回被清掉的 id：调用方要据此同步删除向量表（purgeSite 只管关系型表，
  // 向量由 @navhub/store 的 vector store 持有，API 层才有实例）。
  return { purged: ids.length, ids };
}

/**
 * 回收「心跳已停」的任务。
 *
 * 旧实现把所有 `running` 且超过阈值的行直接改成 `failed`——一次 Worker 重启
 * （部署、OOM、容器迁移）就会把正在跑的任务永久判死：不重试、不告警，
 * 管理端只看到一条「执行超时」的失败记录，没有任何恢复路径。
 *
 * 新语义按 attempts 分流（与 JobRunner 的 MAX_JOB_ATTEMPTS 对齐）：
 *   - 还有重试额度 → 回到 `pending` 并立即到期（下一轮 tick 重新认领）；
 *   - 额度耗尽     → 落 `failed` 终态，交给上层告警。
 *
 * 安全性：`completeJob` 的 CAS 条件要求 `status = 'running'`，所以被回收后
 * 迟到的执行结果不会把 pending/failed 覆盖成 done。
 *
 * `cancelling` 也要回收：那是「已要求停手、等 handler 确认」的中间态，确认靠
 * 同进程的 Runner。Runner 崩溃后就没人来收尾，不回收这些行会永久卡在中间态
 * （既不重试、也不取消、管理端还显示「正在收尾」）。它同样靠 `updated_at`
 * 判定——Runner 在收尾期间会继续心跳，所以只有真的没人管了才会被回收。
 */
export async function reapStaleJobs(
  repo: Repository,
  timeoutMs = 15 * 60 * 1000,
  maxAttempts = 3,
): Promise<number> {
  const cutoff = Date.now() - timeoutMs;
  const now = Date.now();
  const rows = await repo.raw(
    "UPDATE jobs SET " +
      "status = CASE WHEN attempts < ? THEN 'pending' ELSE 'failed' END, " +
      "next_run_at = CASE WHEN attempts < ? THEN ? ELSE NULL END, " +
      "error = CASE WHEN attempts < ? THEN 'Worker 中断，已重新排队' ELSE '任务执行超时或 Worker 异常中断' END, " +
      "updated_at = ? " +
      "WHERE status IN ('running', 'cancelling') AND updated_at < ? RETURNING id, status",
    [maxAttempts, maxAttempts, now, maxAttempts, now, cutoff],
  );
  return rows.length;
}
