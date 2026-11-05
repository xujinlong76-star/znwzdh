/**
 * `/api/storage` 的读可见性（升级改造方案 P1-6）。
 *
 * 背景：`GET /api/storage?path=navigation.json` 是 `scope:"read"`，而快照投影
 * 刻意不过滤 `enabled` / 状态 —— 它是后台「读-改-写」的数据源，过滤会让写回
 * 把停用记录当成「用户删了」。但同一个端点也直接面向 read 令牌/匿名调用方，
 * 于是后台态（停用类目、停用站点、pending/archived）对最低权限调用方完全透明。
 *
 * 这一轮的口径：
 *   A 鉴权 + read 令牌     → 只能拿到 public 投影（过滤停用与未发布状态）
 *   B 鉴权 + 管理凭据     → 原始快照（写回数据源，内容一行不少）
 *   C 开放模式（默认）      → 保持历史行为（本机即管理面）
 *   D 显式 `view=public`   → 管理员也能核对匿名视角
 *
 * 非空性：把 public 投影改成恒等投影，A/D 失败；把 raw 也过滤掉，B 失败。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { invalidateSnapshotCache } from "../src/storage.ts";

const BOOTSTRAP = "storage-visibility-boot";
const READ_TOKEN = "storage-visibility-read-token";
const NAV = "src/navsphere/content/navigation.json";

const base = {
  mode: "lite" as const,
  embedding: {
    model: "none",
    endpoint: "",
    dtype: "q8" as const,
    dim: 512,
    cacheDir: join(tmpdir(), "navhub-storage-vis-models"),
    enabled: false,
  },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 1500, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubStorageVisTest/0.1" },
  corsOrigins: ["*"],
};

type App = Awaited<ReturnType<typeof buildServer>>;

let dir: string;
let ctxAuth: AppContext, appAuth: App;
let ctxOpen: AppContext, appOpen: App;
let readToken = "";

/** 快照缓存是模块级的：两个上下文共用进程时必须显式失效，否则读到对方的库 */
async function getSnapshot(app: App, headers: Record<string, string> = {}, query = ""): Promise<any> {
  invalidateSnapshotCache();
  const res = await app.inject({
    method: "GET",
    url: "/api/storage?path=" + encodeURIComponent(NAV) + query,
    headers,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

/** 快照里出现的所有站点 id（顶级 items + 子类目 items） */
function itemIds(data: any): string[] {
  const out: string[] = [];
  for (const top of data.navigationItems ?? []) {
    for (const item of top.items ?? []) out.push(item.id);
    for (const sub of top.subCategories ?? []) for (const item of sub.items ?? []) out.push(item.id);
  }
  return out.sort();
}

function categoryIds(data: any): string[] {
  const out: string[] = [];
  for (const top of data.navigationItems ?? []) {
    out.push(top.id);
    for (const sub of top.subCategories ?? []) out.push(sub.id);
  }
  return out.sort();
}

async function seed(ctx: AppContext) {
  await ctx.repo.createCategory({ id: "sv-cat", title: "可见类目", sort: 1, source: "api" });
  await ctx.repo.createCategory({ id: "sv-sub", title: "可见子类", parentId: "sv-cat", sort: 2, source: "api" });
  await ctx.repo.createCategory({ id: "sv-hidden-cat", title: "停用类目", sort: 3, source: "api" });
  await ctx.repo.updateCategory("sv-hidden-cat", { enabled: false });
  await ctx.repo.createCategory({ id: "sv-hidden-sub", title: "停用子类", parentId: "sv-cat", sort: 4, source: "api" });
  await ctx.repo.updateCategory("sv-hidden-sub", { enabled: false });

  const site = (id: string, categoryId: string, extra: Record<string, unknown> = {}) =>
    ctx.repo.createSiteWithId({
      id,
      url: "https://" + id + ".example.com",
      title: id,
      categoryId,
      source: "api",
      ...extra,
    } as never);

  await site("sv-active", "sv-cat");
  await site("sv-broken", "sv-cat", { status: "broken" });
  await site("sv-pending", "sv-cat", { status: "pending" });
  await site("sv-archived", "sv-cat", { status: "archived" });
  await site("sv-disabled", "sv-cat", { enabled: false });
  await site("sv-sub-site", "sv-sub");
  await site("sv-hidden-site", "sv-hidden-cat");
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-storage-visibility-"));

  ctxAuth = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "auth.db"), authRequired: true, bootstrapToken: BOOTSTRAP } as never),
  );
  appAuth = await buildServer(ctxAuth);
  await appAuth.ready();
  await seed(ctxAuth);

  const created = await appAuth.inject({
    method: "POST",
    url: "/api/tokens",
    headers: { authorization: "Bearer " + BOOTSTRAP, "content-type": "application/json" },
    payload: { name: READ_TOKEN, scopes: "read" },
  });
  expect(created.statusCode, created.body).toBe(201);
  readToken = created.json().token as string;

  ctxOpen = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "open.db") } as never));
  appOpen = await buildServer(ctxOpen);
  await appOpen.ready();
  await seed(ctxOpen);
});

afterAll(async () => {
  for (const [app, ctx] of [[appAuth, ctxAuth], [appOpen, ctxOpen]] as const) {
    await app?.close();
    await ctx?.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("导航快照的读可见性", () => {
  it("A 鉴权 + read 令牌：只拿到 public 投影（停用类目/停用站点/未发布状态全部不可见）", async () => {
    const data = await getSnapshot(appAuth, { authorization: "Bearer " + readToken });

    expect(categoryIds(data)).toEqual(["sv-cat", "sv-sub"]);
    expect(itemIds(data)).toEqual(["sv-active", "sv-broken", "sv-sub-site"]);
    // broken 是「已上线但暂时不可用」：站点列表对只读调用方可见，快照同理。
    // 若这里消失，说明过滤口径扩到了 status !== active，与 /api/sites 分叉。
    expect(itemIds(data)).toContain("sv-broken");
  });

  it("B 鉴权 + 管理凭据：原始快照一行不少（写回数据源不能被过滤）", async () => {
    const data = await getSnapshot(appAuth, { authorization: "Bearer " + BOOTSTRAP });

    expect(categoryIds(data)).toEqual(["sv-cat", "sv-hidden-cat", "sv-hidden-sub", "sv-sub"]);
    expect(itemIds(data)).toEqual([
      "sv-active",
      "sv-archived",
      "sv-broken",
      "sv-disabled",
      "sv-hidden-site",
      "sv-pending",
      "sv-sub-site",
    ]);
  });

  it("D 管理员显式 view=public：拿到与 read 令牌一致的匿名视角", async () => {
    const data = await getSnapshot(appAuth, { authorization: "Bearer " + BOOTSTRAP }, "&view=public");
    expect(itemIds(data)).toEqual(["sv-active", "sv-broken", "sv-sub-site"]);
  });

  it("view=raw 不能提权：read 令牌带它仍然只拿到 public 投影", async () => {
    const data = await getSnapshot(appAuth, { authorization: "Bearer " + readToken }, "&view=raw");
    expect(itemIds(data)).not.toContain("sv-pending");
    expect(itemIds(data)).not.toContain("sv-disabled");
  });

  it("C 开放模式：默认仍返回原始快照（个人/NAS 本机即管理面）", async () => {
    const data = await getSnapshot(appOpen);
    expect(itemIds(data)).toContain("sv-pending");
    expect(itemIds(data)).toContain("sv-disabled");
  });

  it("读可见性不改变写回：管理员把原始快照原样写回后，停用与待审记录仍在", async () => {
    const raw = await getSnapshot(appAuth, { authorization: "Bearer " + BOOTSTRAP });
    const put = await appAuth.inject({
      method: "PUT",
      url: "/api/storage",
      headers: { authorization: "Bearer " + BOOTSTRAP, "content-type": "application/json" },
      payload: { path: NAV, content: JSON.stringify(raw) },
    });
    expect(put.statusCode, put.body).toBe(200);

    const after = await getSnapshot(appAuth, { authorization: "Bearer " + BOOTSTRAP });
    expect(itemIds(after)).toContain("sv-pending");
    expect(itemIds(after)).toContain("sv-disabled");
    expect(categoryIds(after)).toContain("sv-hidden-cat");

    // 公开视图仍然过滤 —— 写回不该顺手改变读侧口径
    const publicView = await getSnapshot(appAuth, { authorization: "Bearer " + readToken });
    expect(itemIds(publicView)).toEqual(["sv-active", "sv-broken", "sv-sub-site"]);
  });

  it("非导航路径不受 view 影响：只读凭据仍能读站点配置", async () => {
    invalidateSnapshotCache();
    const res = await appAuth.inject({
      method: "GET",
      url: "/api/storage?path=" + encodeURIComponent("src/navsphere/content/site.json") + "&view=public",
      headers: { authorization: "Bearer " + readToken },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toBeTruthy();
  });
});
