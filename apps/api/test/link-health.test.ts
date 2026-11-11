/**
 * A10：链接巡检后台清单 + 处置闭环测试。
 *
 * 覆盖：
 *  - GET /api/admin/link-health：总览口径与清单口径（broken 入列、连续失败入列、
 *    健康/未巡检/归档不入列、连续失败次数与错误分类对得上巡检落库数据）。
 *  - POST /api/admin/link-health/visibility：隐藏真生效（enabled=false、公开投影剔除）、
 *    恢复可逆、未知 id 如实回执、参数校验 400。
 *  - 推荐位口径：broken 不进热榜（repo.hotSites）与精选专题详情（GET /api/collections/:slug），
 *    站点巡检恢复后自动回到专题。
 *  - 鉴权模式下 admin scope 门禁：匿名 401、read token 403、admin token 200。
 *
 * 巡检结果用 repo.updateSiteHealth 造——与 health-check.task 落库走的是同一方法。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { buildNavigationData, isPubliclyVisibleSite } from "../src/storage.ts";

const dir = mkdtempSync(join(tmpdir(), "navhub-link-health-"));
const base = {
  mode: "lite" as const,
  embedding: { model: "m", endpoint: "https://hf-mirror.com", dtype: "q8" as const, cacheDir: join(dir, "models"), dim: 512, enabled: false },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 3000 },
  fetch: { timeoutMs: 1000, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let authCtx: AppContext;
let authApp: Awaited<ReturnType<typeof buildServer>>;

const ids: Record<string, string> = {};

async function failPatrol(siteId: string, httpStatus: number | null, error: string | null, markBroken: boolean) {
  await ctx.repo.updateSiteHealth(siteId, {
    httpStatus,
    ok: false,
    latencyMs: 120,
    redirectTo: null,
    error,
    markBroken,
    currentStatus: "active",
  });
}

beforeAll(async () => {
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "open.db") }));
  app = await buildServer(ctx);
  await app.ready();

  await ctx.repo.createCategory({ id: "root-life", title: "生活专区" });
  await ctx.repo.createCategory({ id: "cat-life", title: "生活服务", parentId: "root-life" });

  const mk = async (key: string, url: string, title: string) => {
    const site = await ctx.repo.createSite({ url, title, description: `${title} 描述`, categoryId: "cat-life", tags: [] });
    ids[key] = site.id;
  };
  await mk("broken", "https://broken.example.com", "已失效站");
  await mk("failing", "https://failing.example.com", "连续失败站");
  await mk("healthy", "https://healthy.example.com", "健康站");
  await mk("fresh", "https://fresh.example.com", "未巡检站");
  await mk("gone", "https://gone.example.com", "已归档站");

  // broken：连败 3 次，第三次确认失效（与 health-check.task 的阈值口径一致）
  await failPatrol(ids.broken, 503, "HTTP 503", false);
  await failPatrol(ids.broken, 503, "HTTP 503", false);
  await failPatrol(ids.broken, 503, "HTTP 503", true);
  // failing：连败 2 次，未达阈值，仍 active
  await failPatrol(ids.failing, null, "fetch failed: ECONNREFUSED", false);
  await failPatrol(ids.failing, null, "fetch failed: ECONNREFUSED", false);
  // healthy：巡检正常
  await ctx.repo.updateSiteHealth(ids.healthy, { httpStatus: 200, ok: true, latencyMs: 40, redirectTo: null, error: null });
  // gone：归档，不进清单
  await ctx.repo.updateSite(ids.gone, { status: "archived" });

  // 精选专题：含 broken 与 healthy 两站
  await ctx.repo.upsertCollection({
    slug: "lh-picks",
    title: "巡检口径专题",
    kind: "topic",
    sites: [ids.broken, ids.healthy],
  });

  // 鉴权实例（scope 门禁）
  authCtx = await createContext(loadConfig({
    ...base,
    sqlitePath: join(dir, "auth.db"),
    authRequired: true,
    bootstrapToken: "boot-secret-please-rotate",
    adminToken: "admin-static-please-rotate",
  }));
  authApp = await buildServer(authCtx);
  await authApp.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  await authApp.close();
  await authCtx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/admin/link-health 清单口径", () => {
  it("总览数字与样本一致，清单只含 broken 与连续失败站", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/link-health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // totalSites 是运营口径：不含已归档/待审；checkedSites 按 last_checked_at 计
    expect(body.summary.totalSites).toBe(4);
    expect(body.summary.checkedSites).toBe(3); // broken/failing/healthy；fresh 与 gone 未巡检
    expect(body.summary.brokenCount).toBe(1);
    expect(body.summary.failingCount).toBe(1);
    expect(body.summary.lastPatrolAt).toBeGreaterThan(0);

    const byId = new Map(body.items.map((i: { siteId: string }) => [i.siteId, i]));
    expect([...byId.keys()].sort()).toEqual([ids.broken, ids.failing].sort());

    const broken = byId.get(ids.broken) as Record<string, unknown>;
    expect(broken.status).toBe("broken");
    expect(broken.consecutiveFailures).toBe(3);
    expect(broken.httpStatus).toBe(503);
    expect(broken.errorKind).toBe("http_error");
    expect(broken.enabled).toBe(true);

    const failing = byId.get(ids.failing) as Record<string, unknown>;
    expect(failing.status).toBe("active");
    expect(failing.consecutiveFailures).toBe(2);
    expect(failing.errorKind).toBe("network");
  });
});

describe("POST /api/admin/link-health/visibility 处置闭环", () => {
  it("隐藏真生效：enabled 翻转且公开投影剔除；恢复可逆", async () => {
    const hide = await app.inject({
      method: "POST",
      url: "/api/admin/link-health/visibility",
      payload: { siteIds: [ids.broken], visible: false },
    });
    expect(hide.statusCode).toBe(200);
    expect(hide.json().updated).toBe(1);

    const hidden = await ctx.repo.getSite(ids.broken);
    expect(hidden?.enabled).toBe(false);
    expect(isPubliclyVisibleSite(hidden!)).toBe(false);

    const list = await app.inject({ method: "GET", url: "/api/admin/link-health" });
    const item = list.json().items.find((i: { siteId: string }) => i.siteId === ids.broken);
    expect(item.enabled).toBe(false);

    const show = await app.inject({
      method: "POST",
      url: "/api/admin/link-health/visibility",
      payload: { siteIds: [ids.broken], visible: true },
    });
    expect(show.json().updated).toBe(1);
    const restored = await ctx.repo.getSite(ids.broken);
    expect(restored?.enabled).toBe(true);
    expect(isPubliclyVisibleSite(restored!)).toBe(true);
  });

  it("未知 id 如实回执 ok=false，不算进 updated", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/link-health/visibility",
      payload: { siteIds: ["no-such-site"], visible: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.updated).toBe(0);
    expect(body.results).toEqual([{ siteId: "no-such-site", ok: false, reason: "not_found" }]);
  });

  it("参数无效 → 400", async () => {
    const empty = await app.inject({ method: "POST", url: "/api/admin/link-health/visibility", payload: { siteIds: [], visible: false } });
    expect(empty.statusCode).toBe(400);
    const noVisible = await app.inject({ method: "POST", url: "/api/admin/link-health/visibility", payload: { siteIds: [ids.broken] } });
    expect(noVisible.statusCode).toBe(400);
  });
});

describe("推荐位口径：broken 不进榜单与精选", () => {
  it("导航投影带 status：首页影院的 broken 过滤有数据可依", async () => {
    const nav = await buildNavigationData(ctx);
    const items = nav.navigationItems.flatMap((c) => [
      ...(c.items ?? []),
      ...(c.subCategories ?? []).flatMap((s) => s.items ?? []),
    ]);
    expect(items.find((i) => i.id === ids.broken)?.status).toBe("broken");
    expect(items.find((i) => i.id === ids.healthy)?.status).toBe("active");
  });

  it("repo.hotSites / newestSites 只含 active 站", async () => {
    const hotIds = (await ctx.repo.hotSites(10)).map((s) => s.id);
    expect(hotIds).toContain(ids.healthy);
    expect(hotIds).not.toContain(ids.broken);
    expect(hotIds).not.toContain(ids.gone);
    const newIds = (await ctx.repo.newestSites(10)).map((s) => s.id);
    expect(newIds).not.toContain(ids.broken);
  });

  it("精选专题详情剔除 broken；站点恢复后自动回来", async () => {
    const before = await app.inject({ method: "GET", url: "/api/collections/lh-picks" });
    expect(before.statusCode).toBe(200);
    const siteIds = before.json().sites.map((s: { id: string }) => s.id);
    expect(siteIds).toContain(ids.healthy);
    expect(siteIds).not.toContain(ids.broken);

    // 巡检恢复：与 health-check.task 的自愈口径一致（healthy 且原 broken → 回 active）
    await ctx.repo.updateSiteHealth(ids.broken, { httpStatus: 200, ok: true, latencyMs: 30, redirectTo: null, error: null, currentStatus: "active" });
    const after = await app.inject({ method: "GET", url: "/api/collections/lh-picks" });
    expect(after.json().sites.map((s: { id: string }) => s.id)).toContain(ids.broken);

    // 清单同步消失（恢复后不再是坏站）
    const list = await app.inject({ method: "GET", url: "/api/admin/link-health" });
    expect(list.json().items.map((i: { siteId: string }) => i.siteId)).not.toContain(ids.broken);
  });
});

describe("鉴权模式 scope 门禁", () => {
  it("匿名 401、read token 403、admin token 200", async () => {
    const anon = await authApp.inject({ method: "GET", url: "/api/admin/link-health" });
    expect(anon.statusCode).toBe(401);

    const mint = await authApp.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: "Bearer boot-secret-please-rotate" },
      payload: { name: "reader", scopes: "read" },
    });
    expect(mint.statusCode).toBe(201);
    const readToken = mint.json().token as string;
    const asReader = await authApp.inject({
      method: "GET",
      url: "/api/admin/link-health",
      headers: { authorization: "Bearer " + readToken },
    });
    expect(asReader.statusCode).toBe(403);

    const asAdmin = await authApp.inject({
      method: "GET",
      url: "/api/admin/link-health",
      headers: { authorization: "Bearer admin-static-please-rotate" },
    });
    expect(asAdmin.statusCode).toBe(200);
  });
});
