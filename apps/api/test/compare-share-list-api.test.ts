/**
 * 对照表分享列表接口：`GET /api/compare/shares`（P13 sitemap 打通）。
 *
 * 本文件独立临时库（不与 compare-share-api.test.ts 共享库），覆盖：
 *   1. 空库 → `{ ok: true, items: [] }`；
 *   2. 返回结构：sitemap loader 约定的 `{ items: [{ slug, updatedAt,
 *      publishedAt }] }`，三键齐全、无 owner、无 published_json；
 *   3. 只含已发布：下线后即消失，单查同步 404；
 *   4. 排序：updated_at 倒序；
 *   5. 分页：limit / offset；
 *   6. status 只认 published，其它值 → 400；
 *   7. 免登公开读。
 *
 * 顺序敏感：用例按文件顺序执行——空库断言必须在任何发布之前。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

let siteAId = "";
let siteBId = "";

const USER = "user-1";
const userHeaders = { "x-navhub-user-id": USER };

const FIELDS = ["pricing", "platform"];

async function seed() {
  const cat = await ctx.repo.createCategory({ title: "效率办公", slug: "office" });
  const a = await ctx.repo.createSite({
    url: "https://ppt-a.example.com",
    title: "PPT 大师",
    description: "在线做 PPT",
    categoryId: cat.id,
    tags: ["PPT"],
    facets: { pricing: ["free"], platform: ["web", "ios"], form: ["saas"] },
  });
  siteAId = a.id;
  const b = await ctx.repo.createSite({
    url: "https://ppt-b.example.com",
    title: "幻灯片 Pro",
    description: "付费幻灯片工具",
    categoryId: cat.id,
    tags: ["PPT"],
    facets: { pricing: ["paid"], platform: ["web"], form: ["saas", "desktop"] },
  });
  siteBId = b.id;
  await ctx.repo.updateSiteHealth(siteAId, {
    httpStatus: 200, ok: true, latencyMs: 120, redirectTo: null, error: null, currentStatus: "active",
  });

  // 快照保存要求站点在本人可比收藏里（不在 → 通用 404），故两站都要收藏。
  await ctx.repo.addFavorite({ userId: USER, siteId: siteAId, note: null, tags: ["PPT"] });
  await ctx.repo.addFavorite({ userId: USER, siteId: siteBId, note: null, tags: ["PPT", "付费"] });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-compare-share-list-"));
  ctx = await createContext(loadConfig({ mode: "lite", sqlitePath: join(dir, "api.db"), corsOrigins: ["*"] }));
  (ctx as { embedding: unknown }).embedding = null;
  app = await buildServer(ctx);
  await app.ready();
  await seed();
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function saveSnapshot(siteIds: string[] = [siteAId, siteBId]) {
  const res = await app.inject({
    method: "POST",
    url: "/api/compare/snapshots",
    headers: { ...userHeaders, "content-type": "application/json" },
    payload: { siteIds },
  });
  expect(res.statusCode).toBe(201);
  return res.json().snapshot as { id: string };
}

async function publish(snapshotId: string) {
  const res = await app.inject({
    method: "POST",
    url: `/api/compare/snapshots/${encodeURIComponent(snapshotId)}/publish`,
    headers: { ...userHeaders, "content-type": "application/json" },
    payload: { fields: FIELDS },
  });
  expect(res.statusCode).toBe(201);
  return res.json().share as { slug: string };
}

async function list(query = "") {
  return app.inject({ method: "GET", url: `/api/compare/shares${query}` });
}

let slugA = "";
let slugB = "";

describe("GET /api/compare/shares 列表接口", () => {
  it("空库：items 为空数组（sitemap loader 视角即 0 条）", async () => {
    const res = await list("?status=published&limit=100");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, items: [] });
  });

  it("发布 2 张快照后列表含 2 条：只含 slug/updatedAt/publishedAt，无 owner、无 published_json", async () => {
    const snapA = await saveSnapshot([siteAId, siteBId]);
    const snapB = await saveSnapshot([siteAId, siteBId]);
    slugA = (await publish(snapA.id)).slug;
    slugB = (await publish(snapB.id)).slug;

    // 与 sitemap loader 逐字同一查询串：status=published&limit=100。
    const res = await list("?status=published&limit=100");
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok: boolean;
      items: { slug: string; updatedAt: number; publishedAt: number }[];
    };
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(2);
    expect(body.items.map((i) => i.slug).sort()).toEqual([slugA, slugB].sort());
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(["publishedAt", "slug", "updatedAt"]);
      expect(typeof item.updatedAt).toBe("number");
      expect(typeof item.publishedAt).toBe("number");
    }
    expect(res.body).not.toContain("ownerIdentity");
    expect(res.body).not.toContain("publishedJson");
    expect(res.body).not.toContain("published_json");
  });

  it("免登公开读：不带身份头也能列出", async () => {
    const res = await app.inject({ method: "GET", url: "/api/compare/shares" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { items: unknown[] }).items).toHaveLength(2);
  });

  it("排序：updated_at 倒序（显式拉开时间戳，避免同毫秒并列）", async () => {
    await ctx.repo.run("UPDATE comparison_snapshot_shares SET updated_at = ? WHERE slug = ?", [1000, slugA]);
    await ctx.repo.run("UPDATE comparison_snapshot_shares SET updated_at = ? WHERE slug = ?", [2000, slugB]);
    const res = await list();
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: { slug: string }[] }).items;
    expect(items.map((i) => i.slug)).toEqual([slugB, slugA]);
  });

  it("分页：limit=1 取 1 条；offset=1 取第 2 条", async () => {
    const first = await list("?limit=1&offset=0");
    expect((first.json() as { items: unknown[] }).items).toHaveLength(1);
    expect((first.json() as { items: { slug: string }[] }).items[0]?.slug).toBe(slugB);
    const second = await list("?limit=1&offset=1");
    expect((second.json() as { items: unknown[] }).items).toHaveLength(1);
    expect((second.json() as { items: { slug: string }[] }).items[0]?.slug).toBe(slugA);
  });

  it("status 只认 published：status=unpublished → 400", async () => {
    const res = await list("?status=unpublished");
    expect(res.statusCode).toBe(400);
    const res2 = await list("?status=draft");
    expect(res2.statusCode).toBe(400);
  });

  it("只含已发布：PATCH 下线 A 后列表只剩 B，单查 A 同步 404", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/compare/shares/${encodeURIComponent(slugA)}`,
      headers: { ...userHeaders, "content-type": "application/json" },
      payload: { status: "unpublished" },
    });
    expect(patch.statusCode).toBe(200);
    const res = await list();
    const items = (res.json() as { items: { slug: string }[] }).items;
    expect(items.map((i) => i.slug)).toEqual([slugB]);
    const single = await app.inject({ method: "GET", url: `/api/compare/shares/${encodeURIComponent(slugA)}` });
    expect(single.statusCode).toBe(404);
  });
});
