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
const CHUNKS = arg("chunks", "1000,2000,5000,10000")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n >= 100);

interface Sample {
  chunk: number;
  sites: number;
  totalMs: number;
  chunks: number;
  perChunkMs: number;
  maxLagMs: number;
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
  const totalMs = Date.now() - startedAt;
  const maxLagMs = lag.stop();
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
  const chunks = Math.ceil(sites / chunk);
  return {
    chunk,
    sites,
    totalMs,
    chunks,
    perChunkMs: Math.round(totalMs / chunks),
    maxLagMs,
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

async function main(): Promise<void> {
  const samples: Sample[] = [];
  for (const chunk of CHUNKS) {
    const sample = await withFreshDb(`c${chunk}`, USE_INDEX, (ctx, dir) => runOnce(ctx, dir, SITES, chunk));
    samples.push(sample);
    console.log(
      `chunk=${String(chunk).padStart(5)}  ${sample.chunks} 片  总耗时 ${(sample.totalMs / 1000).toFixed(2)}s  ` +
        `单片均值 ${sample.perChunkMs}ms  最大事件循环延迟 ${sample.maxLagMs}ms  写入 ${sample.rows} 行`,
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
