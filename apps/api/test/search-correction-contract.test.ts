/**
 * 搜索纠正契约（搜索容错纠错 · 第 5 项，API 层）。
 *
 * 锁：
 * 1. nocorrect 透传进 store：GET /api/search?q=zhihhu 自动纠正为知乎并返回
 *    correction + 纠正后 hits；nocorrect=1 时不纠正、保持零结果；
 * 2. 响应含 correction 且过 SearchResponse zod 校验；
 * 3. correction 不进缓存键污染：nocorrect 在 query 串里天然分键，
 *    两次请求（带 / 不带 nocorrect）不串味；
 * 4. 事件按原查询记（热榜不被纠正词污染）：events.search 的 query 是 zhihhu。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { SearchResponse } from "@navhub/core";

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

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-search-correction-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "test.db") }));
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "纠正契约" });
  await ctx.repo.createSite({ url: "https://www.zhihu.com/", title: "知乎", categoryId: cat.id, description: "中文问答社区" });
  await ctx.repo.createSite({ url: "https://github.com/", title: "GitHub", categoryId: cat.id, description: "代码托管" });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/search 自动纠正契约", () => {
  it("zhihhu 自动纠正为知乎：correction + 纠正后 hits，且过 zod 校验", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=zhihhu" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const parsed = SearchResponse.safeParse(body);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(body.correction).toEqual({ original: "zhihhu", corrected: "知乎", reason: "pinyin-typo" });
    expect(body.hits.map((h: { site: { title: string } | null }) => h.site?.title)).toContain("知乎");
    expect(body.didYouMean).toBeUndefined();
  });

  it("nocorrect=1 时不纠正：保持零结果、无 correction", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=zhihhu&nocorrect=1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hits).toHaveLength(0);
    expect(body.correction).toBeUndefined();
  });

  it("nocorrect=0 / nocorrect=false 仍纠正（N4：只有 1 / true 才 disable）", async () => {
    for (const v of ["0", "false"]) {
      const res = await app.inject({ method: "GET", url: `/api/search?q=zhihhu&nocorrect=${v}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.correction).toEqual({ original: "zhihhu", corrected: "知乎", reason: "pinyin-typo" });
      expect(body.hits.map((h: { site: { title: string } | null }) => h.site?.title)).toContain("知乎");
    }
  });

  it("nocorrect 分键：带参 / 不带参两次请求不串味", async () => {
    const plain = await app.inject({ method: "GET", url: "/api/search?q=zihhu" });
    expect(plain.json().correction?.corrected).toBe("知乎");
    const nofix = await app.inject({ method: "GET", url: "/api/search?q=zihhu&nocorrect=true" });
    expect(nofix.json().hits).toHaveLength(0);
    expect(nofix.json().correction).toBeUndefined();
    const plainAgain = await app.inject({ method: "GET", url: "/api/search?q=zihhu" });
    expect(plainAgain.json().correction?.corrected).toBe("知乎");
  });

  it("事件按原查询记：events.search 的 query 是 zhihhu，不是纠正词", async () => {
    await app.inject({ method: "GET", url: "/api/search?q=zhihhu" });
    const rows = await ctx.repo.raw("SELECT query FROM events WHERE kind = 'search' ORDER BY created_at DESC LIMIT 5", []);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => String(r.query))).toContain("zhihhu");
    expect(rows.map((r) => String(r.query))).not.toContain("知乎");
  });
});
