/**
 * 快照读缓存的回归测试。
 *
 * 缓存是性能优化，但快照同时是「后台读改写」的数据源 —— 缓存一旦滞后，
 * 后果不是慢，而是**数据丢失**（快照里没有 = 用户删了）。因此这里锁三件事：
 *
 *   1. 缓存确实生效（第二次读不再重建）；
 *   2. 任何写请求（HTTP 层）都让缓存立即失效；
 *   3. **绕过 HTTP 的直接写库**（后台任务/运维脚本/测试）也能被指纹发现，
 *      不会把旧快照继续喂给前端。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { invalidateSnapshotCache, snapshotCacheInfo } from "../src/storage.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const NAV = "src/navsphere/content/navigation.json";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-snapcache-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  invalidateSnapshotCache();
});

async function getSnapshot(): Promise<any> {
  const res = await app.inject({ method: "GET", url: "/api/storage?path=" + encodeURIComponent(NAV) });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe("快照读缓存", () => {
  it("第二次读取命中缓存，且内容与第一次完全一致", async () => {
    await ctx.repo.createCategory({ id: "cat-cache", title: "缓存分类", sort: 1, source: "api" } as never);

    const first = await getSnapshot();
    expect(snapshotCacheInfo().cached).toBe(true);

    const second = await getSnapshot();
    expect(second).toEqual(first);
    expect(second.navigationItems.some((c: any) => c.id === "cat-cache")).toBe(true);
  });

  it("绕过 HTTP 直接写库（后台任务场景）也会让缓存失效", async () => {
    await ctx.repo.createCategory({ id: "cat-direct", title: "改名前", sort: 2, source: "api" } as never);
    const before = await getSnapshot();
    expect(before.navigationItems.find((c: any) => c.id === "cat-direct")?.title).toBe("改名前");

    // 模拟 health_check / recompute_rank 这类不经路由的写
    await ctx.repo.updateCategory("cat-direct", { title: "改名后" } as never);

    const after = await getSnapshot();
    expect(after.navigationItems.find((c: any) => c.id === "cat-direct")?.title).toBe("改名后");
  });

  it("HTTP 写请求成功后缓存立即失效（保存后刷新即可见）", async () => {
    await ctx.repo.createCategory({ id: "cat-http", title: "HTTP 前", sort: 3, source: "api" } as never);
    await getSnapshot();
    expect(snapshotCacheInfo().cached).toBe(true);

    const put = await app.inject({
      method: "PUT",
      url: "/api/storage",
      payload: {
        path: NAV,
        content: JSON.stringify({
          navigationItems: [{ id: "cat-http", title: "HTTP 后", items: [] }],
        }),
      },
    });
    expect(put.statusCode).toBe(200);

    // 写路径显式失效 + onResponse 前缀失效，两者任一都应让下一次读重建
    const after = await getSnapshot();
    expect(after.navigationItems.find((c: any) => c.id === "cat-http")?.title).toBe("HTTP 后");
  });

  it("响应带 ETag 与 no-cache，可被浏览器条件请求复用", async () => {
    const res = await app.inject({ method: "GET", url: "/api/storage?path=" + encodeURIComponent(NAV) });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["cache-control"] ?? "")).toContain("no-cache");
    expect(String(res.headers["etag"] ?? "")).toMatch(/^".+"$/);

    const etag = String(res.headers["etag"]);
    const second = await app.inject({
      method: "GET",
      url: "/api/storage?path=" + encodeURIComponent(NAV),
      headers: { "if-none-match": etag },
    });
    expect(second.statusCode).toBe(304);
  });
});
