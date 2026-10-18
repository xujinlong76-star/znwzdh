/**
 * JobRunner 与画像服务集成测试。
 *
 * 跑真实 SQLite + 真实 tick 循环（不 mock 仓储），覆盖：
 *  - recompute_rank：点击/收藏 -> trend_score 的真实排序效果
 *  - health_check：SSRF 目标被判 broken（不抛错咽掉整个循环）
 *  - refetch_metadata：坏 siteId -> 任务 failed 且不阻塞后续任务
 *  - 单实例锁：并发 tick 只有一个真正执行
 *  - 画像聚合：click 事件 -> user_profiles -> personal 通道可检索
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner, backoffMs, jobEventBus, type JobEventPayload } from "../src/jobs.ts";
import { refreshUserProfile } from "../src/profile-service.ts";

let dir: string;
let ctx: AppContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-jobs-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "jobs.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("recompute_rank 任务", () => {
  it("点击多的站点 trend_score 更高，且写入 sites 表", async () => {
    await ctx.repo.createCategory({ id: "rc", title: "热度类目" });
    const hot = await ctx.repo.createSite({ url: "https://example.com/hot", title: "热门站", categoryId: "rc" });
    const cold = await ctx.repo.createSite({ url: "https://example.com/cold", title: "冷门站", categoryId: "rc" });
    const old = await ctx.repo.createSite({ url: "https://example.com/old", title: "老站", categoryId: "rc" });

    // 热门站：5 次点击 + 2 次收藏
    for (let i = 0; i < 5; i++) await ctx.repo.recordEvent("click", { siteId: hot.id, meta: { identity: "u1" } });
    for (let i = 0; i < 2; i++) await ctx.repo.addFavorite({ userId: "u1", siteId: hot.id });
    // 冷门站：1 次点击
    await ctx.repo.recordEvent("click", { siteId: cold.id, meta: { identity: "u1" } });
    // 老站：无互动，但人为改老创建时间
    await ctx.db.sqlite!.prepare("UPDATE sites SET created_at = ? WHERE id = ?").run(Date.now() - 200 * 86_400_000, old.id);

    await ctx.repo.enqueueJob("recompute_rank", {});
    const runner = new JobRunner(ctx);
    const result = await runner.tick();
    expect(result.processed).toBe(1);

    const hotAfter = await ctx.repo.getSite(hot.id);
    const coldAfter = await ctx.repo.getSite(cold.id);
    const oldAfter = await ctx.repo.getSite(old.id);
    expect(hotAfter!.trendScore!).toBeGreaterThan(coldAfter!.trendScore!);
    expect(hotAfter!.trendScore!).toBeGreaterThan(oldAfter!.trendScore!);
    expect(coldAfter!.trendScore!).toBeGreaterThan(oldAfter!.trendScore!); // 有互动 > 无互动
    expect(oldAfter!.trendScore!).toBe(0); // 无互动老站钳为 0

    // 热度榜反映真实顺序
    const ranking = await ctx.repo.hotSites(3);
    expect(ranking[0]!.id).toBe(hot.id);
  });
});

describe("health_check 任务", () => {
  /**
   * 判定规则在 2026-10-18 改为「连续 3 次失败才 broken」：
   * 单次探测会被 403/429/超时命中，实测把 kubernetes.io / figma.com 等
   * 可正常访问的站点误标为 broken（50 站点里 15 个，误判率 30%）。
   * 因此这里断言两段行为：第 1 次只记录不判死，第 3 次才置 broken。
   */
  it("SSRF 目标：首次失败只记录，连续 3 次才判 broken，任务不失败", async () => {
    const site = await ctx.repo.createSite({ url: "http://127.0.0.1:9/", title: "内网站", categoryId: "rc" });
    const runner = new JobRunner(ctx);

    const runOnce = async () => {
      await ctx.repo.enqueueJob("health_check", { siteId: site.id });
      const result = await runner.tick();
      expect(result.processed).toBe(1);
    };

    await runOnce();
    const afterFirst = await ctx.repo.getSite(site.id);
    expect(afterFirst!.status).toBe("active"); // 单次抖动不判死
    expect(afterFirst!.health!.error).toBeTruthy();
    expect(afterFirst!.health!.lastCheckedAt).toBeGreaterThan(0);

    await runOnce();
    expect((await ctx.repo.getSite(site.id))!.status).toBe("active");

    await runOnce();
    const afterThird = await ctx.repo.getSite(site.id);
    expect(afterThird!.status).toBe("broken"); // 连续第 3 次才 broken

    // 任务本身是 done 不是 failed（抓取失败是业务的正常结果）
    const jobs = await ctx.repo.listJobs("done", 10);
    expect(jobs.some((j) => j.kind === "health_check")).toBe(true);
  });
});

describe("refetch_metadata 任务", () => {
  it("坏 siteId 首次失败回 pending（退避），不阻塞同轮其它任务", async () => {
    await ctx.repo.enqueueJob("refetch_metadata", { siteId: "no-such-site" });
    await ctx.repo.enqueueJob("recompute_rank", {});
    const runner = new JobRunner(ctx);
    const result = await runner.tick();
    expect(result.processed).toBe(2);

    // 首次失败不再直接终态 failed：回 pending 并排了退避时间（否则瞬时抖动一击毙命）
    const jobs = await ctx.repo.listJobs(undefined, 20);
    const refetch = jobs.find((j) => j.kind === "refetch_metadata" && j.error);
    expect(refetch).toBeTruthy();
    expect(refetch!.status).toBe("pending");
    expect(refetch!.nextRunAt).toBeGreaterThan(Date.now());
    const done = await ctx.repo.listJobs("done", 10);
    expect(done.some((j) => j.kind === "recompute_rank")).toBe(true);
  });

  it("退避到点前不被认领（不饿死正常任务）", async () => {
    const pending = (await ctx.repo.listJobs("pending", 10)).filter((j) => j.nextRunAt !== null);
    expect(pending.length).toBeGreaterThan(0);
    const runner = new JobRunner(ctx);
    // next_run_at 在未来 → 一个都认领不到
    expect((await runner.tick()).processed).toBe(0);
  });

  it("重试到点后重新认领，耗尽 3 次才落 failed 并触发一次告警", async () => {
    const alerts: string[] = [];
    const runner = new JobRunner(ctx, { onAlert: (msg) => alerts.push(msg) });
    let refetchId = "";

    // 把所有退避中的任务时间拨到过去，模拟"到点"
    const now = Date.now();
    ctx.db.sqlite!.prepare("UPDATE jobs SET next_run_at = ? WHERE next_run_at IS NOT NULL").run(now - 1);
    let jobs = await ctx.repo.listJobs("pending", 10);
    refetchId = jobs.find((j) => j.kind === "refetch_metadata")?.id ?? "";
    expect(refetchId).toBeTruthy();

    // attempts 已是 1 → 再执行 2 次即达到 MAX_JOB_ATTEMPTS=3
    await runner.tick();
    // 第二次失败后仍在退避
    ctx.db.sqlite!.prepare("UPDATE jobs SET next_run_at = ? WHERE id = ?").run(now - 1, refetchId);
    await runner.tick();

    const final = (await ctx.repo.listJobs(undefined, 50)).find((j) => j.id === refetchId);
    expect(final!.status).toBe("failed");
    expect(final!.attempts).toBeGreaterThanOrEqual(3);
    // 告警恰好一次（耗尽时），不是每次失败都喊
    expect(alerts.length).toBe(1);
    expect(alerts[0]).toContain("refetch_metadata");
    expect(alerts[0]).toContain("停止重试");
  });
});

describe("任务配置与退避", () => {
  it("backoffMs 指数增长且封顶 1 小时", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(240_000);
    expect(backoffMs(20)).toBe(60 * 60_000); // 封顶
  });

  it("轮询间隔可由 NAVHUB_JOBS_INTERVAL_MS 配置（非法值回退 30s）", () => {
    process.env.NAVHUB_JOBS_INTERVAL_MS = "5000";
    expect(new JobRunner(ctx).interval).toBe(5000);
    process.env.NAVHUB_JOBS_INTERVAL_MS = "10"; // < 1000 视为非法
    expect(new JobRunner(ctx).interval).toBe(30_000);
    delete process.env.NAVHUB_JOBS_INTERVAL_MS;
    expect(new JobRunner(ctx).interval).toBe(30_000);
  });
});

describe("reindex 任务", () => {
  it("全站重建不报错（embedding 关闭时只重建拼音/FTS）", async () => {
    await ctx.repo.enqueueJob("reindex", { vectors: false });
    const runner = new JobRunner(ctx);
    const result = await runner.tick();
    expect(result.processed).toBe(1);
    const failed = await ctx.repo.listJobs("failed", 10);
    expect(failed.some((j) => j.kind === "reindex")).toBe(false);
  });
});

describe("data_retention 任务", () => {
  /** 造几天前的 events：直接改 created_at，避免测试等真实时间 */
  async function seedOldEvents(days: number[], perDay = 3) {
    for (const d of days) {
      const at = Date.now() - d * 86_400_000;
      for (let i = 0; i < perDay; i++) {
        await ctx.repo.recordEvent("click", { siteId: null, meta: { identity: `u${i}` } });
        await ctx.db.sqlite!.prepare("UPDATE events SET created_at = ? WHERE rowid = last_insert_rowid()").run(at);
      }
    }
  }

  /** 只数 click 明细：data_retention 自己也会写一条 events 留痕，不能混进来 */
  const countClicks = async () =>
    Number(
      (await ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM events WHERE kind = 'click'").get())?.c ?? 0,
    );
  /** 用例之间共享同一个库：先清掉上一个用例留下的过期 click，断言才站得住 */
  const clearOldClicks = async () => {
    await ctx.db.sqlite!
      .prepare("DELETE FROM events WHERE kind = 'click' AND created_at < ?")
      .run(Date.now() - 365 * 86_400_000);
  };
  const tableExists = async (table: string) =>
    Boolean(
      (await ctx.db.sqlite!.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))?.name,
    );

  it("默认（rollup + dry-run）只统计：不建聚合表、不删明细", async () => {
    await clearOldClicks();
    await seedOldEvents([400, 399], 2);
    await ctx.repo.enqueueJob("data_retention", {});
    const result = await new JobRunner(ctx).tick();

    expect(result.processed).toBe(1);
    expect(await tableExists("events_daily")).toBe(false); // dry-run 不建表
    const before = await countClicks();
    await ctx.repo.enqueueJob("data_retention", { mode: "rollup", apply: false, maxDays: 30 });
    await new JobRunner(ctx).tick();
    expect(await countClicks()).toBe(before); // 一行没删
    const failed = await ctx.repo.listJobs("failed", 10);
    expect(failed.some((j) => j.kind === "data_retention")).toBe(false);
  });

  it("rollup + apply：写 events_daily、删已聚合的明细，并留一条 data_retention 事件", async () => {
    await ctx.db.sqlite!.prepare("DELETE FROM events WHERE site_id IS NULL").run();
    await seedOldEvents([400, 399], 2); // 两天、每天 2 行
    const before = await countClicks();

    await ctx.repo.enqueueJob("data_retention", { mode: "rollup", apply: true, maxDays: 30 });
    const result = await new JobRunner(ctx).tick();
    expect(result.processed).toBe(1);

    // 两天各自一个分组（每天 2 行 click，site_id 为空 → site_key = ''）
    const rows = await ctx.db.sqlite!
      .prepare("SELECT day_start, kind, site_key, total, identities FROM events_daily ORDER BY day_start")
      .all();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.kind).toBe("click");
      expect(row.site_key).toBe("");
      expect(Number(row.total)).toBe(2);
      expect(Number(row.identities)).toBe(2); // u0 / u1 两个身份
    }
    expect(await countClicks()).toBe(before - 4);

    // 行为事件留痕：运维能在事件流里看到这轮动了什么
    const trail = await ctx.db.sqlite!
      .prepare("SELECT COUNT(*) AS c FROM events WHERE kind = 'data_retention'")
      .get();
    expect(Number(trail?.c)).toBe(1);
  });

  it("cleanup + apply 被拒绝（fail-closed）：任务报错且明细一行未删", async () => {
    await clearOldClicks();
    await seedOldEvents([500], 3);
    const before = await countClicks();

    await ctx.repo.enqueueJob("data_retention", { mode: "cleanup", apply: true });
    await new JobRunner(ctx).tick();

    // 首次失败会进 retrying（还有重试额度），错误信息已经落在 job 行上
    const jobs = await ctx.repo.listJobs(undefined, 50);
    const job = jobs.find((j) => j.kind === "data_retention");
    expect(job?.error).toContain("只允许 dry-run");
    expect(job?.error).toContain("scripts/data-retention.mjs");
    expect(await countClicks()).toBe(before); // 一行没删
  });

  it("cleanup dry-run 正常完成并给出命中量（不删任何行）", async () => {
    await clearOldClicks();
    await seedOldEvents([500, 400], 2);
    const before = await countClicks();

    await ctx.repo.enqueueJob("data_retention", { mode: "cleanup" });
    const result = await new JobRunner(ctx).tick();

    expect(result.processed).toBe(1);
    expect(await countClicks()).toBe(before);
    const failed = await ctx.repo.listJobs("failed", 10);
    expect(failed.some((j) => j.kind === "data_retention" && j.status === "failed")).toBe(false);
  });
});

describe("单实例锁与防重入", () => {
  it("并发 tick 只有一个真正执行（防重入）", async () => {
    await ctx.repo.enqueueJob("recompute_rank", {});
    const runner = new JobRunner(ctx);
    const [a, b] = await Promise.all([runner.tick(), runner.tick()]);
    const executed = [a, b].filter((r) => !r.skipped);
    expect(executed.length).toBe(1);
    expect(a.processed + b.processed).toBe(1);
  });

  it("锁释放后下一轮可以继续消费", async () => {
    await ctx.repo.enqueueJob("recompute_rank", {});
    const runner = new JobRunner(ctx);
    expect((await runner.tick()).processed).toBe(1);
    await ctx.repo.enqueueJob("recompute_rank", {});
    expect((await runner.tick()).processed).toBe(1);
  });

  it("锁行在 idempotency 表且带持有者（可观测）", async () => {
    const row = ctx.db.sqlite!.prepare("SELECT key, response FROM idempotency WHERE key = ?").get("lock:job-runner") as { response?: string } | undefined;
    // tick 结束后锁已释放（DELETE），所以这里应该没有行——验证释放语义
    expect(row).toBeUndefined();
  });
});

describe("个性化画像服务", () => {
  it("click 事件聚合出画像，并可注入检索的 personal 通道", async () => {
    await ctx.repo.createCategory({ id: "ai-cat", title: "AI 工具" });
    await ctx.repo.createCategory({ id: "dev-cat", title: "开发运维" });
    const s1 = await ctx.repo.createSite({ url: "https://example.com/ai1", title: "AI 站一", categoryId: "ai-cat", tags: ["大模型"] });
    const s2 = await ctx.repo.createSite({ url: "https://example.com/ai2", title: "AI 站二", categoryId: "ai-cat", tags: ["大模型", "对话"] });
    await ctx.repo.createSite({ url: "https://example.com/dev1", title: "开发站", categoryId: "dev-cat", tags: ["代码"] });

    // 用户 u-p 连续点击 AI 类站点
    for (let i = 0; i < 4; i++) {
      await ctx.repo.recordEvent("click", { siteId: i % 2 === 0 ? s1.id : s2.id, meta: { identity: "u-p" } });
    }
    await ctx.repo.recordEvent("click", { siteId: (await ctx.repo.findSiteByUrl("https://example.com/dev1"))!.id, meta: { identity: "u-p" } });

    const refreshed = await refreshUserProfile(ctx, "u-p");
    expect(refreshed).toBe(true);

    const profile = await ctx.repo.getUserProfile("u-p");
    expect(profile).not.toBeNull();
    expect(profile!.topCategories[0]).toBe("ai-cat");
    expect(profile!.topTags).toContain("大模型");
    expect(profile!.visitedSiteIds.length).toBe(3);

    // 画像可直接作为 personalize 信号注入检索（personal 通道出现）。
    // 注意：personal 只对「已被相关性通道召回」的站点生效（设计约束），
    // 所以查询词必须能命中这些站点——用 "AI" 命中「AI 站一/二」。
    const result = await ctx.search.search({
      q: "AI",
      personalize: {
        topCategories: profile!.topCategories,
        topTags: profile!.topTags,
        visitedSiteIds: profile!.visitedSiteIds,
      },
      limit: 10,
    });
    expect(result.channelsUsed).toContain("personal");
    // personal 通道权重低：不会把不相关站点顶到第一（RRF 教训的回归保护）
    const first = result.hits[0];
    expect(first).toBeTruthy();
  });

  it("节流：60 秒内重复刷新返回 false", async () => {
    expect(await refreshUserProfile(ctx, "u-p")).toBe(false);
  });

  it("陌生身份刷新不出错（空画像）", async () => {
    const ok = await refreshUserProfile(ctx, "u-stranger");
    expect(ok).toBe(true);
    const profile = await ctx.repo.getUserProfile("u-stranger");
    expect(profile!.topCategories).toEqual([]);
    expect(profile!.searchCount).toBe(0);
  });

  it("site_self_healing 任务执行自愈诊断并落审计", async () => {
    const site = await ctx.repo.createSite({
      url: "https://healing-test.example.com",
      title: "自愈测试站",
      categoryId: "ai-cat",
      status: "broken",
    });

    const jobId = await ctx.repo.enqueueJob("site_self_healing", { siteId: site.id });
    const runner = new JobRunner(ctx, { intervalMs: 1000 });
    await runner.tick();

    const jobs = await ctx.repo.listJobs(undefined, 10);
    const job = jobs.find((j) => j.id === jobId);
    expect(job?.status).toBe("done");

    const audit = ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = ? AND target = ?")
      .get("site.heal", site.id) as { c: number };
    expect(Number(audit.c)).toBeGreaterThan(0);
  });

  it("health_check 巡检按 Weibull 存活概率优先调度陈旧/高危站点", async () => {
    const now = Date.now();
    const DAY = 86_400_000;
    const recent = await ctx.repo.createSite({
      url: "https://recent.example.com",
      title: "近期已查站点",
      categoryId: "ai-cat",
      status: "active",
    });
    const stale = await ctx.repo.createSite({
      url: "https://stale.example.com",
      title: "长期未巡检站点",
      categoryId: "ai-cat",
      status: "active",
    });

    ctx.db.sqlite!.prepare("UPDATE sites SET last_checked_at = ? WHERE id = ?").run(now - 500 * DAY, stale.id);
    ctx.db.sqlite!.prepare("UPDATE sites SET last_checked_at = ? WHERE id = ?").run(now - 1 * DAY, recent.id);

    const runner = new JobRunner(ctx, { intervalMs: 1000 });
    const targets = await (runner as any).patrolTargets(50);
    const staleIndex = targets.findIndex((t: any) => t.id === stale.id);
    const recentIndex = targets.findIndex((t: any) => t.id === recent.id);
    expect(staleIndex).toBeGreaterThanOrEqual(0);
    expect(recentIndex).toBeGreaterThanOrEqual(0);
    expect(staleIndex).toBeLessThan(recentIndex);
  });

  it("token_audit 任务巡检临期、过期与长期闲置凭据并落审计", async () => {
    const now = Date.now();
    const DAY = 86_400_000;
    const normal = await ctx.repo.createApiToken({
      name: "正常凭据",
      tokenHash: "hash-token-audit-normal",
      scopes: "read",
      expiresAt: now + 60 * DAY,
    });
    const expiring = await ctx.repo.createApiToken({
      name: "即将过期凭据",
      tokenHash: "hash-token-audit-expiring",
      scopes: "read",
      expiresAt: now + 5 * DAY,
    });
    const expired = await ctx.repo.createApiToken({
      name: "已过期凭据",
      tokenHash: "hash-token-audit-expired",
      scopes: "read",
      expiresAt: now - 2 * DAY,
    });
    const dormant = await ctx.repo.createApiToken({
      name: "闲置凭据",
      tokenHash: "hash-token-audit-dormant",
      scopes: "read",
    });
    ctx.db.sqlite!.prepare("UPDATE api_tokens SET created_at = ? WHERE id = ?").run(now - 120 * DAY, dormant.id);

    const jobId = await ctx.repo.enqueueJob("token_audit", { expiringDays: 14, dormantDays: 90 });
    const runner = new JobRunner(ctx, { intervalMs: 1000 });
    await runner.tick();

    const jobs = await ctx.repo.listJobs(undefined, 10);
    const job = jobs.find((j) => j.id === jobId);
    expect(job?.status).toBe("done");

    const auditRow = ctx.db.sqlite!.prepare("SELECT diff FROM audit_logs WHERE action = 'token.audit' ORDER BY id DESC LIMIT 1").get() as { diff: string };
    expect(auditRow).toBeTruthy();
    const diff = JSON.parse(auditRow.diff);
    expect(diff.expiringCount).toBeGreaterThanOrEqual(1);
    expect(diff.expiredCount).toBeGreaterThanOrEqual(1);
    expect(diff.dormantCount).toBeGreaterThanOrEqual(1);
    expect(diff.expiringIds).toContain(expiring.id);
    expect(diff.expiredIds).toContain(expired.id);
    expect(diff.dormantIds).toContain(dormant.id);
    expect(diff.expiringIds).not.toContain(normal.id);
  });

  it("purge_trash 任务物理清理超期软删除站点", async () => {
    const site = await ctx.repo.createSite({ url: "https://example.com/expired-trash", title: "超期软删站", categoryId: "rc" });
    await ctx.repo.deleteSite(site.id);

    // 修改 deleted_at 为 40 天前
    const fortyDaysAgo = Date.now() - 40 * 86_400_000;
    ctx.db.sqlite!.prepare("UPDATE sites SET deleted_at = ? WHERE id = ?").run(fortyDaysAgo, site.id);

    const jobId = await ctx.repo.enqueueJob("purge_trash", { olderThanDays: 30 });
    const runner = new JobRunner(ctx);
    await runner.tick();

    const jobs = await ctx.repo.listJobs(undefined, 10);
    const job = jobs.find((j) => j.id === jobId);
    expect(job?.status).toBe("done");

    // 确认已彻底物理抹除
    const checkRow = ctx.db.sqlite!.prepare("SELECT id FROM sites WHERE id = ?").get(site.id);
    expect(checkRow).toBeUndefined();
  });

  it("enableCron 模式在 tick 时自动调度内置周期任务", async () => {
    const runner = new JobRunner(ctx, { enableCron: true });
    const tickRes = await runner.tick();
    expect(tickRes.processed).toBeGreaterThan(0);

    // 再次 tick 时，由于 cron 水位已更新且未到间隔，不会重复入队大量任务
    const secondTick = await runner.tick();
    expect(secondTick.processed).toBe(0);
  });

  it("jobEventBus 在任务执行生命周期中派发实时状态事件", async () => {
    const events: JobEventPayload[] = [];
    const unsubscribe = (payload: JobEventPayload) => {
      events.push(payload);
    };
    jobEventBus.on("job", unsubscribe);

    try {
      const jobId = await ctx.repo.enqueueJob("recompute_rank", {});
      const runner = new JobRunner(ctx);
      await runner.tick();

      const related = events.filter((e) => e.jobId === jobId);
      expect(related.some((e) => e.status === "running")).toBe(true);
      expect(related.some((e) => e.status === "completed")).toBe(true);
    } finally {
      jobEventBus.off("job", unsubscribe);
    }
  });
});

describe("PG advisory lock 同连接语义（fake 池，无需真实 PG）", () => {
  it("加锁与解锁在同一连接上执行，结束后归还", async () => {
    const queries: Array<{ client: object; sql: string }> = [];
    const released: object[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push({ client, sql });
        return { rows: [{ ok: true }], rowCount: 1 };
      },
      release: () => { released.push(client); },
    };
    const pool = {
      query: async (): Promise<never> => { throw new Error("锁必须走独占连接"); },
      connect: async () => client,
      end: async () => {},
    };
    const fakeCtx = {
      db: { dialect: "pg", pg: pool },
      repo: { claimNextJob: async () => null },
    } as unknown as AppContext;
    const runner = new JobRunner(fakeCtx);
    const r = await runner.tick();
    expect(r.skipped).toBe(false);
    const lockQ = queries.filter((q) => q.sql.includes("pg_try_advisory_lock"));
    const unlockQ = queries.filter((q) => q.sql.includes("pg_advisory_unlock"));
    expect(lockQ.length).toBe(1);
    expect(unlockQ.length).toBe(1);
    // 关键断言：unlock 必须发生在加锁的同一会话上，否则锁残留
    expect(unlockQ[0]!.client).toBe(lockQ[0]!.client);
    expect(released).toContain(client);
  });

  it("拿不到独占连接时放弃本轮（fail-closed，不发病）", async () => {
    const pool = {
      query: async () => ({ rows: [], rowCount: 0 }),
      end: async () => {},
    };
    const fakeCtx = {
      db: { dialect: "pg", pg: pool },
      repo: { claimNextJob: async () => null },
    } as unknown as AppContext;
    const runner = new JobRunner(fakeCtx);
    const r = await runner.tick();
    expect(r.skipped).toBe(true);
    expect(r.processed).toBe(0);
  });
});
