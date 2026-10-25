import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";
import { generateToken, hashToken } from "../src/auth.ts";

/**
 * /api/me 写面只读令牌守卫（授权一致性，施工图 v2）。
 *
 * 只读令牌泄露后仍能改设置、清理数据、注销账号、甚至再签发 write 令牌，
 * 与前端「只读令牌泄露后也无法改动你的数据」的承诺相反。
 * 闸门挂在 meRoutes 插件的 onRequest：14 个写端点默认拒绝，坏 JSON 也先 403
 * （preHandler 会先被 body 解析打成 400，把授权失败伪装成参数错误）。
 */
const SECRET = "test-secret-me-write-scope";
const USER = "github:u-me-write-scope";
const DELETE_USER = "github:u-me-delete-scope";
const BFF_USER = "github:u-bff-signed";
const ANON = "anon-44444444-4444-4444-4444-444444444444";

const base = {
  mode: "lite" as const,
  embedding: {
    model: "Xenova/bge-small-zh-v1.5",
    endpoint: "https://hf-mirror.com",
    dtype: "q8",
    dim: 512,
    enabled: false,
  },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let readToken = "";
let revokeToken = "";
let revokeTokenId = "";
let writeToken = "";
let deleteToken = "";
let siteA = "";
let siteB = "";

const headersFor = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

// 每个请求换一个来源地址：避免把令牌/导入等限流桶当成授权断言失败
let seq = 0;
type InjectOpts = {
  method: "GET" | "HEAD" | "POST" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
};
const inject = (opts: InjectOpts) =>
  app.inject({ ...opts, remoteAddress: `10.91.0.${(seq++ % 200) + 3}` } as never);

async function seedToken(write: boolean, user = USER) {
  const raw = generateToken();
  const record = await ctx.repo.createApiToken({
    name: write ? "probe-write" : "probe-read",
    tokenHash: hashToken(raw),
    scopes: write ? "read,write" : "read",
    ownerIdentity: user,
  });
  expect(record.scopes).toEqual(write ? ["read", "write"] : ["read"]);
  return { token: raw, id: record.id };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-me-write-scope-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "scope.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "写面授权测试" });
  siteA = (await ctx.repo.createSite({ url: "https://scope-a.example.com", title: "scope A", categoryId: cat.id })).id;
  siteB = (await ctx.repo.createSite({ url: "https://scope-b.example.com", title: "scope B", categoryId: cat.id })).id;

  await ctx.repo.recordSearch(USER, "probe", 1);
  await ctx.repo.saveUserVaultIfUnchanged(USER, JSON.stringify({ probe: true }), 0);
  await ctx.repo.addFavorite({ userId: USER, siteId: siteA });
  await ctx.repo.addFavorite({ userId: DELETE_USER, siteId: siteA });

  const read = await seedToken(false);
  readToken = read.token;
  const revoke = await seedToken(false);
  revokeToken = revoke.token;
  revokeTokenId = revoke.id;
  writeToken = (await seedToken(true)).token;
  deleteToken = (await seedToken(false, DELETE_USER)).token;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("/api/me 写面：只读令牌一律 403", () => {
  const read = () => ({ authorization: "Bearer " + readToken });
  const write = () => ({ authorization: "Bearer " + writeToken });

  it("验收 1：14 个写端点全部 403，错误信息指向只读", async () => {
    const hex64 = "a".repeat(64);
    const cases: Array<InjectOpts & { method: "POST" | "PATCH" | "DELETE" }> = [
      { method: "PATCH", url: "/api/me/settings", headers: read(), payload: { personalizationEnabled: false } },
      { method: "PATCH", url: "/api/me/profile", headers: read(), payload: { username: "probe-rename" } },
      { method: "POST", url: "/api/me/diagnostics", headers: read(), payload: {} },
      { method: "POST", url: "/api/me/import", headers: read(), payload: { schemaVersion: 1 } },
      { method: "POST", url: "/api/me/prune", headers: read(), payload: { domains: ["search_history"] } },
      { method: "POST", url: "/api/me/sessions/check", headers: read(), payload: { sid: "0123456789abcdef" } },
      { method: "POST", url: "/api/me/tokens", headers: read(), payload: { name: "esc", write: true } },
      { method: "DELETE", url: `/api/me/tokens/${revokeTokenId}`, headers: { authorization: "Bearer " + revokeToken } },
      { method: "POST", url: "/api/me/notifications/probe-notification/read", headers: read() },
      { method: "POST", url: "/api/me/notifications/read-all", headers: read() },
      { method: "DELETE", url: `/api/me/sessions/${hex64}`, headers: read() },
      { method: "POST", url: "/api/me/favorites/sync", headers: read(), payload: { ops: [{ op: "remove", siteId: siteA }] } },
      { method: "DELETE", url: "/api/me", headers: { authorization: "Bearer " + deleteToken }, payload: { confirm: "DELETE" } },
      { method: "POST", url: "/api/me/merge", headers: read(), payload: { anonId: ANON } },
    ];
    // 不用 expect 逐条抛错：矩阵必须全部执行完，后续「数据未变」用例才有意义
    const failures: string[] = [];
    for (const c of cases) {
      const res = await inject(c);
      const label = `${c.method} ${c.url}`;
      if (res.statusCode !== 403) failures.push(`${label} → ${res.statusCode}`);
      else if (!String((res.json() as { error?: string }).error ?? "").includes("只读")) failures.push(`${label} → 缺只读文案`);
    }
    expect(failures).toEqual([]);
  });

  it("验收 2：设置未被 403 请求改动（含 updatedAt）", async () => {
    const res = await inject({ method: "GET", url: "/api/me/settings", headers: read() });
    expect(res.statusCode).toBe(200);
    const settings = (res.json() as { settings: { personalizationEnabled: boolean; updatedAt: number } }).settings;
    expect(settings.personalizationEnabled).toBe(true);
    expect(settings.updatedAt).toBe(0);
  });

  it("验收 3：prune 403 后搜索历史与金库仍在", async () => {
    const rows = await ctx.repo.listSearchHistory(USER, 50);
    expect(rows.some((h) => h.query === "probe")).toBe(true);
    expect(await ctx.repo.getUserVault(USER)).not.toBeNull();
  });

  it("验收 4：只读令牌不能再签发令牌（read→write 提权关闭）", async () => {
    const tokens = await ctx.repo.listApiTokensByOwner(USER);
    expect(tokens).toHaveLength(3);
    expect(tokens.every((t) => !t.scopes.includes("admin"))).toBe(true);
    const revoked = await inject({ method: "GET", url: "/api/me", headers: { authorization: "Bearer " + revokeToken } });
    expect(revoked.statusCode).toBe(200);
    const me = await inject({ method: "GET", url: "/api/me", headers: read() });
    expect(me.statusCode).toBe(200);
  });

  it("验收 5：DELETE /api/me 403 后注销目标的数据仍在", async () => {
    expect((await ctx.repo.listFavorites(DELETE_USER)).map((f) => f.siteId)).toContain(siteA);
    expect((await ctx.repo.getUserSettings(DELETE_USER)).updatedAt).toBe(0);
  });

  it("验收 6：favorites/sync 403 后没有删除收藏", async () => {
    expect((await ctx.repo.listFavorites(USER)).map((f) => f.siteId)).toEqual([siteA]);
  });

  it("验收 7：import 403 后设置与收藏未变", async () => {
    const settings = await ctx.repo.getUserSettings(USER);
    expect(settings.personalizationEnabled).toBe(true);
    expect(settings.updatedAt).toBe(0);
    expect((await ctx.repo.listFavorites(USER)).map((f) => f.siteId)).toEqual([siteA]);
  });

  it("验收 8：write 令牌的合法写不被误伤", async () => {
    const patched = await inject({
      method: "PATCH",
      url: "/api/me/settings",
      headers: write(),
      payload: { personalizationEnabled: false },
    });
    expect(patched.statusCode).toBe(200);

    const synced = await inject({
      method: "POST",
      url: "/api/me/favorites/sync",
      headers: write(),
      payload: { ops: [{ op: "add", siteId: siteB }] },
    });
    expect(synced.statusCode).toBe(200);
    expect((await ctx.repo.listFavorites(USER)).map((f) => f.siteId)).toContain(siteB);
  });

  it("验收 9：无 owner 的签名身份（BFF 路径）写不改行为", async () => {
    const res = await inject({
      method: "PATCH",
      url: "/api/me/settings",
      headers: headersFor(BFF_USER),
      payload: { personalizationEnabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect((await ctx.repo.getUserSettings(BFF_USER)).personalizationEnabled).toBe(true);
  });

  it("验收 10：只读令牌的读能力不变", async () => {
    for (const url of ["/api/me", "/api/me/settings", "/api/favorites", "/api/search-history", "/api/vault/sync"]) {
      const res = await inject({ method: "GET", url, headers: read() });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it("验收 11：HEAD /api/me 与 GET 同状态，不被守卫误拦", async () => {
    const head = await inject({ method: "HEAD", url: "/api/me", headers: read() });
    expect(head.statusCode).toBe(200);
    const get = await inject({ method: "GET", url: "/api/me", headers: read() });
    expect(get.statusCode).toBe(head.statusCode);
  });

  it("验收 12：无凭据的写请求仍是 401（认证语义不变）", async () => {
    const res = await inject({
      method: "PATCH",
      url: "/api/me/settings",
      payload: { personalizationEnabled: false },
    });
    expect(res.statusCode).toBe(401);
  });

  it("验收 13：只读令牌 + 合法 bearer 头但坏 JSON 也是 403（锁定 onRequest 阶段）", async () => {
    const res = await inject({
      method: "PATCH",
      url: "/api/me/settings",
      headers: { ...read(), "content-type": "application/json" },
      payload: '{"personalizationEnabled":',
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error?: string }).error).toContain("只读");
  });
});
