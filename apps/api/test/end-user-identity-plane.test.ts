/**
 * 终端用户数据面（收藏 / 历史 / 画像 / 金库 / CRDT / 个人 AI 配置）的身份轴。
 *
 * 这些路由全是 `scope:"public"` + 自报身份，闸门只有一个作用：
 * 在「鉴权开着、签名没配」的部署里阻止无票调用方冒充他人（IDOR）。
 * 但闸门此前只看票据轴（`identityAllowed`：`authRequired` 开就要求非匿名），
 * 于是把 `/api/hub/*` 代理**专门为其设计**的那类调用方也一起拦了：
 * 公共站的匿名访客没有 token，只有代理替他签好的 `x-navhub-identity-signature`。
 * 结果 `NAVHUB_AUTH_REQUIRED=1` + `NAVHUB_IDENTITY_SECRET=…`（生产多用户形态）下
 * 所有访客的收藏夹/历史/金库恒 401——功能整片失效。
 *
 * 现在按两轴判定（`identityTrusted`）：持票 **或** 身份已被 HMAC 绑定。
 * 安全性不降：配了密钥时，签名不对的请求在 preValidation 就 401（见
 * `identity-signature.test.ts`），能走到路由的身份已经是不可伪造的。
 *
 * 三套配置的口径：
 *   A 鉴权 + 无签名密钥 → 无票自称他人身份必须 401（IDOR 阻断，本文件的主案）
 *   B 鉴权 + 签名密钥   → 签名访客必须 200（不许把生产形态锁死）
 *   C 开放模式          → 与历史版本一致
 *
 * 非空性：把 `identityTrusted` 退回旧的 `identityAllowed`（只看票据），B 组全红；
 * 把闸门整个删掉，A 组全红。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

const BOOTSTRAP = "plane-boot-token";
const SECRET = "plane-signature-secret";
const USER = "anon-user-1001";

const base = {
  mode: "lite" as const,
  embedding: { model: "none", endpoint: "", dtype: "q8" as const, dim: 512, cacheDir: join(tmpdir(), "navhub-plane-models"), enabled: false },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 1500, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubPlaneTest/0.1" },
  corsOrigins: ["*"],
};

type App = Awaited<ReturnType<typeof buildServer>>;
const SELF = (identity: string) => `?anonId=${identity}`;

let dir: string;
let ctxA: AppContext, appA: App;
let ctxB: AppContext, appB: App;
let ctxC: AppContext, appC: App;

const call = (getApp: () => App) =>
  async (url: string, opts: { signed?: string; token?: string } = {}) =>
    getApp().inject({
      method: "GET",
      url,
      headers: {
        ...(opts.token ? { authorization: "Bearer " + opts.token } : {}),
        ...(opts.signed
          ? { "x-navhub-anon-id": opts.signed, "x-navhub-identity-signature": signIdentity(SECRET, opts.signed) }
          : {}),
      },
    });

/** 终端用户私有视图读取面：六条 GET 覆盖六个域 */
const READ_URLS = [
  "/api/favorites",
  "/api/search-history",
  "/api/profile",
  "/api/vault/sync",
  "/api/crdt/sync",
  "/api/user/ai/config",
];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plane-"));

  ctxA = await createContext(loadConfig({
    ...base, sqlitePath: join(dir, "a.db"), authRequired: true, bootstrapToken: BOOTSTRAP,
  } as never));
  appA = await buildServer(ctxA);
  await appA.ready();

  ctxB = await createContext(loadConfig({
    ...base, sqlitePath: join(dir, "b.db"), authRequired: true, bootstrapToken: BOOTSTRAP, identitySecret: SECRET,
  } as never));
  appB = await buildServer(ctxB);
  await appB.ready();

  ctxC = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "c.db") } as never));
  appC = await buildServer(ctxC);
  await appC.ready();
});

afterAll(async () => {
  for (const [app, ctx] of [[appA, ctxA], [appB, ctxB], [appC, ctxC]] as const) {
    await app?.close();
    await ctx?.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("A 鉴权 + 未配置签名密钥：无票自称他人身份一律 401", () => {
  const get = call(() => appA);

  for (const url of READ_URLS) {
    it(url + " 匿名自称身份 → 401", async () => {
      const res = await get(url + SELF(USER));
      expect(res.statusCode).toBe(401);
    });
  }

  it("持票调用方照常读取（证明 401 来自闸门）", async () => {
    for (const url of READ_URLS) {
      const res = await get(url + SELF(USER), { token: BOOTSTRAP });
      expect(res.statusCode, url + " " + res.payload).toBe(200);
    }
  });
});

describe("B 鉴权 + 已配置签名密钥：签名访客是合法一等公民", () => {
  const get = call(() => appB);

  for (const url of READ_URLS) {
    it(url + " 签名访客 → 200", async () => {
      const res = await get(url, { signed: USER });
      expect(res.statusCode, res.payload).toBe(200);
    });
  }

  it("签名访客写入收藏 → 成功，且只有签名者自己能读回", async () => {
    // 写入口只接受叶子（G2），夹具照真树形建一个「根 + 叶」
    await ctxB.repo.createCategory({ id: "cat-plane-root", title: "身份轴根" });
    await ctxB.repo.createCategory({ id: "cat-plane", title: "身份轴类目", parentId: "cat-plane-root" });
    const site = await appB.inject({
      method: "POST",
      url: "/api/sites",
      headers: { authorization: "Bearer " + BOOTSTRAP },
      payload: { url: "https://plane-fixture.example.com", title: "身份轴夹具站点", categoryId: "cat-plane" },
    });
    expect(site.statusCode, site.payload).toBe(201);
    const siteId = (site.json() as { id: string }).id;

    const add = await appB.inject({
      method: "POST",
      url: "/api/favorites",
      headers: { "x-navhub-anon-id": USER, "x-navhub-identity-signature": signIdentity(SECRET, USER) },
      payload: { siteId },
    });
    expect(add.statusCode, add.payload).toBeLessThan(300);

    const mine = await get("/api/favorites", { signed: USER });
    expect(((mine.json() as { items: unknown[] }).items).length).toBe(1);

    // 另一个签名访客读不到：签名只绑得住自己的身份
    const other = await get("/api/favorites", { signed: "anon-user-2002" });
    expect(((other.json() as { items: unknown[] }).items).length).toBe(0);
  });

  it("带身份但不带签名 → 401（放宽的只是「签名过的匿名」）", async () => {
    const res = await get("/api/favorites" + SELF(USER));
    expect(res.statusCode).toBe(401);
  });

  it("签名不匹配（拿别人的签名用自己的身份）→ 401", async () => {
    const res = await appB.inject({
      method: "GET",
      url: "/api/favorites",
      headers: {
        "x-navhub-anon-id": "anon-user-3003",
        "x-navhub-identity-signature": signIdentity(SECRET, USER),
      },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("C 开放模式：存量行为零变化", () => {
  const get = call(() => appC);

  for (const url of READ_URLS) {
    it(url + " 匿名自称身份 → 200", async () => {
      const res = await get(url + SELF(USER));
      expect(res.statusCode, res.payload).toBe(200);
    });
  }
});
