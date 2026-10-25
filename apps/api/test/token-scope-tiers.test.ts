import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";
import { hashToken, parseScopes, scopeSatisfies } from "../src/auth.ts";
import { randomUUID } from "node:crypto";

/**
 * 个人令牌三档（P1 按域收敛）：read / read+favorites / read+write。
 *
 * write 令牌此前是「全量用户域写」：可 prune 物理删金库/历史、import、
 * 再签发令牌、DELETE /api/me 注销，而 UI 只承诺「扩展收藏当前页」。
 * 现在增加 favorites 中间档：只写收藏域（/api/favorites* 与
 * /api/me/favorites/sync），其余写面仍要求 write/admin；
 * 存量 read/write 令牌与 BFF/签名身份行为不变。
 */
const SECRET = "test-secret-token-scope-tiers";
const USER = "github:u-token-tiers";
const WRITE_USER = "github:u-token-tiers-write";
const DELETE_USER = "github:u-token-tiers-delete";
const BFF_USER = "github:u-token-tiers-bff";
const STORE_USER = "github:u-token-tiers-store";

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
let siteA = "";
let siteB = "";
let siteC = "";

let readToken = "";
let readTokenId = "";
let favToken = "";
let writeToken = "";
let legacyWriteToken = "";
let legacyReadToken = "";
let deleteFavToken = "";
let conflictToken = "";

const headersFor = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

// 每个请求换来源地址：令牌签发/收藏写各有独立限流桶，避免把限流 429 当授权断言失败
let seq = 0;
type InjectOpts = {
  method: "GET" | "HEAD" | "POST" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
};
const inject = (opts: InjectOpts) =>
  app.inject({ ...opts, remoteAddress: `10.92.0.${(seq++ % 200) + 3}` } as never);

async function createToken(body: Record<string, unknown>, user = USER) {
  const res = await inject({ method: "POST", url: "/api/me/tokens", headers: headersFor(user), payload: body });
  expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
  return res.json() as { token: string; record: { id: string; scopes: string[] } };
}

const bearer = (token: string) => ({ authorization: "Bearer " + token });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-token-tiers-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "tiers.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "令牌档位测试" });
  siteA = (await ctx.repo.createSite({ url: "https://tier-a.example.com", title: "tier A", categoryId: cat.id })).id;
  siteB = (await ctx.repo.createSite({ url: "https://tier-b.example.com", title: "tier B", categoryId: cat.id })).id;
  siteC = (await ctx.repo.createSite({ url: "https://tier-c.example.com", title: "tier C", categoryId: cat.id })).id;

  await ctx.repo.recordSearch(USER, "tier-probe", 1);
  await ctx.repo.saveUserVaultIfUnchanged(USER, JSON.stringify({ tier: true }), 0);
  await ctx.repo.addFavorite({ userId: DELETE_USER, siteId: siteA });

  const read = await createToken({ name: "tier-read", permission: "read" });
  readToken = read.token;
  readTokenId = read.record.id;
  favToken = (await createToken({ name: "tier-fav", permission: "favorites" })).token;
  writeToken = (await createToken({ name: "tier-write", permission: "write" }, WRITE_USER)).token;
  legacyWriteToken = (await createToken({ name: "tier-legacy-write", write: true })).token;
  legacyReadToken = (await createToken({ name: "tier-legacy-read" })).token;
  conflictToken = (await createToken({ name: "tier-conflict", permission: "favorites", write: true })).token;
  deleteFavToken = (await createToken({ name: "tier-delete", permission: "favorites" }, DELETE_USER)).token;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("个人令牌三档：签发与归一化", () => {
  it("验收 1：permission=read/favorites/write 映射三档 scope", async () => {
    const fav = await ctx.repo.listApiTokensByOwner(USER);
    const byName = (name: string) => fav.find((t) => t.name === name)?.scopes;
    expect(byName("tier-read")).toEqual(["read"]);
    expect(byName("tier-fav")).toEqual(["read", "favorites"]);
    expect(byName("tier-legacy-write")).toEqual(["read", "write"]);
    expect(byName("tier-legacy-read")).toEqual(["read"]);
    // permission 显式给定时优先于旧 write 布尔
    expect(byName("tier-conflict")).toEqual(["read", "favorites"]);
  });

  it("验收 2：非法 permission 400，且不产生令牌", async () => {
    const before = (await ctx.repo.listApiTokensByOwner(USER)).length;
    const res = await inject({
      method: "POST",
      url: "/api/me/tokens",
      headers: headersFor(USER),
      payload: { name: "tier-bad", permission: "admin-lite" },
    });
    expect(res.statusCode).toBe(400);
    expect((await ctx.repo.listApiTokensByOwner(USER)).length).toBe(before);
  });

  it("验收 3：store 归一化接受 favorites，未知值仍被丢弃", async () => {
    const ok = await ctx.repo.createApiToken({
      name: "store-fav",
      tokenHash: "a".repeat(64),
      scopes: "favorites,read",
      ownerIdentity: STORE_USER,
    });
    expect(ok.scopes).toEqual(["favorites", "read"]);
    const junk = await ctx.repo.createApiToken({
      name: "store-junk",
      tokenHash: "b".repeat(64),
      scopes: "read,superuser",
      ownerIdentity: STORE_USER,
    });
    expect(junk.scopes).toEqual(["read"]);
  });
});

describe("favorites 档：收藏域可写", () => {
  it("验收 4：可新增/删除收藏", async () => {
    const fav = () => bearer(favToken);
    const added = await inject({ method: "POST", url: "/api/favorites", headers: fav(), payload: { siteId: siteA } });
    expect(added.statusCode).toBe(201);
    const removed = await inject({ method: "DELETE", url: `/api/favorites/${siteA}`, headers: fav() });
    expect(removed.statusCode).toBe(200);
  });

  it("验收 5：可改收藏备注，可建/改/删收藏夹", async () => {
    const fav = () => bearer(favToken);
    expect((await inject({ method: "POST", url: "/api/favorites", headers: fav(), payload: { siteId: siteB } })).statusCode).toBe(201);
    expect((await inject({ method: "PATCH", url: `/api/favorites/${siteB}`, headers: fav(), payload: { note: "tier" } })).statusCode).toBe(200);

    const folder = await inject({ method: "POST", url: "/api/favorites/folders", headers: fav(), payload: { name: "tier-folder" } });
    expect(folder.statusCode).toBe(201);
    const folderId = (folder.json() as { id: string }).id;
    expect((await inject({ method: "PATCH", url: `/api/favorites/folders/${folderId}`, headers: fav(), payload: { name: "tier-folder-2" } })).statusCode).toBe(200);
    expect((await inject({ method: "DELETE", url: `/api/favorites/folders/${folderId}`, headers: fav() })).statusCode).toBe(200);
  });

  it("验收 6：可批量同步收藏（/api/me/favorites/sync）", async () => {
    const res = await inject({
      method: "POST",
      url: "/api/me/favorites/sync",
      headers: bearer(favToken),
      payload: { ops: [{ op: "add", siteId: siteC }] },
    });
    expect(res.statusCode).toBe(200);
    expect((await ctx.repo.listFavorites(USER)).map((f) => f.siteId)).toContain(siteC);
  });
});

describe("favorites 档：收藏域之外一律 403", () => {
  const fav = () => bearer(favToken);

  it("验收 7：不能改设置（403 文案指向收藏档，数据不变）", async () => {
    const res = await inject({
      method: "PATCH",
      url: "/api/me/settings",
      headers: fav(),
      payload: { personalizationEnabled: false },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error?: string }).error).toContain("仅可写收藏");
    const settings = await ctx.repo.getUserSettings(USER);
    expect(settings.personalizationEnabled).toBe(true);
    expect(settings.updatedAt).toBe(0);
  });

  it("验收 8：不能 prune（403，历史与金库仍在）", async () => {
    const res = await inject({
      method: "POST",
      url: "/api/me/prune",
      headers: fav(),
      payload: { domains: ["search_history"] },
    });
    expect(res.statusCode).toBe(403);
    const rows = await ctx.repo.listSearchHistory(USER, 50);
    expect(rows.some((h) => h.query === "tier-probe")).toBe(true);
    expect(await ctx.repo.getUserVault(USER)).not.toBeNull();
  });

  it("验收 9：不能签发/吊销令牌（提权与自断后路都关闭）", async () => {
    const before = (await ctx.repo.listApiTokensByOwner(USER)).length;
    const escalate = await inject({
      method: "POST",
      url: "/api/me/tokens",
      headers: fav(),
      payload: { name: "escalate", permission: "write" },
    });
    expect(escalate.statusCode).toBe(403);
    expect((await ctx.repo.listApiTokensByOwner(USER)).length).toBe(before);

    const revoke = await inject({ method: "DELETE", url: `/api/me/tokens/${readTokenId}`, headers: fav() });
    expect(revoke.statusCode).toBe(403);
    expect((await inject({ method: "GET", url: "/api/me", headers: bearer(readToken) })).statusCode).toBe(200);
  });

  it("验收 10：不能注销账号（403，目标用户数据仍在）", async () => {
    const res = await inject({
      method: "DELETE",
      url: "/api/me",
      headers: bearer(deleteFavToken),
      payload: { confirm: "DELETE" },
    });
    expect(res.statusCode).toBe(403);
    expect((await ctx.repo.listFavorites(DELETE_USER)).map((f) => f.siteId)).toContain(siteA);
    expect((await ctx.repo.getUserSettings(DELETE_USER)).updatedAt).toBe(0);
  });

  it("验收 11：不能写历史/资料/金库", async () => {
    const fav = () => bearer(favToken);
    const cases: InjectOpts[] = [
      { method: "DELETE", url: "/api/search-history", headers: fav() },
      { method: "DELETE", url: "/api/profile", headers: fav() },
      { method: "DELETE", url: "/api/vault/sync", headers: fav() },
    ];
    const failures: string[] = [];
    for (const c of cases) {
      const res = await inject(c);
      if (res.statusCode !== 403) failures.push(`${c.method} ${c.url} → ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });
});

/**
 * 开放模式下实例级路由不做 scope 门槛（历史行为），所以「favorites 不越权到
 * 实例级 write」必须在鉴权模式（NAVHUB_AUTH_REQUIRED=true）下验证。
 */
describe("鉴权模式：favorites 只到 read 门槛，过不了实例级 write", () => {
  let gdir: string;
  let gctx: AppContext;
  let gapp: Awaited<ReturnType<typeof buildServer>>;
  let gseq = 0;
  const ginject = (opts: InjectOpts) =>
    gapp.inject({ ...opts, remoteAddress: `10.94.0.${(gseq++ % 200) + 3}` } as never);
  const mint = async (scopes: string) => {
    const raw = "navhub_gate_" + randomUUID().replace(/-/g, "");
    await gctx.repo.createApiToken({ name: "gate-" + scopes, tokenHash: hashToken(raw), scopes });
    return raw;
  };

  beforeAll(async () => {
    gdir = mkdtempSync(join(tmpdir(), "navhub-token-tiers-gate-"));
    gctx = await createContext(
      loadConfig({ ...base, authRequired: true, sqlitePath: join(gdir, "gate.db"), identitySecret: SECRET }),
    );
    gapp = await buildServer(gctx);
    await gapp.ready();
  });

  afterAll(async () => {
    await gapp.close();
    await gctx.close();
    rmSync(gdir, { recursive: true, force: true });
  });

  it("验收 11b：scopeSatisfies 把 favorites 钉在 read 档", () => {
    expect(scopeSatisfies(parseScopes("read,favorites"), "read")).toBe(true);
    expect(scopeSatisfies(parseScopes("read,favorites"), "write")).toBe(false);
    expect(scopeSatisfies(parseScopes("read,write"), "write")).toBe(true);
    expect(scopeSatisfies(parseScopes("read"), "write")).toBe(false);
  });

  it("验收 11c：favorites 令牌 read 门槛 200、write 门槛 403；write 令牌 201", async () => {
    const fav = await mint("read,favorites");
    const wr = await mint("read,write");

    const readOk = await ginject({ method: "GET", url: "/api/jobs", headers: bearer(fav) });
    expect(readOk.statusCode, readOk.body).toBe(200);

    const denied = await ginject({
      method: "POST",
      url: "/api/categories",
      headers: bearer(fav),
      payload: { title: "nope" },
    });
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.json().error).toContain("scope");

    const allowed = await ginject({
      method: "POST",
      url: "/api/categories",
      headers: bearer(wr),
      payload: { title: "gate ok" },
    });
    expect(allowed.statusCode, allowed.body).toBe(201);
  });
});

describe("存量令牌与无 owner 身份不回归", () => {
  it("验收 12：存量 write 令牌仍是全量写", async () => {
    const patched = await inject({
      method: "PATCH",
      url: "/api/me/settings",
      headers: bearer(writeToken),
      payload: { personalizationEnabled: false },
    });
    expect(patched.statusCode).toBe(200);
    expect((await ctx.repo.getUserSettings(WRITE_USER)).updatedAt).toBeGreaterThan(0);
    const synced = await inject({
      method: "POST",
      url: "/api/me/favorites/sync",
      headers: bearer(writeToken),
      payload: { ops: [{ op: "add", siteId: siteA }] },
    });
    expect(synced.statusCode).toBe(200);
  });

  it("验收 13：存量 read 令牌仍只读（403 文案仍是只读）", async () => {
    for (const token of [readToken, legacyReadToken]) {
      const res = await inject({
        method: "POST",
        url: "/api/me/favorites/sync",
        headers: bearer(token),
        payload: { ops: [{ op: "add", siteId: siteA }] },
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error?: string }).error).toContain("只读");
    }
  });

  it("验收 14：BFF/签名身份（无 owner）写收藏与设置均不受影响；无凭据仍 401", async () => {
    const settings = await inject({
      method: "PATCH",
      url: "/api/me/settings",
      headers: headersFor(BFF_USER),
      payload: { personalizationEnabled: false },
    });
    expect(settings.statusCode).toBe(200);
    const sync = await inject({
      method: "POST",
      url: "/api/me/favorites/sync",
      headers: headersFor(BFF_USER),
      payload: { ops: [] },
    });
    expect(sync.statusCode).toBe(200);
    const anon = await inject({
      method: "PATCH",
      url: "/api/me/settings",
      payload: { personalizationEnabled: true },
    });
    expect(anon.statusCode).toBe(401);
  });

  it("验收 15：favorites 令牌的读能力不变", async () => {
    for (const url of ["/api/me", "/api/favorites", "/api/me/tokens"]) {
      const res = await inject({ method: "GET", url, headers: bearer(favToken) });
      expect(res.statusCode, url).toBe(200);
    }
  });
});
