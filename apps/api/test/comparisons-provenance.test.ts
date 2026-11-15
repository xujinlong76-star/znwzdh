/**
 * Batch 4 Phase 2 P2-5：GET /api/comparisons 动态对比改造——API 集成测试。
 *
 * 覆盖 §5.3 的 API 部分（模型端点由 fetch 桩接管，测试不出网；与
 * recipes-ai-cache-key.test.ts / recipes-validation.test.ts 同款）：
 *  - prompt 组装：结构化字段在 prompt 内、硬指令存在、title/url/description
 *    只在补充区；
 *  - LLM 路径：精确匹配→measured、改述→model_generated、空值→unverified、
 *    verdict 恒 model_generated、模型自标 provenance 被忽略、非法 winner
 *    被丢弃、新增维度被丢弃；
 *  - 无 Key：回结构化对照表（aiGenerated:false、无 winner、固定 verdict），
 *    两侧未收录仍回 null；
 *  - 缓存：分面改动 → 旧缓存 miss；
 *  - 知识库路径：react vs vue 全字段 measured。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const dir = mkdtempSync(join(tmpdir(), "navhub-comparisons-prov-"));

function baseConfig(llm: Record<string, unknown>, sqlitePath: string) {
  return loadConfig({
    mode: "lite" as const,
    embedding: { model: "m", endpoint: "https://hf-mirror.com", dtype: "q8" as const, cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://93.184.216.34/v1", model: "prov-test-model", timeoutMs: 3000, ...llm },
    fetch: { timeoutMs: 1000, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
    sqlitePath,
  } as never);
}

let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let generations: number[];
let lastPrompt = "";

function stubLlm(payload: Record<string, unknown> | ((n: number) => Record<string, unknown>)) {
  const original = globalThis.fetch;
  generations = [];
  lastPrompt = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/chat/completions")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const n = generations.length + 1;
    generations.push(n);
    try {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
      lastPrompt = (body.messages ?? []).map((m) => m.content ?? "").join("\n");
    } catch { /* 桩解析失败不影响断言主体 */ }
    const content = JSON.stringify(typeof payload === "function" ? payload(n) : payload);
    return new Response(
      JSON.stringify({ model: "prov-test-model", choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** 模型回的矩阵：精确复述、改述、空值、自标 provenance、非法 winner、新增维度全有 */
const MODEL_MATRIX = {
  id: "ai-cmp-prov",
  title: "Prov甲工具 vs Prov乙工具 深度选型对比",
  itemA: { name: "Prov甲工具", category: "开发工具", license: "免费增值", primaryPros: ["上手快"], tradeoffs: ["高级功能收费"], bestFor: "个人开发者", provenance: { license: "measured", category: "measured" } },
  itemB: { name: "Prov乙工具", category: "开发工具", license: "商业付费", primaryPros: ["功能全"], tradeoffs: ["贵"], bestFor: "企业团队" },
  dimensions: [
    { dimName: "核心能力", valueA: "免费增值", valueB: "商业付费", winner: "TIE", provenanceA: "measured", provenanceB: "measured" },
    { dimName: "免费与性价比", valueA: "改述过的便宜", valueB: "", winner: "C", provenanceA: "measured" },
    { dimName: "上手与生态", valueA: "未验证", valueB: "Web 网页端", winner: "B" },
    { dimName: "模型自造维度", valueA: "x", valueB: "y", winner: "A" },
  ],
  verdict: "按需选",
  verdictProvenance: "measured",
};

const A = "Prov甲工具";
const B = "Prov乙工具";

beforeAll(async () => {
  ctx = await createContext(baseConfig({ apiKey: "test-key" }, join(dir, "prov.db")));
  app = await buildServer(ctx);
  await app.ready();
  await ctx.repo.createCategory({ id: "cat-prov", title: "三态标注类目" });
  const a = await ctx.repo.createSite({ url: "https://prov-a.example.com", title: A, description: "Prov甲工具的描述", categoryId: "cat-prov" });
  const b = await ctx.repo.createSite({ url: "https://prov-b.example.com", title: B, description: "Prov乙工具的描述", categoryId: "cat-prov" });
  await ctx.repo.setSiteFacets(String(a.id), { pricing: ["freemium"], platform: ["web", "ios"], form: ["saas"] });
  await ctx.repo.setSiteFacets(String(b.id), { pricing: ["paid"], platform: ["web"], form: ["desktop"] });
  await ctx.repo.updateSiteHealth(String(a.id), { httpStatus: 200, ok: true, latencyMs: 120, redirectTo: null, error: null });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/comparisons LLM 路径：prompt 与三态标注", () => {
  it("prompt 只喂结构化事实，硬指令存在，title/url/description 在补充区", async () => {
    const restore = stubLlm(MODEL_MATRIX);
    try {
      const res = await app.inject({ method: "GET", url: `/api/comparisons?q=${encodeURIComponent(`${A} vs ${B}`)}` });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(lastPrompt).toContain("免费增值");
      expect(lastPrompt).toContain("Web 网页端");
      expect(lastPrompt).toContain("可达");
      expect(lastPrompt).toContain("只转述以下结构化事实");
      expect(lastPrompt).toContain("结构化事实里没有的，写‘未验证’，不许编造");
      expect(lastPrompt).toContain("不许新增对照维度");
      expect(lastPrompt).toContain("winner 只能取 A / B / TIE，依据不足时取 TIE");
      const structuredAt = lastPrompt.indexOf("【站内已核实结构化事实】");
      const supplementaryAt = lastPrompt.indexOf("【补充上下文");
      expect(structuredAt).toBeGreaterThan(-1);
      expect(supplementaryAt).toBeGreaterThan(structuredAt);
      expect(lastPrompt.indexOf("免费增值")).toBeLessThan(supplementaryAt);
      expect(lastPrompt.indexOf("Prov甲工具 (https://prov-a.example.com)")).toBeGreaterThan(supplementaryAt);
    } finally {
      restore();
    }
  });

  it("三态标注由服务端定夺：模型自标被忽略，非法 winner 与新增维度被丢弃", async () => {
    const restore = stubLlm(MODEL_MATRIX);
    try {
      const res = await app.inject({ method: "GET", url: `/api/comparisons?q=${encodeURIComponent(`${A} vs ${B}`)}` });
      expect(res.json().ok).toBe(true);
      const m = res.json().matrix;
      expect(res.json().aiGenerated).toBe(true);
      // 新增维度被丢弃：只剩白名单三维
      expect(m.dimensions.map((d: { dimName: string }) => d.dimName)).toEqual(["核心能力", "免费与性价比", "上手与生态"]);
      // 精确匹配 → measured；改述 → model_generated（自标 measured 被忽略）
      expect(m.dimensions[0].provenanceA).toBe("measured");
      expect(m.dimensions[0].provenanceB).toBe("measured");
      expect(m.dimensions[1].provenanceA).toBe("model_generated");
      // 空值 → unverified；非法 winner "C" 被丢弃
      expect(m.dimensions[1].provenanceB).toBe("unverified");
      expect(m.dimensions[1].winner).toBeUndefined();
      expect(m.dimensions[2].provenanceA).toBe("unverified");
      expect(m.dimensions[2].provenanceB).toBe("measured");
      // license 逐字等于计费档 label → measured；category 自由文本 → model_generated
      expect(m.itemA.provenance.license).toBe("measured");
      expect(m.itemB.provenance.license).toBe("measured");
      expect(m.itemA.provenance.category).toBe("model_generated");
      // 开放文本恒 model_generated；verdict 恒 model_generated（自标 measured 被忽略）
      expect(m.itemA.provenance.primaryPros).toBe("model_generated");
      expect(m.itemA.provenance.bestFor).toBe("model_generated");
      expect(m.verdictProvenance).toBe("model_generated");
    } finally {
      restore();
    }
  });

  it("知识库路径：react vs vue 全字段 measured", async () => {
    const res = await app.inject({ method: "GET", url: `/api/comparisons?q=${encodeURIComponent("react vs vue")}` });
    expect(res.json().ok).toBe(true);
    const m = res.json().matrix;
    expect(m.verdictProvenance).toBe("measured");
    expect(m.dimensions.every((d: { provenanceA: string; provenanceB: string }) => d.provenanceA === "measured" && d.provenanceB === "measured")).toBe(true);
    expect(m.itemA.provenance.license).toBe("measured");
  });
});

describe("GET /api/comparisons 缓存：分面改动即失效", () => {
  const C = "Prov丙工具";
  const D = "Prov丁工具";

  it("分面改了旧缓存 miss，重算后再次命中", async () => {
    const created = await ctx.repo.createSite({ url: "https://prov-c.example.com", title: C, description: "Prov丙工具的描述", categoryId: "cat-prov" });
    await ctx.repo.setSiteFacets(String(created.id), { pricing: ["freemium"], platform: ["web"], form: ["saas"] });
    const payload = (n: number) => ({
      ...MODEL_MATRIX,
      title: `第${n}次选型结论`,
      itemA: { name: C, category: "开发工具", license: "免费增值", primaryPros: ["p"], tradeoffs: ["t"], bestFor: "b" },
      itemB: { name: D, category: "开发工具", license: "商业付费", primaryPros: ["p"], tradeoffs: ["t"], bestFor: "b" },
      dimensions: [{ dimName: "核心能力", valueA: "a", valueB: "b", winner: "TIE" }],
      verdict: `第${n}次选型结论`,
    });
    const restore = stubLlm(payload);
    try {
      const get = () => app.inject({ method: "GET", url: `/api/comparisons?q=${encodeURIComponent(`${C} vs ${D}`)}` });
      expect((await get()).json().matrix?.verdict).toBe("第1次选型结论");
      expect(generations).toHaveLength(1);

      await ctx.repo.setSiteFacets(String(created.id), { pricing: ["paid"], platform: ["web"], form: ["saas"] });
      const after = await get();
      expect(after.json().cached).toBeUndefined();
      expect(after.json().matrix?.verdict).toBe("第2次选型结论");
      expect(generations).toHaveLength(2);

      expect((await get()).json().cached).toBe(true);
      expect(generations).toHaveLength(2);
    } finally {
      restore();
      await ctx.repo.deleteSite(String(created.id));
    }
  });
});

describe("GET /api/comparisons 无 Key：结构化对照表", () => {
  let noKeyCtx: AppContext;
  let noKeyApp: Awaited<ReturnType<typeof buildServer>>;
  const E = "Prov戊工具";
  // F 用拉丁无意义 token：路由按检索首条取站（既有行为，无相关度阈值），
  // 查询词若与已收录标题共享“工具”等 token 会被模糊命中——这里必须保证
  // 未收录侧真的搜不到，否则测的就不是“未收录”。
  const F = "Zqxw Unrecorded Beta";

  beforeAll(async () => {
    noKeyCtx = await createContext(baseConfig({ apiKey: null }, join(dir, "prov-nokey.db")));
    noKeyApp = await buildServer(noKeyCtx);
    await noKeyApp.ready();
    await noKeyCtx.repo.createCategory({ id: "cat-prov-nokey", title: "无 Key 对照类目" });
    const e = await noKeyCtx.repo.createSite({ url: "https://prov-e.example.com", title: E, description: "Prov戊工具的描述", categoryId: "cat-prov-nokey" });
    await noKeyCtx.repo.setSiteFacets(String(e.id), { pricing: ["freemium"], platform: ["web"], form: ["saas"] });
    await noKeyCtx.repo.updateSiteHealth(String(e.id), { httpStatus: 200, ok: true, latencyMs: 90, redirectTo: null, error: null });
    // 无 Key 服务端装一个“模型被调即炸”的桩：结构化路径绝不能碰 LLM
    const original = globalThis.fetch;
    (globalThis as unknown as { __provNoKeyFetch: typeof fetch }).__provNoKeyFetch = original;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("/chat/completions")) throw new Error("无 Key 路径调用了 LLM");
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
  });

  afterAll(async () => {
    globalThis.fetch = (globalThis as unknown as { __provNoKeyFetch: typeof fetch }).__provNoKeyFetch;
    await noKeyApp.close();
    await noKeyCtx.close();
  });

  it("一侧收录即回结构化表：aiGenerated false、无 winner、固定 verdict", async () => {
    const res = await noKeyApp.inject({ method: "GET", url: `/api/comparisons?q=${encodeURIComponent(`${E} vs ${F}`)}` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().aiGenerated).toBe(false);
    const m = res.json().matrix;
    expect(m.dimensions.map((d: { dimName: string }) => d.dimName)).toEqual(["付费模式", "支持平台", "产品形态", "是否还在维护"]);
    expect(m.dimensions.every((d: { winner?: string }) => d.winner === undefined)).toBe(true);
    expect(m.dimensions[0].valueA).toBe("免费增值");
    expect(m.dimensions[0].provenanceA).toBe("measured");
    expect(m.dimensions[0].valueB).toBe("未验证");
    expect(m.dimensions[0].provenanceB).toBe("unverified");
    expect(m.dimensions[3].valueA).toBe("可达");
    expect(m.dimensions[3].provenanceA).toBe("measured");
    expect(m.verdict).toBe("未调用模型，仅列出站内已核实字段");
    expect(m.verdictProvenance).toBe("model_generated");
    expect(m.itemA.provenance.license).toBe("measured");
    expect(m.itemB.provenance.category).toBe("unverified");
  });

  it("两侧均未收录仍回 null，不编造", async () => {
    const res = await noKeyApp.inject({ method: "GET", url: `/api/comparisons?q=${encodeURIComponent("Zqxw Fictional Alpha vs Zqxw Fictional Beta")}` });
    expect(res.json().ok).toBe(false);
    expect(res.json().matrix).toBeNull();
  });
});
