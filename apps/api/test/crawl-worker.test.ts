import { describe, expect, it } from "vitest";
import {
  extractFeedUrls,
  isRobotsAllowed,
  extractHtmlMetadata,
  parseCrawlSeeds,
  parseRetryAfterMs,
  rankNearDuplicateFingerprints,
} from "../src/jobs/tasks/crawl-worker.task.ts";

describe("crawl worker source parsing", () => {
  it("parses and deduplicates public HTTP(S) seeds", () => {
    expect(parseCrawlSeeds(JSON.stringify([
      { url: "https://example.com/sitemap.xml#top", kind: "sitemap" },
      { url: "https://example.com/sitemap.xml", kind: "sitemap" },
      { url: "file:///etc/passwd", kind: "sitemap" },
      { url: "https://user:pass@example.com/feed.xml", kind: "rss" },
      { url: "https://example.com/feed.xml", kind: "rss" },
    ]))).toEqual([
      { url: "https://example.com/sitemap.xml", kind: "sitemap" },
      { url: "https://example.com/feed.xml", kind: "rss" },
    ]);
  });

  it("rejects malformed seed configuration rather than silently guessing", () => {
    expect(() => parseCrawlSeeds("{bad json")).toThrow("JSON 数组");
    expect(() => parseCrawlSeeds(JSON.stringify({ url: "https://example.com" }))).toThrow("JSON 数组");
  });

  it("extracts sitemap locations, resolves relative links and deduplicates", () => {
    const xml = `<?xml version="1.0"?>
      <urlset>
        <url><loc>https://example.com/a</loc></url>
        <url><loc>https://example.com/b#fragment</loc></url>
        <url><loc>https://example.com/a</loc></url>
        <url><loc>javascript:alert(1)</loc></url>
      </urlset>`;
    expect(extractFeedUrls(xml, "https://example.com/sitemap.xml", "sitemap")).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("extracts RSS and Atom item links", () => {
    const rss = `<rss><channel>
      <item><title>A</title><link>https://news.example/a</link></item>
      <item><title>B</title><link>https://news.example/b</link></item>
    </channel></rss>`;
    expect(extractFeedUrls(rss, "https://news.example/feed.xml", "rss")).toEqual([
      "https://news.example/a",
      "https://news.example/b",
    ]);

    const atom = `<feed>
      <entry><title>C</title><link href="/c" rel="alternate"/></entry>
    </feed>`;
    expect(extractFeedUrls(atom, "https://news.example/feed.xml", "rss")).toEqual([
      "https://news.example/c",
    ]);
    expect(extractFeedUrls(
      '<feed><entry><link href="/self" rel="self"/></entry></feed>',
      "https://news.example/feed.xml",
      "rss",
    )).toEqual([]);
  });

  it("只把最近的 SimHash 近重复作为审核证据，不自动隐藏候选", () => {
    const rows = [
      { canonical_url: "https://example.com/exact", content_hash: "sha256:current", simhash64: "0000000000000000" },
      { canonical_url: "https://example.com/near-1", content_hash: "sha256:other-1", simhash64: "0000000000000001" },
      { canonical_url: "https://example.com/near-3", content_hash: "sha256:other-3", simhash64: "0000000000000007" },
      { canonical_url: "https://example.com/far", content_hash: "sha256:far", simhash64: "ffffffffffffffff" },
      { canonical_url: "https://example.com/bad", content_hash: "sha256:bad", simhash64: "not-a-hash" },
    ];
    expect(rankNearDuplicateFingerprints(rows, "sha256:current", "0000000000000000")).toEqual([
      { canonicalUrl: "https://example.com/near-1", distance: 1 },
      { canonicalUrl: "https://example.com/near-3", distance: 3 },
    ]);
    expect(rankNearDuplicateFingerprints(rows, "sha256:current", "0000000000000000", {
      maxDistance: 1, limit: 1,
    })).toEqual([{ canonicalUrl: "https://example.com/near-1", distance: 1 }]);
  });

  it("遵守 robots.txt 的用户代理分组、最长匹配与 Allow 优先规则", () => {
    const rules = `User-agent: *
Disallow: /private
Allow: /private/public
Disallow: /search?
User-agent: NavHubDiscoveryBot
Disallow: /internal
`;
    expect(isRobotsAllowed(rules, "https://example.com/private/account")).toBe(false);
    expect(isRobotsAllowed(rules, "https://example.com/private/public/page")).toBe(true);
    // 站点对本 Worker 的专属规则优先于通配组。
    expect(isRobotsAllowed(rules, "https://example.com/private/account", "NavHubDiscoveryBot/1.0")).toBe(true);
    expect(isRobotsAllowed(rules, "https://example.com/internal/admin", "NavHubDiscoveryBot/1.0")).toBe(false);
    expect(isRobotsAllowed(rules, "https://example.com/open")).toBe(true);
    expect(isRobotsAllowed(
      "User-agent: OtherBot\nDisallow: /",
      "https://example.com/private",
      "NavHubDiscoveryBot/1.0",
    )).toBe(true);
  });

  it("parses Retry-After seconds and HTTP-date with a six-hour ceiling", () => {
    const now = Date.parse("2026-11-24T00:00:00Z");
    expect(parseRetryAfterMs("120", now)).toBe(120_000);
    expect(parseRetryAfterMs("Tue, 24 Nov 2026 00:02:00 GMT", now)).toBe(120_000);
    expect(parseRetryAfterMs("999999", now)).toBe(6 * 60 * 60_000);
    expect(parseRetryAfterMs("invalid", now)).toBe(0);
    expect(parseRetryAfterMs("-5", now)).toBe(0);
  });

  it("extracts title, description and readable text without script/style noise", () => {
    const html = `<html lang="zh-CN"><head>
      <title>示例站点</title>
      <meta name="description" content="这是站点简介">
      <style>.hidden{display:none}</style><script>secret()</script>
      </head><body><main>这是公开网页的正文内容。</main></body></html>`;
    expect(extractHtmlMetadata(html)).toEqual({
      title: "示例站点",
      description: "这是站点简介",
      text: expect.stringContaining("这是公开网页的正文内容"),
    });
    expect(extractHtmlMetadata(html).text).not.toContain("secret");
  });
});
