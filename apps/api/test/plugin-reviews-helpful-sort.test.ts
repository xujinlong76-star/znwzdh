/**
 * 评价「有用」投票与排序（P2-3）API 层测试。
 *
 * 覆盖：GET ?sort=helpful/highest/lowest/bogus 的顺序与回显、POST helpful
 * 的投票切换与计数、自己投自己 403、未签名 401、未知评价/插件 404、
 * 列表回填 helpfulCount 与 helpfulByMe。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const BOOTSTRAP = "hs-bootstrap-token-please-rotate";
const SECRET = "hs-identity-secret-please-rotate";
const ADMIN_STATIC = "hs-admin-static-please-rotate";

const OWNER = "anon-author-hs";
const AUTHOR_LOW = "anon-author-low-hs";
const AUTHOR_MID = "anon-author-mid-hs";
const AUTHOR_HIGH = "anon-author-high-hs";
const VOTER_1 = "anon-voter-1-hs";
const VOTER_2 = "anon-voter-2-hs";
const VOTER_3 = "anon-voter-3-hs";

const reviewPack = {
  manifestVersion: 1,
  kind: "theme",
  name: "有用排序包",
  description: "P2-3 评价投票与排序夹具",
  icon: "⭐",
  author: "P2-3 复现",
  license: "MIT",
  version: "1.0.0",
  tags: ["主题"],
  payload: { tokens: { background: "#222222", foreground: "#dddddd" } },
};

let lowId = "";
let midId = "";
let highId = "";

function signedHeaders(identity: string) {
  return {
    "x-navhub-anon-id": identity,
    "x-navhub-identity-signature": signIdentity(SECRET, identity),
  };
}

async function postHelpful(slug: string, reviewId: string, identity?: string) {
  return app.inject({
    method: "POST",
    url: `/api/plugins/${slug}/reviews/${reviewId}/helpful`,
    headers: identity ? signedHeaders(identity) : {},
    payload: {},
  });
}

async function getReviews(slug: string, query: string, identity?: string) {
  return app.inject({
    method: "GET",
    url: `/api/plugins/${slug}/reviews${query}`,
    headers: identity ? signedHeaders(identity) : {},
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-helpful-sort-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "helpful-sort.db"),
    authRequired: true,
    bootstrapToken: BOOTSTRAP,
    adminToken: ADMIN_STATIC,
    identitySecret: SECRET,
    embedding: { model: "none", endpoint: "", dtype: "q8", dim: 512, cacheDir: join(dir, "models"), enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubHelpfulSortTest/0.1" },
    corsOrigins: ["*"],
  } as never);
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();

  await ctx.repo.createPlugin(
    {
      manifest: reviewPack as never,
      author: "P2-3 复现",
      authorKind: "identity",
      ownerIdentity: OWNER,
      source: "user",
      status: "published",
      slug: "hs-review-pack",
    },
    { actor: OWNER, actorKind: "identity" },
  );
  // 三条评价：评分与票数故意错开，区分 helpful 排序与评分排序
  await ctx.repo.installPlugin("hs-review-pack", AUTHOR_LOW, { actor: AUTHOR_LOW, actorKind: "identity" });
  await ctx.repo.installPlugin("hs-review-pack", AUTHOR_MID, { actor: AUTHOR_MID, actorKind: "identity" });
  await ctx.repo.installPlugin("hs-review-pack", AUTHOR_HIGH, { actor: AUTHOR_HIGH, actorKind: "identity" });
  lowId = (await ctx.repo.createPluginReview("hs-review-pack", AUTHOR_LOW, { rating: 1, content: "很差" })).id;
  midId = (await ctx.repo.createPluginReview("hs-review-pack", AUTHOR_MID, { rating: 4, content: "还行" })).id;
  highId = (await ctx.repo.createPluginReview("hs-review-pack", AUTHOR_HIGH, { rating: 5, content: "很好" })).id;
  // 票数：low 3 票、mid 1 票、high 0 票
  for (const voter of [VOTER_1, VOTER_2, VOTER_3]) {
    await ctx.repo.togglePluginReviewHelpful("hs-review-pack", lowId, voter);
  }
  await ctx.repo.togglePluginReviewHelpful("hs-review-pack", midId, VOTER_1);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("P2-3：评价排序 GET ?sort=", () => {
  it("sort=helpful 按票数倒序，sort 回显 helpful", async () => {
    const res = await getReviews("hs-review-pack", "?sort=helpful");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sort).toBe("helpful");
    expect(body.items.map((r: { id: string }) => r.id)).toEqual([lowId, midId, highId]);
    expect(body.items.map((r: { helpfulCount: number }) => r.helpfulCount)).toEqual([3, 1, 0]);
  });

  it("sort=highest/lowest 按评分倒序/正序", async () => {
    const highest = await getReviews("hs-review-pack", "?sort=highest");
    expect(highest.json().items.map((r: { id: string }) => r.id)).toEqual([highId, midId, lowId]);
    const lowest = await getReviews("hs-review-pack", "?sort=lowest");
    expect(lowest.json().items.map((r: { id: string }) => r.id)).toEqual([lowId, midId, highId]);
  });

  it("sort 非法值回落 newest，不 400", async () => {
    const res = await getReviews("hs-review-pack", "?sort=bogus");
    expect(res.statusCode).toBe(200);
    expect(res.json().sort).toBe("newest");
    expect(res.json().total).toBe(3);
  });

  it("带签名身份读列表时回填 helpfulByMe", async () => {
    const res = await getReviews("hs-review-pack", "?sort=helpful", VOTER_1);
    const byId = new Map(res.json().items.map((r: { id: string; helpfulByMe: boolean }) => [r.id, r.helpfulByMe]));
    expect(byId.get(lowId)).toBe(true);
    expect(byId.get(midId)).toBe(true);
    expect(byId.get(highId)).toBe(false);
  });
});

describe("P2-3：POST helpful 投票切换", () => {
  it("投上 +1、再点撤回 -1，返回体带最新计数与评价快照", async () => {
    const first = await postHelpful("hs-review-pack", highId, VOTER_2);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ ok: true, helpful: true, helpfulCount: 1 });
    expect(first.json().review.id).toBe(highId);

    const second = await postHelpful("hs-review-pack", highId, VOTER_2);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ ok: true, helpful: false, helpfulCount: 0 });
  });

  it("自己投自己的评价 403", async () => {
    const res = await postHelpful("hs-review-pack", lowId, AUTHOR_LOW);
    expect(res.statusCode).toBe(403);
  });

  it("未签名调用 401；未知评价 404；未知插件 404", async () => {
    const unsigned = await postHelpful("hs-review-pack", highId);
    expect(unsigned.statusCode).toBe(401);

    const unknownReview = await postHelpful("hs-review-pack", "no-such-review", VOTER_1);
    expect(unknownReview.statusCode).toBe(404);

    const unknownPlugin = await postHelpful("no-such-plugin", highId, VOTER_1);
    expect(unknownPlugin.statusCode).toBe(404);
  });
});
