/**
 * 对照表分享：路由端到端测试（Batch 4 Phase 2 P2-4）。
 *
 * 隐私回归测试先于功能代码写（设计 §4.5 硬门）：以下 1–6 条全部通过
 * 才是 P2-4 的提交门。
 *   1. 金丝雀：快照 note/migration 格含 canary 串，全 5 字段发布后，
 *      公开读响应全文不含 canary、不含 "note"/"migration" 键、不含 owner 身份串；
 *   2. 未勾选即不存在：只勾 pricing 发布，响应 items[0] 没有 platform /
 *      form / maintenance / price 键（in 运算符断言，不只是值为空）；
 *   3. 非法字段拒绝：["note"] / [] / ["__proto__"] → 400；
 *   4. 下线即 404：PATCH 下线后新请求读公开端点 → 404；重发产生新 slug，
 *      旧 slug 仍 404；
 *   5. 跨 owner 404：他人调 publish / PATCH / DELETE → 404；他人读已发布页
 *      可以，但读不到任何身份信息；
 *   6. 冻结性：发布后为同一组站保存一张新快照，公开读内容不变
 *      （与 published_json 逐字节一致）。
 * 另锁：匿名 publish 401；字段去重；已发布快照重复 publish → 409；
 * slug 分配复用 allocatePublicSlug（占用 → null）；price 格只含展示字段，
 * 原始记录字段（amountMinor/currency/period/freeTierLimit）绝不进
 * published_json；公开读 public 缓存 + etag；注销删净分享行。
 *
 * 挂载方式：buildServer(ctx) 直接挂载——server.ts 已注册 compareShareRoutes，
 * 不再手动 register（重复注册会报“路由已声明”）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { allocatePublicSlug } from "../src/routes/public-pages.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

let siteAId = "";
let siteBId = "";

const USER = "user-1";
const OTHER = "user-2";
const userHeaders = { "x-navhub-user-id": USER };
const otherHeaders = { "x-navhub-user-id": OTHER };
const anonHeaders = { "x-navhub-anon-id": "anon-1" };

const CANARY = "CANARY-PRIVATE-NOTE-7f3a9c2e";
const ALL_FIELDS = ["pricing", "platform", "form", "maintenance", "price"];

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

  // A 站备注含金丝雀串：note 格与 migration 格（备注原文优先）都会带上它。
  await ctx.repo.addFavorite({ userId: USER, siteId: siteAId, note: CANARY, tags: ["PPT"] });
  await ctx.repo.addFavorite({ userId: USER, siteId: siteBId, note: null, tags: ["PPT", "付费"] });

  // A 站价格记录：原始记录字段只供编辑回填，绝不进 published_json。
  await ctx.repo.upsertSitePrice({
    ownerIdentity: USER,
    siteId: siteAId,
    amountMinor: 1990,
    currency: "CNY",
    period: "month",
    freeTierLimit: "100次/月",
    sourceType: "manual",
    sourceUrl: null,
    verifiedAt: Date.now(),
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-compare-share-"));
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

async function saveSnapshot(siteIds: string[] = [siteAId, siteBId], headers: Record<string, string> = userHeaders) {
  const res = await app.inject({
    method: "POST",
    url: "/api/compare/snapshots",
    headers: { ...headers, "content-type": "application/json" },
    payload: { siteIds },
  });
  expect(res.statusCode).toBe(201);
  return res.json().snapshot as { id: string };
}

async function publish(
  snapshotId: string,
  fields: unknown,
  headers: Record<string, string> = userHeaders,
) {
  return app.inject({
    method: "POST",
    url: `/api/compare/snapshots/${encodeURIComponent(snapshotId)}/publish`,
    headers: { ...headers, "content-type": "application/json" },
    payload: { fields },
  });
}

async function readPublic(slug: string, headers: Record<string, string> = {}) {
  return app.inject({ method: "GET", url: `/api/compare/shares/${encodeURIComponent(slug)}`, headers });
}

describe("§4.5-1 金丝雀：备注与迁移格永不公开", () => {
  it("全 5 字段发布：公开读全文不含 canary、不含 note/migration 键、不含 owner 身份串", async () => {
    const snapshot = await saveSnapshot();
    const res = await publish(snapshot.id, ALL_FIELDS);
    expect(res.statusCode).toBe(201);
    const slug = res.json().share.slug as string;
    expect(typeof slug).toBe("string");

    const pub = await readPublic(slug);
    expect(pub.statusCode).toBe(200);
    const text = JSON.stringify(pub.json());
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain('"note"');
    expect(text).not.toContain('"migration"');
    expect(text).not.toContain(USER);
    expect(text).not.toContain("user-1");
    // 公开读的 share/snapshot 外壳也不含任何身份字段
    expect(pub.json()).not.toHaveProperty("owner_identity");
    expect(pub.json()).not.toHaveProperty("ownerIdentity");
    expect(pub.json().share).not.toHaveProperty("owner_identity");
    expect(pub.json().snapshot).not.toHaveProperty("owner_identity");
  });

  it("price 格只含展示字段：原始记录字段绝不进 published_json", async () => {
    const snapshot = await saveSnapshot();
    const res = await publish(snapshot.id, ["price", "maintenance"]);
    expect(res.statusCode).toBe(201);
    const pub = await readPublic(res.json().share.slug as string);
    expect(pub.statusCode).toBe(200);
    const item = pub.json().snapshot.items[0] as Record<string, unknown>;
    const price = item.price as Record<string, unknown>;
    expect(price).toBeDefined();
    expect(price.value).toBe("¥19.9/月 · 免费档100次/月");
    expect(price).toHaveProperty("source");
    expect(price).toHaveProperty("verified");
    expect(price).toHaveProperty("verifiedAt");
    for (const raw of ["amountMinor", "currency", "period", "freeTierLimit", "sourceUrl"]) {
      expect(raw in price).toBe(false);
    }
    // 维护格也不带 lastCheckedAt：只留 value/source/verified/verifiedAt/stale
    const maintenance = item.maintenance as Record<string, unknown>;
    expect("lastCheckedAt" in maintenance).toBe(false);
  });
});

describe("§4.5-2 未勾选即不存在（in 运算符断言）", () => {
  it("只勾 pricing 发布：items[0] 没有 platform / form / maintenance / price 键", async () => {
    const snapshot = await saveSnapshot();
    const res = await publish(snapshot.id, ["pricing"]);
    expect(res.statusCode).toBe(201);
    expect(res.json().share.fields).toEqual(["pricing"]);
    const pub = await readPublic(res.json().share.slug as string);
    expect(pub.statusCode).toBe(200);
    const items = pub.json().snapshot.items as Record<string, unknown>[];
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect("pricing" in item).toBe(true);
      expect("platform" in item).toBe(false);
      expect("form" in item).toBe(false);
      expect("maintenance" in item).toBe(false);
      expect("price" in item).toBe(false);
      expect("note" in item).toBe(false);
      expect("migration" in item).toBe(false);
      // siteId / title / url 保留
      expect(typeof item.siteId).toBe("string");
      expect(typeof item.title).toBe("string");
      expect(typeof item.url).toBe("string");
    }
    expect(pub.json().snapshot.siteIds).toEqual([siteAId, siteBId]);
    expect(typeof pub.json().snapshot.createdAt).toBe("number");
  });
});

describe("§4.5-3 非法字段拒绝", () => {
  it.each([
    ["note 永不可公开", ["note"]],
    ["migration 永不可公开", ["migration"]],
    ["空数组", []],
    ["__proto__", ["__proto__"]],
    ["未知键", ["unknown-key"]],
    ["白名单 + note 混发", ["pricing", "note"]],
    ["非数组", "pricing"],
    ["非字符串元素", [123]],
  ])("%s → 400", async (_label, fields) => {
    const snapshot = await saveSnapshot();
    const res = await publish(snapshot.id, fields);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("BAD_REQUEST");
  });

  it("字段去重：[pricing, pricing] → 201，fields 只剩一项", async () => {
    const snapshot = await saveSnapshot();
    const res = await publish(snapshot.id, ["pricing", "pricing"]);
    expect(res.statusCode).toBe(201);
    expect(res.json().share.fields).toEqual(["pricing"]);
  });
});

describe("§4.5-4 下线即 404，重发产生新 slug", () => {
  it("PATCH 下线后新请求读公开端点 → 404；POST 重发新 slug，旧 slug 仍 404", async () => {
    const snapshot = await saveSnapshot();
    const res = await publish(snapshot.id, ALL_FIELDS);
    expect(res.statusCode).toBe(201);
    const slug = res.json().share.slug as string;
    expect((await readPublic(slug)).statusCode).toBe(200);

    const off = await app.inject({
      method: "PATCH",
      url: `/api/compare/shares/${encodeURIComponent(slug)}`,
      headers: { ...userHeaders, "content-type": "application/json" },
      payload: { status: "unpublished" },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().share.status).toBe("unpublished");

    // 新请求直读，不走缓存
    const gone = await readPublic(slug);
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error).toBe("NOT_FOUND");

    // 重发：新 slug；旧 slug 永不复活
    const again = await publish(snapshot.id, ["pricing"]);
    expect(again.statusCode).toBe(201);
    const newSlug = again.json().share.slug as string;
    expect(newSlug).not.toBe(slug);
    expect((await readPublic(slug)).statusCode).toBe(404);
    expect((await readPublic(newSlug)).statusCode).toBe(200);
    expect((await readPublic(newSlug)).json().share.fields).toEqual(["pricing"]);
  });

  it("PATCH 重新发布须重算：published 后公开读仍 200，内容与 published_json 一致", async () => {
    const snapshot = await saveSnapshot();
    const res = await publish(snapshot.id, ["pricing", "platform"]);
    expect(res.statusCode).toBe(201);
    const slug = res.json().share.slug as string;
    const before = await readPublic(slug);
    expect(before.statusCode).toBe(200);

    const off = await app.inject({
      method: "PATCH",
      url: `/api/compare/shares/${encodeURIComponent(slug)}`,
      headers: { ...userHeaders, "content-type": "application/json" },
      payload: { status: "unpublished" },
    });
    expect(off.statusCode).toBe(200);
    const on = await app.inject({
      method: "PATCH",
      url: `/api/compare/shares/${encodeURIComponent(slug)}`,
      headers: { ...userHeaders, "content-type": "application/json" },
      payload: { status: "published" },
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().share.status).toBe("published");
    const after = await readPublic(slug);
    expect(after.statusCode).toBe(200);
    expect(JSON.stringify(after.json())).toBe(JSON.stringify(before.json()));
  });

  it("PATCH 非法 status → 400；不存在的 slug → 404", async () => {
    const snapshot = await saveSnapshot();
    const res = await publish(snapshot.id, ["pricing"]);
    const slug = res.json().share.slug as string;
    const bad = await app.inject({
      method: "PATCH",
      url: `/api/compare/shares/${encodeURIComponent(slug)}`,
      headers: { ...userHeaders, "content-type": "application/json" },
      payload: { status: "deleted" },
    });
    expect(bad.statusCode).toBe(400);
    const ghost = await app.inject({
      method: "PATCH",
      url: "/api/compare/shares/no-such-slug",
      headers: { ...userHeaders, "content-type": "application/json" },
      payload: { status: "unpublished" },
    });
    expect(ghost.statusCode).toBe(404);
    expect(ghost.json().error).toBe("NOT_FOUND");
  });
});

describe("§4.5-5 跨 owner 404，公开读不泄露身份", () => {
  it("他人调 publish / PATCH / DELETE → 404（不泄露快照存在性）；他人读已发布页可以", async () => {
    const snapshot = await saveSnapshot();
    const crossPublish = await publish(snapshot.id, ["pricing"], otherHeaders);
    expect(crossPublish.statusCode).toBe(404);
    expect(crossPublish.json().error).toBe("NOT_FOUND");
    expect(JSON.stringify(crossPublish.json())).not.toContain(snapshot.id);

    const mine = await publish(snapshot.id, ALL_FIELDS);
    expect(mine.statusCode).toBe(201);
    const slug = mine.json().share.slug as string;

    const crossPatch = await app.inject({
      method: "PATCH",
      url: `/api/compare/shares/${encodeURIComponent(slug)}`,
      headers: { ...otherHeaders, "content-type": "application/json" },
      payload: { status: "unpublished" },
    });
    expect(crossPatch.statusCode).toBe(404);
    const crossDelete = await app.inject({
      method: "DELETE",
      url: `/api/compare/shares/${encodeURIComponent(slug)}`,
      headers: otherHeaders,
    });
    expect(crossDelete.statusCode).toBe(404);
    // 跨 owner 下线/删除未生效：公开读仍 200
    expect((await readPublic(slug)).statusCode).toBe(200);

    // 他人读已发布页可以（公开读免登），但读不到任何身份信息
    const otherRead = await readPublic(slug, otherHeaders);
    expect(otherRead.statusCode).toBe(200);
    const text = JSON.stringify(otherRead.json());
    expect(text).not.toContain(USER);
    expect(text).not.toContain(OTHER);
    expect(text).not.toContain(CANARY);
  });

  it("匿名 publish → 401；匿名读已发布页 → 200（公开读免登）", async () => {
    const snapshot = await saveSnapshot();
    expect((await publish(snapshot.id, ["pricing"], anonHeaders)).statusCode).toBe(401);
    const mine = await publish(snapshot.id, ["pricing"]);
    expect(mine.statusCode).toBe(201);
    const slug = mine.json().share.slug as string;
    const anonRead = await app.inject({
      method: "GET",
      url: `/api/compare/shares/${encodeURIComponent(slug)}`,
    });
    expect(anonRead.statusCode).toBe(200);
  });

  it("不存在的快照 publish → 404；已发布快照重复 publish → 409", async () => {
    const ghost = await publish("ghost-snapshot-id", ["pricing"]);
    expect(ghost.statusCode).toBe(404);
    expect(ghost.json().error).toBe("NOT_FOUND");
    const snapshot = await saveSnapshot();
    expect((await publish(snapshot.id, ["pricing"])).statusCode).toBe(201);
    const dup = await publish(snapshot.id, ["platform"]);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe("CONFLICT");
  });
});

describe("并发 publish 撞唯一约束 → 409（NIT 4）", () => {
  it("两并发 publish 同一快照：一份 201、一份 409，不抛 500；已发布页仍可读", async () => {
    const snapshot = await saveSnapshot();
    const [first, second] = await Promise.all([
      publish(snapshot.id, ["pricing"]),
      publish(snapshot.id, ["pricing"]),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
    const conflict = first.statusCode === 409 ? first : second;
    expect(conflict.json().error).toBe("CONFLICT");
    const winner = first.statusCode === 201 ? first : second;
    expect((await readPublic(winner.json().share.slug as string)).statusCode).toBe(200);
  });

  it("唯一约束冲突被捕获转 409：create 抛 SQLITE_CONSTRAINT_UNIQUE → 409 而非 500", async () => {
    const snapshot = await saveSnapshot();
    const originalCreate = ctx.repo.createComparisonSnapshotShare.bind(ctx.repo);
    const throwing = async (): Promise<never> => {
      const err = new Error(
        "UNIQUE constraint failed: comparison_snapshot_shares.snapshot_id",
      ) as Error & { code: string };
      err.code = "SQLITE_CONSTRAINT_UNIQUE";
      throw err;
    };
    (ctx.repo as { createComparisonSnapshotShare: typeof originalCreate }).createComparisonSnapshotShare =
      throwing as unknown as typeof originalCreate;
    try {
      const res = await publish(snapshot.id, ["pricing"]);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("CONFLICT");
    } finally {
      (ctx.repo as { createComparisonSnapshotShare: typeof originalCreate }).createComparisonSnapshotShare =
        originalCreate;
    }
    // 409 未建行：恢复后正常 publish 仍可 201
    const retry = await publish(snapshot.id, ["pricing"]);
    expect(retry.statusCode).toBe(201);
  });
});

describe("§4.5-6 冻结性：发布后新快照不影响已发布页", () => {
  it("发布后为同一组站保存一张新快照（巡检状态已变），公开读内容逐字节不变", async () => {
    const snapshot = await saveSnapshot();
    const res = await publish(snapshot.id, ALL_FIELDS);
    expect(res.statusCode).toBe(201);
    const slug = res.json().share.slug as string;
    const before = await readPublic(slug);
    expect(before.statusCode).toBe(200);
    const beforeText = JSON.stringify(before.json());

    // B 站巡检通过 + 再保存一张新快照：活数据变了，已发布页不能跟
    await ctx.repo.updateSiteHealth(siteBId, {
      httpStatus: 200, ok: true, latencyMs: 90, redirectTo: null, error: null, currentStatus: "active",
    });
    await saveSnapshot();

    const after = await readPublic(slug);
    expect(after.statusCode).toBe(200);
    expect(JSON.stringify(after.json())).toBe(beforeText);
  });
});

describe("发布响应形态与缓存", () => {
  it("201 回 slug + url /pub/compare/<slug> + fields + createdAt；url 即公开读路径", async () => {
    const snapshot = await saveSnapshot();
    const res = await publish(snapshot.id, ["pricing", "form"]);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.share.url).toBe(`/pub/compare/${body.share.slug}`);
    expect(body.share.fields).toEqual(["pricing", "form"]);
    expect(typeof body.share.createdAt).toBe("number");
    expect(body.share).not.toHaveProperty("owner_identity");
    const pub = await readPublic(body.share.slug as string);
    expect(pub.statusCode).toBe(200);
    expect(pub.json().share.slug).toBe(body.share.slug);
    expect(pub.json().share.fields).toEqual(["pricing", "form"]);
  });

  it("公开读：public, max-age=60 + s-maxage=60 + etag + 304；不存在的 slug → 404", async () => {
    const snapshot = await saveSnapshot();
    const res = await publish(snapshot.id, ["pricing"]);
    const slug = res.json().share.slug as string;
    const first = await readPublic(slug);
    expect(first.statusCode).toBe(200);
    // 内容与身份无关，匿名请求走共享缓存；带身份头的请求由 onSend 降级 private。
    expect(first.headers["cache-control"]).toBe("public, max-age=60, s-maxage=60");
    const etag = first.headers.etag;
    expect(typeof etag).toBe("string");
    expect(etag!.length).toBeGreaterThan(0);
    const second = await app.inject({
      method: "GET",
      url: `/api/compare/shares/${encodeURIComponent(slug)}`,
      headers: { "if-none-match": etag as string },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
    const ghost = await readPublic("no-such-slug");
    expect(ghost.statusCode).toBe(404);
    expect(ghost.json().error).toBe("NOT_FOUND");
  });
});

describe("删除与 slug 永不复用", () => {
  it("DELETE 删分享行：公开读 404；再删 → 404；重发新 slug，旧 slug 仍 404", async () => {
    const snapshot = await saveSnapshot();
    const res = await publish(snapshot.id, ["pricing"]);
    const slug = res.json().share.slug as string;
    const del = await app.inject({
      method: "DELETE",
      url: `/api/compare/shares/${encodeURIComponent(slug)}`,
      headers: userHeaders,
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);
    expect((await readPublic(slug)).statusCode).toBe(404);
    const delAgain = await app.inject({
      method: "DELETE",
      url: `/api/compare/shares/${encodeURIComponent(slug)}`,
      headers: userHeaders,
    });
    expect(delAgain.statusCode).toBe(404);

    const again = await publish(snapshot.id, ["pricing"]);
    expect(again.statusCode).toBe(201);
    expect(again.json().share.slug).not.toBe(slug);
    expect((await readPublic(slug)).statusCode).toBe(404);
  });
});

describe("slug 分配复用 allocatePublicSlug", () => {
  it("已被占用的自定义 slug → null；自动分配以前缀 compare- 开头", async () => {
    await ctx.repo.createPublicPage({
      slug: "taken-slug",
      ownerIdentity: USER,
      title: "已占用的页",
    });
    expect(await allocatePublicSlug(ctx, "标题", "taken-slug")).toBeNull();
    const auto = await allocatePublicSlug(ctx, "compare", null);
    expect(typeof auto).toBe("string");
    expect(auto!.startsWith("compare-")).toBe(true);
  });
});

describe("注销随删", () => {
  it("deleteUserData 删净分享行，回执计入 comparisonSnapshotShares", async () => {
    const snapshot = await saveSnapshot();
    const res = await publish(snapshot.id, ["pricing"]);
    expect(res.statusCode).toBe(201);
    const counts = await ctx.repo.deleteUserData(USER);
    expect(counts.comparisonSnapshotShares).toBeGreaterThan(0);
    expect(await ctx.repo.getComparisonSnapshotShareBySnapshotId(snapshot.id)).toBeNull();
    expect((await readPublic(res.json().share.slug as string)).statusCode).toBe(404);
  });
});
