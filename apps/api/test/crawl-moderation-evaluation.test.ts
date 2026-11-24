import { describe, expect, it } from "vitest";
import { selectGoldEvaluationSample } from "../src/routes/crawl-operations.ts";

describe("selectGoldEvaluationSample", () => {
  it("supports a deterministic 100-case full-set evaluation sample", () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `gold-${String(index).padStart(3, "0")}`,
      category: index % 3 === 0 ? "development" : "productivity",
      final_risk: index % 4 === 0,
    }));
    const first = selectGoldEvaluationSample(rows, 100);
    const second = selectGoldEvaluationSample(rows, 100);
    expect(first).toHaveLength(100);
    expect(new Set(first.map(row => row.id)).size).toBe(100);
    expect(first.map(row => row.id)).toEqual(second.map(row => row.id));
  });

  it("caps oversized evaluation requests at 100 rather than silently evaluating more", () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({
      id: `gold-${String(index).padStart(3, "0")}`,
      category: "development",
      final_risk: index % 5 === 0,
    }));
    expect(selectGoldEvaluationSample(rows, 5000)).toHaveLength(100);
  });
});
