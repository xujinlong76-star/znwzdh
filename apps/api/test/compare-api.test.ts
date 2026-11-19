/**
 * 跨站对照：路由端到端测试（GET /api/compare?siteIds=，Batch 4 Phase 1 第 1 项）。
 *
 * 锁的是调用链与守卫（仿 ask-api.test.ts：临时 SQLite + createContext +
 * buildServer + 双用户 seed + app.inject）：
 *  - 正常 2 个 / 3 个 / 4 个：6 维齐全、来源与日期齐全、按请求顺序返回；
 *  - 越权 404 不可区分：他人收藏 / 不存在 / pending / archived 指向
 *    → 同码同 body，不点名 id，不返回部分结果；
 *  - 匿名/无身份 401（抄 /api/ask 口径）；
 *  - 空 / 1 个 / 5 个 / 去重后不足 2 个 → 400；重复去重后仍够 2 个 → 200；
 *  - pricing: unknown 与 lastCheckedAt: null 的站 → 格子“未验证”仍 200；
 *  - 缓存头：private, max-age=60 + Vary 含身份头 + etag + If-None-Match → 304。
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
let siteCId = "";
let siteDId = "";
let pendingSiteId = "";
let archivedSiteId = "";
let otherSiteId = "";
let neverFavoritedSiteId = "";

const USER = "user-1";
const OTHER = "user-2";
const userHeaders = { "x-navhub-user-id": USER };
const anonHeaders = { "x-navhub-anon-id": "anon-1" };

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
  // C：pricing unknown、无平台/形态分面、从未巡检、无备注无标签——全格“未验证”
  const c = await ctx.repo.createSite({
    url: "https://ppt-c.example.com",
    title: "模板小站",
    description: "不知名模板站",
    categoryId: cat.id,
    tags: ["PPT"],
    facets: { pricing: ["unknown"] },
  });
  siteCId = c.id;
  // D：第四站（P2-6）：免费增值、Web + Android、巡检可达、有备注有标签——
  // 4 站对照时每格都应有来源与日期。
  const d = await ctx.repo.createSite({
    url: "https://ppt-d.example.com",
    title: "演示新秀",
    description: "新出的演示工具",
    categoryId: cat.id,
    tags: ["PPT"],
    facets: { pricing: ["freemium"], platform: ["web", "android"], form: ["saas"] },
  });
  siteDId = d.id;
  const pending = await ctx.repo.createSite({
    url: "https://pending.example.com",
    title: "待审站",
    description: "还在审核",
    categoryId: cat.id,
    tags: ["PPT"],
    status: "pending",
  });
  pendingSiteId = pending.id;
  const archived = await ctx.repo.createSite({
    url: "https://archived.example.com",
    title: "归档站",
    description: "已归档",
    categoryId: cat.id,
    tags: ["PPT"],
    status: "archived",
  });
  archivedSiteId = archived.id;
  const other = await ctx.repo.createSite({
    url: "https://other.example.com",
    title: "别人的收藏",
    description: "只在 user-2 的收藏里",
    categoryId: cat.id,
    tags: ["PPT"],
  });
  otherSiteId = other.id;
  const never = await ctx.repo.createSite({
    url: "https://never.example.com",
    title: "无人收藏站",
    description: "谁都没收藏",
    categoryId: cat.id,
    tags: ["PPT"],
  });
  neverFavoritedSiteId = never.id;

  // A 巡检通过（lastCheckedAt 落库）；B 巡检失败但留了时间戳——
  // ok === false 时 verified 仍为 true、值是“不可达”，不能反推成“未验证”。
  await ctx.repo.updateSiteHealth(siteAId, {
    httpStatus: 200, ok: true, latencyMs: 120, redirectTo: null, error: null, currentStatus: "active",
  });
  await ctx.repo.updateSiteHealth(siteBId, {
    httpStatus: null, ok: false, latencyMs: 5000, redirectTo: null, error: "connection refused",
    currentStatus: "active", markBroken: false,
  });
  await ctx.repo.updateSiteHealth(siteDId, {
    httpStatus: 200, ok: true, latencyMs: 90, redirectTo: null, error: null, currentStatus: "active",
  });

  await ctx.repo.addFavorite({ userId: USER, siteId: siteAId, note: "免费档够用，导出是 CSV", tags: ["PPT"] });
  await ctx.repo.addFavorite({ userId: USER, siteId: siteBId, note: null, tags: ["PPT", "付费"] });
  await ctx.repo.addFavorite({ userId: USER, siteId: siteCId });
  await ctx.repo.addFavorite({ userId: USER, siteId: siteDId, note: "免费档每月 20 次", tags: ["PPT", "新"] });

  // Batch0-02 R10 档案行：A verified（四格应带值）、B draft（四格按缺失）、
  // C/D 无行（四格按缺失）。alternatives 目标站存在，写时校验通过。
  const profileVerifiedAt = Date.now();
  await ctx.repo.upsertSiteProfile({
    siteId: siteAId,
    bestFor: "个人轻量做演示文稿",
    notFor: "不支持多人实时协作",
    license: "MIT",
    alternatives: [siteBId],
    profileSourceUrl: "https://ppt-a.example.com/pricing",
    profileStatus: "verified",
    verifiedBy: "seed",
    profileVerifiedAt,
  });
  await ctx.repo.upsertSiteProfile({
    siteId: siteBId,
    bestFor: "草稿适用陈述不应出现",
    notFor: "草稿边界不应出现",
    license: "草稿协议不应出现",
    alternatives: [siteAId],
    profileSourceUrl: "https://ppt-b.example.com/pricing",
    profileStatus: "draft",
    verifiedBy: "seed",
    profileVerifiedAt,
  });
  await ctx.repo.addFavorite({ userId: USER, siteId: pendingSiteId });
  await ctx.repo.addFavorite({ userId: USER, siteId: archivedSiteId });
  await ctx.repo.addFavorite({ userId: OTHER, siteId: otherSiteId });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-compare-"));
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

type Cell = { value: unknown; source: string; verified: boolean; verifiedAt: number | null; lastCheckedAt?: number | null };
type Item = {
  siteId: string; title: string; url: string;
  pricing: Cell; platform: Cell; form: Cell; maintenance: Cell; note: Cell; migration: Cell;
  best_for: Cell; not_for: Cell; license: Cell; alternatives: Cell;
};

function itemsOf(body: unknown): Item[] {
  return (body as { items: Item[] }).items;
}

describe("正常：2 个、3 个与 4 个，6 维齐全、来源与日期齐全", () => {
  it("2 个：按请求顺序返回，6 维都有值/来源/日期", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/compare?siteIds=${siteAId},${siteBId}`,
      headers: userHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    const items = itemsOf(body);
    expect(items.map((i) => i.siteId)).toEqual([siteAId, siteBId]);

    const [a, b] = items as [Item, Item];
    // A：计费免费、双平台、备注原文、巡检可达
    expect(a.pricing).toMatchObject({ value: "完全免费", source: "站点分面", verified: true });
    expect(typeof a.pricing.verifiedAt).toBe("number");
    // 分面水合按 (facet_key, facet_value) 排序回读：ios 在 web 之前
    expect(a.platform).toMatchObject({ value: ["iOS / iPadOS", "Web 网页端"], source: "站点分面", verified: true });
    expect(typeof a.platform.verifiedAt).toBe("number");
    expect(a.form).toMatchObject({ value: ["在线 SaaS"], source: "站点分面", verified: true });
    expect(a.maintenance).toMatchObject({ value: "可达", source: "健康巡检", verified: true });
    expect(typeof a.maintenance.verifiedAt).toBe("number");
    expect(a.maintenance.lastCheckedAt).toBe(a.maintenance.verifiedAt);
    expect(a.note).toMatchObject({ value: "免费档够用，导出是 CSV", source: "我的备注", verified: true });
    expect(typeof a.note.verifiedAt).toBe("number");
    expect(a.migration).toMatchObject({ value: "免费档够用，导出是 CSV", source: "我的备注", verified: true });
    // B：计费付费、巡检失败但已验证（不可达 ≠ 未验证）、备注空则迁移格取标签
    expect(b.pricing).toMatchObject({ value: "商业付费", verified: true });
    expect(b.form).toMatchObject({ value: ["独立桌面软件", "在线 SaaS"], verified: true });
    expect(b.maintenance).toMatchObject({ value: "不可达", source: "健康巡检", verified: true });
    expect(typeof b.maintenance.verifiedAt).toBe("number");
    expect(b.note).toMatchObject({ value: null, verified: false, verifiedAt: null });
    expect(b.migration).toMatchObject({ value: ["PPT", "付费"], source: "我的标签", verified: true });
  });

  it("3 个：顺序与请求一致", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/compare?siteIds=${siteBId},${siteAId},${siteCId}`,
      headers: userHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(itemsOf(res.json()).map((i) => i.siteId)).toEqual([siteBId, siteAId, siteCId]);
  });

  it("4 个（P2-6）：顺序与请求一致，每站 6 格都有来源与日期", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/compare?siteIds=${siteDId},${siteCId},${siteBId},${siteAId}`,
      headers: userHeaders,
    });
    expect(res.statusCode).toBe(200);
    const items = itemsOf(res.json());
    expect(items.map((i) => i.siteId)).toEqual([siteDId, siteCId, siteBId, siteAId]);
    // 第四站 D：免费增值、巡检可达、备注原文，每格来源与日期齐全
    const d = items[0]!;
    expect(d.pricing).toMatchObject({ value: "免费增值", source: "站点分面", verified: true });
    expect(d.maintenance).toMatchObject({ value: "可达", source: "健康巡检", verified: true });
    expect(d.note).toMatchObject({ value: "免费档每月 20 次", source: "我的备注", verified: true });
    // 4 站 × 6 维：已验证的格子必须有来源字符串与数字核实时间；
    // 未验证的格子（如 C 站全格）来源仍在、verifiedAt 为 null，不编造日期
    const dims = ["pricing", "platform", "form", "maintenance", "note", "migration"] as const;
    for (const item of items) {
      for (const key of dims) {
        const cell = item[key];
        expect(typeof cell.source).toBe("string");
        expect(cell.source.length).toBeGreaterThan(0);
        if (cell.verified) {
          expect(typeof cell.verifiedAt).toBe("number");
        } else {
          expect(cell.verifiedAt).toBeNull();
        }
      }
    }
  });

  it("重复去重后仍够 2 个 → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/compare?siteIds=${siteAId},${siteAId},${siteBId}`,
      headers: userHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(itemsOf(res.json()).map((i) => i.siteId)).toEqual([siteAId, siteBId]);
  });
});

describe("未验证：pricing unknown 与 lastCheckedAt null 的站仍 200", () => {
  it("C 站：计费“未标注”、平台/形态/维护/备注/迁移全格未验证", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/compare?siteIds=${siteAId},${siteCId}`,
      headers: userHeaders,
    });
    expect(res.statusCode).toBe(200);
    const c = itemsOf(res.json()).find((i) => i.siteId === siteCId)!;
    // pricing unknown 如实显示“未标注”，不推断成免费/付费
    expect(c.pricing).toMatchObject({ value: "未标注", source: "站点分面", verified: false, verifiedAt: null });
    expect(c.platform).toMatchObject({ value: null, verified: false, verifiedAt: null });
    expect(c.form).toMatchObject({ value: null, verified: false, verifiedAt: null });
    // 从未巡检：lastCheckedAt 为 null 才是“未验证”的唯一依据
    expect(c.maintenance).toMatchObject({ value: null, source: "健康巡检", verified: false, verifiedAt: null, lastCheckedAt: null });
    expect(c.note).toMatchObject({ value: null, verified: false, verifiedAt: null });
    expect(c.migration).toMatchObject({ value: null, verified: false, verifiedAt: null });
  });
});

describe("档案四格（Batch0-02 R10）：verified 带值、draft/无行未验证、无 winner", () => {
  it("A verified：四格带值且 verified:true；B draft 与 C 无行：四格 verified:false 且不编造值", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/compare?siteIds=${siteAId},${siteBId},${siteCId}`,
      headers: userHeaders,
    });
    expect(res.statusCode).toBe(200);
    const items = itemsOf(res.json());
    const [a, b, c] = items as [Item, Item, Item];

    // A：verified 行四格全部带值，来源“站点档案”，核实时间为数字
    expect(a.best_for).toMatchObject({ value: "个人轻量做演示文稿", source: "站点档案", verified: true });
    expect(typeof a.best_for.verifiedAt).toBe("number");
    expect(a.not_for).toMatchObject({ value: "不支持多人实时协作", source: "站点档案", verified: true });
    expect(typeof a.not_for.verifiedAt).toBe("number");
    expect(a.license).toMatchObject({ value: "MIT", source: "站点档案", verified: true });
    expect(typeof a.license.verifiedAt).toBe("number");
    expect(a.alternatives).toMatchObject({ value: [siteBId], source: "站点档案", verified: true });
    expect(typeof a.alternatives.verifiedAt).toBe("number");

    // B：draft 行按缺失处理——值一律 null，不泄露草稿文案
    for (const cell of [b.best_for, b.not_for, b.license, b.alternatives]) {
      expect(cell).toMatchObject({ value: null, verified: false, verifiedAt: null });
    }
    expect(JSON.stringify(b)).not.toContain("草稿");

    // C：无档案行——四格同样 verified:false，不编造值
    for (const cell of [c.best_for, c.not_for, c.license, c.alternatives]) {
      expect(cell).toMatchObject({ value: null, verified: false, verifiedAt: null });
    }

    // 裁决 19：不设 winner，任何一站都不出现 winner 字段
    for (const item of items) {
      expect(item).not.toHaveProperty("winner");
    }
  });
});

describe("越权 404 不可区分：同码同 body，不点名 id，不返回部分结果", () => {
  it("他人收藏 / 不存在 / pending / archived / 无人收藏 → 同一个 404 body", async () => {
    const cases = [
      `/api/compare?siteIds=${siteAId},${otherSiteId}`,
      `/api/compare?siteIds=${siteAId},ghost-id-404`,
      `/api/compare?siteIds=${siteAId},${pendingSiteId}`,
      `/api/compare?siteIds=${siteAId},${archivedSiteId}`,
      `/api/compare?siteIds=${siteAId},${neverFavoritedSiteId}`,
    ];
    const bodies: unknown[] = [];
    for (const url of cases) {
      const res = await app.inject({ method: "GET", url, headers: userHeaders });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBe("NOT_FOUND");
      expect(body.code).toBe("NOT_FOUND");
      expect(body).not.toHaveProperty("items");
      // 不点名是哪个 id：body 里不出现任何被试 id
      expect(JSON.stringify(body)).not.toContain(otherSiteId);
      expect(JSON.stringify(body)).not.toContain("ghost-id-404");
      expect(JSON.stringify(body)).not.toContain(pendingSiteId);
      expect(JSON.stringify(body)).not.toContain(archivedSiteId);
      expect(JSON.stringify(body)).not.toContain(neverFavoritedSiteId);
      bodies.push(body);
    }
    for (const b of bodies.slice(1)) expect(b).toEqual(bodies[0]);
  });
});

describe("身份：匿名/无头 401", () => {
  it("只有 anonId 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/compare?siteIds=${siteAId},${siteBId}`,
      headers: anonHeaders,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("UNAUTHORIZED");
  });

  it("无任何身份头 401", async () => {
    const res = await app.inject({ method: "GET", url: `/api/compare?siteIds=${siteAId},${siteBId}` });
    expect(res.statusCode).toBe(401);
  });
});

describe("数量校验：空 / 1 个 / 5 个 / 去重后不足 → 400", () => {
  it.each([
    ["空串", "/api/compare?siteIds="],
    ["缺参数", "/api/compare"],
    ["1 个", `/api/compare?siteIds=${siteAId}`],
    ["5 个", `/api/compare?siteIds=${siteAId},${siteBId},${siteCId},${siteDId},${neverFavoritedSiteId}`],
    ["重复去重后只剩 1 个", `/api/compare?siteIds=${siteAId},${siteAId}`],
  ])("%s → 400", async (_label, url) => {
    const res = await app.inject({ method: "GET", url, headers: userHeaders });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("BAD_REQUEST");
    // 明示上限：400 文案写清最多 4 个
    expect(res.json().message).toContain("2–4");
  });
});

describe("缓存头：private 60s + Vary 身份头 + etag + 304", () => {
  it("cache-control 与 Vary 含全部身份头，etag 存在，If-None-Match → 304", async () => {
    const url = `/api/compare?siteIds=${siteAId},${siteBId}`;
    const first = await app.inject({ method: "GET", url, headers: userHeaders });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, max-age=60");
    const vary = String(first.headers.vary ?? "");
    for (const h of ["x-navhub-anon-id", "x-user-id", "x-navhub-user-id", "authorization", "cookie"]) {
      expect(vary.toLowerCase()).toContain(h);
    }
    const etag = first.headers.etag;
    expect(typeof etag).toBe("string");
    expect(etag!.length).toBeGreaterThan(0);

    const second = await app.inject({
      method: "GET",
      url,
      headers: { ...userHeaders, "if-none-match": etag as string },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
  });
});
