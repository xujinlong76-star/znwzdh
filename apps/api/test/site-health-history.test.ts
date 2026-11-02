/**
 * 站点健康历史端点测试（详情页健康趋势 sparkline 的数据源）。
 *
 * 覆盖：
 *  - 返回最近 N 次巡检，按时间正序（旧→新），便于前端直接画折线；
 *  - 站点不存在返回 404；
 *  - limit 越界被钳制；
 *  - 无巡检数据时返回空数组（不报错）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const dir = mkdtempSync(join(tmpdir(), "navhub-health-history-"));
const base = {
  mode: "lite" as const,
  embedding: { model: "m", endpoint: "https://hf-mirror.com", dtype: "q8" as const, cacheDir: join(dir, "models"), dim: 512, enabled: false },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 3000 },
  fetch: { timeoutMs: 1000, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

/** 直接插入一条 health_checks 记录（不经巡检任务，避免网络） */
async function insertHealthCheck(siteId: string, ok: boolean, checkedAt: number) {
  await ctx.repo.run(
    "INSERT INTO health_checks (site_id, checked_at, ok, http_status, latency_ms) VALUES (?,?,?,?,?)",
    [siteId, checkedAt, ok ? 1 : 0, ok ? 200 : 0, ok ? 120 : 0],
  );
}

beforeAll(async () => {
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "health.db") }));
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/sites/:id/health-history", () => {
  it("返回按时间正序的巡检历史", async () => {
    await ctx.repo.createCategory({ id: "cat-test", title: "测试分类" });
    await ctx.repo.createSiteWithId({
      id: "site-test-1",
      url: "https://example.com",
      title: "测试站点",
      categoryId: "cat-test",
    });

    // 插入 5 条巡检，时间从旧到新
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await insertHealthCheck("site-test-1", i % 2 === 0, now - (5 - i) * 60_000);
    }

    const res = await app.inject({ method: "GET", url: "/api/sites/site-test-1/health-history?limit=30" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.checks)).toBe(true);
    expect(body.checks.length).toBe(5);
    // 时间正序：第一条最早，最后一条最新
    expect(body.checks[0].checkedAt).toBeLessThan(body.checks[4].checkedAt);
    // ok 值正确
    expect(body.checks[0].ok).toBe(true);
    expect(body.checks[1].ok).toBe(false);
  });

  it("limit 越界被钳制到 [1,90]", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sites/site-test-1/health-history?limit=9999" });
    expect(res.statusCode).toBe(200);
    expect(res.json().checks.length).toBeLessThanOrEqual(90);
  });

  it("站点不存在返回 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sites/no-such-site/health-history" });
    expect(res.statusCode).toBe(404);
  });

  it("无巡检数据时返回空数组", async () => {
    await ctx.repo.createSiteWithId({
      id: "site-no-health",
      url: "https://nohealth.example.com",
      title: "无巡检站点",
      categoryId: "cat-test",
    });
    const res = await app.inject({ method: "GET", url: "/api/sites/site-no-health/health-history" });
    expect(res.statusCode).toBe(200);
    expect(res.json().checks).toEqual([]);
  });
});
