import { describe, expect, it } from "vitest";
import { extractCrawlCandidateDetails, extractCrawlCandidateUrls } from "../src/crawl-source-worker.ts";

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
      '<feed><entry><title>Atom article</title><link href="https://example.com/feed/2" rel="alternate"/></entry><link href="https://example.com/feed.xml" rel="self"/></feed><rss><channel><item><link>https://example.com/post/1</link></item><item><link>https://example.com/post/1</link></item></channel></rss>',
      "rss",
      "https://example.com/feed.xml",
    );
    expect(result).toEqual(["https://example.com/feed/2", "https://example.com/post/1"]);
  });

  it("keeps RSS item metadata and HTML anchor labels attached to their own candidate", () => {
    const feed = extractCrawlCandidateDetails(
      `<rss><channel><item><title>First article</title><link>https://example.com/1</link><description>First summary</description></item><item><title>Second article</title><link>https://example.com/2</link></item><item><guid isPermaLink="false">article-id-3</guid></item></channel></rss>`,
      "rss",
      "https://example.com/feed.xml",
    );
    expect(feed).toEqual([
      { url: "https://example.com/1", title: "First article", description: "First summary" },
      { url: "https://example.com/2", title: "Second article", description: null },
    ]);
    expect(extractCrawlCandidateDetails(
      '<a href="/docs"><strong>Documentation</strong> portal</a>',
      "page",
      "https://example.com/",
    )).toEqual([{ url: "https://example.com/docs", title: "Documentation portal", description: null }]);
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
