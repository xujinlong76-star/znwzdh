/**
 * 搜索请求只能有一个身份（run53）。
 *
 * 改前 /api/search 里并存两套取法：
 *  - 个性化 / 搜索历史：`input.userId ?? input.anonId`（只看 Body/Query）；
 *  - 事件归属：`requestIdentityOf`（用户级令牌 owner 优先，其次 Header→Query→Body）。
 * 两者不一致时，同一次请求可以「按 A 的画像重排、把行为记进 B 的可删除列」：
 * 签名 Header=USER + body anonId=OTHER 时，排序用 OTHER、事件记 USER；
 * 个人令牌 owner=USER + body userId=OTHER 时，排序用 OTHER、事件记 USER。
 * 反过来，只有签名 Header 的调用方（扩展/脚本形态）个性化恒不生效——画像被完全忽略。
 *
 * 本轮口径：一个 identity 同时服务三个消费者，且身份必须过 `identityTrusted` 才
 * 允许读画像 / 写历史（鉴权模式下的匿名自称不能借排序结果反推他人偏好）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SearchQuery, SearchResult } from "@navhub/core";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";
import { generateToken, hashToken } from "../src/auth.ts";

const SECRET = "test-secret-please-rotate";
const USER = "github:u-search-ident";
const OTHER = "github:u-search-ident-other";
const TOKEN_USER = "github:u-search-token-owner";
const VICTIM = "github:u-search-victim";

const Q_HEADER_BODY = "identityattr-header-body";
const Q_TOKEN_BODY = "identityattr-token-body";
const Q_ANON = "identityattr-anon";
const Q_RANK = "identityrank";

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
let authDir: string;
let authCtx: AppContext;
let authApp: Awaited<ReturnType<typeof buildServer>>;
let catA: { id: string };
let catB: { id: string };

const signed = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

const profile = (userId: string, categoryId: string) => ({
  userId,
  topCategories: [categoryId],
  topTags: [],
  visitedSiteIds: [],
  favoriteSiteIds: [],
  searchCount: 0,
  updatedAt: Date.now(),
});

function spyProfiles(
  c: AppContext,
  map: Record<string, ReturnType<typeof profile> | null>,
): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const spy = vi.spyOn(c.repo, "getUserProfile").mockImplementation(async (userId: string) => {
    calls.push(userId);
    return map[userId] ?? null;
  });
  return { calls, restore: () => spy.mockRestore() };
}

function captureSearch(c: AppContext): { inputs: SearchQuery[]; restore: () => void } {
  const inputs: SearchQuery[] = [];
  const original = c.search.search.bind(c.search);
  const spy = vi.spyOn(c.search, "search").mockImplementation(async (input: SearchQuery): Promise<SearchResult> => {
    inputs.push(input);
    return original(input);
  });
  return { inputs, restore: () => spy.mockRestore() };
}

async function historyOwners(c: AppContext, q: string): Promise<string[]> {
  const rows = (await c.repo.raw(
    "SELECT user_id FROM search_history WHERE query = ? ORDER BY id",
    [q],
  )) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

async function eventIdentities(c: AppContext, q: string): Promise<Array<string | null>> {
  const rows = (await c.repo.raw(
    "SELECT identity FROM events WHERE query = ? ORDER BY id",
    [q],
  )) as Array<{ identity: string | null }>;
  return rows.map((r) => r.identity);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-search-ident-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "ident.db"), identitySecret: SECRET }));
  app = await buildServer(ctx);
  await app.ready();
  catA = await ctx.repo.createCategory({ title: "身份一致性 A 类目" });
  catB = await ctx.repo.createCategory({ title: "身份一致性 B 类目" });
  await ctx.repo.createSite({ url: "https://identity-rank-a.example.com", title: "identityrank 个性化站点 A", categoryId: catA.id });
  await ctx.repo.createSite({ url: "https://identity-rank-b.example.com", title: "identityrank 个性化站点 B", categoryId: catB.id });

  // 鉴权模式 + 未配置签名密钥：匿名自称身份不可信的那一档
  authDir = mkdtempSync(join(tmpdir(), "navhub-search-ident-auth-"));
  authCtx = await createContext(loadConfig({ ...base, sqlitePath: join(authDir, "ident-auth.db"), authRequired: true }));
  authApp = await buildServer(authCtx);
  await authApp.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  await authApp.close();
  await authCtx.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(authDir, { recursive: true, force: true });
});

describe("搜索请求的单一身份口径", () => {
  it("签名 Header 与 Body 冲突：画像、历史、事件全部用 Header 那个", async () => {
    const prof = spyProfiles(ctx, { [USER]: profile(USER, catA.id), [OTHER]: profile(OTHER, catB.id) });
    const cap = captureSearch(ctx);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/search",
        headers: signed(USER),
        payload: { q: Q_HEADER_BODY, anonId: OTHER },
      });
      expect(res.statusCode).toBe(200);
      expect(prof.calls).toEqual([USER]);
      expect(cap.inputs[cap.inputs.length - 1]?.personalize?.topCategories).toEqual([catA.id]);
      expect(await historyOwners(ctx, Q_HEADER_BODY)).toEqual([USER]);
      const ids = await eventIdentities(ctx, Q_HEADER_BODY);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((id) => id === USER)).toBe(true);
    } finally {
      cap.restore();
      prof.restore();
    }
  });

  it("个人令牌 owner 与 Body 冲突：画像、历史、事件全部用 owner", async () => {
    const raw = generateToken();
    await ctx.repo.createApiToken({
      name: "identity-owner",
      tokenHash: hashToken(raw),
      scopes: "read,write",
      ownerIdentity: TOKEN_USER,
    });
    const prof = spyProfiles(ctx, {
      [TOKEN_USER]: profile(TOKEN_USER, catA.id),
      [OTHER]: profile(OTHER, catB.id),
    });
    const cap = captureSearch(ctx);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/search",
        headers: { authorization: `Bearer ${raw}` },
        payload: { q: Q_TOKEN_BODY, userId: OTHER },
      });
      expect(res.statusCode).toBe(200);
      expect(prof.calls).toEqual([TOKEN_USER]);
      expect(cap.inputs[cap.inputs.length - 1]?.personalize?.topCategories).toEqual([catA.id]);
      expect(await historyOwners(ctx, Q_TOKEN_BODY)).toEqual([TOKEN_USER]);
      const ids = await eventIdentities(ctx, Q_TOKEN_BODY);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((id) => id === TOKEN_USER)).toBe(true);
    } finally {
      cap.restore();
      prof.restore();
    }
  });

  it("鉴权模式匿名自称：不读画像、不写历史、事件留 NULL", async () => {
    const prof = spyProfiles(authCtx, { [VICTIM]: profile(VICTIM, catA.id) });
    try {
      const res = await authApp.inject({
        method: "POST",
        url: "/api/search",
        payload: { q: Q_ANON, userId: VICTIM },
      });
      expect(res.statusCode).toBe(200);
      expect(prof.calls).toEqual([]);
      expect(await historyOwners(authCtx, Q_ANON)).toEqual([]);
      const ids = await eventIdentities(authCtx, Q_ANON);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((id) => id === null)).toBe(true);
    } finally {
      prof.restore();
    }
  });

  it("排序回归：不同身份拿到各自画像对应的首条结果", async () => {
    const prof = spyProfiles(ctx, { [USER]: profile(USER, catA.id), [OTHER]: profile(OTHER, catB.id) });
    try {
      const asUser = await app.inject({
        method: "POST",
        url: "/api/search",
        headers: signed(USER),
        payload: { q: Q_RANK },
      });
      const asOther = await app.inject({
        method: "POST",
        url: "/api/search",
        headers: signed(OTHER),
        payload: { q: Q_RANK },
      });
      expect(asUser.statusCode).toBe(200);
      expect(asOther.statusCode).toBe(200);
      const userHits = (asUser.json() as { hits: Array<{ site?: { categoryId?: string } }> }).hits;
      const otherHits = (asOther.json() as { hits: Array<{ site?: { categoryId?: string } }> }).hits;
      expect(userHits.length).toBeGreaterThanOrEqual(2);
      expect(otherHits.length).toBeGreaterThanOrEqual(2);
      expect(userHits[0]?.site?.categoryId).toBe(catA.id);
      expect(otherHits[0]?.site?.categoryId).toBe(catB.id);
    } finally {
      prof.restore();
    }
  });
});
