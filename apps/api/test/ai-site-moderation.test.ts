import { describe, expect, it } from "vitest";
import { decideSiteModerationVerdict, moderateSiteWithAi } from "@navhub/ai";

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

  it("supports the metered application gateway adapter without bypassing it", async () => {
    const provider = { baseUrl: "https://llm.example/v1", model: "test-model", apiKey: "test-key" };
    let called = false;
    const result = await moderateSiteWithAi(provider, {
      url: "https://example.com",
      title: "Example",
      contentExcerpt: "A useful public website with product documentation and tutorials.",
    }, {}, {
      complete: async (_provider, request) => {
        called = true;
        expect(request.json).toBe(true);
        expect(request.temperature).toBe(0);
        expect(request.messages).toHaveLength(2);
        return {
          model: "metered-test-model",
          content: JSON.stringify({
            confidence: 0.98,
            qualityScore: 91,
            category: null,
            tags: ["documentation"],
            risks: ["none"],
            reasons: ["内容清晰且具有实用价值"],
            evidence: ["product documentation and tutorials"],
          }),
        };
      },
    });
    expect(called).toBe(true);
    expect(result.model).toBe("metered-test-model");
    expect(result.verdict).toBe("auto_approve");
  });

  it("fails closed when the metered gateway adapter fails", async () => {
    const provider = { baseUrl: "https://llm.example/v1", model: "test-model", apiKey: "test-key" };
    await expect(moderateSiteWithAi(provider, { url: "https://example.com" }, {}, {
      complete: async () => { throw new Error("quota or gateway unavailable"); },
    })).rejects.toThrow("quota or gateway unavailable");
  });
});
