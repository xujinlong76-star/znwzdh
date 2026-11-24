import { describe, expect, it } from "vitest";
import { decideSiteModerationVerdict } from "@navhub/ai";

describe("AI website moderation policy", () => {
  it("auto-approves only high-confidence, high-quality, risk-free results", () => {
    expect(decideSiteModerationVerdict({
      confidence: 0.97, qualityScore: 88, risks: ["none"],
    })).toBe("auto_approve");
  });

  it("sends uncertain or low-quality websites to manual review", () => {
    expect(decideSiteModerationVerdict({
      confidence: 0.82, qualityScore: 95, risks: ["none"],
    })).toBe("manual_review");
    expect(decideSiteModerationVerdict({
      confidence: 0.99, qualityScore: 55, risks: ["none"],
    })).toBe("manual_review");
  });

  it("rejects only high-confidence critical risk evidence", () => {
    expect(decideSiteModerationVerdict({
      confidence: 0.98, qualityScore: 10, risks: ["phishing"],
    })).toBe("reject");
    expect(decideSiteModerationVerdict({
      confidence: 0.91, qualityScore: 10, risks: ["phishing"],
    })).toBe("manual_review");
  });

  it("does not infer safety from HTTPS and supports an optional HTTPS policy", () => {
    expect(decideSiteModerationVerdict({
      confidence: 0.99, qualityScore: 90, risks: ["scam"],
    }, {}, "https://bad.example")).toBe("reject");
    expect(decideSiteModerationVerdict({
      confidence: 0.99, qualityScore: 90, risks: ["none"],
    }, { requireHttps: true }, "http://example.com")).toBe("manual_review");
  });

  it("keeps borderline and unknown risk categories in manual review", () => {
    expect(decideSiteModerationVerdict({
      confidence: 0.96, qualityScore: 90, risks: ["copyright"],
    })).toBe("manual_review");
  });
});
