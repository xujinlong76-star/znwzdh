import { describe, expect, it } from "vitest";
import { extractMetadata } from "../src/metadata.ts";

/**
 * 数字实体解码的边界。
 *
 * 抽取的 HTML 是**第三方页面**，实体值不可信；`String.fromCodePoint` 对越界码位直接
 * 抛 RangeError，而 `extractMetadata` 在 enrich.ts 里位于 try 之外（那个 try 只兜抓取
 * 一步）。所以一个坏实体能把整条富化请求打成 500（投稿与 refetch_metadata 任务一起
 * 失败）。这组用例钉住「降级而不是抛错」，也钉住合法实体没被一起砍掉。
 */
describe("元数据：第三方 HTML 的数字实体", () => {
  it("越界码位降级为替换符，而不是抛 RangeError", () => {
    const html = "<html><head><title>中央人民政府 &#1114112; 门户</title></head><body></body></html>";
    expect(() => extractMetadata(html, "https://example.com/")).not.toThrow();
    const meta = extractMetadata(html, "https://example.com/");
    expect(meta.title).toContain("中央人民政府");
    expect(meta.title).toContain("门户");
    expect(meta.title).toContain("\uFFFD");
  });

  it("十六进制实体同样受限（&#x110000; 与超长十六进制）", () => {
    const html = "<html><head><title>A &#x110000; B &#xFFFFFFFFFFFFFFFF; C</title></head></html>";
    expect(() => extractMetadata(html, "https://example.com/")).not.toThrow();
    expect(extractMetadata(html, "https://example.com/").title).toContain("A");
  });

  it("代理区码位不留孤立代理项（PG 的 text 拒收，写库会整条失败）", () => {
    const html = "<html><head><meta property=\"og:description\" content=\"前&#xD800;后\"></head></html>";
    const meta = extractMetadata(html, "https://example.com/");
    expect(meta.description).toBe("前\uFFFD后");
  });

  it("合法实体仍然正确解码：中文、emoji、命名实体", () => {
    const html =
      "<html><head><title>&#20013;&#22269; &amp; 😀 &#x1F600;</title>" +
      "<meta name=\"description\" content=\"A&nbsp;B&#39;C\"></head></html>";
    const meta = extractMetadata(html, "https://example.com/");
    expect(meta.title).toBe("中国 & 😀 😀");
    expect(meta.description).toBe("A B'C");
  });
});

/**
 * 图标来源：声明的 vs 按根路径猜的。
 *
 * 富化审核（AI-4c）把每个字段的来源展示给运营：页面没写 link rel=icon 时，
 * 抽取层会把 /favicon.ico 当成候选——这是「猜的」，不保证存在。若仍标成
 * scraped（页面抓取），审核界面就等于替页面作证，运营也没法据此拒绝。
 */
describe("元数据：图标来源", () => {
  it("页面声明了 icon → declared", () => {
    const html =
      "<html><head><title>t</title>" +
      "<link rel=\"icon\" href=\"/assets/icon.png\"></head><body></body></html>";
    const meta = extractMetadata(html, "https://example.com/page");
    expect(meta.icon).toBe("https://example.com/assets/icon.png");
    expect(meta.iconSource).toBe("declared");
  });

  it("没有声明 icon → fallback 到根路径 /favicon.ico，并如实标 fallback", () => {
    const html = "<html><head><title>t</title></head><body></body></html>";
    const meta = extractMetadata(html, "https://example.com/page");
    expect(meta.icon).toBe("https://example.com/favicon.ico");
    expect(meta.iconSource).toBe("fallback");
  });

  it("apple-touch-icon 也算页面声明", () => {
    const html =
      "<html><head><title>t</title>" +
      "<link rel=\"apple-touch-icon\" href=\"/apple.png\"></head><body></body></html>";
    const meta = extractMetadata(html, "https://example.com/");
    expect(meta.icon).toBe("https://example.com/apple.png");
    expect(meta.iconSource).toBe("declared");
  });
});
