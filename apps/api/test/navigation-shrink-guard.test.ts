/**
 * navigation.json 写回的缩水保护（P2 收尾）。
 *
 * 快照是整包覆盖写：前端一次 bug 提交空快照，就会把几千个托管站点全部软删。
 * 判据与 videos.json 相同（100 条基线 / 80% 保留率），但基线只数
 * 「这份快照有权删除的托管站点」——手工 / MCP 创建的站点不参与比较。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import {
  evaluateNavigationShrink,
  NAVIGATION_SHRINK_KEEP_RATIO,
  NAVIGATION_SHRINK_MIN_BASELINE,
} from "../src/storage.ts";
import { resolveSiteIcon } from "@navhub/core";

const NAV = "src/navsphere/content/navigation.json";
const NAV_COUNT = 150;
const MANUAL_COUNT = 40;

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-nav-shrink-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  ctx.db.sqlite!.exec("DELETE FROM sites; DELETE FROM categories;");
  await ctx.repo.createCategory({ id: "nav-top", title: "导航", source: "navsphere" });
  const rows: Array<Parameters<AppContext["repo"]["insertSitesBulk"]>[0][number]> = [];
  for (let i = 0; i < NAV_COUNT; i++) {
    const url = `https://ns-${i}.example.com`;
    rows.push({ id: `ns-${i}`, url, title: `站点 ${i}`, iconKey: resolveSiteIcon(url, `站点 ${i}`), categoryId: "nav-top", sort: i, source: "navsphere" });
  }
  for (let i = 0; i < MANUAL_COUNT; i++) {
    const url = `https://manual-${i}.example.com`;
    rows.push({ id: `manual-${i}`, url, title: `手工站点 ${i}`, iconKey: resolveSiteIcon(url, `手工站点 ${i}`), categoryId: "nav-top", sort: 1000 + i, source: "manual" });
  }
  await ctx.repo.insertSitesBulk(rows, { hydrate: false });
});

function snapshot(count: number): Record<string, unknown> {
  return {
    navigationItems: [
      {
        id: "nav-top",
        title: "导航",
        enabled: true,
        items: Array.from({ length: count }, (_, i) => ({
          id: `ns-${i}`,
          title: `站点 ${i}`,
          href: `https://ns-${i}.example.com`,
          enabled: true,
        })),
        subCategories: [],
      },
    ],
  };
}

async function put(data: unknown, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: "PUT",
    url: "/api/storage",
    payload: { path: NAV, content: JSON.stringify(data), ...extra },
  });
}

async function active(source?: string): Promise<number> {
  const rows = source
    ? await ctx.repo.raw("SELECT COUNT(*) AS n FROM sites WHERE deleted_at IS NULL AND source = ?", [source])
    : await ctx.repo.raw("SELECT COUNT(*) AS n FROM sites WHERE deleted_at IS NULL");
  return Number((rows[0] as { n: number }).n);
}

describe("导航快照缩水保护", () => {
  it("门槛与视频库同判据（100 / 80%），常量独立导出", () => {
    expect(NAVIGATION_SHRINK_MIN_BASELINE).toBe(100);
    expect(NAVIGATION_SHRINK_KEEP_RATIO).toBe(0.8);
    expect(evaluateNavigationShrink(99, 0)).toBeNull();
    expect(evaluateNavigationShrink(200, 160)).toBeNull();
    expect(evaluateNavigationShrink(200, 159)).toMatchObject({ existingCount: 200, minimumAllowed: 160 });
    // 清空整库是最极端的缩水，不能有「0 也算合法」的口子
    expect(evaluateNavigationShrink(201, 0)).toMatchObject({ minimumAllowed: 161 });
  });

  it("空快照默认拒绝：409 + retryWith，且一个站点都没删", async () => {
    const res = await put(snapshot(0));
    expect(res.statusCode, res.body).toBe(409);
    const body = res.json() as Record<string, any>;
    expect(body.error).toBe("navigation_shrink_requires_confirmation");
    expect(body).toMatchObject({ existingCount: NAV_COUNT, incomingCount: 0, minimumAllowed: 120 });
    // 客户端照 retryWith 重试就能过；让它自己猜数字会正好撞上 mismatch
    expect(body.retryWith).toEqual({ confirmLargeDeletion: true, expectedCount: 0 });

    expect(await active()).toBe(NAV_COUNT + MANUAL_COUNT);
    const logs = await ctx.repo.listAuditLogs({ action: "storage.navigation.shrink_blocked", limit: 5 });
    expect(logs.items.length).toBeGreaterThan(0);
    expect(logs.items[0].diff).toMatchObject({ code: "navigation_shrink_requires_confirmation", incomingCount: 0 });
  });

  it("只给 confirm 不给 expectedCount：仍然拒绝（确认不能退化成一个布尔开关）", async () => {
    const res = await put(snapshot(5), { confirmLargeDeletion: true });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ error: "navigation_shrink_expected_count_required", incomingCount: 5 });
    expect(await active("navsphere")).toBe(NAV_COUNT);
  });

  it("expectedCount 与真实条数不符：拒绝，并说出「声明 / 实际」", async () => {
    const res = await put(snapshot(5), { confirmLargeDeletion: true, expectedCount: 4 });
    expect(res.statusCode, res.body).toBe(409);
    const body = res.json() as Record<string, any>;
    expect(body.error).toBe("navigation_shrink_expected_count_mismatch");
    expect(body.detail).toContain("声明 4 个站点");
    expect(body.detail).toContain("实际 5 个");
    expect(await active("navsphere")).toBe(NAV_COUNT);
  });

  it("基线不含手工站点：120 / 150 恰好 80% 放行", async () => {
    // 若基线误算成 190（含 40 个手工站点），下限会变成 152，这条正常保存就被误拦
    const res = await put(snapshot(120));
    expect(res.statusCode, res.body).toBe(200);
    expect(await active("navsphere")).toBe(120);
    expect(await active("manual")).toBe(MANUAL_COUNT);
  });

  it("两段确认齐全：真的删到 10 个托管站点，手工站保留，审计留痕", async () => {
    const res = await put(snapshot(10), { confirmLargeDeletion: true, expectedCount: 10 });
    expect(res.statusCode, res.body).toBe(200);
    expect(await active("navsphere")).toBe(10);
    expect(await active("manual")).toBe(MANUAL_COUNT);

    const logs = await ctx.repo.listAuditLogs({ action: "storage.navigation.large_deletion", limit: 5 });
    expect(logs.items.length).toBeGreaterThan(0);
    expect(logs.items[0].diff).toMatchObject({
      existingCount: NAV_COUNT,
      incomingCount: 10,
      minimumAllowed: 120,
      declaredExpectedCount: 10,
    });
    // 确认放行不等于没有正常写入审计：两条都要在，事后才连得起来
    const writes = await ctx.repo.listAuditLogs({ action: "storage.write", limit: 5 });
    expect(writes.items.some((log) => log.target === NAV)).toBe(true);
  });

  it("确认后的原样保存不再触发：小库低于基线门槛", async () => {
    await put(snapshot(10), { confirmLargeDeletion: true, expectedCount: 10 });
    const res = await put(snapshot(10));
    expect(res.statusCode, res.body).toBe(200);
    expect(await active("navsphere")).toBe(10);
  });
});
