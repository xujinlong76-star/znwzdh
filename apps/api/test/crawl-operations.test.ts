import { describe, expect, it } from "vitest";
import { scoreCrawlCandidate } from "../src/routes/crawl-operations.ts";

describe("crawl candidate quality hints", () => {
  it("rewards complete, substantial HTTPS pages with explainable reasons", () => {
    const result = scoreCrawlCandidate({
      url: "https://example.com/",
      title: "Example",
      description: "A useful website",
      evidence: { tokenCount: 900, nearDuplicateCandidates: [] },
    });
    expect(result.score).toBe(85);
    expect(result.reasons).toContain("正文信息量较充分");
    expect(result.reasons).toContain("使用 HTTPS");
  });
  it("penalizes exact and near duplicate evidence without making an automatic decision", () => {
    const clean = scoreCrawlCandidate({ url: "https://example.com", title: "A", description: "B", evidence: { tokenCount: 500 } });
    const duplicate = scoreCrawlCandidate({
      url: "https://example.com", title: "A", description: "B",
      evidence: { tokenCount: 500, exactDuplicateOf: "https://other.example", nearDuplicateCandidates: [{ url: "x" }, { url: "y" }] },
    });
    expect(duplicate.score).toBeLessThan(clean.score);
    expect(duplicate.reasons).toContain("存在完全重复页面证据");
  });
  it("bounds scores and reports missing content", () => {
    const result = scoreCrawlCandidate({ url: "not-a-url", evidence: { tokenCount: 0 } });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.reasons).toContain("缺少页面标题");
    expect(result.reasons).toContain("URL 格式异常");
  });
});
