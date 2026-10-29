/**
 * AI-6 API 契约：分模型单价簿 + 调用成本快照 + 成本/质量观测读数。
 *
 * 钉住的语义：
 *   1. 单价簿 PUT 是全量替换，空模型/负价/超量必须 400，不静默吞；
 *   2. 解析链：单价簿 > 旧版单一价 > 无。两档都没有时成本落 NULL，
 *      观测接口返回 costSource="none" 与 estimatedCostRmb=null，绝不折算成 ¥0；
 *   3. 快照按「实际应答的模型」取：模型换家时不能沿用主模型的价；
 *   4. 画布生成质量（首过率）来自 canvas_generate 事件，无样本时 null；
 *   5. 单价簿变更落审计。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { callLlm } from "../src/llm-usage.ts";
import { resolveLlmPrice } from "../src/llm-prices.ts";
import type { ResolvedLlm } from "../src/llm-config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-llm-prices-"));
  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "api.db"),
      corsOrigins: ["*"],
      // 旧版单一价：单价簿没命中的模型回落到它
      costPer1kTokensRmb: 0.003,
    }),
  );
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  await new Promise((r) => setTimeout(r, 30));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows SQLite 句柄延迟释放
  }
});

function fakeProvider(model: string): ResolvedLlm {
  return {
    provider: {
      name: "fake-" + model,
      baseUrl: "http://127.0.0.1:11430/v1",
      model,
      apiKey: "sk-fake",
      allowPrivateNetwork: true,
    },
    fallbacks: [],
    source: "system",
  } as unknown as ResolvedLlm;
}

/** 固定用量：1000 输入 + 500 输出，方便手算成本 */
function fakeFetch(model: string) {
  return (async () =>
    new Response(
      JSON.stringify({
        model,
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
}

async function putPrices(items: unknown) {
  return app.inject({ method: "PUT", url: "/api/admin/ai/prices", payload: { items } });
}

/** 用量写入是 fire-and-forget：轮询到目标模型都出现，避免断言与落库竞速 */
async function waitForUsage(models: string[]) {
  for (let i = 0; i < 100; i++) {
    const rows = (await ctx.repo.raw(
      "SELECT model, cost_rmb, prompt_price_per_1k, completion_price_per_1k, price_source FROM llm_usage ORDER BY id",
    )) as Array<Record<string, unknown>>;
    if (models.every((m) => rows.some((r) => r.model === m))) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("llm_usage 未在预期时间内落库");
}

describe("GET/PUT /api/admin/ai/prices", () => {
  it("空簿 + 旧版单一价如实回报", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/ai/prices" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ prices: [], legacyUnitPriceRmb: 0.003 });
  });

  it("保存成功、trim 去重后者胜，并按模型名排序返回", async () => {
    const res = await putPrices([
      { model: "  model-x  ", promptPer1kRmb: 0.001, completionPer1kRmb: 0.001 },
      { model: "model-x", promptPer1kRmb: 0.002, completionPer1kRmb: 0.006 },
      { model: "model-a", promptPer1kRmb: 0.5, completionPer1kRmb: 1.5 },
    ]);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.prices.map((p: { model: string }) => p.model)).toEqual(["model-a", "model-x"]);
    expect(body.prices[1]).toMatchObject({ promptPer1kRmb: 0.002, completionPer1kRmb: 0.006 });

    const get = await app.inject({ method: "GET", url: "/api/admin/ai/prices" });
    expect(get.json().prices).toHaveLength(2);
  });

  it("非法输入一律 400：空模型 / 负价 / 超 200 条", async () => {
    expect((await putPrices([{ model: "  ", promptPer1kRmb: 1, completionPer1kRmb: 1 }])).statusCode).toBe(400);
    expect((await putPrices([{ model: "m", promptPer1kRmb: -0.1, completionPer1kRmb: 1 }])).statusCode).toBe(400);
    expect((await putPrices([{ model: "m", promptPer1kRmb: 1, completionPer1kRmb: 10_001 }])).statusCode).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => ({ model: `m${i}`, promptPer1kRmb: 1, completionPer1kRmb: 1 }));
    expect((await putPrices(many)).statusCode).toBe(400);
  });

  it("每次保存都落审计（ai.prices.update）", async () => {
    const rows = await ctx.repo.raw(
      "SELECT action, target FROM audit_logs WHERE action = 'ai.prices.update' ORDER BY id",
    );
    // 上面只有一次成功保存（非法请求不产生审计）
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toMatchObject({ action: "ai.prices.update", target: "llm_model_prices" });
  });

  it("空数组清空整簿", async () => {
    expect((await putPrices([])).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/admin/ai/prices" })).json().prices).toEqual([]);
  });
});

describe("resolveLlmPrice 解析链", () => {
  it("单价簿命中优先，未命中回落旧版单一价", async () => {
    await putPrices([{ model: "model-x", promptPer1kRmb: 0.002, completionPer1kRmb: 0.006 }]);

    const book = await resolveLlmPrice(ctx, "model-x");
    expect(book).toMatchObject({ promptPer1kRmb: 0.002, completionPer1kRmb: 0.006, source: "book" });

    const legacy = await resolveLlmPrice(ctx, "model-unknown");
    expect(legacy).toMatchObject({ promptPer1kRmb: 0.003, completionPer1kRmb: 0.003, source: "legacy" });
  });
});

describe("callLlm 成本快照与观测读数", () => {
  it("按实际应答模型取价：簿价与旧版价各记各的，成本不为 0", async () => {
    await ctx.repo.run("DELETE FROM llm_usage");
    await putPrices([{ model: "model-x", promptPer1kRmb: 0.002, completionPer1kRmb: 0.006 }]);

    await callLlm(ctx, fakeProvider("model-x"), {
      scenario: "copilot",
      messages: [{ role: "user", content: "ping" }],
      fetchImpl: fakeFetch("model-x"),
    });
    await callLlm(ctx, fakeProvider("model-y"), {
      scenario: "enrich",
      messages: [{ role: "user", content: "ping" }],
      fetchImpl: fakeFetch("model-y"),
    });

    // recordLlmUsage 是 fire-and-forget：等两条都落库，再按模型取行（id 先后不保证）
    const rows = await waitForUsage(["model-x", "model-y"]);
    expect(rows).toHaveLength(2);
    const rowX = rows.find((r) => r.model === "model-x")!;
    const rowY = rows.find((r) => r.model === "model-y")!;
    // model-x：1000/1000*0.002 + 500/1000*0.006 = 0.005
    expect(Number(rowX.cost_rmb)).toBeCloseTo(0.005, 9);
    expect(rowX.price_source).toBe("book");
    // model-y 未进簿：旧版单一价 0.003 套输入输出 = 0.0045
    expect(Number(rowY.cost_rmb)).toBeCloseTo(0.0045, 9);
    expect(rowY.price_source).toBe("legacy");
  });

  it("观测接口：成本走快照口径、覆盖率区分有价/无价、分模型可拆", async () => {
    // 再造一条没有单价的调用：覆盖率的「无价」必须如实计数
    await ctx.repo.recordLlmUsage({ scenario: "enrich", source: "system", model: "model-free", promptTokens: 400, completionTokens: 100, ok: true });

    const res = await app.inject({ method: "GET", url: "/api/admin/ai/observability?window=1d" });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.costSource).toBe("snapshot");
    expect(body.estimatedCostRmb).toBeCloseTo(0.0095, 4);
    expect(body.costCoverage).toMatchObject({
      totalCalls: 3,
      pricedCalls: 2,
      unpricedCalls: 1,
      pricedTokens: 1500 + 1500,
      totalTokens: 1500 + 1500 + 500,
    });
    const x = body.byModel.find((m: { model: string }) => m.model === "model-x");
    expect(x).toMatchObject({ count: 1, tokens: 1500, costRmb: 0.005, pricedCalls: 1 });
    const free = body.byModel.find((m: { model: string }) => m.model === "model-free");
    expect(free.costRmb).toBeNull();
    expect(free.pricedCalls).toBe(0);

    const copilot = body.byScenario.find((s: { scenario: string }) => s.scenario === "copilot");
    expect(copilot.costRmb).toBeCloseTo(0.005, 6);
    expect(copilot.pricedCalls).toBe(1);
  });

  it("画布质量：canvas_generate 事件折出首过率，空样本为 null", async () => {
    const empty = await app.inject({ method: "GET", url: "/api/admin/ai/observability?window=1d" });
    expect(empty.json().canvasQuality).toMatchObject({ generations: 0, firstPassRate: null });

    await ctx.repo.recordEvent("canvas_generate", { meta: { model: "model-x", planned: 3, widgets: 3, dropped: 0, issues: 0, fallback: false } });
    await ctx.repo.recordEvent("canvas_generate", { meta: { model: "model-x", planned: 3, widgets: 2, dropped: 1, issues: 1, fallback: false } });
    await ctx.repo.recordEvent("canvas_generate", { meta: { model: "model-x", planned: 1, widgets: 1, dropped: 0, issues: 0, fallback: true } });

    const res = await app.inject({ method: "GET", url: "/api/admin/ai/observability?window=1d" });
    expect(res.json().canvasQuality).toMatchObject({
      generations: 3,
      cleanGenerations: 1,
      fallbackGenerations: 1,
      droppedWidgets: 1,
      firstPassRate: 0.333,
    });
  });
});

describe("无任何单价时不伪造成本", () => {
  it("单价簿与旧版价都缺 ⇒ resolveLlmPrice 为 null，写入成本列为 NULL", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "navhub-llm-prices-none-"));
    const ctx2 = await createContext(
      loadConfig({ mode: "lite", sqlitePath: join(dir2, "api.db"), corsOrigins: ["*"], costPer1kTokensRmb: 0 }),
    );
    try {
      expect(await resolveLlmPrice(ctx2, "model-x")).toBeNull();
      await callLlm(ctx2, fakeProvider("model-x"), {
        scenario: "copilot",
        messages: [{ role: "user", content: "ping" }],
        fetchImpl: fakeFetch("model-x"),
      });
      const rows = await ctx2.repo.raw("SELECT cost_rmb, price_source FROM llm_usage");
      expect(rows).toHaveLength(1);
      expect(rows[0].cost_rmb).toBeNull();
      expect(rows[0].price_source).toBeNull();
    } finally {
      await ctx2.close();
      await new Promise((r) => setTimeout(r, 30));
      try {
        rmSync(dir2, { recursive: true, force: true });
      } catch {
        // Windows 句柄延迟释放
      }
    }
  });
});
