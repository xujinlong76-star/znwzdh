import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";

describe("Dashboard Repository & Search Extensions", () => {
  let db: Db;
  let repo: Repository;
  let search: SearchEngine;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    search = new SearchEngine({ db, fts: null, vectors: null, repo });
  });

  afterAll(async () => {
    await db.close();
  });

  it("dashboardOverview 返回全景指标与 24h 统计", async () => {
    const c1 = await repo.createCategory({ title: "AI 工具" });
    await repo.createSite({
      url: "https://example.com/site-1",
      title: "Site 1",
      categoryId: c1.id,
      status: "active",
    });
    await repo.createSite({
      url: "https://example.com/site-2",
      title: "Site 2",
      categoryId: c1.id,
      status: "broken",
    });

    // 写入健康检查、任务、审计与事件
    await repo.updateSiteHealth("s1", {
      ok: true,
      httpStatus: 200,
      latencyMs: 42,
      redirectTo: null,
      error: null,
    });
    await repo.enqueueJob("test_job", { foo: "bar" });
    await repo.audit({
      actor: "test_admin",
      actorKind: "user",
      action: "site.create",
      target: "s1",
    });
    await repo.recordEvent("search", { query: "人工智能" });
    await repo.recordEvent("click", { query: "人工智能" });

    const overview = await repo.dashboardOverview();
    expect(overview.overview.totalSites).toBe(2);
    expect(overview.overview.activeSites).toBe(1);
    expect(overview.overview.brokenSites).toBe(1);
    expect(overview.overview.categories).toBeGreaterThanOrEqual(1);

    expect(overview.metrics24h.healthChecks).toBe(1);
    expect(overview.metrics24h.healthRate).toBe(100);
    expect(overview.metrics24h.avgLatencyMs).toBe(42);
    expect(overview.metrics24h.jobsTotal).toBe(1);
    expect(overview.metrics24h.auditLogs).toBe(1);
    expect(overview.metrics24h.searches).toBe(1);
    expect(overview.metrics24h.clicks).toBe(1);

    expect(overview.storage.tableCounts.sites).toBe(2);
    expect(overview.storage.tableCounts.categories).toBeGreaterThanOrEqual(1);
  });

  it("categorySiteDistribution 返回顶级分类及其占比", async () => {
    const dist = await repo.categorySiteDistribution(5);
    expect(Array.isArray(dist)).toBe(true);
    expect(dist.length).toBeGreaterThanOrEqual(1);
    expect(dist[0]?.title).toBe("AI 工具");
    expect(dist[0]?.siteCount).toBe(2);
    expect(dist[0]?.percentage).toBe(100);
  });

  it("securityOverview 汇总近期鉴权失败与 Token 态势", async () => {
    await repo.audit({
      actor: "anonymous",
      actorKind: "anonymous",
      action: "auth.invalid_token",
      ip: "127.0.0.1",
    });

    const sec = await repo.securityOverview(24);
    expect(sec.totalAuthFailures24h).toBe(1);
    expect(sec.recentFailures.length).toBe(1);
    expect(sec.recentFailures[0]?.action).toBe("auth.invalid_token");
    expect(sec.recentAudits.length).toBeGreaterThanOrEqual(1);
  });

  it("SearchEngine.getLinUCBTelemetry 导出多臂老虎机状态", async () => {
    const linucb = search.getLinUCBTelemetry();
    expect(linucb.dimension).toBe(5);
    expect(linucb.alpha).toBe(0.15);
    expect(linucb.feedbackCount).toBe(0);
    expect(linucb.arms.exact).toBeDefined();
    expect(linucb.arms.semantic).toBeDefined();
    expect(linucb.arms.exact.weightEstimate).toBe(1.0);

    // 模拟反馈更新
    search.recordFeedback("fts", "test query", { reward: 1.0 });
    const after = search.getLinUCBTelemetry();
    expect(after.feedbackCount).toBe(1);
  });

  it("任务生命周期：getJob / cancelJob / retryJob / pruneJobs 完整运转", async () => {
    const jobId = await repo.enqueueJob("refetch_metadata", { siteId: "s1" });
    const job = await repo.getJob(jobId);
    expect(job).not.toBeNull();
    expect(job?.status).toBe("pending");
    expect(job?.attempts).toBe(0);

    // 取消任务
    const cancelled = await repo.cancelJob(jobId);
    expect(cancelled).toBe(true);
    const afterCancel = await repo.getJob(jobId);
    expect(afterCancel?.status).toBe("cancelled");

    // 重试已取消的任务
    const retried = await repo.retryJob(jobId);
    expect(retried?.status).toBe("pending");
    expect(retried?.attempts).toBe(0);

    // 模拟任务失败
    await repo.completeJob(jobId, "simulated error", { retryAt: null, exhausted: true });
    const failedJob = await repo.getJob(jobId);
    expect(failedJob?.status).toBe("failed");
    expect(failedJob?.error).toBe("simulated error");

    // 再次重试失败任务
    const retriedAgain = await repo.retryJob(jobId);
    expect(retriedAgain?.status).toBe("pending");
    expect(retriedAgain?.error).toBeNull();

    // 标记完成并测试 prune
    await repo.completeJob(jobId, null);
    const pruneResult = await repo.pruneJobs(0, ["done"]);
    expect(pruneResult.pruned).toBeGreaterThanOrEqual(1);
    const prunedJob = await repo.getJob(jobId);
    expect(prunedJob).toBeNull();
  });

  it("数据库自检与维护：maintenanceCheck / vacuumDatabase / optimizeFts / checkpointWal", async () => {
    const check = await repo.maintenanceCheck();
    expect(check.ok).toBe(true);
    expect(check.dialect).toBe("sqlite");
    expect(check.integrity).toBe("ok");
    expect(check.tableCounts.sites).toBeGreaterThanOrEqual(1);

    const vacuum = await repo.vacuumDatabase();
    expect(vacuum.ok).toBe(true);
    expect(vacuum.tookMs).toBeGreaterThanOrEqual(0);

    const optimize = await repo.optimizeFts();
    expect(optimize.ok).toBe(true);

    const checkpoint = await repo.checkpointWal("passive");
    expect(checkpoint.ok).toBe(true);
  });
});
