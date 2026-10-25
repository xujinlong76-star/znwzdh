/**
 * 异步恢复的分片基准（A11）。
 *
 * 回答三个问题：
 *   1. 一片 2000 条到底要多久？（设计文档里的「约 1.5 秒/片」是估的，从没测过）
 *   2. 换片大小，总耗时与「单次阻塞」怎么变？片越大越快，但事件循环被独占得越久。
 *   3. 分片间让出事件循环（setImmediate）到底值多少？——用同一批数据跑两遍对比。
 *
 * 为什么会关心「事件循环延迟」而不是只看总耗时：
 * `better-sqlite3` 是同步驱动，一片写入期间整个 Node 进程（包括 HTTP 处理）停摆。
 * 前端轮询、取消请求、健康检查都在这期间进不来——总耗时好看但页面是死的。
 *
 * 用法：
 *   node --experimental-strip-types scripts/bench-restore-chunk.mjs? 见下
 *   node --experimental-strip-types scripts/bench-restore-chunk.ts
 *   node --experimental-strip-types scripts/bench-restore-chunk.ts --sites=20000 --chunks=1000,2000,5000
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createContext, type AppContext } from "../apps/api/src/context.ts";
import { loadConfig } from "../apps/api/src/config.ts";
import { JobRunner } from "../apps/api/src/jobs.ts";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const SITES = Number(arg("sites", "10000"));
const USE_INDEX = arg("index", "0") === "1";
/** 重复次数：这台机器的单次测量波动能到 2 倍，结论必须用中位数 */
const REPS = Math.max(1, Number(arg("reps", "1")) || 1);
const CHUNKS = arg("chunks", "1000,2000,5000,10000")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n >= 100);

interface Sample {
  chunk: number;
  sites: number;
  /** 恢复任务自身耗时（jobs.created_at → updated_at） */
  totalMs: number;
  /** 整个 tick（含结束后入队的 reindex），仅用于提示，不参与结论 */
  tickMs: number;
  chunks: number;
  perChunkMs: number;
  /** 整个 tick 期间的最大延迟（含 reindex，仅供参考） */
  maxLagMs: number;
  /** 恢复任务运行期间的最大延迟——这才是「恢复会不会卡住页面」的答案 */
  restoreLagMs: number;
  rows: number;
}

/**
 * 事件循环延迟探针。
 *
 * 每 10ms 记一次「实际醒来时刻 - 应醒时刻」，取最大值。
 * 同步驱动写库期间这个值会直接跳到「一片的耗时」量级——那正是用户感知到的卡顿。
 */
function startLagProbe(): { stop: () => number } {
  const INTERVAL = 10;
  let expected = Date.now() + INTERVAL;
  let maxLag = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    const lag = now - expected;
    if (lag > maxLag) maxLag = lag;
    expected = now + INTERVAL;
  }, INTERVAL);
  return {
    stop: () => {
      clearInterval(timer);
      return maxLag;
    },
  };
}

function makeSites(count: number, tag: string) {
  return Array.from({ length: count }, (_, i) => ({
    url: `https://bench-${tag}-${i}.example.com`,
    title: `基准站点 ${i}`,
    categoryId: "bench-cat",
    tags: i % 3 === 0 ? ["基准"] : [],
    enabled: true,
    createdAt: Date.now() - i * 1000,
  }));
}

async function runOnce(ctx: AppContext, dir: string, sites: number, chunk: number): Promise<Sample> {
  const tag = `${chunk}-${sites}`;
  const stagingPath = join(dir, `staging-${tag}.json`);
  writeFileSync(
    stagingPath,
    JSON.stringify({
      categories: [],
      sites: makeSites(sites, tag),
    }),
    "utf8",
  );

  process.env.NAVHUB_RESTORE_CHUNK = String(chunk);
  /**
   * 先清掉别人留下的可认领任务。
   *
   * 恢复成功会顺手入队一个 `reindex`（全库重建索引）。如果不清，下一轮的 tick
   * 会把这个 reindex 也捡起来跑——它是对**全库**的 O(n) 操作，会让后面的配置
   * 越来越慢，测出来的「分片耗时」其实混了索引重建的时间。
   */
  await ctx.repo.run(
    "DELETE FROM jobs WHERE kind IN ('reindex') AND status IN ('pending', 'running', 'retrying')",
  );
  const jobId = await ctx.repo.enqueueJob("backup_restore", { stagingPath });
  const lag = startLagProbe();
  /**
   * 延迟探针要在**恢复任务结束**时停，而不是 tick 结束时停。
   *
   * 恢复成功会顺手入队 `reindex`，tick 会把它一起跑掉；如果把整段 tick 的延迟
   * 都算成「恢复期间的阻塞」，量出来的是 reindex 的阻塞（上轮就是这么把
   * 300ms 与 3.3s 混在一起的）。这里用一个小轮询盯住恢复任务的状态。
   */
  let restoreMaxLag: number | null = null;
  const watcher = setInterval(() => {
    void ctx.repo
      .raw("SELECT status FROM jobs WHERE id = ?", [jobId])
      .then((rows) => {
        const st = String(rows[0]?.status ?? "");
        if (restoreMaxLag === null && (st === "done" || st === "failed" || st === "cancelled")) {
          restoreMaxLag = lag.stop();
        }
      })
      .catch(() => undefined);
  }, 25);
  const startedAt = Date.now();
  const progressTimer = setInterval(() => {
    void ctx.repo
      .raw("SELECT progress_done AS d, progress_total AS t FROM jobs WHERE id = ?", [jobId])
      .then((rows) => {
        const d = Number(rows[0]?.d ?? 0);
        const t = Number(rows[0]?.t ?? 0);
        console.log(`    …chunk=${chunk} 进度 ${d}/${t}`);
      })
      .catch(() => undefined);
  }, 2000);
  const runner = new JobRunner(ctx, { enableCron: false });
  await runner.tick();
  clearInterval(progressTimer);
  const tickMs = Date.now() - startedAt;
  clearInterval(watcher);
  // 恢复早已结束（watcher 已停过探针）时，这次调用返回同一个值（stop 幂等）
  const maxLagMs = lag.stop();
  const restoreLagMs = restoreMaxLag ?? maxLagMs;
  await ctx.repo.run(
    "DELETE FROM jobs WHERE kind IN ('reindex') AND status IN ('pending', 'running', 'retrying')",
  );

  const row = (
    await ctx.repo.raw("SELECT status, progress_done AS done FROM jobs WHERE id = ?", [jobId])
  )[0]!;
  if (String(row.status) !== "done") throw new Error(`任务未成功：${String(row.status)}`);

  const rows = Number(
    (await ctx.repo.raw("SELECT COUNT(*) AS c FROM sites WHERE url LIKE ?", [`https://bench-${tag}-%`]))[0]!
      .c,
  );
  /**
   * 只算**恢复任务自身**的时长，不把 tick 总时长当成分片耗时。
   *
   * 曾经踩的坑：`runner.tick()` 会把恢复结束时入队的 `reindex` 一起跑掉，
   * 于是「10k 条恢复 56 秒」其实是「恢复 1.7 秒 + 全库重建索引 54.8 秒」。
   * 分片基准必须只测分片本身，否则结论会指向完全错误的地方
   * （去优化分片大小，而真凶是索引重建）。
   */
  const jobRow = (
    await ctx.repo.raw("SELECT duration_ms, created_at, updated_at FROM jobs WHERE id = ?", [jobId])
  )[0]!;
  /**
   * 用 `duration_ms`（handler 自身耗时）而不是 `updated_at - created_at`：
   * 后者含排队等待，任务在队列里等过就会被算成「执行慢」。
   */
  const restoreMs = Number(jobRow.duration_ms) || Number(jobRow.updated_at) - Number(jobRow.created_at);
  const chunks = Math.ceil(sites / chunk);
  return {
    chunk,
    sites,
    totalMs: restoreMs,
    tickMs,
    chunks,
    perChunkMs: Math.round(restoreMs / chunks),
    maxLagMs,
    restoreLagMs,
    rows,
  };
}

async function withFreshDb<T>(label: string, useIndex: boolean, fn: (ctx: AppContext, dir: string) => Promise<T>): Promise<T> {
  /**
   * 每个配置都从**独立的空库**开始。
   *
   * 第一版让所有配置共用一张表，结果行数在配置之间累积：
   * chunk=5000 那轮的表里已经有 10000 行，算出来 139s/片，
   * 看起来像「片越大越慢」，其实测的是「表越大越慢」。
   * 基准必须只变一个因素。
   */
  const dir = mkdtempSync(join(tmpdir(), `navhub-bench-${label}-`));
  const ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "bench.db"),
      embedding: {
        model: "Xenova/bge-small-zh-v1.5",
        endpoint: "https://hf-mirror.com",
        dtype: "q8",
        cacheDir: join(dir, "models"),
        dim: 512,
        enabled: false,
      },
      corsOrigins: ["*"],
    }),
  );
  try {
    if (useIndex) {
      // 对照组：给 sites(url) 建普通索引。
      // `findExistingSiteUrls` 按 url 等值查询，而现网 schema 上 url 没有索引——
      // 每片去重都是一次全表扫描，表越大越慢。
      await ctx.repo.run("CREATE INDEX IF NOT EXISTS bench_sites_url_idx ON sites(url)");
    }
    await ctx.repo.createCategory({ id: "bench-cat", title: `基准分类 ${label}` });
    return await fn(ctx, dir);
  } finally {
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

async function main(): Promise<void> {
  const samples: Sample[] = [];
  for (const chunk of CHUNKS) {
    const runs: Sample[] = [];
    for (let rep = 0; rep < REPS; rep += 1) {
      // 每次重复都用全新空库：表里已有行会让去重查询变贵，混在一起就测不出片大小的影响
      runs.push(await withFreshDb(`c${chunk}r${rep}`, USE_INDEX, (ctx, dir) => runOnce(ctx, dir, SITES, chunk)));
    }
    const sample: Sample = {
      ...runs[0]!,
      totalMs: median(runs.map((r) => r.totalMs)),
      tickMs: median(runs.map((r) => r.tickMs)),
      perChunkMs: median(runs.map((r) => r.perChunkMs)),
      maxLagMs: median(runs.map((r) => r.maxLagMs)),
      restoreLagMs: median(runs.map((r) => r.restoreLagMs)),
    };
    samples.push(sample);
    console.log(
      `chunk=${String(chunk).padStart(5)}  ${sample.chunks} 片  恢复自身 ${(sample.totalMs / 1000).toFixed(2)}s  ` +
        `单片均值 ${sample.perChunkMs}ms  恢复期最大延迟 ${sample.restoreLagMs}ms（整个 tick ${sample.maxLagMs}ms）写入 ${sample.rows} 行  ` +
        `（tick 总计 ${(sample.tickMs / 1000).toFixed(2)}s，含 reindex）`,
    );
  }

  console.log("\n| 片大小 | 片数 | 总耗时 | 单片均值 | 最大事件循环延迟 | 写入行数 |");
  console.log("|---:|---:|---:|---:|---:|---:|");
  for (const s of samples) {
    console.log(
      `| ${s.chunk} | ${s.chunks} | ${(s.totalMs / 1000).toFixed(2)}s | ${s.perChunkMs}ms | ${s.maxLagMs}ms | ${s.rows} |`,
    );
  }
  console.log(`\n条件：${SITES} 条站点、sites(url) 索引=${USE_INDEX ? "有（对照组）" : "无（现网）"}`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
