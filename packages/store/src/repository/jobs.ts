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

export async function claimNextJob(repo: Repository): Promise<JobRecord | null> {
  if (repo.db.dialect === "pg") {
    const now = Date.now();
    const rows = await repo.raw(
      "WITH next AS (" +
        "SELECT id FROM jobs WHERE status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?) " +
        "ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED" +
        ") UPDATE jobs SET status = 'running', attempts = attempts + 1, next_run_at = NULL, updated_at = ? " +
        "FROM next WHERE jobs.id = next.id RETURNING jobs.*",
      [now, now],
    );
    const row = rows[0];
    return row ? rowToJob(row) : null;
  }
  return repo.withTransaction(async () => {
    const rows = await repo.raw(
      "SELECT * FROM jobs WHERE status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY created_at ASC LIMIT 1",
      [Date.now()],
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

export async function completeJob(repo: Repository, id: string, error?: string | null, opts: { retryAt?: number | null; exhausted?: boolean } | null = null): Promise<boolean> {
  const now = Date.now();
  // CAS 到 running：任务被取消 / 被 reaper 回收 / 已被另一个实例接管后，
  // 迟到的执行结果不得再改写终态。旧实现无条件 UPDATE，一个跑超时的 handler
  // 醒来后能把 cancelled 覆盖成 done，甚至把别人重跑后的 failed 改回 done。
  if (error && !opts?.exhausted && opts?.retryAt) {
    const rows = await repo.raw(
      "UPDATE jobs SET status = 'pending', error = ?, next_run_at = ?, updated_at = ? WHERE id = ? AND status = 'running' RETURNING id",
      [error, opts.retryAt, now, id],
    );
    return rows.length > 0;
  }
  const rows = await repo.raw(
    "UPDATE jobs SET status = ?, error = ?, next_run_at = NULL, updated_at = ? WHERE id = ? AND status = 'running' RETURNING id",
    [error ? "failed" : "done", error ?? null, now, id],
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
export async function heartbeatJob(repo: Repository, id: string): Promise<boolean> {
  const now = Date.now();
  if (repo.db.dialect === "sqlite") {
    const info = repo.db.sqlite!
      .prepare("UPDATE jobs SET updated_at = ? WHERE id = ? AND status = 'running'")
      .run(now, id) as { changes?: number };
    return Number(info?.changes ?? 0) > 0;
  }
  const res = await repo.db.pg!.query(
    "UPDATE jobs SET updated_at = $1 WHERE id = $2 AND status = 'running'",
    [now, id],
  );
  return Number(res.rowCount ?? 0) > 0;
}

export async function listJobs(repo: Repository, status?: string, limit = 50): Promise<JobRecord[]> {
  // `kind = 'kv'` 是 KV 存储借住在 jobs 表里的行，不是任务：管理端列表不该出现
  const rows = status
    ? await repo.raw(
        "SELECT * FROM jobs WHERE status = ? AND kind <> 'kv' ORDER BY created_at DESC LIMIT ?",
        [status, limit],
      )
    : await repo.raw("SELECT * FROM jobs WHERE kind <> 'kv' ORDER BY created_at DESC LIMIT ?", [limit]);
  return rows.map(rowToJob);
}

export async function getJob(repo: Repository, id: string): Promise<JobRecord | null> {
  const rows = await repo.raw("SELECT * FROM jobs WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? rowToJob(rows[0]) : null;
}

export async function cancelJob(repo: Repository, id: string): Promise<boolean> {
  const now = Date.now();
  /**
   * 允许取消 `retrying`：退避中的任务仍会被重新认领执行，不取消就只是「等它再来一次」。
   * 恢复任务的最长退避是 4 分钟、共 3 次尝试，不支持取消意味着用户最多要干等 7 分钟。
   *
   * 不允许取消 `done` / `failed`：那是历史结果，改状态会让「谁在什么时候成功过」失真。
   */
  await repo.run(
    "UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('pending', 'running', 'retrying')",
    [now, id],
  );
  return true;
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

export async function purgeExpiredDeletedSites(repo: Repository, olderThanMs: number): Promise<number> {
  const threshold = Date.now() - olderThanMs;
  const rows = await repo.raw("SELECT id FROM sites WHERE deleted_at IS NOT NULL AND deleted_at < ?", [threshold]);
  let count = 0;
  for (const r of rows) {
    if (r.id) {
      await repo.purgeSite(String(r.id));
      count++;
    }
  }
  return count;
}

export async function reapStaleJobs(repo: Repository, timeoutMs = 15 * 60 * 1000): Promise<number> {
  const cutoff = Date.now() - timeoutMs;
  const now = Date.now();
  // 单条原子 UPDATE：先 SELECT 再逐条 UPDATE 的旧实现在并发 reaper 下会重复计数；
  // 执行中的任务由 heartbeatJob 持续刷新 updated_at，长任务不会被误判为僵尸。
  const rows = await repo.raw(
    "UPDATE jobs SET status = 'failed', error = '任务执行超时或 Worker 异常中断', updated_at = ? " +
      "WHERE status = 'running' AND updated_at < ? RETURNING id",
    [now, cutoff],
  );
  return rows.length;
}
