/**
 * 终端用户数据面（收藏 / 历史 / 画像 / 金库 / CRDT / 个人 AI 配置 / 个人中心）的身份轴。
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
 * 清单化：矩阵不再手写 URL，而是从 `app.routeInventory`（注册期 onRoute 同源快照）
 * 按 `PRIVATE_READ_PREFIXES` 派生。前缀下新增 GET 自动进入 401/200 矩阵；
 * 若它其实是公开读，必须写进 `PRIVATE_READ_EXEMPT` 并说明原因，否则矩阵会红。
 *
 * 非空性：把 `identityTrusted` 退回旧的 `identityAllowed`（只看票据），B 组全红；
 * 把闸门整个删掉，A 组全红；把派生改成 `startsWith(prefix)` 无边界匹配，
 * `/api/metrics` 会被 `/api/me` 吞进来，B 组红（见下方边界用例）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";
import type { RouteEntry } from "../src/openapi.ts";

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
let READ_PROBES: Array<{ route: RouteEntry; url: string }> = [];

/** 用户域私有读面的前缀清单（清单化的唯一来源） */
const PRIVATE_READ_PREFIXES = [
  "/api/me",
  "/api/favorites",
  "/api/search-history",
  "/api/profile",
  "/api/vault/sync",
  "/api/crdt/sync",
  "/api/user/ai/config",
] as const;

/**
 * 白名单：确实是公开读、但 URL 落在私有前缀下的例外。
 * 目前为空——以上前缀下的所有 GET 都是私有读面。
 * 新增例外必须写在这里并给出原因，矩阵会校验豁免项仍对应真实路由。
 */
const PRIVATE_READ_EXEMPT = new Map<string, string>();

/** 带路径参数的私有读路由不能原样注入，必须显式给出探针样例 */
const PRIVATE_READ_PARAM_PROBES = new Map<string, string>();

/** 前缀必须按路径段匹配：`/api/me` 不能吞掉 `/api/metrics` */
function underPrefix(url: string, prefix: string): boolean {
  return url === prefix || url.startsWith(prefix + "/");
}

function derivePrivateReadRoutes(
  entries: readonly Pick<RouteEntry, "method" | "url">[],
  options: {
    prefixes: readonly string[];
    exempt: ReadonlyMap<string, string>;
    paramProbes: ReadonlyMap<string, string>;
  } = {
    prefixes: PRIVATE_READ_PREFIXES,
    exempt: PRIVATE_READ_EXEMPT,
    paramProbes: PRIVATE_READ_PARAM_PROBES,
  },
): Array<{ route: Pick<RouteEntry, "method" | "url">; url: string }> {
  const out: Array<{ route: Pick<RouteEntry, "method" | "url">; url: string }> = [];
  for (const route of entries) {
    if (route.method !== "GET") continue;
    if (!options.prefixes.some((prefix) => underPrefix(route.url, prefix))) continue;
    if (options.exempt.has(route.url)) continue;
    if (!route.url.includes(":")) {
      out.push({ route, url: route.url });
      continue;
    }
    const probe = options.paramProbes.get(route.method + " " + route.url);
    if (!probe) {
      throw new Error(
        `私有读路由 ${route.method} ${route.url} 含路径参数，` +
          `请在 PRIVATE_READ_PARAM_PROBES 里给出可注入的探针样例。`,
      );
    }
    out.push({ route, url: probe });
  }
  return out;
}

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

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plane-"));

  ctxA = await createContext(loadConfig({
    ...base, sqlitePath: join(dir, "a.db"), authRequired: true, bootstrapToken: BOOTSTRAP,
  } as never));
  appA = await buildServer(ctxA);
  await appA.ready();
  READ_PROBES = derivePrivateReadRoutes(appA.routeInventory);

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

describe("清单化：私有读面从路由表派生（不再手写 URL 列表）", () => {
  it("路由表快照可用且非空", () => {
    expect(Object.isFrozen(appA.routeInventory)).toBe(true);
    expect(appA.routeInventory.length).toBeGreaterThan(100);
  });

  it("派生覆盖旧六条 + 全部 /api/me 读面（下限 18，防派生悄悄清空）", () => {
    const urls = READ_PROBES.map((probe) => probe.url);
    expect(urls.length).toBeGreaterThanOrEqual(18);
    for (const legacy of [
      "/api/favorites",
      "/api/search-history",
      "/api/profile",
      "/api/vault/sync",
      "/api/crdt/sync",
      "/api/user/ai/config",
    ]) {
      expect(urls).toContain(legacy);
    }
    expect(urls).toContain("/api/me/export/bookmarks.html");
  });

  it("前缀按路径段匹配：/api/metrics 不会被 /api/me 吞进来", () => {
    // 夹具非空：路由表里确实存在一条字符串以 /api/me 开头的公开面邻居
    expect(appA.routeInventory.some((r) => r.method === "GET" && r.url === "/api/metrics")).toBe(true);
    const derived = derivePrivateReadRoutes([
      { method: "GET", url: "/api/metrics" },
      { method: "GET", url: "/api/me" },
      { method: "GET", url: "/api/me/visits" },
      { method: "POST", url: "/api/me/settings" },
    ]);
    expect(derived.map((item) => item.url)).toEqual(["/api/me", "/api/me/visits"]);
  });

  it("白名单豁免生效且不会混进矩阵", () => {
    const derived = derivePrivateReadRoutes(
      [{ method: "GET", url: "/api/profile/public-card" }],
      {
        prefixes: PRIVATE_READ_PREFIXES,
        exempt: new Map([["/api/profile/public-card", "公开名片页"]]),
        paramProbes: new Map(),
      },
    );
    expect(derived).toEqual([]);
  });

  it("陈旧白名单会自爆（豁免必须对应真实 GET 路由且原因非空）", () => {
    const live = new Set(
      appA.routeInventory.filter((route) => route.method === "GET").map((route) => route.url),
    );
    for (const [url, reason] of PRIVATE_READ_EXEMPT) {
      expect(live.has(url), url).toBe(true);
      expect(reason.trim().length, url).toBeGreaterThan(0);
    }
  });

  it("带参数的私有读路由必须给探针样例，否则派生直接抛错", () => {
    expect(() => derivePrivateReadRoutes([{ method: "GET", url: "/api/me/items/:id" }])).toThrow(
      /PRIVATE_READ_PARAM_PROBES/,
    );
  });

  it("派生出的路由仍是 scope=public（身份由处理器两轴判定）", () => {
    const byRoute = new Map(
      appA.routeInventory.map((route) => [route.method + " " + route.url, route]),
    );
    for (const { route } of READ_PROBES) {
      expect(byRoute.get("GET " + route.url)?.scope, route.url).toBe("public");
    }
  });
});

describe("A 鉴权 + 未配置签名密钥：无票自称他人身份一律 401", () => {
  const get = call(() => appA);

  it("派生出的全部私有读面：匿名自称身份 → 401", async () => {
    const failures: string[] = [];
    for (const { url } of READ_PROBES) {
      const res = await get(url + SELF(USER));
      if (res.statusCode !== 401) failures.push(`${url} → ${res.statusCode} ${res.payload.slice(0, 120)}`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("持票调用方照常读取（证明 401 来自闸门）", async () => {
    const failures: string[] = [];
    for (const { url } of READ_PROBES) {
      const res = await get(url + SELF(USER), { token: BOOTSTRAP });
      if (res.statusCode !== 200) failures.push(`${url} → ${res.statusCode} ${res.payload.slice(0, 120)}`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

describe("B 鉴权 + 已配置签名密钥：签名访客是合法一等公民", () => {
  const get = call(() => appB);

  it("派生出的全部私有读面：签名访客 → 200", async () => {
    const failures: string[] = [];
    for (const { url } of READ_PROBES) {
      const res = await get(url, { signed: USER });
      if (res.statusCode !== 200) failures.push(`${url} → ${res.statusCode} ${res.payload.slice(0, 120)}`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

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

  it("派生出的全部私有读面：匿名自称身份 → 200", async () => {
    const failures: string[] = [];
    for (const { url } of READ_PROBES) {
      const res = await get(url + SELF(USER));
      if (res.statusCode !== 200) failures.push(`${url} → ${res.statusCode} ${res.payload.slice(0, 120)}`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
