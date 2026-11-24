import { describe, expect, it } from "vitest";
import { buildSiteQualityAssessments } from "../src/site-quality-assessment.ts";

const site = {
  url: "https://example.com",
  title: "Example",
  description: "A useful website",
  iconKey: "example.svg",
  categoryId: "tools",
  tags: ["tool"],
};

describe("buildSiteQualityAssessments", () => {
  it("uses repeated non-WAF health evidence and keeps unsupported dimensions unknown", () => {
    const result = buildSiteQualityAssessments(site, [
      { ok: true, checkedAt: 100, error: null },
      { ok: false, checkedAt: 200, error: "HTTP 503" },
      { ok: false, checkedAt: 300, error: "BOT_BLOCKED: HTTP 403" },
    ]);
    expect(result.accessibility.score).toBe(50);
    expect(result.accessibility.evidence.join(" ")).toContain("2 次非 WAF 阻断巡检");
    expect(result.contentCompleteness.score).toBe(100);
    expect(result.uniqueness.score).toBe(100);
    expect(result.sourceTrust.score).toBeNull();
    expect(result.relevance.score).toBeNull();
    expect(result.freshness.score).toBeNull();
    expect(result.risk.score).toBeNull();
  });

  it("does not infer accessibility from a single failed probe or WAF-only evidence", () => {
    const result = buildSiteQualityAssessments(site, [
      { ok: false, checkedAt: 100, error: "timeout" },
      { ok: false, checkedAt: 200, error: "BOT_BLOCKED: HTTP 403" },
    ]);
    expect(result.accessibility.score).toBeNull();
    expect(result.accessibility.evidence[0]).toContain("不足两次");
  });

  it("scores missing catalog metadata explicitly", () => {
    const result = buildSiteQualityAssessments(
      { ...site, description: null, iconKey: null, tags: [] },
      [],
    );
    expect(result.contentCompleteness.score).toBe(40);
    expect(result.contentCompleteness.evidence).toContain("描述字段：缺失");
  });
});
