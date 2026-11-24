import { describe, expect, it } from "vitest";
import { extractCrawlCandidateUrls } from "../src/crawl-source-worker.ts";

describe("crawl source URL extraction", () => {
  it("extracts and canonicalizes sitemap locations", () => {
    const result = extractCrawlCandidateUrls(
      "<urlset><url><loc>https://example.com/a#top</loc></url><url><loc>https://example.com/b</loc></url></urlset>",
      "sitemap",
      "https://example.com/sitemap.xml",
    );
    expect(result).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("extracts RSS text links and Atom href links without duplicates", () => {
    const result = extractCrawlCandidateUrls(
      '<rss><channel><item><link>https://example.com/post/1</link></item><item><link>https://example.com/post/1</link></item></channel></rss><link href="https://example.com/feed/2" rel="self"/>',
      "rss",
      "https://example.com/feed.xml",
    );
    expect(result).toEqual(["https://example.com/post/1", "https://example.com/feed/2"]);
  });

  it("rejects unsafe schemes, credential-bearing URLs and malformed links", () => {
    const result = extractCrawlCandidateUrls(
      '<a href="javascript:alert(1)">bad</a><a href="https://user:pass@example.com/private">bad</a><a href="/safe">safe</a><a href="not a url">bad</a>',
      "page",
      "https://example.com/index",
    );
    expect(result).toEqual(["https://example.com/safe"]);
  });

  it("caps candidate fan-out to 100 unique URLs", () => {
    const html = Array.from({ length: 130 }, (_, i) => '<a href="/p/' + i + '">x</a>').join("");
    expect(extractCrawlCandidateUrls(html, "page", "https://example.com/")).toHaveLength(100);
  });
});
