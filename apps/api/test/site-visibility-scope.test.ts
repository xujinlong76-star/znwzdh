import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

/**
 * 站点列表的「数据面最小化」回归。
 *
 * 背景：`GET /api/sites` 是 `scope:"read"`。鉴权模式下任何 read 令牌都能调，
 * 原实现因此把 pending（待审）与 archived（已归档）站点一并返回——那是编辑
 * 工作面的中间态：可能还没上线，或已下架。只读集成方拿到它们既无用途，
 * 也让「库里有什么」这件事对最低权限的调用方完全透明。
 *
 * 三套配置各自的口径（缺一不可）：
 *   A 鉴权 + read 令牌     → 看不到 pending/archived；显式查这两种状态返回空集
 *   B 鉴权 + 管理/bootstrap → 全量可见（管理面不许被这次收紧影响）
 *   C 开放模式（默认）      → 与历史版本逐字节一致（个人/NAS 本机即管理面）
 *
 * 非空性：把 `canSeeUnpublishedSites` 改成恒真，A 组立刻失败；改成恒假，
 * B/C 两组失败。
 */
const BOOTSTRAP = "site-visibility-boot";
const READ_TOKEN = "site-visibility-read-token";

const base = {
  mode: "lite" as const,
  embedding: {
    model: "none",
    endpoint: "",
    dtype: "q8" as const,
    dim: 512,
    cacheDir: join(tmpdir(), "navhub-visibility-models"),
    enabled: false,
  },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 1500, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubVisibilityTest/0.1" },
  corsOrigins: ["*"],
};

type App = Awaited<ReturnType<typeof buildServer>>;

let dir: string;
let ctxA: AppContext, appA: App;
let ctxB: AppContext, appB: App;
let ctxC: AppContext, appC: App;
let readToken = "";

/** 每个实例都有：active / pending / archived 三个站点 + 一个分类 */
async function seed(ctx: AppContext) {
  const cat = await ctx.repo.createCategory({ title: "可见性测试类目" });
  await ctx.repo.createSite({ url: "https://visible.example.com", title: "已上线", categoryId: cat.id, status: "active" });
  await ctx.repo.createSite({ url: "https://pending.example.com", title: "待审", categoryId: cat.id, status: "pending" });
  await ctx.repo.createSite({ url: "https://archived.example.com", title: "已归档", categoryId: cat.id, status: "archived" });
}

const urlsOf = (res: { json: () => unknown }) =>
  (res.json() as Array<{ url: string }>).map((s) => s.url);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-visibility-"));

  ctxA = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "a.db"), authRequired: true, bootstrapToken: BOOTSTRAP } as never),
  );
  appA = await buildServer(ctxA);
  await appA.ready();
  await seed(ctxA);

  // read 令牌：用 bootstrap 建，scope 只给 read
  const created = await appA.inject({
    method: "POST",
    url: "/api/tokens",
    headers: { authorization: "Bearer " + BOOTSTRAP, "content-type": "application/json" },
    payload: { name: READ_TOKEN, scopes: "read" },
  });
  expect(created.statusCode).toBe(201);
  readToken = created.json().token as string;

  ctxB = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "b.db"), authRequired: true, bootstrapToken: BOOTSTRAP } as never),
  );
  appB = await buildServer(ctxB);
  await appB.ready();
  await seed(ctxB);

  ctxC = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "c.db") } as never));
  appC = await buildServer(ctxC);
  await appC.ready();
  await seed(ctxC);
});

afterAll(async () => {
  for (const [app, ctx] of [[appA, ctxA], [appB, ctxB], [appC, ctxC]] as const) {
    await app?.close();
    await ctx?.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("站点列表：pending/archived 只对管理面可见", () => {
  it("A 鉴权 + read 令牌：默认列表不含待审与已归档", async () => {
    const res = await appA.inject({
      method: "GET",
      url: "/api/sites?limit=100",
      headers: { authorization: "Bearer " + readToken },
    });
    expect(res.statusCode).toBe(200);
    const urls = urlsOf(res);
    expect(urls).toContain("https://visible.example.com");
    expect(urls).not.toContain("https://pending.example.com");
    expect(urls).not.toContain("https://archived.example.com");
  });

  it("A 鉴权 + read 令牌：显式查 pending/archived 返回空集（不泄露存在性）", async () => {
    for (const status of ["pending", "archived"]) {
      const res = await appA.inject({
        method: "GET",
        url: `/api/sites?status=${status}`,
        headers: { authorization: "Bearer " + readToken },
      });
      expect(res.statusCode).toBe(200);
      expect(urlsOf(res)).toEqual([]);
    }
  });

  it("A 鉴权 + read 令牌：active/broken 仍可显式查询（公开数据面不收紧）", async () => {
    const res = await appA.inject({
      method: "GET",
      url: "/api/sites?status=active",
      headers: { authorization: "Bearer " + readToken },
    });
    expect(urlsOf(res)).toEqual(["https://visible.example.com"]);
  });

  it("B 鉴权 + 管理令牌：三种状态全量可见", async () => {
    const res = await appB.inject({
      method: "GET",
      url: "/api/sites?limit=100",
      headers: { authorization: "Bearer " + BOOTSTRAP },
    });
    const urls = urlsOf(res);
    expect(urls).toContain("https://visible.example.com");
    expect(urls).toContain("https://pending.example.com");
    expect(urls).toContain("https://archived.example.com");
  });

  it("B 鉴权 + 管理令牌：显式查 pending 仍可用（后台筛选不许被破坏）", async () => {
    const res = await appB.inject({
      method: "GET",
      url: "/api/sites?status=pending",
      headers: { authorization: "Bearer " + BOOTSTRAP },
    });
    expect(urlsOf(res)).toEqual(["https://pending.example.com"]);
  });

  it("C 开放模式：与历史行为一致，三种状态都返回", async () => {
    const res = await appC.inject({ method: "GET", url: "/api/sites?limit=100" });
    const urls = urlsOf(res);
    expect(urls).toContain("https://visible.example.com");
    expect(urls).toContain("https://pending.example.com");
    expect(urls).toContain("https://archived.example.com");
  });
});
