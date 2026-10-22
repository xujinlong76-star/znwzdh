/**
 * MCP 工具契约测试（第七轮深扫）。
 *
 * 这里盯的是「schema 对外承诺过、但处理器没兑现」的那类缺陷：
 *  - 幂等键的作用域：idempotency.key 是全库主键，裸键会跨工具/跨身份串味；
 *  - facets：SearchSitesInput / CreateSiteInput / UpdateSiteInput 都声明了它
 *    （inputSchema 由同一份 zod 生成，Agent 看得见），漏传等于"文档说能筛、实际不过滤"；
 *  - batch_import 同一批里的重复 URL；
 *  - health_check 的 onlyUnchecked 必须先筛后截。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, loadConfig, type AppContext } from "@navhub/api";
import { createHandlers } from "../src/handlers.ts";
import { qualifyIdempotencyKey } from "../src/handlers/shared.ts";
import type { McpScope, ToolContext } from "../src/tools.ts";

let dir: string;
let ctx: AppContext;
let handlers: ReturnType<typeof createHandlers>;

function identity(actor: string): ToolContext {
  return { actor, scopes: ["read", "write"], has: (s: McpScope) => s === "read" || s === "write" };
}

const A = identity("mcp:agent-a");
const B = identity("mcp:agent-b");

function payload(res: { content: Array<{ text: string }> }): any {
  return JSON.parse(res.content.map((c) => c.text).join(""));
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-mcp-contract-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "contract.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "m"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 3000 },
    fetch: { timeoutMs: 1200, maxBytes: 131072, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubTest" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  handlers = createHandlers(ctx);
  await ctx.repo.createCategory({ id: "c1", title: "契约类目" });
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("幂等键必须带工具与身份作用域", () => {
  it("qualifyIdempotencyKey：同键在不同工具 / 不同身份下得到不同的存储键", () => {
    const k = qualifyIdempotencyKey("create_site", "mcp:a", "sync-1");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(k).toBe(qualifyIdempotencyKey("create_site", "mcp:a", "sync-1"));
    expect(k).not.toBe(qualifyIdempotencyKey("delete_site", "mcp:a", "sync-1"));
    expect(k).not.toBe(qualifyIdempotencyKey("create_site", "mcp:b", "sync-1"));
    // 拼接式键容易串味：["a|b"] 与 ["a","b"] 必须区分开
    expect(qualifyIdempotencyKey("create_site", "mcp:a", "b|c")).not.toBe(qualifyIdempotencyKey("create_site", "mcp:a|b", "c"));
  });

  it("同一个键跨工具复用：第二个工具必须真的执行，而不是重放前一个工具的结果", async () => {
    const url = "https://key-scope.example/cross-tool";
    const created = payload(await handlers.create_site({ url, title: "跨工具键", categoryId: "c1", enrich: false, idempotencyKey: "sync-cross" }, A));
    expect(created.created).toBe(true);

    const deleted = payload(await handlers.delete_site({ idOrUrl: url, idempotencyKey: "sync-cross" }, A));
    // 缺陷版会返回 create 的旧结果（replayed:true、没有 deleted 字段），站点其实没被删
    expect(deleted.replayed).toBeUndefined();
    expect(deleted.deleted).toBe(true);
    expect(await ctx.repo.findSiteByUrl(url)).toBeNull();
  });

  it("同一个键跨身份复用：另一个 token 必须读到自己的结果，且能正常写入", async () => {
    const first = payload(await handlers.create_site({
      url: "https://key-scope.example/agent-a", title: "A 的站点", categoryId: "c1", enrich: false, idempotencyKey: "sync-shared",
    }, A));
    expect(first.created).toBe(true);

    const second = payload(await handlers.create_site({
      url: "https://key-scope.example/agent-b", title: "B 的站点", categoryId: "c1", enrich: false, idempotencyKey: "sync-shared",
    }, B));
    // 缺陷版：B 拿到 A 那次调用的缓存（url 是 A 的），并且 B 的站点没建
    expect(second.replayed).toBeUndefined();
    expect(second.created).toBe(true);
    expect(second.site.url).toBe("https://key-scope.example/agent-b");
    expect(await ctx.repo.findSiteByUrl("https://key-scope.example/agent-b")).not.toBeNull();
  });

  it("同身份同工具同键仍然重放（保护本身不能被改没）", async () => {
    const args = { url: "https://key-scope.example/replay", title: "重放站点", categoryId: "c1", enrich: false, idempotencyKey: "sync-replay" };
    const first = payload(await handlers.create_site(args, A));
    const again = payload(await handlers.create_site(args, A));
    expect(first.created).toBe(true);
    expect(again.replayed).toBe(true);
    const rows = await ctx.repo.listSites({ limit: 1000 });
    expect(rows.filter((s) => s.url === args.url).length).toBe(1);
  });
});

describe("facets 是对外承诺过的维度，必须真的生效", () => {
  it("create_site 写入分面并可读回", async () => {
    const body = payload(await handlers.create_site({
      url: "https://facets.example/paid", title: "付费工具", categoryId: "c1", enrich: false,
      facets: { pricing: ["paid"], platform: ["web"] },
    }, A));
    expect(body.created).toBe(true);
    const read = payload(await handlers.get_site({ idOrUrl: "https://facets.example/paid" }, A));
    expect(read.facets?.pricing).toEqual(["paid"]);
    expect(read.facets?.platform).toEqual(["web"]);
  });

  it("update_site 能改写分面", async () => {
    await handlers.create_site({ url: "https://facets.example/flip", title: "改写前", categoryId: "c1", enrich: false, facets: { pricing: ["paid"] } }, A);
    const site = payload(await handlers.get_site({ idOrUrl: "https://facets.example/flip" }, A));
    const upd = payload(await handlers.update_site({ id: site.id, facets: { pricing: ["free"] } }, A));
    expect(upd.updated).toBe(true);
    const read = payload(await handlers.get_site({ idOrUrl: site.id }, A));
    expect(read.facets?.pricing).toEqual(["free"]);
  });

  it("search_sites 的分面过滤真的缩小结果集（正向命中 + 负向排除）", async () => {
    await handlers.create_site({ url: "https://facets.example/free", title: "分面检索靶标", categoryId: "c1", enrich: false, facets: { pricing: ["free"] } }, A);
    await handlers.create_site({ url: "https://facets.example/nofacet", title: "分面检索靶标", categoryId: "c1", enrich: false }, A);

    const filtered = payload(await handlers.search_sites({ query: "分面检索靶标", limit: 20, facets: { pricing: ["free"] } }, A));
    expect(filtered.results.length).toBeGreaterThan(0);
    expect(filtered.results.every((r: any) => String(r.url).startsWith("https://facets.example/free"))).toBe(true);

    const unfiltered = payload(await handlers.search_sites({ query: "分面检索靶标", limit: 20 }, A));
    expect(unfiltered.results.length).toBeGreaterThan(filtered.results.length);
  });
});

describe("batch_import 与 health_check 的边界", () => {
  it("同一批里重复的 URL 只落一条（dryRun 也报出来）", async () => {
    const sites = [
      { url: "https://batch-dup.example/x", title: "重复项" },
      { url: "https://batch-dup.example/y", title: "正常项" },
      { url: "https://batch-dup.example/x", title: "重复项（第二次）" },
    ];
    const preview = payload(await handlers.batch_import({ sites, defaultCategoryId: "c1" }, A));
    expect(preview.dryRun).toBe(true);
    expect(preview.duplicateUrls).toEqual(["https://batch-dup.example/x"]);
    expect(preview.wouldCreate).toBe(2);

    const applied = payload(await handlers.batch_import({ sites, dryRun: false, defaultCategoryId: "c1" }, A));
    expect(applied.created).toBe(2);
    const rows = await ctx.repo.listSites({ limit: 1000 });
    expect(rows.filter((s) => s.url === "https://batch-dup.example/x").length).toBe(1);
  });

  it("onlyUnchecked 在候选靠后时仍能捞到未巡检站点（先筛后截）", async () => {
    // 5 个站点全部未巡检
    for (let i = 0; i < 5; i++) {
      await handlers.create_site({ url: `https://hc-window.example/s${i}`, title: "巡检窗口 " + i, categoryId: "c1", enrich: false }, A);
    }
    // 缺陷版只看 listSites({limit}) 返回的那一批，所以把"恰好是那一批"全标成已巡检，
    // 未巡检的就全部落在窗口之外 —— 这样 limit 放大与否只有这里能区分。
    const limit = 2;
    const head = await ctx.repo.listSites({ limit });
    expect(head.length).toBe(limit);
    for (const s of head) {
      await ctx.repo.updateSiteHealth(s.id, { httpStatus: 200, ok: true, latencyMs: 1, redirectTo: null, error: null, currentStatus: s.status });
    }
    const uncheckedOutside = (await ctx.repo.listSites({ limit: 1000 })).filter((s) => !s.health?.lastCheckedAt && !head.some((h) => h.id === s.id));
    expect(uncheckedOutside.length).toBeGreaterThan(0);

    const body = payload(await handlers.health_check({ limit, onlyUnchecked: true }, A));
    // 缺陷版：窗口里全已巡检 → checked:0，报告成"没有需要巡检的"
    expect(body.checked).toBeGreaterThan(0);
    expect(body.checked).toBeLessThanOrEqual(limit);
    expect(body.scanned).toBeGreaterThan(limit);
  });
});
