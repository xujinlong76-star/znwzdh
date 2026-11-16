/**
 * A-1 回归：下架/待审插件的内容不得通过版本/评价/审计端点公开读取。
 *
 * 详情页门禁（p2-detail-and-tools.ts）对非 published 的非作者/非管理员返回 404，
 * 但版本列表、版本详情、评价列表与 GET audit 三处只查插件是否存在、不查 status，
 * 导致详情 404 的插件仍能通过这三处被拉走完整 manifest、评价全文与审计评分。
 *
 * 夹具（authRequired 鉴权实例 + identitySecret 签名身份）：
 *   - a1-delisted-pack：上架 → 安装 1 站 → 评价 1 条 → 下架（delisted），
 *     版本快照 1.0.0 含完整 manifest；
 *   - a1-pending-pack：待审首发包（无版本快照，audit 仍对外亮分）；
 *   - a1-published-pack：已上架对照包，匿名仍须 200（不过度拦截）。
 *
 * 门禁口径与详情页一致：status !== "published" 时仅作者本人与管理员可读，
 * 其余一律 404（不区分 pending / rejected / delisted / quarantined）。
 *
 * A 批扩展（R4-1/2/3/5/6/4/7/10）：同一口径补到其余内容端点——diff、
 * POST audit、ai-heal、url-deep-diagnose、overlap、url-health、/health、
 * url-health/history、批量 /health、url-health/summary；星标写面加门禁；
 * 举报取消静默自动下架（只计数 + 进治理告警）并原子去重；评价举报去重；
 * 评价长度口径收敛（200/4000，超长明确 400 而非静默截断）。
 * scope 为 read/write 的端点在鉴权实例里匿名会被 401 拦在 hook，与门禁无关，
 * 因此用持 read,write 令牌的非作者非管理员调用（rwGet/rwPost）复现；
 * 真正的匿名口径另见 plugin-status-gate-open-mode.test.ts（开放模式实例）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAndCleanPluginManifest } from "@navhub/core";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

const SECRET = "a1-status-gate-test-secret";
const BOOTSTRAP = "a1-boot-secret-please-rotate";
const ADMIN_STATIC = "a1-admin-static-please-rotate";

const OWNER = "anon-author-a1";
const INSTALLER = "anon-installer-a1";
const STRANGER = "anon-stranger-a1";
const REPORTER1 = "anon-reporter-1-a1";
const REPORTER2 = "anon-reporter-2-a1";
const REPORTER3 = "anon-reporter-3-a1";
const REPORTER4 = "anon-reporter-4-a1";
const SECRET_URL = "https://delisted-secret-a1.example.com/only-here";
const PENDING_URL = "https://pending-a1.example.com/only-here";
const PUBLISHED_URL = "https://published-a1.example.com/only-here";
const SECRET_REVIEW = "真实评价全文-A1-SECRET-REVIEW";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let adminToken = "";
let rwToken = "";
let publishedReviewId = "";

function sitePackManifest(name: string, urls: string[]) {
  const raw = {
    manifestVersion: 1,
    kind: "site-pack",
    name,
    description: "A-1 状态门禁回归测试用网址包",
    version: "1.0.0",
    tags: ["测试"],
    payload: {
      categories: [{ title: "插件测试类目" }],
      sites: urls.map((url, i) => ({ url, title: `测试站点 ${i}`, category: "插件测试类目" })),
    },
  };
  const validated = validateAndCleanPluginManifest(raw as never);
  if (!validated.ok) throw new Error(`测试清单不合法：${validated.errors.join("; ")}`);
  return validated.manifest;
}

function signedHeaders(identity: string) {
  return {
    "x-navhub-anon-id": identity,
    "x-navhub-identity-signature": signIdentity(SECRET, identity),
  };
}

const anonGet = (url: string) => app.inject({ method: "GET", url });
const anonPost = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload });
const ownerGet = (url: string) => app.inject({ method: "GET", url, headers: signedHeaders(OWNER) });
const ownerPost = (url: string, payload: unknown) =>
  app.inject({ method: "POST", url, payload, headers: signedHeaders(OWNER) });
const strangerGet = (url: string) => app.inject({ method: "GET", url, headers: signedHeaders(STRANGER) });
const signedPost = (url: string, payload: unknown, identity: string) =>
  app.inject({ method: "POST", url, payload, headers: signedHeaders(identity) });
const signedDelete = (url: string, identity: string) =>
  app.inject({ method: "DELETE", url, headers: signedHeaders(identity) });
const adminGet = (url: string) =>
  app.inject({ method: "GET", url, headers: { authorization: `Bearer ${adminToken}` } });
const adminPost = (url: string, payload: unknown) =>
  app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${adminToken}` } });
// 持 read,write 令牌的非作者非管理员：scope read/write 路由在鉴权模式下的调用方。
const rwGet = (url: string) =>
  app.inject({ method: "GET", url, headers: { authorization: `Bearer ${rwToken}` } });
const rwPost = (url: string, payload: unknown) =>
  app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${rwToken}` } });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-a1-gate-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "a1.db"),
    authRequired: true,
    bootstrapToken: BOOTSTRAP,
    adminToken: ADMIN_STATIC,
    identitySecret: SECRET,
    embedding: { enabled: false },
  } as never);
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();

  // 管理员令牌：bootstrap 换 admin scope 库内 token
  const minted = await app.inject({
    method: "POST",
    url: "/api/tokens",
    payload: { name: "a1-admin", scopes: "admin" },
    headers: { authorization: `Bearer ${BOOTSTRAP}` },
  });
  expect(minted.statusCode).toBe(201);
  adminToken = minted.json().token as string;

  // 非管理员读写令牌：scope read/write 路由在鉴权模式下必须持票。
  const rwMinted = await app.inject({
    method: "POST",
    url: "/api/tokens",
    payload: { name: "a1-rw", scopes: "read,write" },
    headers: { authorization: `Bearer ${BOOTSTRAP}` },
  });
  expect(rwMinted.statusCode).toBe(201);
  rwToken = rwMinted.json().token as string;

  // 下架包：上架（写版本快照）→ 安装 → 评价 → 下架
  await ctx.repo.createPlugin(
    {
      manifest: sitePackManifest("A1 下架包", [SECRET_URL]),
      slug: "a1-delisted-pack",
      status: "published",
      source: "seed",
      author: "A1 作者",
      ownerIdentity: OWNER,
    },
    { actor: "test", actorKind: "system" },
  );
  await ctx.repo.installPlugin("a1-delisted-pack", INSTALLER, {
    actor: INSTALLER,
    actorKind: "identity",
  });
  await ctx.repo.createPluginReview(
    "a1-delisted-pack",
    INSTALLER,
    { rating: 5, title: "好用", content: SECRET_REVIEW },
    { actor: INSTALLER, actorKind: "identity" },
  );
  const delisted = await ctx.repo.reviewPlugin("a1-delisted-pack", "delist", "A-1 测试下架", {
    actor: "admin",
    actorKind: "admin",
  });
  expect(delisted.status).toBe("delisted");
  // “上架时做过体检”的审计行：供 url-health / /health / history / summary 用。
  await ctx.repo.audit({
    actor: "test",
    actorKind: "system",
    action: "audit.plugin_url_audit",
    target: "a1-delisted-pack",
    diff: { slug: "a1-delisted-pack", declared: 1, sampled: 1, ok: 0, blocked: 0, suspicious: 0, broken: 1, reachability: 0 },
  });

  // 待审首发包：无版本快照，但 audit 仍会亮分、reviews 仍 200
  await ctx.repo.createPlugin(
    {
      manifest: sitePackManifest("A1 待审包", [PENDING_URL]),
      slug: "a1-pending-pack",
      status: "pending",
      source: "user",
      author: "A1 作者",
      ownerIdentity: OWNER,
    },
    { actor: "test", actorKind: "system" },
  );

  // 已上架对照包：匿名四端点必须保持 200
  await ctx.repo.createPlugin(
    {
      manifest: sitePackManifest("A1 已上架包", [PUBLISHED_URL]),
      slug: "a1-published-pack",
      status: "published",
      source: "seed",
      author: "A1 作者",
      ownerIdentity: OWNER,
    },
    { actor: "test", actorKind: "system" },
  );
  // 已上架包：安装 + 一条评价（供 R4-7 评价举报去重、R4-10 长度口径用），
  // 再补一条健康体检审计行（供批量 /health 与 summary 的对照用）。
  await ctx.repo.installPlugin("a1-published-pack", INSTALLER, {
    actor: INSTALLER,
    actorKind: "identity",
  });
  const pubReview = await ctx.repo.createPluginReview(
    "a1-published-pack",
    INSTALLER,
    { rating: 5, title: "好用", content: "已上架包的评价" },
    { actor: INSTALLER, actorKind: "identity" },
  );
  publishedReviewId = pubReview.id;
  await ctx.repo.audit({
    actor: "test",
    actorKind: "system",
    action: "audit.plugin_url_audit",
    target: "a1-published-pack",
    diff: { slug: "a1-published-pack", declared: 1, sampled: 1, ok: 1, blocked: 0, suspicious: 0, broken: 0, reachability: 100 },
  });

  // 星标清理夹具：上架时被陌生人星标 → 下架。unstar 是清理路径，下架后仍须 200。
  await ctx.repo.createPlugin(
    {
      manifest: sitePackManifest("A1 星标后下架包", ["https://star-delisted-a1.example.com/only-here"]),
      slug: "a1-star-delisted-pack",
      status: "published",
      source: "seed",
      author: "A1 作者",
      ownerIdentity: OWNER,
    },
    { actor: "test", actorKind: "system" },
  );
  const starSeed = await app.inject({
    method: "POST",
    url: "/api/plugins/a1-star-delisted-pack/star",
    payload: {},
    headers: signedHeaders(STRANGER),
  });
  expect(starSeed.statusCode).toBe(200);
  const starDelisted = await ctx.repo.reviewPlugin("a1-star-delisted-pack", "delist", "A-1 星标夹具下架", {
    actor: "admin",
    actorKind: "admin",
  });
  expect(starDelisted.status).toBe("delisted");
});

afterAll(async () => {
  await app?.close();
  await ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("A-1：下架/待审插件版本·评价·审计端点状态门禁", () => {
  it("匿名：下架包详情 404，而 versions / versions/1.0.0 / reviews / audit 须同为 404", async () => {
    const detail = await anonGet("/api/plugins/a1-delisted-pack");
    expect(detail.statusCode).toBe(404);

    const versions = await anonGet("/api/plugins/a1-delisted-pack/versions");
    expect(versions.statusCode).toBe(404);

    const version = await anonGet("/api/plugins/a1-delisted-pack/versions/1.0.0");
    expect(version.statusCode).toBe(404);
    expect(version.body).not.toContain(SECRET_URL);

    const reviews = await anonGet("/api/plugins/a1-delisted-pack/reviews");
    expect(reviews.statusCode).toBe(404);
    expect(reviews.body).not.toContain(SECRET_REVIEW);
    expect(reviews.body).not.toContain(INSTALLER);

    const audit = await anonGet("/api/plugins/a1-delisted-pack/audit");
    expect(audit.statusCode).toBe(404);
  });

  it("匿名：待审包 audit 不得对外亮分，versions / reviews 不得 200", async () => {
    const detail = await anonGet("/api/plugins/a1-pending-pack");
    expect(detail.statusCode).toBe(404);

    const audit = await anonGet("/api/plugins/a1-pending-pack/audit");
    expect(audit.statusCode).toBe(404);
    expect(audit.body).not.toContain('"score"');

    const versions = await anonGet("/api/plugins/a1-pending-pack/versions");
    expect(versions.statusCode).toBe(404);

    const reviews = await anonGet("/api/plugins/a1-pending-pack/reviews");
    expect(reviews.statusCode).toBe(404);
  });

  it("作者本人：下架包四端点仍可读，且版本含完整 manifest、评价含全文与身份串", async () => {
    const versions = await ownerGet("/api/plugins/a1-delisted-pack/versions");
    expect(versions.statusCode).toBe(200);
    expect(versions.json().versions).toHaveLength(1);
    expect(versions.json().versions[0].version).toBe("1.0.0");

    const version = await ownerGet("/api/plugins/a1-delisted-pack/versions/1.0.0");
    expect(version.statusCode).toBe(200);
    expect(JSON.stringify(version.json().manifest)).toContain(SECRET_URL);

    const reviews = await ownerGet("/api/plugins/a1-delisted-pack/reviews");
    expect(reviews.statusCode).toBe(200);
    expect(reviews.json().total).toBe(1);
    expect(reviews.json().items[0].content).toBe(SECRET_REVIEW);
    expect(reviews.json().items[0].identity).toBe(INSTALLER);

    const audit = await ownerGet("/api/plugins/a1-delisted-pack/audit");
    expect(audit.statusCode).toBe(200);
    expect(audit.json().report.slug).toBe("a1-delisted-pack");
  });

  it("管理员：下架包四端点可读", async () => {
    for (const url of [
      "/api/plugins/a1-delisted-pack/versions",
      "/api/plugins/a1-delisted-pack/versions/1.0.0",
      "/api/plugins/a1-delisted-pack/reviews",
      "/api/plugins/a1-delisted-pack/audit",
    ]) {
      const res = await adminGet(url);
      expect(res.statusCode).toBe(200);
    }
  });

  it("陌生签名用户：下架包四端点均为 404", async () => {
    for (const url of [
      "/api/plugins/a1-delisted-pack/versions",
      "/api/plugins/a1-delisted-pack/versions/1.0.0",
      "/api/plugins/a1-delisted-pack/reviews",
      "/api/plugins/a1-delisted-pack/audit",
    ]) {
      const res = await strangerGet(url);
      expect(res.statusCode).toBe(404);
    }
  });

  it("已上架包：匿名四端点仍为 200（不过度拦截）", async () => {
    for (const url of [
      "/api/plugins/a1-published-pack/versions",
      "/api/plugins/a1-published-pack/versions/1.0.0",
      "/api/plugins/a1-published-pack/reviews",
      "/api/plugins/a1-published-pack/audit",
    ]) {
      const res = await anonGet(url);
      expect(res.statusCode).toBe(200);
    }
  });
});

describe("A 批 R4-1/R4-2/R4-3/R4-5：工具与体检端点状态门禁", () => {
  const otherTarget = () => sitePackManifest("目标包", ["https://other-a1.example.com/x"]);

  it("匿名：下架包与待审包 diff（slug 作基准）均为 404，且不泄漏真实 URL", async () => {
    for (const slug of ["a1-delisted-pack", "a1-pending-pack"]) {
      const res = await anonPost("/api/plugins/diff", { slug, targetManifest: otherTarget() });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(SECRET_URL);
      expect(res.body).not.toContain(PENDING_URL);
    }
  });

  it("作者与管理员：下架包 diff 仍可比对；已上架包匿名 diff 仍 200", async () => {
    const owner = await ownerPost("/api/plugins/diff", {
      slug: "a1-delisted-pack",
      targetManifest: otherTarget(),
    });
    expect(owner.statusCode).toBe(200);
    expect(owner.body).toContain(SECRET_URL);

    const admin = await adminPost("/api/plugins/diff", {
      slug: "a1-delisted-pack",
      targetManifest: otherTarget(),
    });
    expect(admin.statusCode).toBe(200);

    const published = await anonPost("/api/plugins/diff", {
      slug: "a1-published-pack",
      targetManifest: otherTarget(),
    });
    expect(published.statusCode).toBe(200);
    expect(published.body).toContain(PUBLISHED_URL);
  });

  it("只用自带清单、不带 slug 的比对不受门禁影响", async () => {
    const res = await anonPost("/api/plugins/diff", {
      baseManifest: sitePackManifest("自带基准", [SECRET_URL]),
      targetManifest: otherTarget(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(SECRET_URL);
  });

  it("持票陌生人：下架包与待审包 POST audit 均为 404", async () => {
    for (const slug of ["a1-delisted-pack", "a1-pending-pack"]) {
      const res = await rwPost(`/api/plugins/${slug}/audit`, { limit: 1 });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(SECRET_URL);
      expect(res.body).not.toContain(PENDING_URL);
    }
  });

  it("持票陌生人：已上架包 POST audit 仍 200", async () => {
    const res = await rwPost("/api/plugins/a1-published-pack/audit", { limit: 1 });
    expect(res.statusCode).toBe(200);
  }, 60_000);

  it("持票陌生人：下架包与待审包 ai-heal 均为 404，不带回标题/分类", async () => {
    for (const slug of ["a1-delisted-pack", "a1-pending-pack"]) {
      const url = slug === "a1-delisted-pack" ? SECRET_URL : PENDING_URL;
      const res = await rwPost(`/api/plugins/${slug}/ai-heal`, { brokenUrls: [url] });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(url);
      expect(res.body).not.toContain("测试站点 0");
    }
  });

  it("持票陌生人：已上架包 ai-heal 仍 200 且诊断含 URL", async () => {
    const res = await rwPost("/api/plugins/a1-published-pack/ai-heal", { brokenUrls: [PUBLISHED_URL] });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(PUBLISHED_URL);
  }, 60_000);

  it("持票陌生人：下架包与待审包 url-deep-diagnose 均为 404", async () => {
    for (const slug of ["a1-delisted-pack", "a1-pending-pack"]) {
      const url = slug === "a1-delisted-pack" ? SECRET_URL : PENDING_URL;
      const res = await rwPost(`/api/plugins/${slug}/url-deep-diagnose`, { url });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(url);
    }
  });

  it("持票陌生人：已上架包 url-deep-diagnose 仍 200", async () => {
    const res = await rwPost("/api/plugins/a1-published-pack/url-deep-diagnose", { url: PUBLISHED_URL });
    expect(res.statusCode).toBe(200);
  }, 60_000);

  it("匿名：下架包与待审包 overlap 均为 404", async () => {
    for (const slug of ["a1-delisted-pack", "a1-pending-pack"]) {
      const res = await anonGet(`/api/plugins/${slug}/overlap`);
      expect(res.statusCode).toBe(404);
    }
    const published = await anonGet("/api/plugins/a1-published-pack/overlap");
    expect(published.statusCode).toBe(200);
    expect(published.json().declared).toBe(1);
  });

  it("匿名：下架包与待审包 url-health 均为 404；已上架包仍 200 且含计数", async () => {
    for (const slug of ["a1-delisted-pack", "a1-pending-pack"]) {
      const res = await anonGet(`/api/plugins/${slug}/url-health`);
      expect(res.statusCode).toBe(404);
    }
    const published = await anonGet("/api/plugins/a1-published-pack/url-health");
    expect(published.statusCode).toBe(200);
    // 计数本身随探活结果而变（前面的 POST audit 对照会真实探活并写新行），
    // 这里只断言“有数可读”，不锁死具体值。
    expect(typeof published.json().brokenCount).toBe("number");
  });

  it("持票陌生人：下架包与待审包 /health 均为 404；已上架包仍 200", async () => {
    for (const slug of ["a1-delisted-pack", "a1-pending-pack"]) {
      const res = await rwGet(`/api/plugins/${slug}/health`);
      expect(res.statusCode).toBe(404);
    }
    const published = await rwGet("/api/plugins/a1-published-pack/health");
    expect(published.statusCode).toBe(200);
    expect(published.json().auditedAt).not.toBeNull();
  });

  it("持票陌生人：下架包与待审包 url-health/history 均为 404；已上架包仍 200", async () => {
    for (const slug of ["a1-delisted-pack", "a1-pending-pack"]) {
      const res = await rwGet(`/api/plugins/${slug}/url-health/history`);
      expect(res.statusCode).toBe(404);
    }
    const published = await rwGet("/api/plugins/a1-published-pack/url-health/history");
    expect(published.statusCode).toBe(200);
    expect(published.json().points.length).toBeGreaterThan(0);
  });

  it("持票陌生人：批量 /health 里下架/待审包按“从未体检过”形态返回，已上架包带真实时间", async () => {
    const res = await rwGet(
      "/api/plugins/health?slugs=a1-delisted-pack,a1-pending-pack,a1-published-pack,a1-no-such-pack",
    );
    expect(res.statusCode).toBe(200);
    const bySlug = new Map(res.json().items.map((i: { slug: string }) => [i.slug, i]));
    const delisted = bySlug.get("a1-delisted-pack") as { auditedAt: unknown; state: unknown };
    const pending = bySlug.get("a1-pending-pack") as { auditedAt: unknown; state: unknown };
    const missing = bySlug.get("a1-no-such-pack") as { auditedAt: unknown; state: unknown };
    const published = bySlug.get("a1-published-pack") as { auditedAt: unknown };
    // 不可见的与不存在的同形：auditedAt 为 null、state 与“从未体检”一致，不泄漏存在性。
    expect(delisted.auditedAt).toBeNull();
    expect(pending.auditedAt).toBeNull();
    expect(delisted.state).toEqual(missing.state);
    expect(published.auditedAt).not.toBeNull();
  });

  it("持票陌生人：url-health/summary 不含下架包，只含已上架包", async () => {
    const res = await rwGet("/api/plugins/url-health/summary");
    expect(res.statusCode).toBe(200);
    expect(res.json().summaries["a1-delisted-pack"]).toBeUndefined();
    expect(res.json().summaries["a1-published-pack"]).toBeDefined();
    // 计数随探活结果而变（前面的 POST audit 对照会真实探活并写新行），
    // 这里只断言“有条目可读”，不锁死具体值。
    expect(res.json().summaries["a1-published-pack"].auditedAt).not.toBeNull();
  });
});

describe("A 批 R4-6：星标状态门禁", () => {
  it("陌生人：下架包与待审包 star 返回 400，且不写星标", async () => {
    for (const slug of ["a1-delisted-pack", "a1-pending-pack"]) {
      const res = await signedPost(`/api/plugins/${slug}/star`, {}, STRANGER);
      expect(res.statusCode).toBe(400);
    }
    expect((await ctx.repo.getPluginBySlug("a1-delisted-pack"))?.starCount).toBe(0);
    expect((await ctx.repo.getPluginBySlug("a1-pending-pack"))?.starCount).toBe(0);
  });

  it("陌生人：已上架包 star 仍 200；下架包的既有星标仍可取消（清理路径）", async () => {
    const starred = await signedPost("/api/plugins/a1-published-pack/star", {}, STRANGER);
    expect(starred.statusCode).toBe(200);
    expect(starred.json().starCount).toBe(1);
    const unstarred = await signedDelete("/api/plugins/a1-published-pack/star", STRANGER);
    expect(unstarred.statusCode).toBe(200);
    expect(unstarred.json().starCount).toBe(0);

    // a1-star-delisted-pack：上架时已被星标，下架后 star 仍 400、unstar 仍 200。
    const restar = await signedPost("/api/plugins/a1-star-delisted-pack/star", {}, STRANGER);
    expect(restar.statusCode).toBe(400);
    const unstar = await signedDelete("/api/plugins/a1-star-delisted-pack/star", STRANGER);
    expect(unstar.statusCode).toBe(200);
    expect(unstar.json().starCount).toBe(0);
    expect((await ctx.repo.getPluginBySlug("a1-star-delisted-pack"))?.starCount).toBe(0);
  });
});

describe("A 批 R4-4：举报不再静默自动下架", () => {
  it("3 个不同身份举报 → 不再隔离、只计数，治理告警可见", async () => {
    for (const [i, reporter] of [REPORTER1, REPORTER2, REPORTER3].entries()) {
      const res = await signedPost("/api/plugins/a1-published-pack/report", { reason: "测试举报" }, reporter);
      expect(res.statusCode).toBe(200);
      expect(res.json().message).toBe("举报已受理");
      expect(res.json().deduplicated).toBe(false);
      expect(res.json().quarantined).toBe(false);
      expect(res.json().reportCount).toBe(i + 1);
    }
    const plugin = await ctx.repo.getPluginBySlug("a1-published-pack");
    expect(plugin?.status).toBe("published");
    expect(plugin?.reportCount).toBe(3);

    const gov = await adminGet("/api/admin/plugins/governance");
    expect(gov.statusCode).toBe(200);
    const alert = gov.json().alerts.find(
      (a: { kind: string; slug: string }) => a.kind === "reported" && a.slug === "a1-published-pack",
    );
    expect(alert).toBeDefined();
    expect(alert.value).toBe(3);
  });

  it("同一身份重复举报 → 计数不变，文案如实说“已举报过”", async () => {
    const res = await signedPost("/api/plugins/a1-published-pack/report", { reason: "测试举报 again" }, REPORTER1);
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe("您已举报过该插件");
    expect(res.json().deduplicated).toBe(true);
    expect(res.json().reportCount).toBe(3);
    const plugin = await ctx.repo.getPluginBySlug("a1-published-pack");
    expect(plugin?.reportCount).toBe(3);
    expect(plugin?.status).toBe("published");
  });

  it("并发同身份举报（存储层）→ 恰好一方计入，计数只 +1、不触发隔离", async () => {
    const results = await Promise.all([
      ctx.repo.reportPlugin(
        "a1-published-pack",
        { reason: "并发举报", identity: REPORTER4 },
        { actor: REPORTER4, actorKind: "identity", ip: "127.0.0.1" },
      ),
      ctx.repo.reportPlugin(
        "a1-published-pack",
        { reason: "并发举报", identity: REPORTER4 },
        { actor: REPORTER4, actorKind: "identity", ip: "127.0.0.1" },
      ),
    ]);
    // 恰好一方是新举报、另一方被去重；顺序不定，但集合恒为 {false, true}。
    expect(results.map((r) => r.deduplicated).sort()).toEqual([false, true]);
    const plugin = await ctx.repo.getPluginBySlug("a1-published-pack");
    expect(plugin?.reportCount).toBe(4);
    expect(plugin?.status).toBe("published");
  });
});

describe("A 批 R4-7：评价举报去重", () => {
  it("同一身份重复举报同一评价 → report_count 只 +1；不同身份再 +1", async () => {
    const url = `/api/plugins/a1-published-pack/reviews/${publishedReviewId}/report`;
    const first = await signedPost(url, { reason: "测试举报评价" }, REPORTER1);
    expect(first.statusCode).toBe(200);
    expect(first.json().reportCount).toBe(1);
    expect(first.json().deduplicated).toBe(false);

    const dup = await signedPost(url, { reason: "测试举报评价 again" }, REPORTER1);
    expect(dup.statusCode).toBe(200);
    expect(dup.json().reportCount).toBe(1);
    expect(dup.json().deduplicated).toBe(true);

    const other = await signedPost(url, { reason: "测试举报评价" }, REPORTER2);
    expect(other.statusCode).toBe(200);
    expect(other.json().reportCount).toBe(2);
    expect(other.json().deduplicated).toBe(false);
  });
});

describe("A 批 R4-10：评价长度口径收敛", () => {
  it("200 字标题 + 2000 字正文提交后原样读回", async () => {
    const longTitle = "标".repeat(200);
    const longContent = "正".repeat(2000);
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/a1-published-pack/reviews",
      payload: { rating: 5, title: longTitle, content: longContent },
      headers: signedHeaders(INSTALLER),
    });
    expect(res.statusCode).toBe(201);
    const list = await anonGet("/api/plugins/a1-published-pack/reviews");
    expect(list.statusCode).toBe(200);
    const mine = list.json().items.find((i: { identity: string }) => i.identity === INSTALLER);
    expect(mine.title).toBe(longTitle);
    expect(mine.content).toBe(longContent);
  });

  it("超长标题/正文明确 400，且原评价不被改写", async () => {
    const overTitle = await app.inject({
      method: "POST",
      url: "/api/plugins/a1-published-pack/reviews",
      payload: { rating: 5, title: "标".repeat(201), content: "正".repeat(10) },
      headers: signedHeaders(INSTALLER),
    });
    expect(overTitle.statusCode).toBe(400);
    const overContent = await app.inject({
      method: "POST",
      url: "/api/plugins/a1-published-pack/reviews",
      payload: { rating: 5, title: "短标题", content: "正".repeat(4001) },
      headers: signedHeaders(INSTALLER),
    });
    expect(overContent.statusCode).toBe(400);

    const list = await anonGet("/api/plugins/a1-published-pack/reviews");
    const mine = list.json().items.find((i: { identity: string }) => i.identity === INSTALLER);
    expect(mine.title).toBe("标".repeat(200));
    expect(mine.content).toBe("正".repeat(2000));
  });
});
