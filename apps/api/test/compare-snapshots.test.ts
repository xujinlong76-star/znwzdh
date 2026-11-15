/**
 * 对照快照：路由端到端测试（Batch 4 Phase 2 P2-3）。
 *
 * 挂载方式：buildServer(ctx) 直接挂载——server.ts 已注册 compareSnapshotsRoutes，
 * 不再手动 register（重复注册会报“路由已声明”）。复用 buildServer 的 onSend 缓存
 * hook，否则 private/Vary/etag 无从验证。
 * GET /api/compare（已注册）用来锁“保存后读回与保存那一刻的对照表逐格一致”。
 *
 * 锁点（设计 §P2-3 验收）：
 *  - 只含本人站点：他人/不存在/pending/archived → 404，列表里不留快照；
 *  - 保存后立即读回逐格一致（与 GET /api/compare 同表 deepEqual）；
 *  - 快照不可变：无 PATCH/PUT/DELETE 接口（→404）；重复保存只新增，
 *    旧快照内容一字不动；
 *  - diff 只标事实变化（value_changed / became_verified / verification_added），
 *    无结论句、无打分、无 winner；verification_added 走纯函数单测
 *    （仓储时间戳是 Date.now()，同毫秒会撞，HTTP 层不锁它）；
 *  - 注销随删：deleteUserData 删净快照（counts.comparisonSnapshots），
 *    导出包里含快照；
 *  - private + Vary 身份头 + etag + 304（列表与 diff 两路）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { diffComparisonSnapshots } from "../src/routes/compare-snapshots.ts";
import type { ComparisonSnapshot } from "@navhub/store";

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

const USER = "user-1";
const OTHER = "user-2";
const userHeaders = { "x-navhub-user-id": USER };
const otherHeaders = { "x-navhub-user-id": OTHER };
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
  const c = await ctx.repo.createSite({
    url: "https://ppt-c.example.com",
    title: "模板小站",
    description: "不知名模板站",
    categoryId: cat.id,
    tags: ["PPT"],
    facets: { pricing: ["unknown"] },
  });
  siteCId = c.id;
  const d = await ctx.repo.createSite({
    url: "https://ppt-d.example.com",
    title: "演示新站",
    description: "第四个候选",
    categoryId: cat.id,
    tags: ["PPT"],
    facets: { pricing: ["freemium"], platform: ["web"], form: ["saas"] },
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

  // A 巡检通过；B 巡检失败但留了时间戳（不可达 ≠ 未验证）；C/D 从未巡检。
  await ctx.repo.updateSiteHealth(siteAId, {
    httpStatus: 200, ok: true, latencyMs: 120, redirectTo: null, error: null, currentStatus: "active",
  });
  await ctx.repo.updateSiteHealth(siteBId, {
    httpStatus: null, ok: false, latencyMs: 5000, redirectTo: null, error: "connection refused",
    currentStatus: "active", markBroken: false,
  });

  await ctx.repo.addFavorite({ userId: USER, siteId: siteAId, note: "免费档够用", tags: ["PPT"] });
  await ctx.repo.addFavorite({ userId: USER, siteId: siteBId, note: null, tags: ["PPT", "付费"] });
  await ctx.repo.addFavorite({ userId: USER, siteId: siteCId });
  await ctx.repo.addFavorite({ userId: USER, siteId: siteDId });
  await ctx.repo.addFavorite({ userId: USER, siteId: pendingSiteId });
  await ctx.repo.addFavorite({ userId: USER, siteId: archivedSiteId });
  await ctx.repo.addFavorite({ userId: OTHER, siteId: otherSiteId });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-compare-snapshots-"));
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

async function saveSnapshot(siteIds: string[], headers: Record<string, string> = userHeaders) {
  return app.inject({
    method: "POST",
    url: "/api/compare/snapshots",
    headers: { ...headers, "content-type": "application/json" },
    payload: { siteIds },
  });
}

async function listSnapshots(headers: Record<string, string> = userHeaders) {
  const res = await app.inject({ method: "GET", url: "/api/compare/snapshots", headers });
  return res;
}

describe("保存：201 + 与 GET /api/compare 逐格一致", () => {
  it("保存 2 站：快照 items 与同一时刻的对照表 deepEqual", async () => {
    const live = await app.inject({
      method: "GET",
      url: `/api/compare?siteIds=${siteAId},${siteBId}`,
      headers: userHeaders,
    });
    expect(live.statusCode).toBe(200);
    const saved = await saveSnapshot([siteAId, siteBId]);
    expect(saved.statusCode).toBe(201);
    const body = saved.json();
    expect(body.ok).toBe(true);
    expect(body.snapshot.siteIds).toEqual([siteAId, siteBId]);
    expect(typeof body.snapshot.id).toBe("string");
    expect(typeof body.snapshot.createdAt).toBe("number");
    expect(body.snapshot).not.toHaveProperty("owner_identity");
    expect(body.snapshot).not.toHaveProperty("ownerIdentity");
    // 逐格一致：保存那一刻的对照表原样冻结
    expect(body.snapshot.items).toEqual(live.json().items);

    // 读回：列表里同一张快照逐格一致
    const list = await listSnapshots();
    expect(list.statusCode).toBe(200);
    const found = list.json().snapshots.find((s: { id: string }) => s.id === body.snapshot.id);
    expect(found).toBeDefined();
    expect(found.items).toEqual(live.json().items);
  });

  it("保存 4 站：上限与当前对照接口一致（2–4）", async () => {
    const saved = await saveSnapshot([siteAId, siteBId, siteCId, siteDId]);
    expect(saved.statusCode).toBe(201);
    expect(saved.json().snapshot.items).toHaveLength(4);
  });

  it.each([
    ["空数组", []],
    ["1 个", [siteAId]],
    ["5 个", [siteAId, siteBId, siteCId, siteDId, siteAId]],
    ["去重后只剩 1 个", [siteAId, siteAId]],
  ])("%s → 400", async (_label, siteIds) => {
    const res = await saveSnapshot(siteIds as string[]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("BAD_REQUEST");
  });

  it("非数组 siteIds → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/compare/snapshots",
      headers: { ...userHeaders, "content-type": "application/json" },
      payload: { siteIds: siteAId },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("只含本人站点：越权 404，不留快照", () => {
  it("他人收藏 / 不存在 / pending / archived → 同一个 404 body，列表仍为空增量", async () => {
    const before = (await listSnapshots()).json().snapshots.length;
    const cases = [
      [siteAId, otherSiteId],
      [siteAId, "ghost-id-404"],
      [siteAId, pendingSiteId],
      [siteAId, archivedSiteId],
    ];
    const bodies: unknown[] = [];
    for (const ids of cases) {
      const res = await saveSnapshot(ids);
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBe("NOT_FOUND");
      expect(body).not.toHaveProperty("snapshot");
      expect(JSON.stringify(body)).not.toContain(otherSiteId);
      expect(JSON.stringify(body)).not.toContain("ghost-id-404");
      bodies.push(body);
    }
    for (const b of bodies.slice(1)) expect(b).toEqual(bodies[0]);
    const after = (await listSnapshots()).json().snapshots.length;
    expect(after).toBe(before);
  });
});

describe("身份：匿名/无头 401", () => {
  it("POST / GET 列表 / GET diff 匿名一律 401", async () => {
    expect((await saveSnapshot([siteAId, siteBId], anonHeaders)).statusCode).toBe(401);
    expect((await listSnapshots(anonHeaders)).statusCode).toBe(401);
    const res = await app.inject({
      method: "GET",
      url: "/api/compare/snapshots/whatever/diff?against=other",
      headers: anonHeaders,
    });
    expect(res.statusCode).toBe(401);
  });

  it("无任何身份头 POST → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/compare/snapshots",
      headers: { "content-type": "application/json" },
      payload: { siteIds: [siteAId, siteBId] },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("列表隔离：只看得到自己的快照", () => {
  it("user-2 的列表为空；user-2 保存自己的快照后 user-1 的列表不受影响", async () => {
    const empty = await listSnapshots(otherHeaders);
    expect(empty.statusCode).toBe(200);
    expect(empty.json().snapshots).toEqual([]);

    const mineBefore = (await listSnapshots()).json().snapshots.length;
    // user-2 只有 1 个收藏站：单站保存应 400（数量不足），列表不受影响
    const saved = await saveSnapshot([otherSiteId], otherHeaders);
    expect(saved.statusCode).toBe(400);
    const mineAfter = (await listSnapshots()).json().snapshots.length;
    expect(mineAfter).toBe(mineBefore);
    expect(JSON.stringify(await listSnapshots(otherHeaders)).includes(siteAId)).toBe(false);
  });
});

describe("不可变：没有改写接口，重复保存只新增", () => {
  it("PATCH / PUT / DELETE 快照 → 404（路由不存在）", async () => {
    const saved = await saveSnapshot([siteAId, siteCId]);
    expect(saved.statusCode).toBe(201);
    const id = saved.json().snapshot.id as string;
    for (const method of ["PATCH", "PUT", "DELETE"] as const) {
      const res = await app.inject({
        method,
        url: `/api/compare/snapshots/${id}`,
        headers: { ...userHeaders, "content-type": "application/json" },
        payload: { siteIds: [siteAId, siteBId] },
      });
      expect(res.statusCode).toBe(404);
    }
    // 旧快照原样还在
    const found = (await listSnapshots()).json().snapshots.find((s: { id: string }) => s.id === id);
    expect(found).toBeDefined();
    expect(found.siteIds).toEqual([siteAId, siteCId]);
  });

  it("同一组站再保存一次：新 id，旧快照 items 一字不动", async () => {
    const first = await saveSnapshot([siteAId, siteBId]);
    const second = await saveSnapshot([siteAId, siteBId]);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().snapshot.id).not.toBe(first.json().snapshot.id);
    const list = (await listSnapshots()).json().snapshots;
    const old = list.find((s: { id: string }) => s.id === first.json().snapshot.id);
    expect(old.items).toEqual(first.json().snapshot.items);
  });
});

describe("diff：只标事实变化，不生成结论", () => {
  it("B 站从不可达变可达 → maintenance 值变了；C 站首次巡检 → maintenance 从未验证变成已验证", async () => {
    const s1 = await saveSnapshot([siteAId, siteBId, siteCId]);
    expect(s1.statusCode).toBe(201);
    const s1Id = s1.json().snapshot.id as string;

    // B：巡检失败 → 巡检通过；C：从未巡检 → 巡检通过
    await ctx.repo.updateSiteHealth(siteBId, {
      httpStatus: 200, ok: true, latencyMs: 90, redirectTo: null, error: null, currentStatus: "active",
    });
    await ctx.repo.updateSiteHealth(siteCId, {
      httpStatus: 200, ok: true, latencyMs: 80, redirectTo: null, error: null, currentStatus: "active",
    });
    const s2 = await saveSnapshot([siteAId, siteBId, siteCId]);
    expect(s2.statusCode).toBe(201);
    const s2Id = s2.json().snapshot.id as string;

    const res = await app.inject({
      method: "GET",
      url: `/api/compare/snapshots/${s1Id}/diff?against=${s2Id}`,
      headers: userHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.diff.base.id).toBe(s1Id);
    expect(body.diff.against.id).toBe(s2Id);
    const changes = body.diff.changes as Array<{
      siteId: string; dimension: string; kind: string; oldValue: unknown; newValue: unknown;
    }>;
    // B 的维护格：不可达 → 可达
    expect(changes).toContainEqual(expect.objectContaining({
      siteId: siteBId, dimension: "maintenance", kind: "value_changed", oldValue: "不可达", newValue: "可达",
    }));
    // C 的维护格：null → 可达
    expect(changes).toContainEqual(expect.objectContaining({
      siteId: siteCId, dimension: "maintenance", kind: "became_verified", oldValue: null, newValue: "可达",
    }));
    // A 的格子一个都没变：A 不在 changes 里
    expect(changes.some((c) => c.siteId === siteAId)).toBe(false);
    // diff 里没有任何结论句、打分、排名、winner
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/conclusion|score|winner|排名|推荐|更好|胜出/i);
    for (const c of changes) {
      expect(["value_changed", "became_verified", "verification_added"]).toContain(c.kind);
    }
  });

  it("两张完全相同的快照 → changes 为空", async () => {
    const s1 = await saveSnapshot([siteAId, siteBId]);
    const s2 = await saveSnapshot([siteAId, siteBId]);
    const res = await app.inject({
      method: "GET",
      url: `/api/compare/snapshots/${s1.json().snapshot.id}/diff?against=${s2.json().snapshot.id}`,
      headers: userHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().diff.changes).toEqual([]);
  });

  it("缺 against → 400；与自身比 → 400；不存在的 id → 404；他人的快照 → 404", async () => {
    const s1 = await saveSnapshot([siteAId, siteBId]);
    const s1Id = s1.json().snapshot.id as string;
    const noAgainst = await app.inject({
      method: "GET", url: `/api/compare/snapshots/${s1Id}/diff`, headers: userHeaders,
    });
    expect(noAgainst.statusCode).toBe(400);
    const self = await app.inject({
      method: "GET", url: `/api/compare/snapshots/${s1Id}/diff?against=${s1Id}`, headers: userHeaders,
    });
    expect(self.statusCode).toBe(400);
    const ghost = await app.inject({
      method: "GET", url: `/api/compare/snapshots/ghost/diff?against=${s1Id}`, headers: userHeaders,
    });
    expect(ghost.statusCode).toBe(404);
    expect(ghost.json().error).toBe("NOT_FOUND");
    // 他人的快照 id：user-2 读 user-1 的两张快照 → 404（不泄露存在性）
    const s2 = await saveSnapshot([siteAId, siteBId]);
    const s2Id = s2.json().snapshot.id as string;
    const cross = await app.inject({
      method: "GET", url: `/api/compare/snapshots/${s1Id}/diff?against=${s2Id}`, headers: otherHeaders,
    });
    expect(cross.statusCode).toBe(404);
    expect(JSON.stringify(cross.json())).not.toContain(s1Id);
  });
});

describe("diff 纯函数：verification_added 与站点增减", () => {
  function cell(value: unknown, verified: boolean, verifiedAt: number | null) {
    return { value: value as never, source: "站点分面", verified, verifiedAt };
  }
  function item(siteId: string, maintenanceAt: number) {
    return {
      siteId, title: siteId, url: `https://${siteId}.example.com`,
      pricing: cell("完全免费", true, 1000),
      platform: cell(["Web 网页端"], true, 1000),
      form: cell(["在线 SaaS"], true, 1000),
      maintenance: { value: "可达", source: "健康巡检", verified: true, verifiedAt: maintenanceAt, lastCheckedAt: maintenanceAt },
      note: cell(null, false, null),
      migration: cell(null, false, null),
    };
  }
  function snap(id: string, items: ReturnType<typeof item>[]): ComparisonSnapshot {
    return { id, ownerIdentity: USER, siteIds: items.map((i) => i.siteId), items, createdAt: 1000 };
  }

  it("同值、都已验证、新核实时间更新 → verification_added；时间不变 → 无变化", () => {
    const base = snap("s1", [item("a", 1000)]);
    const newer = snap("s2", [item("a", 2000)]);
    const diff = diffComparisonSnapshots(base, newer);
    expect(diff.changes).toEqual([
      expect.objectContaining({ siteId: "a", dimension: "maintenance", kind: "verification_added", oldValue: "可达", newValue: "可达" }),
    ]);
    expect(diffComparisonSnapshots(base, snap("s3", [item("a", 1000)])).changes).toEqual([]);
  });

  it("新快照多一站：新增站的格子按“从未验证变成已验证”标，不另立名目", () => {
    const base = snap("s1", [item("a", 1000)]);
    const against = snap("s2", [item("a", 1000), item("b", 1000)]);
    const diff = diffComparisonSnapshots(base, against);
    expect(diff.changes.every((c) => c.siteId === "b")).toBe(true);
    expect(diff.changes).toContainEqual(
      expect.objectContaining({ siteId: "b", dimension: "pricing", kind: "became_verified", oldValue: null, newValue: "完全免费" }),
    );
  });
});

describe("缓存头：列表与 diff 均为 private + Vary 身份头 + etag + 304", () => {
  it("GET /api/compare/snapshots", async () => {
    const first = await listSnapshots();
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
      url: "/api/compare/snapshots",
      headers: { ...userHeaders, "if-none-match": etag as string },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
  });

  it("GET diff：private + Vary + etag", async () => {
    const s1 = await saveSnapshot([siteAId, siteBId]);
    const s2 = await saveSnapshot([siteAId, siteBId]);
    const url = `/api/compare/snapshots/${s1.json().snapshot.id}/diff?against=${s2.json().snapshot.id}`;
    const first = await app.inject({ method: "GET", url, headers: userHeaders });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, max-age=60");
    const vary = String(first.headers.vary ?? "");
    for (const h of ["x-navhub-anon-id", "x-user-id", "x-navhub-user-id", "authorization", "cookie"]) {
      expect(vary.toLowerCase()).toContain(h);
    }
    expect(typeof first.headers.etag).toBe("string");
  });
});

describe("注销随删 + 导出含快照", () => {
  it("exportUserData 含快照原文；deleteUserData 删净，快照数计入回执", async () => {
    const exported = await ctx.repo.exportUserData(USER);
    expect(Array.isArray(exported.comparisonSnapshots)).toBe(true);
    expect(exported.comparisonSnapshots.length).toBeGreaterThan(0);
    expect(exported.comparisonSnapshots[0]).toHaveProperty("id");
    expect(exported.comparisonSnapshots[0]).toHaveProperty("siteIds");
    expect(exported.comparisonSnapshots[0]).toHaveProperty("items");

    const counts = await ctx.repo.deleteUserData(USER);
    expect(counts.comparisonSnapshots).toBeGreaterThan(0);
    const remaining = await ctx.repo.listComparisonSnapshotsByOwner(USER);
    expect(remaining).toEqual([]);
    // 别人的快照不受影响（本用例里 user-2 没有快照；只断言删除路径按身份过滤）
    const otherRemaining = await ctx.repo.listComparisonSnapshotsByOwner(OTHER);
    expect(otherRemaining).toEqual([]);
  });
});
