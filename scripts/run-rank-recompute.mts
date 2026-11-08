/**
 * 手动执行一次 recompute_rank 任务（端到端验证用）。
 *
 * 直接复用任务本体与仓储层，不经过 HTTP 鉴权，也不另写一份评分逻辑——
 * 目的只是让「这条链路现在是否真的能跑通」有可复现证据。
 *
 * 用法：node scripts/run-rank-recompute.mts [db路径]
 */
import { openDb } from "../packages/store/src/driver.ts";
import { Repository } from "../packages/store/src/repository.ts";
import { handleRecomputeRank } from "../apps/api/src/jobs/tasks/rank-recompute.task.ts";

const dbPath = process.argv[2] || "data/navhub.db";
const db = await openDb({ dialect: "sqlite", sqlitePath: dbPath });
const repo = new Repository(db);

const before = await repo.raw("SELECT COUNT(*) c FROM sites WHERE trend_score <> 0");
console.log("[verify] 执行前 trend_score<>0 的站点数 =", before[0].c);

const t0 = Date.now();
try {
  // 任务只用到 ctx.repo，这里给一个最小上下文（运行时不需要完整 AppContext）
  await handleRecomputeRank({ repo } as never);
  console.log("[verify] recompute_rank 执行成功，耗时", Date.now() - t0, "ms");
} catch (err) {
  console.log("[verify] recompute_rank 执行失败：", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}

const after = await repo.raw("SELECT COUNT(*) c FROM sites WHERE trend_score <> 0");
const maxRow = await repo.raw("SELECT MAX(trend_score) m FROM sites");
console.log("[verify] 执行后 trend_score<>0 的站点数 =", after[0].c, "| 最高分 =", maxRow[0].m);
await db.close();
