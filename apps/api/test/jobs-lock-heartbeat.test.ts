/**
 * 单实例锁的心跳续期回归。
 *
 * 背景：SQLite 的 runner 锁是「主库之外的独立租约文件 + created_at，超 LOCK_TTL_MS(120s)
 * 即可被抢」。原先只在**任务之间**刷新一次 created_at，而单个任务自己就能跑过 120s：
 * health_check 巡检 100 个站点是串行抓取（每次最长 NAVHUB_FETCH_TIMEOUT_MS），
 * reindex / data_retention 声明的预算就是 600s。TTL 一过，别的实例按 SQL 语义是
 * **合法**夺锁 —— 于是两个实例同时跑同一批任务：重复抓取、重复写 health/rank、
 * 对外站翻倍施压，而且谁都不觉得自己重复了。
 *
 * 这里把「长任务」压缩到毫秒级：往 recompute_rank 执行体里注入一段等待（等价于任务体很久），
 * 观察锁行的 created_at 是否在任务**进行中**被持续刷新。去掉 setInterval 心跳后
 * created_at 只会停在抢锁那一刻，本文件必红。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner } from "../src/jobs.ts";

const LOCK_TTL_MS = 120_000;

let dir: string;
let ctx: AppContext;

function lockRow(): Promise<{ holder: string; createdAt: number } | null> {
  return ctx.repo.getJobRunnerLease();
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-lock-heartbeat-"));
  ctx = await createContext(
    loadConfig({ mode: "lite", sqlitePath: join(dir, "lock.db"), embedding: { enabled: false } } as never),
  );
});

afterAll(async () => {
  await ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("JobRunner 单实例锁心跳", () => {
  it("未指定 holder 时使用随机实例标识，避免多容器 PID 相同造成新旧持有者混淆", () => {
    const first = new JobRunner(ctx);
    const second = new JobRunner(ctx);
    const holderOf = (runner: JobRunner) => (runner as unknown as { holder: string }).holder;
    expect(holderOf(first)).toMatch(/^runner-/);
    expect(holderOf(first)).not.toBe(holderOf(second));
  });

  it("任务进行中锁一直被续期（长任务不会被判过期）", async () => {
    await ctx.repo.createCategory({ id: "hb", title: "心跳类目" });
    await ctx.repo.createSite({ url: "https://hb.example.com/1", title: "心跳站", categoryId: "hb" });
    await ctx.repo.enqueueJob("recompute_rank", {});

    const runner = new JobRunner(ctx, { holder: "pid-long", lockHeartbeatMs: 40 });
    const original = (runner as unknown as {
      runRecomputeRank: () => Promise<void>;
    }).runRecomputeRank.bind(runner);
    const observed: number[] = [];
    let heldSinceAt = 0;
    (runner as unknown as { runRecomputeRank: () => Promise<void> }).runRecomputeRank = async () => {
      // 模拟长任务体（不处于 DB 事务中）；不能在 completeJob 内等待，否则正确的
      // 共享写门禁会排队心跳，测试观察到的只能是抢锁时间戳。
      heldSinceAt = (await lockRow())!.createdAt;
      // 心跳间隔 40ms：等到观察到 ≥3 个不同续期时间戳再收尾（上限 2s）。
      // 固定睡 300ms 在高负载下可能一次心跳都没轮到，会把「心跳存在」误判成失败。
      const distinct = new Set<number>();
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline && distinct.size < 3) {
        await new Promise((r) => setTimeout(r, 20));
        const row = await lockRow();
        if (row) {
          observed.push(row.createdAt);
          distinct.add(row.createdAt);
        }
      }
      return original();
    };

    try {
      const res = await runner.tick();
      expect(res.processed).toBe(1);
    } finally {
      (runner as unknown as { runRecomputeRank: unknown }).runRecomputeRank = original;
    }

    expect(observed.length).toBeGreaterThan(0);
    // 1) 刷新发生在任务进行中，而不是抢锁那一刻
    expect(Math.max(...observed)).toBeGreaterThan(heldSinceAt);
    // 2) 周期性心跳（≥2 个不同时间戳），不是收尾补一刀
    expect(new Set(observed).size).toBeGreaterThanOrEqual(2);
  });

  it("锁被别的实例接管后，旧持有者的心跳不会顶掉新持有者", async () => {
    const now = Date.now();
    expect(await ctx.repo.acquireJobRunnerLease("pid-old", LOCK_TTL_MS, now)).toBe(true);
    expect(await ctx.repo.acquireJobRunnerLease("pid-new", LOCK_TTL_MS, now + LOCK_TTL_MS + 1)).toBe(true);

    const stale = new JobRunner(ctx, { holder: "pid-old", lockHeartbeatMs: 40 });
    (stale as unknown as { lockHeld: boolean }).lockHeld = true;
    try {
      await (stale as unknown as { renewLock: () => Promise<void> }).renewLock();
      expect((await lockRow())?.holder).toBe("pid-new");
      expect((stale as unknown as { lockLost: boolean }).lockLost).toBe(true);
    } finally {
      await ctx.repo.releaseJobRunnerLease("pid-new");
    }
  });

  it("主库长事务占住写门禁时，独立心跳仍按时续期且不受事务回滚影响", async () => {
    const before = Date.now() - 1_000;
    expect(await ctx.repo.acquireJobRunnerLease("pid-gated", LOCK_TTL_MS, before)).toBe(true);

    const runner = new JobRunner(ctx, { holder: "pid-gated", lockHeartbeatMs: 40 });
    (runner as unknown as { lockHeld: boolean }).lockHeld = true;
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const tx = ctx.repo.withTransaction(async () => {
      started();
      await gate;
      throw new Error("无关任务事务回滚");
    });
    await entered;

    let renewed = false;
    const renewal = (runner as unknown as { renewLock: () => Promise<void> }).renewLock().then(() => {
      renewed = true;
    });
    try {
      await Promise.race([
        renewal,
        new Promise((_, reject) => setTimeout(() => reject(new Error("心跳被主库写门禁阻塞")), 500)),
      ]);
      expect(renewed).toBe(true);
      expect((await lockRow())?.createdAt).toBeGreaterThan(before);
    } finally {
      release();
      await expect(tx).rejects.toThrow("无关任务事务回滚");
      await renewal;
      await ctx.repo.releaseJobRunnerLease("pid-gated");
    }
  });

  async function exerciseActiveHandlerAbort(mode: "stolen" | "error"): Promise<void> {
    // 文件内测试共享同一个 ctx：清掉上一例故意留下的待办，才能断言“第二个未被认领”。
    for (const job of await ctx.repo.listJobs("pending", 100)) {
      if (job.kind === "recompute_rank") await ctx.repo.cancelJob(job.id);
    }
    await ctx.repo.enqueueJob("recompute_rank", {});
    await ctx.repo.enqueueJob("recompute_rank", {});
    const runner = new JobRunner(ctx, { holder: "pid-active", lockHeartbeatMs: 10_000 });
    let started!: () => void;
    const handlerStarted = new Promise<void>((resolve) => { started = resolve; });
    let aborted = false;
    runner.taskRegistry.register("recompute_rank", async ({ run }) => {
      started();
      await new Promise<void>((resolve) => {
        const finish = () => { aborted = true; resolve(); };
        if (run.signal.aborted) finish();
        else {
          const timer = setTimeout(finish, 1_000);
          run.signal.addEventListener("abort", () => { clearTimeout(timer); finish(); }, { once: true });
        }
      });
    });

    const renewSpy = mode === "error"
      ? vi.spyOn(ctx.repo, "renewJobRunnerLease").mockRejectedValueOnce(new Error("simulated renewal failure"))
      : null;
    const tick = runner.tick();
    try {
      await handlerStarted;
      if (mode === "stolen") {
        expect(await ctx.repo.acquireJobRunnerLease("pid-replacement", 1, Date.now() + 10)).toBe(true);
      }
      await (runner as unknown as { renewLock: () => Promise<void> }).renewLock();
      await tick;

      expect(aborted).toBe(true);
      expect((runner as unknown as { lockLost: boolean }).lockLost).toBe(true);
      const pending = (await ctx.repo.listJobs("pending", 20)).filter((job) => job.kind === "recompute_rank");
      expect(pending).toHaveLength(1); // 锁丢失后不得认领第二个任务
    } finally {
      renewSpy?.mockRestore();
      await ctx.repo.releaseJobRunnerLease("pid-replacement");
    }
  }

  it("续期抛错时立即中止当前 handler，并停止认领后续任务", async () => {
    await exerciseActiveHandlerAbort("error");
  });

  it("租约被夺时立即中止当前 handler，并停止认领后续任务", async () => {
    await exerciseActiveHandlerAbort("stolen");
  });

  it("认领等待期间锁被夺时，不启动 handler 并安全归还任务", async () => {
    for (const job of await ctx.repo.listJobs("pending", 100)) {
      if (job.kind === "recompute_rank") await ctx.repo.cancelJob(job.id);
    }
    const jobId = await ctx.repo.enqueueJob("recompute_rank", {});
    const runner = new JobRunner(ctx, { holder: "pid-claim-race", lockHeartbeatMs: 10_000 });
    let handlerCalls = 0;
    runner.taskRegistry.register("recompute_rank", async () => { handlerCalls += 1; });

    const originalClaim = ctx.repo.claimNextJob.bind(ctx.repo);
    const claimSpy = vi.spyOn(ctx.repo, "claimNextJob").mockImplementationOnce(async (opts) => {
      const job = await originalClaim(opts);
      expect(job?.id).toBe(jobId);
      expect(await ctx.repo.acquireJobRunnerLease("pid-race-replacement", 1, Date.now() + 10)).toBe(true);
      await (runner as unknown as { renewLock: () => Promise<void> }).renewLock();
      return job;
    });
    try {
      const result = await runner.tick();
      expect(result).toEqual({ processed: 0, skipped: false });
      expect(handlerCalls).toBe(0);
      const returned = await ctx.repo.getJob(jobId);
      expect(returned?.status).toBe("pending");
      expect(returned?.attempts).toBe(0);
    } finally {
      claimSpy.mockRestore();
      await ctx.repo.releaseJobRunnerLease("pid-race-replacement");
    }
  });
});
