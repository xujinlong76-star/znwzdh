import { describe, expect, it } from "vitest";
import {
  analyzeHtml,
  auditInternalLinks,
  auditJsonLd,
  auditPage,
  auditPageDetailed,
  decodeHtmlEntities,
  isBogusLocalOriginAsset,
  linkHref,
  metaContent,
  normalizeUrl,
  parseSitemapLocs,
  pickSample,
} from "./seo-audit.mjs";

/**
 * 运行时 SEO 审计器的解析层单测。
 *
 * 这个脚本的价值全在「真实响应里能不能发现静默退化」：如果 HTML 解析
 * 悄悄失灵（例如 meta 属性顺序变了、rel 多值没拆开），审计就会全绿而
 * canonical/noindex 问题继续上线。这里用 fixture 锁住解析口径。
 */

const GOOD_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <title>「AI 编程」相关站点 - 示例导航</title>
  <meta name="description" content="AI 编程标签下的站点列表 &amp; 简介" />
  <link rel="canonical" href="https://nav.example/tags/ai" />
  <meta property="og:url" content="https://nav.example/tags/ai" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="示例导航" />
  <meta property="og:locale" content="zh_CN" />
  <meta property="og:image" content="https://nav.example/og-default.png" />
</head>
<body><h1>AI 编程</h1></body>
</html>`;

describe("decodeHtmlEntities", () => {
  it("解码命名实体与数字实体，非法码点降级为空", () => {
    expect(decodeHtmlEntities("a &amp; b &lt;c&gt; &#34;d&#x22;")).toBe('a & b <c> "d"');
    expect(decodeHtmlEntities("&#x110000;")).toBe("");
  });
});

describe("parseSitemapLocs", () => {
  it("解码 &amp;、去重并过滤非 http", () => {
    const xml = `<urlset>
      <url><loc>https://nav.example/site/a?x=1&amp;y=2</loc></url>
      <url><loc>https://nav.example/site/a?x=1&amp;y=2</loc></url>
      <url><loc>ftp://nav.example/file</loc></url>
    </urlset>`;
    expect(parseSitemapLocs(xml)).toEqual(["https://nav.example/site/a?x=1&y=2"]);
  });
});

describe("HTML 字段解析", () => {
  it("meta 的 name/content 顺序任意", () => {
    expect(metaContent('<meta content="x" name="description">', "description")).toBe("x");
    expect(metaContent('<meta name="description" content="y">', "DESCRIPTION")).toBe("y");
    expect(metaContent('<meta name="robots" content="noindex,follow">', "description")).toBeNull();
  });

  it("rel 支持多值（canonical alternate 混写）", () => {
    expect(
      linkHref('<link rel="alternate canonical" href="https://nav.example/a">', "canonical"),
    ).toBe("https://nav.example/a");
  });

  it("analyzeHtml 汇总 title/description/canonical/robots/h1/lang", () => {
    const page = analyzeHtml(GOOD_HTML, "https://nav.example/tags/ai");
    expect(page.title).toBe("「AI 编程」相关站点 - 示例导航");
    expect(page.description).toBe("AI 编程标签下的站点列表 & 简介");
    expect(page.canonical).toBe("https://nav.example/tags/ai");
    expect(page.ogUrl).toBe("https://nav.example/tags/ai");
    expect(page.ogImage).toBe("https://nav.example/og-default.png");
    expect(page.ogType).toBe("website");
    expect(page.ogSiteName).toBe("示例导航");
    expect(page.ogLocale).toBe("zh_CN");
    expect(page.h1Count).toBe(1);
    expect(page.lang).toBe("zh-CN");
    expect(auditPage(page)).toEqual([]);
  });

  it("analyzeHtml 提取 JSON-LD 原文与站内链接，href 实体解码", () => {
    const page = analyzeHtml(
      `${GOOD_HTML}<script type="application/ld+json">{"@type":"WebSite"}</script>
       <a href="/site/a?x=1&amp;y=2">A</a><a href="https://other.example/b">B</a>`,
      "https://nav.example/tags/ai",
    );
    expect(page.jsonLd).toEqual(['{"@type":"WebSite"}']);
    expect(page.anchors).toEqual(["/site/a?x=1&y=2", "https://other.example/b"]);
  });
});

describe("auditJsonLd：结构化数据", () => {
  it("非法 JSON、缺 @context、缺 @type 都要报", () => {
    expect(auditJsonLd(['{"@type":'])).toEqual([expect.stringContaining("不是合法 JSON")]);
    expect(auditJsonLd([JSON.stringify({ "@type": "WebSite" })])).toContain(
      "JSON-LD 缺少 @context 或未声明 schema.org",
    );
    expect(auditJsonLd([JSON.stringify({ "@context": "https://schema.org" })])).toContain(
      "JSON-LD 缺少 @type",
    );
  });

  it("@graph 子节点继承上下文，position 从 1 连续", () => {
    const good = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "首页" },
            { "@type": "ListItem", position: 2, name: "站点" },
          ],
        },
        { "@type": "ItemList", itemListElement: [{ "@type": "ListItem", position: 1 }] },
      ],
    });
    expect(auditJsonLd([good])).toEqual([]);

    const bad = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [{ position: 2 }],
    });
    expect(auditJsonLd([bad])).toEqual([expect.stringContaining("position 应从 1 连续")]);
  });

  it("任何位置都禁止 aggregateRating", () => {
    const block = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "示例",
      aggregateRating: { ratingValue: 5 },
    });
    expect(auditJsonLd([block])).toContain("JSON-LD 出现 aggregateRating（禁止编造评分）");
  });
});

describe("auditInternalLinks：站内链接闭环", () => {
  it("首页必须链到分类入口（/category 总览或 /category/{slug}）", () => {
    expect(auditInternalLinks("https://nav.example/", ["/sites"])).toEqual([
      "首页缺少 /category 站内链接",
    ]);
    expect(auditInternalLinks("https://nav.example/", ["/category/cat-ai"])).toEqual([]);
    // 达标分类不足时目录带整体隐藏，总览 hub 是唯一合法入口：
    // 只认子路径会把「数据薄但结构正确」的首页误判成内链缺失。
    expect(auditInternalLinks("https://nav.example/", ["/category"])).toEqual([]);
  });

  it("站点详情必须链到其他站点，自链/外链不算", () => {
    const url = "https://nav.example/site/a";
    expect(
      auditInternalLinks(url, ["/site/a", "https://other.example/site/b", "#top"]),
    ).toEqual(["站点详情缺少相关 /site/ 站内链接"]);
    expect(auditInternalLinks(url, ["/site/b"])).toEqual([]);
  });

  it("分类页必须链到 /site/", () => {
    expect(auditInternalLinks("https://nav.example/category/ai", ["/category/ai"])).toEqual([
      "分类页缺少 /site/ 站内链接",
    ]);
    expect(auditInternalLinks("https://nav.example/category/ai", ["/site/a"])).toEqual([]);
  });
});

describe("auditPageDetailed：OG 门槛", () => {
  const htmlWith = (head = "") => `<!doctype html><html lang="zh-CN"><head>
    <title>站点详情</title>
    <meta name="description" content="描述">
    <link rel="canonical" href="https://nav.example/site/a">
    <meta property="og:url" content="https://nav.example/site/a">
    ${head}</head><body><h1>一</h1><a href="/site/b">B</a></body></html>`;

  it("sitemap 页面缺 OG 时按 og 归类", () => {
    const issues = auditPageDetailed(analyzeHtml(htmlWith(), "https://nav.example/site/a"));
    const ogMessages = issues.filter((issue) => issue.kind === "og").map((issue) => issue.message);
    expect(ogMessages).toEqual(
      expect.arrayContaining(["缺少 og:image", "缺少 og:type", "缺少 og:site_name", "缺少 og:locale"]),
    );
  });

  it("noindex 页面跳过 OG 与内链要求", () => {
    const html = htmlWith().replace("<h1>一</h1><a href=\"/site/b\">B</a>", "<h1>一</h1>");
    expect(
      auditPageDetailed(analyzeHtml(html, "https://nav.example/site/a"), { expectIndexable: false }),
    ).toEqual([]);
  });
});

describe("isBogusLocalOriginAsset：metadataBase 兜底地址", () => {
  it("真实域名页面引用本机图片算问题", () => {
    expect(isBogusLocalOriginAsset("http://localhost:3000/og-default.png", "https://nav.example/sites")).toBe(true);
    expect(isBogusLocalOriginAsset("http://127.0.0.1:3000/x.png", "https://nav.example/sites")).toBe(true);
    expect(isBogusLocalOriginAsset("http://[::1]:3000/x.png", "https://nav.example/sites")).toBe(true);
  });

  it("审计目标本身就是本机时不算问题", () => {
    expect(isBogusLocalOriginAsset("http://localhost:3078/og.png", "http://127.0.0.1:3078/sites")).toBe(false);
    expect(isBogusLocalOriginAsset("http://localhost:3000/og.png", "http://localhost:3000/sites")).toBe(false);
  });

  it("同为本机但端口不同仍算问题（产物里烤死的兜底地址）", () => {
    // 只看 host 会漏掉这一类：本地审计跑在 :3078，而构建产物里 Next 用
    // http://localhost:3000 兜底 metadataBase —— 两个都是「本机」，端口不同才暴露它
    // 是被烤进快照的地址，不是当次请求解析出来的。2026-10-22 在 /algorithms 上实测。
    expect(isBogusLocalOriginAsset("http://localhost:3000/og-default.png", "http://localhost:3078/algorithms")).toBe(true);
    expect(isBogusLocalOriginAsset("http://127.0.0.1:3000/x.png", "http://localhost:3078/sites")).toBe(true);
  });

  it("默认端口（80/443 缺省）与显式端口不同时也算问题", () => {
    expect(isBogusLocalOriginAsset("http://localhost:3000/x.png", "http://localhost/robots")).toBe(true);
    expect(isBogusLocalOriginAsset("http://localhost/x.png", "http://localhost:3000/sites")).toBe(true);
  });

  it("同域/外链图片与解析失败的地址一律放行", () => {
    expect(isBogusLocalOriginAsset("https://nav.example/og.png", "https://nav.example/sites")).toBe(false);
    expect(isBogusLocalOriginAsset("https://cdn.example/og.png", "https://nav.example/sites")).toBe(false);
    expect(isBogusLocalOriginAsset("/og.png", "https://nav.example/sites")).toBe(false);
    expect(isBogusLocalOriginAsset("not a url", "https://nav.example/sites")).toBe(false);
  });
});

describe("auditPageDetailed：og:image 指向本机", () => {
  const htmlWithImage = (image: string) => `<!doctype html><html lang="zh-CN"><head>
    <title>站点目录</title>
    <meta name="description" content="描述">
    <link rel="canonical" href="/sites">
    <meta property="og:url" content="/sites">
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="示例导航" />
    <meta property="og:locale" content="zh_CN" />
    <meta property="og:image" content="${image}">
    </head><body><h1>站点目录</h1><a href="/site/b">B</a></body></html>`;

  it("线上域名抓到 localhost:3000 的图片时按 og 报", () => {
    const issues = auditPageDetailed(
      analyzeHtml(htmlWithImage("http://localhost:3000/og-default.png"), "https://nav.example/sites"),
    );
    const og = issues.filter((issue) => issue.kind === "og").map((issue) => issue.message);
    expect(og.length).toBe(1);
    expect(og[0]).toContain("og:image 指向本机地址");
    expect(og[0]).toContain("NAVHUB_SITE_URL");
  });

  it("本地环境（base 也是本机）不误报", () => {
    const issues = auditPageDetailed(
      analyzeHtml(htmlWithImage("http://localhost:3078/og-default.png"), "http://127.0.0.1:3078/sites"),
    );
    expect(issues.filter((issue) => issue.kind === "og")).toEqual([]);
  });

  it("缺 origin 时的相对 canonical / og:url 仍然干净", () => {
    const issues = auditPageDetailed(
      analyzeHtml(htmlWithImage("https://nav.example/og-default.png"), "https://nav.example/sites"),
    );
    expect(issues.filter((issue) => issue.kind === "canonical" || issue.kind === "og")).toEqual([]);
  });
});

describe("auditPage：收录底线", () => {
  it("缺 canonical / 多 h1 / noindex 都要报", () => {
    const html = `<!doctype html><html><head><title>页面标题</title>
      <meta name="description" content="描述">
      <meta name="robots" content="noindex,follow">
      </head><body><h1>一</h1><h1>二</h1></body></html>`;
    const problems = auditPage(analyzeHtml(html, "https://nav.example/x"));
    expect(problems).toEqual(
      expect.arrayContaining([
        "缺少 canonical",
        "<html> 缺少 lang",
        "<h1> 数量为 2（应为 1）",
        expect.stringContaining("noindex"),
      ]),
    );
  });

  it("canonical 与 og:url 必须与页面地址一致（尾斜杠归一）", () => {
    const html = `<!doctype html><html lang="zh-CN"><head><title>页面标题</title>
      <meta name="description" content="描述">
      <link rel="canonical" href="https://nav.example/other/">
      <meta property="og:url" content="https://nav.example/x">
      </head><body><h1>一</h1></body></html>`;
    const problems = auditPage(analyzeHtml(html, "https://nav.example/x/"));
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringContaining("canonical 指向"), expect.stringContaining("og:url")]),
    );
  });

  it("normalizeUrl 忽略 hash 与尾斜杠，保留 query", () => {
    expect(normalizeUrl("https://nav.example/a/?p=2#x", "https://nav.example/a/")).toBe(
      "https://nav.example/a?p=2",
    );
  });
});

describe("pickSample", () => {
  it("始终包含首尾、结果去重且不超过上限", () => {
    const urls = Array.from({ length: 100 }, (_, i) => `https://nav.example/${i}`);
    const sample = pickSample(urls, 5);
    expect(sample).toHaveLength(5);
    expect(sample[0]).toBe(urls[0]);
    expect(sample.at(-1)).toBe(urls[99]);
    expect(new Set(sample).size).toBe(sample.length);
  });

  it("少于上限时全量返回（小型站点不被抽样跳过）", () => {
    expect(pickSample(["a", "b"], 20)).toEqual(["a", "b"]);
  });

  it("--all 用 Infinity 表示全量，不抽样", () => {
    const urls = Array.from({ length: 30 }, (_, i) => `https://nav.example/${i}`);
    expect(pickSample(urls, Infinity)).toHaveLength(30);
  });
});
