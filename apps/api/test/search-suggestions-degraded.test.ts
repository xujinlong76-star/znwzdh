/**
 * 搜索建议读失败不能打崩检索（run59）。
 *
 * 缺陷：零结果分支用 `Promise.all([topQueries, zeroResultQueries])` 取建议；
 * （run129 起热榜读函数换成 suggestableTopQueries——运维口径 topQueries 仍归 stats.ts 专用，
 *  本测试的 spy 目标同步换名，断言强度一条没减。）
 * 任一读失败会抛出，早已算出的检索结果一起 5xx。用户看到的是「搜索坏了」，
 * 而实际只是建议区读不出来，且服务端没有任何计数能区分这两件事。
 *
 * 修法：两读各自 `allSettled` 降级为空，响应标 `suggestionsDegraded: true`，
 * 并写入独立 counter（与写入失败分开：读失败不改变命中）。
 * 这里从 HTTP 面钉住：
 *   1. 健康零结果仍有建议、无降级标记、计数不动；
 *   2. topQueries 失败 → 200 + 空建议 + 降级标记 + 计数恰好 +1；
 *   3. zeroResultQueries 失败 → 200 + 可读的一侧仍保留 + 计数 +1；
 *   4. 有命中的查询不读建议 → 计数不动、hits 完整；
 *   5. /api/metrics 暴露该族（含 HELP/TYPE 与 0 值）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const HOT_QUERY = "降级测试热词";

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

async function search(q: string) {
  return app.inject({ method: "GET", url: `/api/search?q=${encodeURIComponent(q)}` });
}

async function degradedCount(): Promise<number> {
  const res = await app.inject({ method: "GET", url: "/api/metrics" });
  expect(res.statusCode).toBe(200);
  const m = /^navhub_search_suggestions_degraded_total (\d+)$/m.exec(res.body);
  expect(m, "缺少 navhub_search_suggestions_degraded_total 序列").not.toBeNull();
  return Number(m![1]);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-search-degraded-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "degraded.db") }));
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "建议降级测试类目" });
  await ctx.repo.createSite({ url: "https://degradedhit-run59.example.com", title: "degradedhit 可命中站点", categoryId: cat.id });
  // 造一条热词，证明健康路径的建议不是空的。run129 起建议位按去重身份数排（≥2 人），
  // 所以两个身份各写一行——同一身份刷量正是本 gap 要挡掉的形状。
  await ctx.repo.recordEvent("search", { query: HOT_QUERY, identity: "degraded-person-a" });
  await ctx.repo.recordEvent("search", { query: HOT_QUERY, identity: "degraded-person-b" });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("搜索建议读侧降级", () => {
  it("健康零结果：建议可用、没有降级标记、计数不动", async () => {
    const before = await degradedCount();
    const res = await search("degraded-none-healthy");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { hits: unknown[]; suggestions: string[]; popular: string[]; suggestionsDegraded?: boolean };
    expect(body.hits.length).toBe(0);
    expect(body.suggestions).toContain(HOT_QUERY);
    expect(body.popular).toContain(HOT_QUERY);
    expect(body.suggestionsDegraded).toBeUndefined();
    expect(await degradedCount()).toBe(before);
  });

  it("建议读失败：检索仍 200，建议降级为空并计数一次", async () => {
    const spy = vi.spyOn(ctx.repo, "suggestableTopQueries").mockRejectedValue(new Error("simulated suggestions read failure"));
    try {
      const before = await degradedCount();
      const res = await search("degraded-none-top-fail");
      expect(res.statusCode).toBe(200);
      const body = res.json() as { hits: unknown[]; suggestions: string[]; popular: string[]; suggestionsDegraded?: boolean };
      expect(body.hits).toEqual([]);
      expect(body.suggestions).toEqual([]);
      expect(body.popular).toEqual([]);
      expect(body.suggestionsDegraded).toBe(true);
      expect(await degradedCount()).toBe(before + 1);
    } finally {
      spy.mockRestore();
    }
  });

  it("zeroResultQueries 读失败：可读的一侧保留，计数一次", async () => {
    const spy = vi.spyOn(ctx.repo, "zeroResultQueries").mockRejectedValue(new Error("simulated zero-result read failure"));
    try {
      const before = await degradedCount();
      const res = await search("degraded-none-zero-fail");
      expect(res.statusCode).toBe(200);
      const body = res.json() as { hits: unknown[]; suggestions: string[]; popular: string[]; suggestionsDegraded?: boolean };
      expect(body.hits).toEqual([]);
      // 建议读仍成功：建议不该因为另一路失败而清空
      expect(body.suggestions).toContain(HOT_QUERY);
      expect(body.suggestionsDegraded).toBe(true);
      expect(await degradedCount()).toBe(before + 1);
    } finally {
      spy.mockRestore();
    }
  });

  it("有命中的查询不读建议：hits 完整且计数不动", async () => {
    const spy = vi.spyOn(ctx.repo, "suggestableTopQueries").mockImplementation(() => {
      throw new Error("有命中时不应读建议");
    });
    try {
      const before = await degradedCount();
      const res = await search("degradedhit 命中");
      expect(res.statusCode).toBe(200);
      const body = res.json() as { hits: Array<{ site?: { title?: string } }>; suggestionsDegraded?: boolean };
      expect(body.hits.length).toBeGreaterThan(0);
      expect(body.hits[0]!.site?.title).toContain("degradedhit");
      expect(body.suggestionsDegraded).toBeUndefined();
      expect(await degradedCount()).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });

  it("/api/metrics 暴露建议降级族（含 0 与 HELP/TYPE）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("# HELP navhub_search_suggestions_degraded_total");
    expect(res.body).toContain("# TYPE navhub_search_suggestions_degraded_total counter");
    expect(res.body).toMatch(/^navhub_search_suggestions_degraded_total \d+$/m);
  });
});
