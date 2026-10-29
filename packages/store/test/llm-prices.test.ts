/**
 * 模型单价簿 + 调用成本快照 + 质量读数（AI-6 存储层）。
 *
 * 钉住的语义：
 *   1. 单价簿是全量替换（PUT 语义），不是逐条 merge——下架的模型必须真的消失，
 *      否则旧价格会继续给新调用折算成本；
 *   2. 成本只在「调用时有单价 + 有 token 读数」时落库，否则 NULL。
 *      写成 0 会把「不知道」记成「免费」，整块成本大盘就成了假账；
 *   3. 聚合把有/无成本的调用分开计数（覆盖率），分模型能拆开看；
 *   4. 画布质量事件读侧对脏 JSON 免疫，无样本时 firstPassRate 为 null。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { canvasQualitySummary } from "../src/index.ts";

let db: Db;
let repo: Repository;

beforeEach(async () => {
  db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  repo = new Repository(db);
});

afterEach(async () => {
  await db.close();
});

const PRICE_M = { promptPer1kRmb: 0.002, completionPer1kRmb: 0.006, source: "book" };

describe("llm_model_prices 单价簿", () => {
  it("写入后可按模型精确读取", async () => {
    await repo.replaceLlmModelPrices([
      { model: "gpt-x", promptPer1kRmb: 0.002, completionPer1kRmb: 0.006 },
      { model: "local-lite", promptPer1kRmb: 0, completionPer1kRmb: 0 },
    ]);
    const all = await repo.listLlmModelPrices();
    expect(all.map((p) => p.model)).toEqual(["gpt-x", "local-lite"]);
    expect(all[0]).toMatchObject({ promptPer1kRmb: 0.002, completionPer1kRmb: 0.006 });

    const one = await repo.getLlmModelPrice("  gpt-x  ");
    expect(one?.promptPer1kRmb).toBe(0.002);
    expect(await repo.getLlmModelPrice("not-exist")).toBeNull();
  });

  it("全量替换：被移除的模型真的消失，空数组清空整簿", async () => {
    await repo.replaceLlmModelPrices([
      { model: "a", promptPer1kRmb: 1, completionPer1kRmb: 2 },
      { model: "b", promptPer1kRmb: 3, completionPer1kRmb: 4 },
    ]);
    await repo.replaceLlmModelPrices([{ model: "a", promptPer1kRmb: 9, completionPer1kRmb: 9 }]);
    const after = await repo.listLlmModelPrices();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ model: "a", promptPer1kRmb: 9 });

    await repo.replaceLlmModelPrices([]);
    expect(await repo.listLlmModelPrices()).toEqual([]);
  });

  it("去空、去重（trim 后同名后者胜）、负数钳到 0、非有限值整行丢弃", async () => {
    await repo.replaceLlmModelPrices([
      { model: "  ", promptPer1kRmb: 1, completionPer1kRmb: 1 },
      { model: "m", promptPer1kRmb: 1, completionPer1kRmb: 1 },
      { model: " m ", promptPer1kRmb: 5, completionPer1kRmb: 6 },
      { model: "neg", promptPer1kRmb: -3, completionPer1kRmb: -4 },
      { model: "nan", promptPer1kRmb: 1, completionPer1kRmb: Number.NaN },
    ]);
    const all = await repo.listLlmModelPrices();
    expect(all.map((p) => p.model)).toEqual(["m", "neg"]);
    expect(all[0]).toMatchObject({ promptPer1kRmb: 5, completionPer1kRmb: 6 });
    expect(all[1]).toMatchObject({ promptPer1kRmb: 0, completionPer1kRmb: 0 });
  });
});

describe("llm_usage 成本快照", () => {
  it("有单价时按输入/输出分别折算并落快照列", async () => {
    await repo.recordLlmUsage({
      scenario: "copilot",
      source: "system",
      model: "gpt-x",
      promptTokens: 1000,
      completionTokens: 500,
      ok: true,
      price: PRICE_M,
    });
    const rows = await repo.raw(
      "SELECT cost_rmb, prompt_price_per_1k, completion_price_per_1k, price_source FROM llm_usage",
    );
    expect(rows).toHaveLength(1);
    // 1000/1000*0.002 + 500/1000*0.006 = 0.005
    expect(rows[0].cost_rmb).toBeCloseTo(0.005, 9);
    expect(rows[0].prompt_price_per_1k).toBeCloseTo(0.002, 9);
    expect(rows[0].completion_price_per_1k).toBeCloseTo(0.006, 9);
    expect(rows[0].price_source).toBe("book");
  });

  it("没有单价 / 没有 token 读数时成本为 NULL，不是 0", async () => {
    await repo.recordLlmUsage({ scenario: "enrich", source: "system", model: "gpt-x", promptTokens: 10, completionTokens: 5, ok: true });
    await repo.recordLlmUsage({ scenario: "enrich", source: "system", model: "gpt-x", ok: true, price: PRICE_M });
    const rows = await repo.raw("SELECT cost_rmb, price_source FROM llm_usage ORDER BY rowid");
    expect(rows[0].cost_rmb).toBeNull();
    expect(rows[0].price_source).toBeNull();
    expect(rows[1].cost_rmb).toBeNull();
  });

  it("负单价快照被拒绝（按没有单价处理）", async () => {
    await repo.recordLlmUsage({
      scenario: "enrich",
      source: "system",
      model: "gpt-x",
      promptTokens: 1000,
      completionTokens: 1000,
      ok: true,
      price: { promptPer1kRmb: -1, completionPer1kRmb: 0.5, source: "book" },
    });
    const rows = await repo.raw("SELECT cost_rmb FROM llm_usage");
    expect(rows[0].cost_rmb).toBeNull();
  });
});

describe("aggregateLlmUsage 成本聚合", () => {
  it("空库时成本为 null，覆盖率为 0/0 如实计数", async () => {
    const agg = await repo.aggregateLlmUsage({ since: 0 });
    expect(agg.totalCostRmb).toBeNull();
    expect(agg.pricedCalls).toBe(0);
    expect(agg.unpricedCalls).toBe(0);
    expect(agg.byModel).toEqual([]);
  });

  it("合计、分场景、分模型：有价与无价调用分开计数，未知成本不混进 0", async () => {
    await repo.recordLlmUsage({ scenario: "copilot", source: "system", model: "gpt-x", promptTokens: 1000, completionTokens: 500, ok: true, price: PRICE_M });
    await repo.recordLlmUsage({ scenario: "copilot", source: "system", model: "gpt-x", promptTokens: 2000, completionTokens: 0, ok: false, errorCode: "timeout", price: PRICE_M });
    await repo.recordLlmUsage({ scenario: "enrich", source: "system", model: "local-lite", promptTokens: 700, completionTokens: 300, ok: true });

    const agg = await repo.aggregateLlmUsage({ since: 0 });
    expect(agg.totalCalls).toBe(3);
    expect(agg.unpricedCalls).toBe(1);
    expect(agg.pricedCalls).toBe(2);
    // 0.005 + 0.004 = 0.009
    expect(agg.totalCostRmb).toBeCloseTo(0.009, 9);
    expect(agg.pricedTokens).toBe(1000 + 500 + 2000);

    const copilot = agg.byScenario.find((s) => s.scenario === "copilot")!;
    expect(copilot.costRmb).toBeCloseTo(0.009, 9);
    expect(copilot.pricedCalls).toBe(2);
    const enrich = agg.byScenario.find((s) => s.scenario === "enrich")!;
    expect(enrich.costRmb).toBeNull();
    expect(enrich.pricedCalls).toBe(0);

    const gpt = agg.byModel.find((m) => m.model === "gpt-x")!;
    expect(gpt.count).toBe(2);
    expect(gpt.errorCalls).toBe(1);
    expect(gpt.costRmb).toBeCloseTo(0.009, 9);
    expect(gpt.pricedCalls).toBe(2);
    const local = agg.byModel.find((m) => m.model === "local-lite")!;
    expect(local.costRmb).toBeNull();
    expect(local.pricedCalls).toBe(0);
  });

  it("最近明细带回成本与单价来源", async () => {
    await repo.recordLlmUsage({ scenario: "copilot", source: "system", model: "gpt-x", promptTokens: 1000, completionTokens: 0, ok: true, price: PRICE_M });
    const recent = await repo.listRecentLlmUsage(5);
    expect(recent[0]!.costRmb).toBeCloseTo(0.002, 9);
    expect(recent[0]!.priceSource).toBe("book");
  });
});

describe("canvasQualitySummary 画布生成质量", () => {
  it("空库给 null 首过率，不编造百分比", async () => {
    const s = await canvasQualitySummary(repo, 7);
    expect(s.generations).toBe(0);
    expect(s.firstPassRate).toBeNull();
    expect(s.droppedWidgets).toBe(0);
  });

  it("首过 = 无 issues 且非兜底；脏 JSON 不计入也不崩", async () => {
    await repo.recordEvent("canvas_generate", { meta: { model: "gpt-x", widgets: 3, issues: 0, dropped: 0, fallback: false } });
    await repo.recordEvent("canvas_generate", { meta: { model: "gpt-x", widgets: 2, issues: 1, dropped: 2, fallback: false } });
    await repo.recordEvent("canvas_generate", { meta: { model: "local", widgets: 1, issues: 0, dropped: 0, fallback: true } });
    // 绕过 recordEvent 直接写一行坏 JSON，模拟历史脏行
    await repo.run(
      "INSERT INTO events (kind, meta, created_at) VALUES ('canvas_generate', '{broken', ?)",
      [Date.now()],
    );
    // 其它 kind 不得混入
    await repo.recordEvent("copilot", { meta: { issues: 0 } });

    const s = await canvasQualitySummary(repo, 7);
    expect(s.generations).toBe(3);
    expect(s.cleanGenerations).toBe(1);
    expect(s.fallbackGenerations).toBe(1);
    expect(s.droppedWidgets).toBe(2);
    expect(s.firstPassRate).toBeCloseTo(0.333, 3);
  });
});
