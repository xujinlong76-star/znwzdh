/**
 * 日堆叠柱 + 累计花费线的语义层守卫（buildDailyChartModel）。
 *
 * 钉三件事：
 *  1. 图例/堆叠顺序按窗口总调用数统一排——同一模型在各日不换层；
 *  2. 累计成本线「无价日不增长、也不补 0」，全部无价时整条线不出现；
 *  3. 空态就是空态：不生成合成数据（对照 dashboard-traffic-chart 的反面教材）。
 */
import { describe, expect, it } from "vitest";
import {
  buildDailyChartModel,
  COST_LINE_COLOR,
  MODEL_PALETTE,
} from "@/components/ai/llm-daily-cost-chart";
import type { HubAiDailyTrendPoint } from "@/lib/navhub-api";

function day(d: string, models: HubAiDailyTrendPoint["models"], costRmb: number | null): HubAiDailyTrendPoint {
  return {
    day: d,
    calls: models.reduce((a, m) => a + m.calls, 0),
    tokens: 0,
    errorCalls: 0,
    costRmb,
    pricedCalls: costRmb === null ? 0 : 1,
    models,
  };
}

describe("buildDailyChartModel", () => {
  it("图例按窗口总调用数降序、颜色按序分配，各日堆叠段同序不换层", () => {
    const daily = [
      day("2026-10-28", [
        { model: "a", calls: 1, tokens: 0, costRmb: null },
        { model: "b", calls: 5, tokens: 0, costRmb: null },
      ], null),
      day("2026-10-29", [
        { model: "a", calls: 9, tokens: 0, costRmb: null },
        { model: "b", calls: 1, tokens: 0, costRmb: null },
      ], null),
    ];
    const chart = buildDailyChartModel(daily);
    // 总量 a=10 > b=6：a 排第一，且两天的段序一致（都 a 在前）
    expect(chart.models.map((m) => m.model)).toEqual(["a", "b"]);
    expect(chart.models[0].color).toBe(MODEL_PALETTE[0]);
    expect(chart.models[1].color).toBe(MODEL_PALETTE[1]);
    for (const d of chart.days) {
      expect(d.segments.map((s) => s.model)).toEqual(["a", "b"]);
    }
    expect(chart.maxTotalCalls).toBe(10);
  });

  it("累计成本线：无价日不增长也不补 0，累计只走带价样本", () => {
    const daily = [
      day("2026-10-27", [{ model: "a", calls: 1, tokens: 0, costRmb: 1.5 }], 1.5),
      day("2026-10-28", [{ model: "a", calls: 2, tokens: 0, costRmb: null }], null),
      day("2026-10-29", [{ model: "a", calls: 1, tokens: 0, costRmb: 0.5 }], 0.5),
    ];
    const chart = buildDailyChartModel(daily);
    expect(chart.hasAnyCost).toBe(true);
    expect(chart.days.map((d) => d.cumCostRmb)).toEqual([1.5, 1.5, 2]);
    expect(chart.windowCostRmb).toBe(2);
    expect(chart.maxCumCostRmb).toBe(2);
  });

  it("全部无价：成本线与右轴不出现，windowCostRmb 为 null 而不是 0", () => {
    const daily = [day("2026-10-29", [{ model: "a", calls: 3, tokens: 0, costRmb: null }], null)];
    const chart = buildDailyChartModel(daily);
    expect(chart.hasAnyCost).toBe(false);
    expect(chart.windowCostRmb).toBeNull();
    expect(chart.days[0].cumCostRmb).toBeNull();
  });

  it("空输入就是空态：没有合成序列", () => {
    const chart = buildDailyChartModel([]);
    expect(chart.days).toEqual([]);
    expect(chart.models).toEqual([]);
    expect(chart.maxTotalCalls).toBe(0);
    expect(chart.windowCalls).toBe(0);
  });

  it("成本线颜色是独立的焦点色，不与模型堆叠色混淆", () => {
    expect(MODEL_PALETTE).not.toContain(COST_LINE_COLOR);
  });
});
