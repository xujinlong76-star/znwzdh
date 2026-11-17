/**
 * 评价提交限流按身份分桶（E2E 2/2 的 429 根因）。
 *
 * 背景：POST /api/plugins/:slug/reviews 的路由级限流默认 key 是 req.ip，
 * E2E 分片里全部请求同 IP（dev 下代理不传可区分的 XFF），共用 15 次/小时
 * 的桶 → NextGen 评价提交吃 429。改法：keyGenerator 用 requestIdentityOf
 *（头 X-Navhub-Anon-Id / x-navhub-user-id → ?anonId= 查询 → 令牌 owner），
 * 读不到身份时回退 req.ip。
 *
 * 覆盖（同一进程、同 IP 发请求，复现 E2E 的同 IP 条件）：
 *   (i) 不同身份走不同桶：A 连发 15 次打满自己的桶后，B 与 C（C 只走
 *       ?anonId= 查询，复现 e2e/plugin-market-sorting.spec.ts 的 reviewAs）
 *       仍能提交成功；
 *   (ii) 同一身份在窗内超过 max 仍被限流：A 第 16 次得 429 RATE_LIMITED。
 * 同一身份重复提交是 upsert（createPluginReview），前 15 次都应 201。
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

const OWNER = "anon-owner-rl-review";
const IDENTITY_A = "anon-reviewer-a-rl";
const IDENTITY_B = "anon-reviewer-b-rl";
const IDENTITY_C = "anon-reviewer-c-rl";
const SLUG = "rl-review-pack";

const reviewPack = {
  manifestVersion: 1,
  kind: "theme",
  name: "评价限流包",
  description: "评价提交限流按身份分桶夹具",
  icon: "⭐",
  author: "限流复现",
  license: "MIT",
  version: "1.0.0",
  tags: ["主题"],
  payload: { tokens: { background: "#222222", foreground: "#dddddd" } },
};

function signedHeaders(identity: string) {
  return {
    "x-navhub-anon-id": identity,
    "x-navhub-identity-signature": signIdentity(SECRET, identity),
  };
}

/** 经头传身份提交评价（浏览器 UI 走 X-Navhub-Anon-Id 头）。 */
async function postReviewByHeader(identity: string, rating = 5) {
  return app.inject({
    method: "POST",
    url: `/api/plugins/${SLUG}/reviews`,
    headers: signedHeaders(identity),
    payload: { rating, content: "分桶验证评价" },
  });
}

/** 只经 ?anonId= 查询传身份提交评价（复现 sorting spec 的 reviewAs）。 */
async function postReviewByQuery(identity: string, rating = 5) {
  return app.inject({
    method: "POST",
    url: `/api/plugins/${SLUG}/reviews?anonId=${encodeURIComponent(identity)}`,
    headers: { "x-navhub-identity-signature": signIdentity(SECRET, identity) },
    payload: { rating, content: "分桶验证评价" },
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-review-ratelimit-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "review-ratelimit.db"),
    authRequired: true,
    bootstrapToken: BOOTSTRAP,
    adminToken: ADMIN_STATIC,
    identitySecret: SECRET,
    embedding: { model: "none", endpoint: "", dtype: "q8", dim: 512, cacheDir: join(dir, "models"), enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubReviewRateLimitTest/0.1" },
    corsOrigins: ["*"],
  } as never);
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();

  await ctx.repo.createPlugin(
    {
      manifest: reviewPack as never,
      author: "限流复现",
      authorKind: "identity",
      ownerIdentity: OWNER,
      source: "user",
      status: "published",
      slug: SLUG,
    },
    { actor: OWNER, actorKind: "identity" },
  );
  // 新评价要求活跃安装：三个身份都先装上
  for (const identity of [IDENTITY_A, IDENTITY_B, IDENTITY_C]) {
    await ctx.repo.installPlugin(SLUG, identity, { actor: identity, actorKind: "identity" });
  }
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/plugins/:slug/reviews 限流按身份分桶", () => {
  it("(i) A 连发 15 次打满自己的桶后，B（头身份）与 C（?anonId= 身份）仍能提交", async () => {
    for (let n = 1; n <= 15; n++) {
      const res = await postReviewByHeader(IDENTITY_A, 5);
      expect(res.statusCode, `A 第 ${n} 次应 201，实际 ${res.statusCode}: ${res.body}`).toBe(201);
    }
    const b = await postReviewByHeader(IDENTITY_B, 4);
    expect(b.statusCode, `B 应 201，实际 ${b.statusCode}: ${b.body}`).toBe(201);
    const c = await postReviewByQuery(IDENTITY_C, 3);
    expect(c.statusCode, `C（?anonId=）应 201，实际 ${c.statusCode}: ${c.body}`).toBe(201);
  });

  it("(ii) 同一身份第 16 次提交被限流 429 RATE_LIMITED", async () => {
    const res = await postReviewByHeader(IDENTITY_A, 5);
    expect(res.statusCode).toBe(429);
    expect(res.body).toContain("RATE_LIMITED");
  });
});
