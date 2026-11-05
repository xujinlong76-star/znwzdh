/**
 * 独立排期定时器（P1-4）。
 *
 * 守两件事：
 *  1. 排期不再依赖 worker tick —— 不调用 tick() 也能按时入队；
 *  2. 去重入队 —— 同 kind 已有没跑完的任务时不再排第二条（旧实现会）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner, planJobLanes } from "../src/jobs.ts";

const dirs: string[] = [];
const contexts: AppContext[] = [];

async function makeCtx(): Promise<AppContext> {
  const dir = mkdtempSync(join(tmpdir(), "navhub-cron-"));
  dirs.push(dir);
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "cron.db"),
    embedding: {
      model: "Xenova/bge-small-zh-v1.5",
      endpoint: "https://hf-mirror.com",
      dtype: "q8",
      cacheDir: join(dir, "models"),
      dim: 512,
      enabled: false,
    },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  const ctx = await createContext(config);
  contexts.push(ctx);
  return ctx;
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("cron 独立定时器", () => {
  it("不调用 tick()，排期也会到点入队", async () => {
    const ctx = await makeCtx();
    const runner = new JobRunner(ctx);
    runner.startCronTimer(10);
    try {
      await new Promise((r) => setTimeout(r, 400));
      const pending = await ctx.repo.pendingJobsByKind();
      // 空库时所有排期都算到期：至少 recompute_rank 应该在队列里
      expect(pending.get("recompute_rank")).toBeGreaterThanOrEqual(1);
      // 水位已推进：同一周期内不会重复入队
      expect(await ctx.repo.getSystemState<number>("cron:last_run:recompute_rank")).toBeGreaterThan(0);
    } finally {
      runner.stop();
    }
  });

  it("同 kind 已有没跑完的任务时不再排第二条（去重入队）", async () => {
    const ctx = await makeCtx();
    // 模拟「上一周期排的任务还在跑」：队列里已有一条 pending 的 recompute_rank
    await ctx.repo.enqueueJob("recompute_rank", {});

    // maxPerTick=0：只跑排期检查，不消费任务
    const runner = new JobRunner(ctx, { enableCron: true, maxPerTick: 0 });
    await runner.tick();

    const pending = await ctx.repo.pendingJobsByKind();
    // 旧实现（enqueueJob）会插到 2；去重后仍然是那一条
    expect(pending.get("recompute_rank")).toBe(1);
    // 其它 kind 不受影响，照常排期
    expect(pending.get("purge_trash")).toBeGreaterThanOrEqual(1);
  });
});

describe("planJobLanes（PG 按 kind 并发）", () => {
  it("每 kind 不超过 maxConcurrency，总量不超过 slots", () => {
    const lanes = planJobLanes(new Map([["health_check", 10], ["reindex", 5]]));
    // health_check 的 maxConcurrency=2，reindex=1，总量 3 ≤ 4
    expect(lanes).toEqual([
      { kind: "health_check", lanes: 2 },
      { kind: "reindex", lanes: 1 },
    ]);
  });

  it("待办不足时不多开 lane，积压多的 kind 先拿名额", () => {
    // slots=2：health_check（3 条积压）先拿满 2 条，recompute_rank 只能等下一轮
    const lanes = planJobLanes(new Map([["recompute_rank", 1], ["health_check", 3]]), 2);
    expect(lanes).toEqual([{ kind: "health_check", lanes: 2 }]);

    // 单条待办只开 1 条 lane，不按上限空转
    expect(planJobLanes(new Map([["health_check", 1]]))).toEqual([{ kind: "health_check", lanes: 1 }]);
  });
});
