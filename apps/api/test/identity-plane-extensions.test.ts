/**
 * 身份轴第八轮的三个补充现场：AI 用量借用、用户中心注销、工作空间名册。
 *
 * 共同点：这些路由都是 `scope:"public"`（或干脆没写 scope，缺省即 public），
 * 调用方身份完全靠 `identityOf` 自报。第一版收紧（只看 Bearer 票）在
 * 「鉴权开着 + 配了签名密钥」的生产多用户形态下会把签名访客整片拦死；
 * 现在的口径是两轴（`identityTrusted`：开放模式 / 持票 / 身份已被 HMAC 绑定）。
 *
 * 这里锁三件事：
 *  1. `/api/copilot/chat`：无票调用方自称他人 → 只能用系统级模型配置，
 *     不会去解他人存的 API Key（`llm_usage` 里不出现他人身份的用量）。
 *  2. `/api/me*`：无票自称他人 → 401。修复前匿名可以 `GET /api/me/export`
 *     拖走任意用户全部个人数据，也能 `DELETE /api/me` 直接注销他人。
 *  3. `/api/workspaces/:id/members`：名册按调用方隔离。修复前键是全局的
 *     `ws_members:<wsId>`，而预设空间（含「个人私有空间」）对每个身份都发
 *     owner/maintainer，任何人都能改写别人看到的名单。
 *
 * 非空性：删掉 copilot / me 的闸门、或把名册键退回 `ws_members:<wsId>`，
 * 对应断言立刻变红；三处都由 `.audit-scratch` 的消融脚本实测验证过。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";
import { encryptGenericPayload } from "@navhub/core";

const BOOTSTRAP = "borrow-boot-token";
const SECRET = "borrow-signature-secret";
const SESSION = "borrow-session-secret";
/** 与 apps/api/src/llm-config.ts 里的 SECRET_TYPE 一致：口令对不上就解不开 */
const SECRET_TYPE = "llm-api-key";
const VICTIM = "anon-victim-7001";
const VICTIM2 = "anon-victim-7002";
const OUTSIDER = "anon-outsider-7003";
/** 本地黑洞端口：连接立即被拒，用不到真实外呼 */
const VICTIM_BASE_URL = "http://127.0.0.1:9/v1";

const base = {
  mode: "lite" as const,
  embedding: { model: "none", endpoint: "", dtype: "q8" as const, dim: 512, cacheDir: join(tmpdir(), "navhub-borrow-models"), enabled: false },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 1500 },
  fetch: { timeoutMs: 1500, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubBorrowTest/0.1" },
  corsOrigins: ["*"],
};

type App = Awaited<ReturnType<typeof buildServer>>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

let dir: string;
let ctxA: AppContext, appA: App;
let ctxB: AppContext, appB: App;

const SELF = (identity: string) => `?anonId=${identity}`;
const signedHeaders = (identity: string) => ({
  "x-navhub-anon-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

function mkSend(getApp: () => App) {
  return async (
    method: Method,
    url: string,
    opts: { token?: string; signed?: string; payload?: unknown } = {},
  ) =>
    getApp().inject({
      method,
      url,
      payload: opts.payload as never,
      headers: {
        ...(opts.token ? { authorization: "Bearer " + opts.token } : {}),
        ...(opts.signed ? signedHeaders(opts.signed) : {}),
      },
    });
}

/** llm_usage 里某个身份名下的用量行（成功与失败都会记账，所以借用一定留痕） */
async function usageRows(ctx: AppContext, identity: string): Promise<Array<{ source: string; scenario: string }>> {
  return (await ctx.db.sqlite!
    .prepare("SELECT source, scenario FROM llm_usage WHERE identity = ?")
    .all(identity)) as Array<{ source: string; scenario: string }>;
}

async function seedUserLlmConfig(ctx: AppContext, identity: string) {
  // 走库而不是走 PUT /api/user/ai/config：那条路由会用 assertLlmEndpoint 探端点，
  // 夹具需要一个「存在且能解密」的个人配置，不需要它真的连通。
  const apiKeyEnc = await encryptGenericPayload("sk-victim-secret-key", SESSION, SECRET_TYPE);
  await ctx.repo.upsertUserLlmConfig(identity, {
    enabled: true,
    name: "受害者个人模型",
    baseUrl: VICTIM_BASE_URL,
    model: "victim-private-model",
    apiKeyEnc,
    timeoutMs: 1200,
    temperature: 0.6,
    maxTokens: 256,
    jsonMode: "auto",
    thinking: false,
    allowPrivateNetwork: false,
    fallbacks: [],
    updatedAt: Date.now(),
    updatedBy: identity,
  } as never);
  expect(await ctx.repo.getUserLlmConfig(identity)).not.toBeNull();
}

async function seedFavorites(ctx: AppContext, identity: string, count: number): Promise<number> {
  let created = 0;
  for (let i = 0; i < count; i += 1) {
    const site = await ctx.repo.createSite({
      url: `https://borrow-fixture-${identity}-${i}.example.com`,
      title: "身份借用夹具站点 " + i,
      categoryId: "cat-borrow",
    });
    await ctx.repo.addFavorite({ userId: identity, siteId: site.id });
    created += 1;
  }
  return created;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-borrow-"));

  ctxA = await createContext(loadConfig({
    ...base, sqlitePath: join(dir, "a.db"), authRequired: true, bootstrapToken: BOOTSTRAP, sessionSecret: SESSION,
  } as never));
  appA = await buildServer(ctxA);
  await appA.ready();

  ctxB = await createContext(loadConfig({
    ...base, sqlitePath: join(dir, "b.db"), authRequired: true, bootstrapToken: BOOTSTRAP, identitySecret: SECRET, sessionSecret: SESSION,
  } as never));
  appB = await buildServer(ctxB);
  await appB.ready();

  await ctxA.repo.createCategory({ id: "cat-borrow", title: "身份借用测试类目" });
  await seedUserLlmConfig(ctxA, VICTIM);
  await seedFavorites(ctxA, VICTIM, 2);
  await seedFavorites(ctxA, VICTIM2, 3);
});

afterAll(async () => {
  for (const [app, ctx] of [[appA, ctxA], [appB, ctxB]] as const) {
    await app?.close();
    await ctx?.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ *
 * 1. AI 用量借用：copilot 是 public 路由，自报身份会解他人密钥
 * ------------------------------------------------------------------ */

describe("copilot：无票自称他人不能借用他人的模型密钥", () => {
  const send = mkSend(() => appA);

  it("夹具确认：受害者个人配置存在且可用（否则下面的 0 行是空的）", async () => {
    const stored = await ctxA.repo.getUserLlmConfig(VICTIM);
    expect(stored, "个人模型配置没写进去").not.toBeNull();
    expect(stored!.provider.enabled).toBe(true);
    expect(stored!.provider.model).toBe("victim-private-model");
  });

  it("无票自称受害者发起对话 → 200 兜底应答，且受害者的用量计数为 0", async () => {
    const res = await send("POST", "/api/copilot/chat" + SELF(VICTIM), { payload: { message: "推荐前端工具" } });
    expect(res.statusCode, res.payload).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(await usageRows(ctxA, VICTIM)).toHaveLength(0);
  });

  it("对照组：同一个调用带 Bearer 票时，借用链是真实可走的（证明上一条不是空跑）", async () => {
    const res = await send("POST", "/api/copilot/chat" + SELF(VICTIM), { payload: { message: "推荐前端工具" }, token: BOOTSTRAP });
    expect(res.statusCode, res.payload).toBe(200);
    const rows = await usageRows(ctxA, VICTIM);
    expect(rows.length, "持票调用没有走个人配置，说明夹具或解析链没生效").toBeGreaterThan(0);
    expect(rows.some((r) => r.source === "user" && r.scenario === "copilot")).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 2. /api/me*：数据主权端点必须认第二轴
 * ------------------------------------------------------------------ */

describe("用户中心：无票自称他人一律 401", () => {
  const send = mkSend(() => appA);

  it("GET /api/me/export 不能匿名拖走他人全部个人数据", async () => {
    const res = await send("GET", "/api/me/export" + SELF(VICTIM));
    expect(res.statusCode).toBe(401);
    expect(res.payload).not.toContain("favorites");
  });

  it("GET /api/me 与 /api/me/settings 同样被拦", async () => {
    expect((await send("GET", "/api/me" + SELF(VICTIM))).statusCode).toBe(401);
    expect((await send("GET", "/api/me/settings" + SELF(VICTIM))).statusCode).toBe(401);
    expect((await send("PATCH", "/api/me/settings" + SELF(VICTIM), { payload: { personalizationEnabled: false } })).statusCode).toBe(401);
  });

  it("DELETE /api/me 不能匿名注销他人：他人收藏原样保留", async () => {
    const before = (await ctxA.repo.listFavorites(VICTIM2)).length;
    expect(before).toBe(3);
    const res = await send("DELETE", "/api/me" + SELF(VICTIM2), { payload: { confirm: "DELETE" } });
    expect(res.statusCode).toBe(401);
    expect((await ctxA.repo.listFavorites(VICTIM2)).length).toBe(before);
  });

  it("对照组：持票调用方可以导出（401 来自闸门而不是路由不可达）", async () => {
    const res = await send("GET", "/api/me/export" + SELF(VICTIM), { token: BOOTSTRAP });
    expect(res.statusCode, res.payload).toBe(200);
    expect((res.json() as { favorites: unknown[] }).favorites).toHaveLength(2);
  });

  it("对照组：被签名绑定的访客能读到自己（不许把生产形态锁死）", async () => {
    const res = await mkSend(() => appB)("GET", "/api/me", { signed: OUTSIDER });
    expect(res.statusCode, res.payload).toBe(200);
  });
});

/* ------------------------------------------------------------------ *
 * 3. 工作空间名册：预设空间的角色人人都有，键就不能是全局的
 * ------------------------------------------------------------------ */

describe("工作空间名册：按调用方隔离", () => {
  const send = mkSend(() => appB);

  it("签名访客能读写自己的名册", async () => {
    const add = await send("POST", "/api/workspaces/ws-personal/members", {
      signed: VICTIM,
      payload: { username: "只在受害者名单里的人", role: "member" },
    });
    expect(add.statusCode, add.payload).toBe(200);
    expect(((add.json() as { members: Array<{ username: string }> }).members)
      .some((m) => m.username === "只在受害者名单里的人")).toBe(true);
  });

  it("另一个签名访客读「个人私有空间」看不到上面那条（修复前是全局键，直接串号）", async () => {
    const res = await send("GET", "/api/workspaces/ws-personal/members", { signed: OUTSIDER });
    expect(res.statusCode, res.payload).toBe(200);
    const names = ((res.json() as { members: Array<{ username: string }> }).members).map((m) => m.username);
    expect(names).not.toContain("只在受害者名单里的人");
  });

  it("名册写在带身份的键下，全局键不再被任何调用方写", async () => {
    expect(await ctxB.repo.getUserVault("ws_members:" + VICTIM + ":ws-personal")).not.toBeNull();
    expect(await ctxB.repo.getUserVault("ws_members:ws-personal")).toBeNull();
  });

  it("无票自称身份仍然一律 401（第一轴没被放宽）", async () => {
    for (const [method, url] of [
      ["GET", "/api/workspaces" + SELF(VICTIM)],
      ["GET", "/api/workspaces/ws-personal/members" + SELF(VICTIM)],
      ["POST", "/api/workspaces/ws-personal/members" + SELF(VICTIM)],
    ] as const) {
      const res = await mkSend(() => appA)(method, url, { payload: { username: "串号者", role: "member" } });
      expect(res.statusCode, method + " " + url).toBe(401);
    }
  });
});
