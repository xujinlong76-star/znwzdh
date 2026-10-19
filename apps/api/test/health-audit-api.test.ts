/**
 * 站点自治巡检与无感自愈 API 测试
 */
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
let testBrokenSiteId: string;
let testCategoryId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-health-audit-api-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "health-audit.db"),
    embedding: { enabled: false, cacheDir: join(dir, "models") },
    fetch: {
      timeoutMs: 2000,
      maxBytes: 262144,
      maxRedirects: 2,
      allowPrivateNetworks: false,
      userAgent: "NavHubTest/0.1",
    },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);

  const cat = await ctx.repo.createCategory({ title: "开发工具" });
  testCategoryId = cat.id;

  // 创建两个正常站点
  await ctx.repo.createSite({
    title: "GitHub",
    url: "https://github.com",
    categoryId: testCategoryId,
    status: "active",
    tags: ["git", "code"],
  });
  await ctx.repo.createSite({
    title: "GitLab",
    url: "https://gitlab.com",
    categoryId: testCategoryId,
    status: "active",
    tags: ["git", "ci"],
  });

  // 创建一个失效站点
  const broken = await ctx.repo.createSite({
    title: "Old Dead Repo",
    url: "https://old-dead-repo-2026.org/tools",
    categoryId: testCategoryId,
    status: "broken",
    tags: ["git", "archive"],
  });
  testBrokenSiteId = broken.id;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("站点自治巡检与无感自愈 API (/api/admin/audit/*)", () => {
  it("GET /api/admin/audit/report 返回全站健康评分与异常站点自愈提案", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/audit/report",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.summary).toBeDefined();
    expect(body.summary.totalSites).toBe(3);
    expect(body.summary.activeCount).toBe(2);
    expect(body.summary.brokenCount).toBe(1);
    expect(body.summary.healthScore).toBe(67);
    expect(Array.isArray(body.summary.issues)).toBe(true);
    expect(body.summary.issues.length).toBe(1);

    const issue = body.summary.issues[0];
    expect(issue.siteId).toBe(testBrokenSiteId);
    expect(issue.waybackRecoveryUrl).toContain("web.archive.org");
    expect(issue.recommendedAction).toBeDefined();
  });

  it("POST /api/admin/audit/scan 触发即时巡检并生成审计记录", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/audit/scan",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.scanned).toBe(3);
    expect(body.summary.brokenCount).toBe(1);
  });

  it("POST /api/admin/audit/apply 参数校验拦截", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/audit/apply",
      payload: { siteId: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
  });

  it("POST /api/admin/audit/apply 执行 Wayback 快照采纳自愈", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/audit/apply",
      payload: {
        siteId: testBrokenSiteId,
        action: "wayback",
        targetUrl: "https://web.archive.org/web/2026/https://old-dead-repo-2026.org/tools",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.site.status).toBe("active");
    expect(body.site.url).toContain("web.archive.org");

    // 验证更新已落库
    const updated = await ctx.repo.getSite(testBrokenSiteId);
    expect(updated?.status).toBe("active");
    expect(updated?.url).toContain("web.archive.org");
  });

  it("POST /api/sites/:id/recommend-alternative 生成智能平替推荐", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/sites/${testBrokenSiteId}/recommend-alternative`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.recommendations)).toBe(true);
    expect(body.recommendations.length).toBeGreaterThan(0);
    expect(body.recommendations[0].title).toBeDefined();
    expect(body.recommendations[0].url).toBeDefined();
  });
});
