import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-dashboard-test-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);

  // 初始化测试数据
  const c = await ctx.repo.createCategory({ title: "AI 测试分类" });
  await ctx.repo.createSite({
    url: "https://example.com/ai-1",
    title: "AI 工具 1",
    categoryId: c.id,
    status: "active",
  });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Dashboard & Telemetry Routes", () => {
  it("GET /api/admin/dashboard/overview 返回聚合全景数据与指标", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/overview",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.overview).toBeDefined();
    expect(body.overview.totalSites).toBe(1);
    expect(body.overview.activeSites).toBe(1);
    expect(body.overview.categories).toBeGreaterThanOrEqual(1);

    expect(body.metrics24h).toBeDefined();
    expect(body.storage).toBeDefined();
    expect(body.runtime).toBeDefined();
    expect(typeof body.runtime.uptimeSeconds).toBe("number");
    expect(typeof body.runtime.qps).toBe("number");
    expect(body.categoryDistribution).toBeDefined();
    expect(Array.isArray(body.categoryDistribution)).toBe(true);
  });

  it("GET /api/admin/dashboard/security 返回安全审计分析", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/security?hours=24",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalAuthFailures24h).toBeDefined();
    expect(Array.isArray(body.recentFailures)).toBe(true);
    expect(Array.isArray(body.recentAudits)).toBe(true);
    expect(body.tokenStats).toBeDefined();
  });

  it("GET /api/admin/dashboard/search-ai 返回 LinUCB 老虎机遥测与搜索热词", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/search-ai?days=14",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.days).toBe(14);
    expect(body.linucb).toBeDefined();
    expect(body.linucb.dimension).toBe(5);
    expect(body.linucb.arms.exact).toBeDefined();
    expect(Array.isArray(body.topQueries)).toBe(true);
    expect(Array.isArray(body.zeroResultQueries)).toBe(true);
    expect(Array.isArray(body.hotSites)).toBe(true);
  });

  it("POST /api/jobs/:id/cancel, /retry, /prune 任务全生命周期运维端点", async () => {
    // 1. 入队
    const enqueueRes = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { kind: "recompute_rank" },
    });
    expect(enqueueRes.statusCode).toBe(201);
    const jobId = enqueueRes.json().id;

    // 2. 取消
    const cancelRes = await app.inject({
      method: "POST",
      url: `/api/jobs/${jobId}/cancel`,
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().status).toBe("cancelled");

    // 3. 重试
    const retryRes = await app.inject({
      method: "POST",
      url: `/api/jobs/${jobId}/retry`,
    });
    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.json().job.status).toBe("pending");

    // 4. 清理 (prune)
    const pruneRes = await app.inject({
      method: "POST",
      url: "/api/jobs/prune",
      payload: { olderThanDays: 0, statuses: ["pending"] },
    });
    expect(pruneRes.statusCode).toBe(200);
    expect(pruneRes.json().ok).toBe(true);
    expect(typeof pruneRes.json().pruned).toBe("number");
  });

  it("GET /api/admin/maintenance/status, /checkpoint, /vacuum 数据库自检维护端点", async () => {
    const statusRes = await app.inject({
      method: "GET",
      url: "/api/admin/maintenance/status",
    });
    expect(statusRes.statusCode).toBe(200);
    const statusBody = statusRes.json();
    expect(statusBody.ok).toBe(true);
    expect(statusBody.integrity).toBe("ok");
    expect(statusBody.dialect).toBe("sqlite");

    const checkpointRes = await app.inject({
      method: "POST",
      url: "/api/admin/maintenance/checkpoint",
      payload: { mode: "passive" },
    });
    expect(checkpointRes.statusCode).toBe(200);
    expect(checkpointRes.json().ok).toBe(true);

    const vacuumRes = await app.inject({
      method: "POST",
      url: "/api/admin/maintenance/vacuum",
    });
    expect(vacuumRes.statusCode).toBe(200);
    expect(vacuumRes.json().ok).toBe(true);
  });

  it("GET /api/admin/audit/export 导出结构化审计流水", async () => {
    const exportRes = await app.inject({
      method: "GET",
      url: "/api/admin/audit/export?limit=100",
    });
    expect(exportRes.statusCode).toBe(200);
    const body = exportRes.json();
    expect(body.exportedAt).toBeDefined();
    expect(Array.isArray(body.items)).toBe(true);
    expect(exportRes.headers["content-disposition"]).toContain("attachment");
  });
});
