/**
 * 搜索框热词端点（W4-0622-1 收尾③）：GET /api/search/hotwords。
 *
 * 口径与零结果页 `popular` 相同：suggestableTopQueries（180 天、≥2 身份、
 * ≥2 行、形状闸）再排除零结果词，取前 8。这里从 HTTP 面钉住：
 *   1. 有 ≥2 身份的热词出现，且不超过 8 个；
 *   2. 零结果词被排除（搜了也没结果的词不许进热词）；
 *   3. 只有 1 个身份的词被排除（单人刷量不进榜）；
 *   4. 读侧失败不 5xx：降级为空 + suggestionsDegraded 标记 + 计数一次，
 *      另一侧可读时仍保留。
 *   5. U-464：探针词（`zzzz不存在的站`，R5-A-07 线上实测上榜）两个身份
 *      各搜一次也不进热词——形状闸在 store 层拦，HTTP 面只验端到端结果。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const HOT_QUERY = "热词测试考研";
const ZERO_QUERY = "热词测试零结果词";
const SINGLE_QUERY = "热词测试单人词";
const PROBE_QUERY = "zzzz不存在的站";

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

async function hotwords() {
  return app.inject({ method: "GET", url: "/api/search/hotwords" });
}

async function degradedCount(): Promise<number> {
  const res = await app.inject({ method: "GET", url: "/api/metrics" });
  expect(res.statusCode).toBe(200);
  const m = /^navhub_search_suggestions_degraded_total (\d+)$/m.exec(res.body);
  expect(m, "缺少 navhub_search_suggestions_degraded_total 序列").not.toBeNull();
  return Number(m![1]);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-search-hotwords-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "hotwords.db") }));
  app = await buildServer(ctx);
  await app.ready();
  // 热词：三个身份各写一行（≥2 身份、≥2 行才进 suggestableTopQueries；
  // 3 身份让它在 9 个填充词（各 2 身份）之前排第一——排序先按身份数，
  // 同身份数时按 query 字母序，填充词会把只有 2 身份的词挤出前 8）。
  await ctx.repo.recordEvent("search", { query: HOT_QUERY, identity: "hotwords-person-a" });
  await ctx.repo.recordEvent("search", { query: HOT_QUERY, identity: "hotwords-person-b" });
  await ctx.repo.recordEvent("search", { query: HOT_QUERY, identity: "hotwords-person-c" });
  // 零结果词：同样两个身份搜过，但也进了零结果榜 → 必须被排除。
  await ctx.repo.recordEvent("search", { query: ZERO_QUERY, identity: "hotwords-person-a" });
  await ctx.repo.recordEvent("search", { query: ZERO_QUERY, identity: "hotwords-person-b" });
  await ctx.repo.recordEvent("zero_result", { query: ZERO_QUERY, identity: "hotwords-person-a" });
  await ctx.repo.recordEvent("zero_result", { query: ZERO_QUERY, identity: "hotwords-person-b" });
  // 单人词：只有一个身份搜过 → 门槛挡掉。
  await ctx.repo.recordEvent("search", { query: SINGLE_QUERY, identity: "hotwords-person-a" });
  await ctx.repo.recordEvent("search", { query: SINGLE_QUERY, identity: "hotwords-person-a" });
  // U-464 探针词：两个身份各搜一次、且故意不写 zero_result 行——与 R5 线上
  // 实测一致（语义检索给了探针命中，路由层 top-30 零结果集根本没拦住它）。
  // 若形状闸失效，它会按字母序排进 2 身份组前列、挤进前 8；进不了榜才是修复。
  await ctx.repo.recordEvent("search", { query: PROBE_QUERY, identity: "hotwords-person-a" });
  await ctx.repo.recordEvent("search", { query: PROBE_QUERY, identity: "hotwords-person-b" });
  // 再补 9 个热词（各 2 身份），把总量推过 8，验上限截断。
  for (let i = 1; i <= 9; i++) {
    const q = `热词测试填充${i}`;
    await ctx.repo.recordEvent("search", { query: q, identity: "hotwords-person-a" });
    await ctx.repo.recordEvent("search", { query: q, identity: "hotwords-person-b" });
  }
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/search/hotwords（搜索框热词）", () => {
  it("返回热词：含多人热词、不超 8 个、不含零结果词与单人词", async () => {
    const res = await hotwords();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { hotwords: string[]; suggestionsDegraded?: boolean };
    expect(Array.isArray(body.hotwords)).toBe(true);
    expect(body.hotwords.length).toBeLessThanOrEqual(8);
    expect(body.hotwords).toContain(HOT_QUERY);
    expect(body.hotwords).not.toContain(ZERO_QUERY);
    expect(body.hotwords).not.toContain(SINGLE_QUERY);
    expect(body.hotwords).not.toContain(PROBE_QUERY);
    expect(body.suggestionsDegraded).toBeUndefined();
  });

  it("suggestableTopQueries 读失败：仍 200，热词为空并标记降级、计数一次", async () => {
    const spy = vi.spyOn(ctx.repo, "suggestableTopQueries").mockRejectedValue(new Error("simulated hotwords read failure"));
    try {
      const before = await degradedCount();
      const res = await hotwords();
      expect(res.statusCode).toBe(200);
      const body = res.json() as { hotwords: string[]; suggestionsDegraded?: boolean };
      expect(body.hotwords).toEqual([]);
      expect(body.suggestionsDegraded).toBe(true);
      expect(await degradedCount()).toBe(before + 1);
    } finally {
      spy.mockRestore();
    }
  });

  it("zeroResultQueries 读失败：可读的一侧保留，仍标记降级、计数一次", async () => {
    const spy = vi.spyOn(ctx.repo, "zeroResultQueries").mockRejectedValue(new Error("simulated zero-result read failure"));
    try {
      const before = await degradedCount();
      const res = await hotwords();
      expect(res.statusCode).toBe(200);
      const body = res.json() as { hotwords: string[]; suggestionsDegraded?: boolean };
      expect(body.hotwords).toContain(HOT_QUERY);
      expect(body.suggestionsDegraded).toBe(true);
      expect(await degradedCount()).toBe(before + 1);
    } finally {
      spy.mockRestore();
    }
  });
});
