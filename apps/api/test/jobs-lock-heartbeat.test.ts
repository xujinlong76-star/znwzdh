/**
 * 单实例锁的心跳续期回归。
 *
 * 背景：SQLite 的 runner 锁是「锁行 + created_at，超 LOCK_TTL_MS(120s) 即可被抢」。
 * 原先只在**任务之间**刷新一次 created_at，而单个任务自己就能跑过 120s：
 * health_check 巡检 100 个站点是串行抓取（每次最长 NAVHUB_FETCH_TIMEOUT_MS），
 * reindex / data_retention 声明的预算就是 600s。TTL 一过，别的实例按 SQL 语义是
 * **合法**夺锁 —— 于是两个实例同时跑同一批任务：重复抓取、重复写 health/rank、
 * 对外站翻倍施压，而且谁都不觉得自己重复了。
 *
 * 这里把「长任务」压缩到毫秒级：往 completeJob 里注入一段等待（等价于任务体很久），
 * 观察锁行的 created_at 是否在任务**进行中**被持续刷新。去掉 setInterval 心跳后
 * created_at 只会停在抢锁那一刻，本文件必红。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner } from "../src/jobs.ts";

const LOCK_KEY = "lock:job-runner";

let dir: string;
let ctx: AppContext;

function lockRow(): { holder: string; createdAt: number } | null {
  const row = ctx.db.sqlite!
    .prepare("SELECT response, created_at FROM idempotency WHERE key = ?")
    .get(LOCK_KEY) as { response: string; created_at: number | string } | undefined;
  if (!row) return null;
  return { holder: row.response, createdAt: Number(row.created_at) };
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
  it("任务进行中锁一直被续期（长任务不会被判过期）", async () => {
    await ctx.repo.createCategory({ id: "hb", title: "心跳类目" });
    await ctx.repo.createSite({ url: "https://hb.example.com/1", title: "心跳站", categoryId: "hb" });
    await ctx.repo.enqueueJob("recompute_rank", {});

    const original = ctx.repo.completeJob.bind(ctx.repo);
    const observed: number[] = [];
    let heldSinceAt = 0;
    (ctx.repo as unknown as { completeJob: (...a: unknown[]) => Promise<unknown> }).completeJob = async (...args) => {
      // 此刻锁刚被本轮抢到（任务体已完成），记下基线，然后模拟一段很长的执行
      heldSinceAt = lockRow()!.createdAt;
      // 心跳间隔 40ms：等到观察到 ≥3 个不同续期时间戳再收尾（上限 2s）。
      // 固定睡 300ms 在高负载下可能一次心跳都没轮到，会把「心跳存在」误判成失败。
      const distinct = new Set<number>();
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline && distinct.size < 3) {
        await new Promise((r) => setTimeout(r, 20));
        const row = lockRow();
        if (row) {
          observed.push(row.createdAt);
          distinct.add(row.createdAt);
        }
      }
      return (original as (...a: unknown[]) => Promise<unknown>)(...args);
    };

    const runner = new JobRunner(ctx, { lockHeartbeatMs: 40 });
    try {
      const res = await runner.tick();
      expect(res.processed).toBe(1);
    } finally {
      (ctx.repo as unknown as { completeJob: unknown }).completeJob = original;
    }

    expect(observed.length).toBeGreaterThan(0);
    // 1) 刷新发生在任务进行中，而不是抢锁那一刻
    expect(Math.max(...observed)).toBeGreaterThan(heldSinceAt);
    // 2) 周期性心跳（≥2 个不同时间戳），不是收尾补一刀
    expect(new Set(observed).size).toBeGreaterThanOrEqual(2);
  });

  /**
   * 心跳把续期从「任务之间」变成了「任务全程」，于是夺锁之后仍会持续打到锁行上。
   * 续期语句必须带 holder 条件：真的被别的实例接管后，旧心跳只能 0 行命中，
   * 不能把新持有者顶掉（否则两边 forever 互抢）。
   */
  it("锁被别的实例接管后，旧持有者的心跳不会顶掉新持有者", async () => {
    ctx.db.sqlite!.prepare("DELETE FROM idempotency WHERE key = ?").run(LOCK_KEY);
    ctx.db.sqlite!
      .prepare("INSERT INTO idempotency (key, response, created_at) VALUES (?,?,?)")
      .run(LOCK_KEY, "pid-new", Date.now());

    const stale = new JobRunner(ctx, { holder: "pid-old", lockHeartbeatMs: 40 });
    (stale as unknown as { lockHeld: boolean }).lockHeld = true;
    try {
      await (stale as unknown as { renewLock: () => Promise<void> }).renewLock();
      expect(lockRow()!.holder).toBe("pid-new");
    } finally {
      ctx.db.sqlite!.prepare("DELETE FROM idempotency WHERE key = ?").run(LOCK_KEY);
    }
  });
});
