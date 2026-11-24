import { describe, expect, it } from "vitest";
import { evaluateSearchRankingShadow, type SearchHit } from "../src/index.ts";

function hit(siteId: string, score: number, channels: string[]): SearchHit {
  return {
    siteId,
    score,
    contributions: Object.fromEntries(channels.map((channel, index) => [
      channel,
      { rank: index + 1, value: score / channels.length },
    ])),
  };
}

describe("versioned search ranking shadow", () => {
  it("compares a bounded shadow order without changing production hits", () => {
    const hits = [
      hit("semantic-only", 0.1, ["semantic"]),
      hit("lexical", 0.095, ["exact"]),
      hit("multi-lexical", 0.09, ["exact", "fts"]),
    ];
    const before = structuredClone(hits);
    const result = evaluateSearchRankingShadow(hits, 3);

    expect(result).toMatchObject({
      rankerVersion: "search-shadow-v1",
      featureVersion: "search-features-v1",
      mode: "shadow",
      topK: 3,
      compared: 3,
    });
    expect(result.changed).toBeGreaterThan(0);
    expect(hits).toEqual(before);
  });

  it("keeps identical baseline order when all optional metadata is absent and evidence ties", () => {
    const hits = [
      hit("a", 0.1, ["exact"]),
      hit("b", 0.1, ["exact"]),
      hit("c", 0.1, ["exact"]),
    ];
    expect(evaluateSearchRankingShadow(hits, 2)).toMatchObject({
      overlap: 2,
      changed: 0,
      overlapRate: 1,
    });
  });

  it("uses only bounded, sanitized optional feature values", () => {
    const hits = [hit("a", 1, ["exact"]), hit("b", 1, ["semantic"])];
    const features = new Map([
      ["a", { qualityScore: 1000, freshnessDays: -20, localeMatch: true, preferenceScore: 99 }],
      ["b", { qualityScore: Number.NaN, freshnessDays: Number.POSITIVE_INFINITY, preferenceScore: Number.NaN }],
    ]);
    const result = evaluateSearchRankingShadow(hits, 2, features);
    expect(result.compared).toBe(2);
    expect(result.overlapRate).toBeGreaterThanOrEqual(0);
    expect(result.overlapRate).toBeLessThanOrEqual(1);
  });

  it("clamps topK to a safe positive range", () => {
    const hits = [hit("a", 1, ["fts"])];
    expect(evaluateSearchRankingShadow(hits, 0).topK).toBe(1);
    expect(evaluateSearchRankingShadow(hits, 1000).topK).toBe(100);
  });
});
