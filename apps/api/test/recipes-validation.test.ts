/**
 * recipes 域「内容真实性」守卫测试：
 *  - GET /api/recipes：模型回候选之外的工具时，整层必须被丢弃，不许把编造的
 *    id/title/url 当站内推荐下发；全部层都编造时按无结果处理。
 *  - GET /api/comparisons：A、B 两侧都不在站内收录时，不许靠模型记忆现编
 *    定价/优劣矩阵，必须如实回 ok:false。
 *  - GET /api/intent/action：模型给的 primaryTool 对不回任何候选时，不许拿
 *    候选第一名顶替并挂着原工具的理由下发，必须如实回 isActionable:false。
 * 模型端点由 fetch 桩接管，测试不出网（与 recipes-ai-cache-key.test.ts 同款）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const dir = mkdtempSync(join(tmpdir(), "navhub-recipes-guard-"));
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

function stubLlm(payload: Record<string, unknown>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes("/chat/completions")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(
      JSON.stringify({
        model: "guard-test-model",
        choices: [{ message: { role: "assistant", content: JSON.stringify(payload) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

beforeAll(async () => {
  ctx = await createContext(
    loadConfig({
      mode: "lite" as const,
      embedding: { model: "m", endpoint: "https://hf-mirror.com", dtype: "q8" as const, cacheDir: join(dir, "models"), dim: 512, enabled: false },
      llm: { baseUrl: "https://93.184.216.34/v1", apiKey: "test-key", model: "guard-test-model", timeoutMs: 3000 },
      fetch: { timeoutMs: 1000, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
      corsOrigins: ["*"],
      sqlitePath: join(dir, "recipes-guard.db"),
    }),
  );
  app = await buildServer(ctx);
  await app.ready();
  await ctx.repo.createCategory({ id: "cat-guard", title: "守卫测试类目" });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/recipes 候选校验", () => {
  it("模型回候选外工具：整层丢弃，配方按无结果处理", async () => {
    const Q = "守卫场景配方甲";
    const created = await ctx.repo.createSite({
      url: "https://guard-recipe.example.com",
      title: Q,
      description: "守卫测试的唯一真实候选",
      categoryId: "cat-guard",
    });
    const restore = stubLlm({
      id: "ai-recipe-fake",
      title: "编造配方",
      targetGoal: "x",
      description: "x",
      keywords: ["x"],
      layers: [
        {
          layerName: "1. 采集",
          category: "采集",
          recommended: { id: "fake-id", title: "不存在的工具", url: "https://fake.example.com", description: "编造理由" },
          alternatives: [{ id: "fake-2", title: "另一个编造", url: "https://fake2.example.com" }],
        },
      ],
      quickStartSnippet: "x",
    });
    try {
      const res = await app.inject({ method: "GET", url: `/api/recipes?q=${encodeURIComponent(Q)}` });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().item).toBeNull();
      expect(res.json().items).toEqual([]);
    } finally {
      restore();
      await ctx.repo.deleteSite(String(created.id));
    }
  });

  it("模型回真实候选但写错网址：以候选的真实 id/title/url 下发", async () => {
    const Q = "守卫场景配方乙";
    const created = await ctx.repo.createSite({
      url: "https://guard-real.example.com",
      title: Q,
      description: "守卫测试的真实候选乙",
      categoryId: "cat-guard",
    });
    const restore = stubLlm({
      id: "ai-recipe-real",
      title: "真实配方",
      targetGoal: "x",
      description: "x",
      keywords: ["x"],
      layers: [
        {
          layerName: "1. 采集",
          category: "采集",
          recommended: { id: String(created.id), title: Q, url: "https://wrong-url.example.com", description: "模型写的理由" },
          alternatives: [],
        },
      ],
      quickStartSnippet: "x",
    });
    try {
      const res = await app.inject({ method: "GET", url: `/api/recipes?q=${encodeURIComponent(Q)}` });
      expect(res.statusCode, res.body).toBe(200);
      const layer = res.json().item?.layers?.[0];
      expect(layer?.recommended?.id).toBe(String(created.id));
      expect(layer?.recommended?.url).toBe("https://guard-real.example.com");
    } finally {
      restore();
      await ctx.repo.deleteSite(String(created.id));
    }
  });
});

describe("GET /api/comparisons 双侧未收录不生成", () => {
  it("A、B 都不在站内：ok:false，不编造矩阵", async () => {
    const restore = stubLlm({
      id: "ai-cmp-fake",
      title: "编造对比",
      itemA: { name: "虚构工具甲", category: "x", license: "免费", primaryPros: ["p"], tradeoffs: ["t"], bestFor: "b" },
      itemB: { name: "虚构工具乙", category: "x", license: "付费", primaryPros: ["p"], tradeoffs: ["t"], bestFor: "b" },
      dimensions: [{ dimName: "核心能力", valueA: "a", valueB: "b", winner: "A" }],
      verdict: "编造结论",
    });
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/comparisons?q=${encodeURIComponent("虚构工具甲 vs 虚构工具乙")}`,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().ok).toBe(false);
      expect(res.json().matrix).toBeNull();
    } finally {
      restore();
    }
  });
});

describe("GET /api/intent/action 不顶替", () => {
  it("模型给的工具对不回候选：如实回不可执行，不拿第一名顶替", async () => {
    const created = await ctx.repo.createSite({
      url: "https://guard-intent.example.com",
      title: "守卫意图候选工具",
      description: "处理音频切分的真实候选",
      categoryId: "cat-guard",
    });
    const restore = stubLlm({
      isActionable: true,
      actionSummary: "3步完成：切分音频",
      primaryTool: { title: "候选里没有的工具", whyBest: "编造的理由" },
      steps: ["第一步", "第二步", "第三步"],
      proTip: "p",
    });
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/intent/action?q=${encodeURIComponent("守卫意图候选工具怎么用")}`,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().isActionable).toBe(false);
      expect(res.json().primaryTool).toBeNull();
    } finally {
      restore();
      await ctx.repo.deleteSite(String(created.id));
    }
  });
});
