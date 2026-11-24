import { describe, expect, it } from "vitest";
import { classifyContentSimilarity, fingerprintPageContent, jaccardSimilarity, normalizeDomainHost, resolveDomainFamily, simhashDistance } from "../src/content-deduplication.ts";

const article = "AI tools help people create images videos and documents with modern machine learning systems. ".repeat(8);

describe("content duplicate signals", () => {
  it("creates deterministic fingerprints and recognizes exact hash duplicates", () => {
    const a = fingerprintPageContent(article), b = fingerprintPageContent(article);
    expect(a).toEqual(b);
    expect(classifyContentSimilarity({ left: a, right: b, exactContentHashMatch: true })).toBe("exact_duplicate");
    expect(simhashDistance(a.simhash, b.simhash)).toBe(0);
  });
  it("uses conservative near-duplicate and semantic thresholds", () => {
    const a = fingerprintPageContent(article);
    const b = fingerprintPageContent(article.replaceAll("modern", "advanced"));
    expect(classifyContentSimilarity({ left: a, right: b })).not.toBe("insufficient_content");
    expect(classifyContentSimilarity({ left: a, right: { ...b, simhash: "0000000000000000" }, semanticSimilarity: 0.96 })).toBe("near_duplicate");
    expect(classifyContentSimilarity({ left: fingerprintPageContent("short text"), right: fingerprintPageContent("short text") })).toBe("insufficient_content");
  });
  it("calculates Jaccard and normalizes host names", () => {
    expect(jaccardSimilarity(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3);
    expect(normalizeDomainHost("https://www.Example.com/abc")).toBe("example.com");
    expect(resolveDomainFamily("www.product.example", [["example.com", "product.example"]])).toBe("example.com");
  });
});
