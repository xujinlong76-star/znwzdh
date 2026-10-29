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
import {
  JobRunner,
  cronDue,
  scheduleCronOf,
  DEFAULT_SCHEDULES,
  DEFAULT_CRON_SCHEDULES,
  JOB_KINDS,
  MANUAL_ONLY_KINDS,
} from "../src/jobs.ts";

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
  /**
   * 必须遍历**全部** kind：手写名单曾经漏掉 data_retention / taxonomy_audit /
   * plugin_governance，于是 data_retention 的 "DAILY4AM" 别名不在 CRON_EXPRS 里、
   * scheduleCronOf 原样吐出 1 段串、cronDue 恒 false 这件事一直没被抓到。
   */
  it("所有任务默认策略齐全且 cron 别名都能解析成 5 段", () => {
    const kinds = Object.keys(DEFAULT_SCHEDULES) as Array<keyof typeof DEFAULT_SCHEDULES>;
    expect(kinds.length).toBeGreaterThanOrEqual(10);
    for (const k of kinds) {
      expect(DEFAULT_SCHEDULES[k].timeoutMs).toBeGreaterThan(0);
      expect(DEFAULT_SCHEDULES[k].maxConcurrency).toBeGreaterThanOrEqual(1);
      if (DEFAULT_SCHEDULES[k].cron === "MANUAL") {
        // 手动任务（如 backup_restore）：绝不自动调度，cronDue 必须判 false
        expect(cronDue(scheduleCronOf(k))).toBe(false);
        continue;
      }
      const expr = scheduleCronOf(k);
      // 别名没登记时 scheduleCronOf 会原样吐出别名（1 段），cronDue 从此恒 false
      expect(expr.split(" ").length, `${k} 的 cron 别名 "${DEFAULT_SCHEDULES[k].cron}" 未在 CRON_EXPRS 登记`).toBe(5);
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
    // 每天 04:00 的任务：只有 4 点整到
    expect(cronDue(scheduleCronOf("data_retention"), new Date(2026, 9, 18, 4, 0, 0))).toBe(true);
    expect(cronDue(scheduleCronOf("data_retention"), new Date(2026, 9, 18, 3, 0, 0))).toBe(false);
  });
});

describe("手动专属任务绝不被排期", () => {
  /**
   * 入队只看 checkRecurringSchedules() 遍历的 DEFAULT_CRON_SCHEDULES（按 intervalMs），
   * 与 cron 表达式和 cronDue() 无关 —— 所以 cron: "MANUAL" 不是保护。
   * 把 backup_restore 加进排期表，它就会真的自动跑：按备份把库改回去，不可逆。
   */
  const scheduled = new Set(DEFAULT_CRON_SCHEDULES.map((s) => s.kind));

  it("MANUAL_ONLY_KINDS 一个都不在排期表里，且 cron 声明为 MANUAL", () => {
    expect(MANUAL_ONLY_KINDS.length).toBeGreaterThan(0);
    for (const kind of MANUAL_ONLY_KINDS) {
      expect(
        scheduled.has(kind),
        `${kind} 出现在 DEFAULT_CRON_SCHEDULES：会被 intervalMs 真的自动入队`,
      ).toBe(false);
      expect(DEFAULT_SCHEDULES[kind].cron).toBe("MANUAL");
      expect(cronDue(scheduleCronOf(kind))).toBe(false);
    }
  });

  it("每个 JobKind 的归属明确：排期 / 手动 / 按需各一次（新增 kind 不会静默永不运行）", () => {
    /**
     * 第三类「按需」指只能由调用方入队、不走 intervalMs 的 kind：
     * refetch_metadata / site_self_healing 需要 siteId（payload 校验见 core/job-payloads.ts），
     * reindex 由备份导入等流程触发（routes/backup.ts、jobs.ts 的 manifest 写回）。
     * 走的是同一条 POST /api/jobs → repo.enqueueJob；这里把它们显式列出来，
     * 是为了让「新加一个 kind 却没有任何入队路径」在测试里立刻暴露。
     */
    const ON_DEMAND_KINDS: Array<(typeof JOB_KINDS)[number]> = [
      "refetch_metadata",
      "reindex",
      "site_self_healing",
    ];
    for (const kind of JOB_KINDS) {
      const times = DEFAULT_CRON_SCHEDULES.filter((s) => s.kind === kind).length;
      const manual = MANUAL_ONLY_KINDS.includes(kind) ? 1 : 0;
      const onDemand = ON_DEMAND_KINDS.includes(kind) ? 1 : 0;
      expect(
        times + manual + onDemand,
        `${kind}：排期 ${times} 次 / 手动 ${manual} / 按需 ${onDemand}`,
      ).toBe(1);
    }
  });

  it("排期表无重复 kind 且间隔为正", () => {
    expect(scheduled.size).toBe(DEFAULT_CRON_SCHEDULES.length);
    for (const s of DEFAULT_CRON_SCHEDULES) expect(s.intervalMs).toBeGreaterThan(0);
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
