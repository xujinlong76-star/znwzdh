/**
 * /api/me/merge 限流按身份分桶。
 *
 * 背景：POST /api/me/merge 的路由级限流默认 key 是 req.ip，且桶只有
 * 5 次/分钟。E2E 分片里全部请求同 IP（dev 下代理不传可区分的 XFF），
 * 登录后 SessionSync 在每个页面挂载时都会尝试合并（失败不记 flag，
 * 下次挂载重试），分片内几次登录就打满整个桶 → run 44137387080 的
 * E2E 2/2 里 17:30:23-24 与 17:30:40 出现 5 次 [API ERROR 429]
 * /api/me/merge。改法：keyGenerator 用 requestIdentityOf（头
 * X-Navhub-Anon-Id / x-navhub-user-id → ?anonId= 查询 → 令牌 owner），
 * 读不到身份时回退 req.ip；桶大小不变（5 次/分钟），不放宽也不删限流。
 *
 * 本测试只认领 merge 429 本身，不认领该分片失败的 2 个 E2E 用例：
 * 它们发生在 17:33:04，晚于全部 429/502（17:30:40 之前），且卸载/
 * 停用路径上无任何 429 记录，另有原因在查。
 *
 * 覆盖（同一进程、同 IP 发请求，复现 E2E 的同 IP 条件）：
 *   (i) 不同身份走不同桶：A 连发 5 次打满自己的桶后，B（头身份）与
 *       C（只走 ?anonId= 查询）仍能合并成功；
 *   (ii) 同一身份在窗内超过 max 仍被限流：A 第 6 次得 429 RATE_LIMITED。
 * 同一对 (anon → 登录) 重复合并是幂等（alreadyMerged），前 5 次都应 200。
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

const LOGIN_A = "github:u-merge-rl-a";
const LOGIN_B = "github:u-merge-rl-b";
const LOGIN_C = "github:u-merge-rl-c";
const ANON_A = "anon-merge-rl-a-11111111";
const ANON_B = "anon-merge-rl-b-22222222";
const ANON_C = "anon-merge-rl-c-33333333";

/** 经头传登录身份合并（BFF 转发 /api/me/merge 时的形态）。 */
async function mergeByHeader(login: string, anon: string) {
  return app.inject({
    method: "POST",
    url: "/api/me/merge",
    headers: {
      "x-navhub-user-id": login,
      "x-navhub-identity-signature": signIdentity(SECRET, login),
      "x-navhub-anon-signature": signIdentity(SECRET, anon),
    },
    payload: { anonId: anon },
  });
}

/** 只经 ?anonId= 查询传登录身份合并（requestIdentityOf 的查询路径）。 */
async function mergeByQuery(login: string, anon: string) {
  return app.inject({
    method: "POST",
    url: `/api/me/merge?anonId=${encodeURIComponent(login)}`,
    headers: {
      "x-navhub-identity-signature": signIdentity(SECRET, login),
      "x-navhub-anon-signature": signIdentity(SECRET, anon),
    },
    payload: { anonId: anon },
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-me-merge-ratelimit-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "merge-ratelimit.db"),
    authRequired: true,
    bootstrapToken: BOOTSTRAP,
    adminToken: ADMIN_STATIC,
    identitySecret: SECRET,
    embedding: { model: "none", endpoint: "", dtype: "q8", dim: 512, cacheDir: join(dir, "models"), enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubMergeRateLimitTest/0.1" },
    corsOrigins: ["*"],
  } as never);
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/me/merge 限流按身份分桶", () => {
  it("(i) A 连发 5 次打满自己的桶后，B（头身份）与 C（?anonId= 身份）仍能合并", async () => {
    for (let n = 1; n <= 5; n++) {
      const res = await mergeByHeader(LOGIN_A, ANON_A);
      expect(res.statusCode, `A 第 ${n} 次应 200，实际 ${res.statusCode}: ${res.body}`).toBe(200);
      expect(res.json().ok).toBe(true);
    }
    const b = await mergeByHeader(LOGIN_B, ANON_B);
    expect(b.statusCode, `B 应 200，实际 ${b.statusCode}: ${b.body}`).toBe(200);
    expect(b.json().ok).toBe(true);
    const c = await mergeByQuery(LOGIN_C, ANON_C);
    expect(c.statusCode, `C（?anonId=）应 200，实际 ${c.statusCode}: ${c.body}`).toBe(200);
    expect(c.json().ok).toBe(true);
  });

  it("(ii) 同一身份第 6 次合并被限流 429 RATE_LIMITED", async () => {
    const res = await mergeByHeader(LOGIN_A, ANON_A);
    expect(res.statusCode).toBe(429);
    expect(res.body).toContain("RATE_LIMITED");
  });
});
