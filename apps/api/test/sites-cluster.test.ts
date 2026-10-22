/**
 * POST /api/sites/cluster 的两条取数分支（方案 P1-4）。
 *
 * 此前 handler 里是 `Promise.all(siteIds.map((id) => ctx.repo.getSite(id)))`：
 * schema 放行 `.max(100)`，一次请求就是最多 100 条单点查询（N+1），每个 id 都要走
 * 一遍 `SELECT s.* + 两个子查询 ... LIMIT 1`。改成仓储自带的 `getSitesByIds`
 * （内部按 `chunkList` 分片拼 `IN`）之后，同一份输入只有常数次查询。
 *
 * 本文件锁两件事：
 *   1. 显式 siteIds 分支走批量，逐条 `getSite` 一次都不许调（允许 ≤1 是为了不让
 *      断言绑定在"一次都不调"这个实现细节上）；
 *   2. 不传 siteIds 的默认分支（`listSites`）也要有人挡——只改批量那条、默认那条
 *      没人看着，下次重构同样会退化。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let categoryId: string;
/** 显式分支用：100 条站点，正好顶到 schema 的 `.max(100)` */
let ids: string[] = [];
/** 默认分支用：挂在另一个类目下，避免两条用例互相污染 */
let defaultCategoryId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-cluster-"));
  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "cluster.db"),
      embedding: { model: "none", endpoint: "", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
      llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
      fetch: { timeoutMs: 1500, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubClusterTest/0.1" },
      corsOrigins: ["*"],
    } as never),
  );
  app = await buildServer(ctx);
  await app.ready();

  // 写入口只接受叶子（一级根只作导航），所以两类目都挂在根下
  await ctx.repo.createCategory({ id: "root-cluster", title: "聚类测试根" });
  await ctx.repo.createCategory({ id: "cat-cluster", title: "聚类测试类目", parentId: "root-cluster" });
  await ctx.repo.createCategory({ id: "cat-cluster-default", title: "聚类默认分支类目", parentId: "root-cluster" });
  categoryId = "cat-cluster";
  defaultCategoryId = "cat-cluster-default";

  ids = [];
  for (let i = 0; i < 100; i++) {
    const site = await ctx.repo.createSite({
      url: `https://cluster-${i}.example.com/`,
      title: `聚类站点 ${i}`,
      categoryId,
      tags: ["cluster"],
    } as never);
    ids.push(site.id);
  }
  for (let i = 0; i < 5; i++) {
    await ctx.repo.createSite({
      url: `https://cluster-default-${i}.example.com/`,
      title: `默认分支站点 ${i}`,
      categoryId: defaultCategoryId,
      tags: ["cluster-default"],
    } as never);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 上 SQLite 句柄释放有延迟：临时目录由系统回收，不让清理失败判红
  }
});

describe("POST /api/sites/cluster 的取数分支", () => {
  it("传 100 个 siteIds → 走批量查询，逐条 getSite 调用次数 ≤ 1", async () => {
    const spy = vi.spyOn(ctx.repo, "getSite");
    const batchSpy = vi.spyOn(ctx.repo, "getSitesByIds");

    const res = await app.inject({
      method: "POST",
      url: "/api/sites/cluster",
      payload: { siteIds: ids, targetK: 4 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok: boolean;
      result: { totalItems: number; clusterCount: number; clusters: Array<{ items: Array<{ id: string }> }> };
    };
    expect(body.ok).toBe(true);
    // 批量取回的站点必须一个不少：改成 Map 之后丢顺序/丢条目会在这里露出来
    expect(body.result.totalItems).toBe(100);
    const returned = body.result.clusters.flatMap((c) => c.items.map((i) => i.id));
    expect(new Set(returned).size).toBe(100);

    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    // 反向自证：批量那条确实被调到了，说明上面的 0 次不是"spy 没装上"的假绿
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy.mock.calls[0]![0]).toHaveLength(100);
  });

  it("不传 siteIds → 走 listSites({ categoryId, limit: 100, status: 'active' }) 默认分支", async () => {
    const spy = vi.spyOn(ctx.repo, "listSites");

    const res = await app.inject({
      method: "POST",
      url: "/api/sites/cluster",
      payload: { categoryId: defaultCategoryId, targetK: 3 },
    });

    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      categoryId: defaultCategoryId,
      limit: 100,
      status: "active",
    });

    const body = res.json() as { ok: boolean; result: { totalItems: number } };
    expect(body.ok).toBe(true);
    expect(body.result.totalItems).toBe(5);
  });

  it("siteIds 命中软删除站点 → 静默过滤，不因取不到行而 500", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sites/cluster",
      payload: { siteIds: [...ids.slice(0, 3), "no-such-site-id"], targetK: 2 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { result: { totalItems: number } };
    expect(body.result.totalItems).toBe(3);
  });
});
