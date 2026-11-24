import { describe, expect, it } from "vitest";
import { classifyCrawlFailure, crawlRetryDelayMs, domainMayStartCrawl, normalizeCrawlHost } from "../src/crawl-scheduler.ts";

describe("crawl scheduler policies", () => {
  it("routes permanent and policy failures differently from transient failures", () => {
    expect(classifyCrawlFailure("network", 1)).toBe("retry");
    expect(classifyCrawlFailure("network", 6)).toBe("dead_letter");
    expect(classifyCrawlFailure("not_found", 1)).toBe("dead_letter");
    expect(classifyCrawlFailure("robots_denied", 1)).toBe("hold_for_review");
    expect(classifyCrawlFailure("auth_required", 1)).toBe("hold_for_review");
  });
  it("uses bounded exponential backoff, jitter and Retry-After lower bound", () => {
    expect(crawlRetryDelayMs(1, { baseDelayMs: 1000, jitterRatio: 0.2 }, 0.5)).toBe(1000);
    expect(crawlRetryDelayMs(3, { baseDelayMs: 1000, maxDelayMs: 3000, jitterRatio: 0 }, 0.5)).toBe(3000);
    expect(crawlRetryDelayMs(1, { baseDelayMs: 1000 }, 0.5, 5000)).toBe(5000);
    expect(() => crawlRetryDelayMs(0)).toThrow();
  });
  it("enforces a per-domain interval gate", () => {
    expect(domainMayStartCrawl(1000, null, 500)).toBe(true);
    expect(domainMayStartCrawl(1499, 1000, 500)).toBe(false);
    expect(domainMayStartCrawl(1500, 1000, 500)).toBe(true);
  });
  it("normalizes HTTP(S) host and rejects credentials or unsafe schemes", () => {
    expect(normalizeCrawlHost("https://www.Example.com/path")).toBe("example.com");
    expect(() => normalizeCrawlHost("https://user:pass@example.com")).toThrow();
    expect(() => normalizeCrawlHost("file:///etc/passwd")).toThrow();
  });
});
