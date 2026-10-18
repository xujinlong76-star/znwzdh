/**
 * 升级专项回归测试（Query Planner + cron 调度 + Runner drain）。
 *
 * 独立文件：不碰 jobs.test.ts / store.test.ts（并行会话正在改 tags 域），
 * 避免合并不必要的冲突。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner, cronDue, scheduleCronOf, DEFAULT_SCHEDULES } from "../src/jobs.ts";

describe("Query Planner early-exit", () => {
  it("强精确命中剪掉语义通道并打标 planner", async () => {
    const dir = mkdtempSync(join(tmpdir(), "navhub-planner-"));
    let ctx: AppContext | null = null;
    try {
      const config = loadConfig({
        mode: "lite",
        sqlitePath: join(dir, "planner.db"),
        embedding: { model: "X", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "m"), dim: 512, enabled: false },
        llm: { baseUrl: "https://x", apiKey: null, model: "m", timeoutMs: 1000 },
        fetch: { timeoutMs: 1000, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "t" },
        corsOrigins: ["*"],
      });
      ctx = await createContext(config);
      await ctx.repo.createCategory({ id: "pc", title: "规划类目" });
      // 6 个同名站点：exact 命中 6 >= 默认阈值 5 → early-exit
      for (let i = 0; i < 6; i++) {
        await ctx.repo.createSite({ url: `https://planner${i}.example.com/`, title: "规划测试站", categoryId: "pc" });
      }
      const r = await ctx.search.search({ q: "规划测试站", limit: 10 });
      expect(r.planner).toBe("early-exit");
      expect(r.channelTimings?.skippedSemantic).toBe(true);
      expect(r.hits.length).toBeGreaterThan(0);
    } finally {
      await ctx?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("阈值设 0 关闭 early-exit（全通道恒跑）", async () => {
    const { SearchEngine } = await import("@navhub/store");
    const dir = mkdtempSync(join(tmpdir(), "navhub-planner0-"));
    let ctx: AppContext | null = null;
    try {
      const config = loadConfig({
        mode: "lite",
        sqlitePath: join(dir, "p0.db"),
        embedding: { model: "X", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "m"), dim: 512, enabled: false },
        llm: { baseUrl: "https://x", apiKey: null, model: "m", timeoutMs: 1000 },
        fetch: { timeoutMs: 1000, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "t" },
        corsOrigins: ["*"],
      });
      ctx = await createContext(config);
      const engine = new SearchEngine(
        { db: ctx.db, repo: ctx.repo, fts: ctx.fts, vectors: ctx.vectors, embed: null },
        { earlyExitExactHits: 0 },
      );
      await ctx.repo.createCategory({ id: "pc0", title: "类目0" });
      for (let i = 0; i < 6; i++) {
        await ctx.repo.createSite({ url: `https://p0-${i}.example.com/`, title: "零阈值站", categoryId: "pc0" });
      }
      const r = await engine.search({ q: "零阈值站", limit: 10, disableSemantic: true });
      expect(r.planner).toBeUndefined();
      // 显式禁用语义（非 planner 剪枝）：timings 如实标记语义没跑，但不产生 planner 标记
      expect(r.channelTimings?.skippedSemantic).toBe(true);
      expect(r.channelTimings?.semanticMs).toBe(0);
    } finally {
      await ctx?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cron 调度语义", () => {
  it("七种任务默认策略齐全且 cron 可解析", () => {
    const kinds = ["health_check", "refetch_metadata", "recompute_rank", "reindex", "site_self_healing", "token_audit", "purge_trash"] as const;
    for (const k of kinds) {
      expect(DEFAULT_SCHEDULES[k].timeoutMs).toBeGreaterThan(0);
      expect(DEFAULT_SCHEDULES[k].maxConcurrency).toBeGreaterThanOrEqual(1);
      const expr = scheduleCronOf(k);
      expect(expr.split(" ").length).toBe(5);
    }
  });

  it("cronDue 匹配步长与整点语义", () => {
    // 2026-10-17 10:00 周六：分钟 0（被 */5 整除），小时 10
    const d = new Date(2026, 9, 17, 10, 0, 0);
    expect(cronDue(scheduleCronOf("health_check"), d)).toBe(true);
    expect(cronDue(scheduleCronOf("recompute_rank"), d)).toBe(true);
    // 10:01 不是整点
    const d2 = new Date(2026, 9, 17, 10, 1, 0);
    expect(cronDue(scheduleCronOf("recompute_rank"), d2)).toBe(false);
    // 非法表达式直接 false，不抛错
    expect(cronDue("not-a-cron", d)).toBe(false);
  });
});

describe("Runner 优雅停机", () => {
  it("stop 后 tick 拒绝新轮次，drain 超时内返回", async () => {
    const dir = mkdtempSync(join(tmpdir(), "navhub-drain-"));
    let ctx: AppContext | null = null;
    try {
      const config = loadConfig({
        mode: "lite",
        sqlitePath: join(dir, "drain.db"),
        embedding: { model: "X", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "m"), dim: 512, enabled: false },
        llm: { baseUrl: "https://x", apiKey: null, model: "m", timeoutMs: 1000 },
        fetch: { timeoutMs: 1000, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "t" },
        corsOrigins: ["*"],
      });
      ctx = await createContext(config);
      const runner = new JobRunner(ctx, { intervalMs: 60_000 });
      runner.stop();
      const r = await runner.tick();
      expect(r.skipped).toBe(true);
      await runner.drain(1000);
    } finally {
      await ctx?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
