import { describe, expect, it } from "vitest";
import {
  extractFeedUrls,
  extractHtmlMetadata,
  parseCrawlSeeds,
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
