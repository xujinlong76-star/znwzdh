import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSiteFeedXml, escapeXml } from "@/lib/seo/feed";

/**
 * RSS feed 与搜索引擎验证的结构锁（2026-10-21）。
 *
 * 背景：站点没有 feed，聚合器只能反复抓 HTML；搜索引擎验证 meta 也没有
 * 统一入口（以前要在代码里手写 meta，换 key 就得改代码）。
 *
 * 锁的不变量：
 *   1. XML 字段逐项转义：站点标题/描述是用户可编辑数据，一个 `</title>`
 *      或裸 `&` 就让整份 feed 解析失败；
 *   2. item 链接与站内链接同源（/site/{encodeURIComponent(id)}）；
 *   3. /feed.xml 路由不挂在页面布局上，输出正确的 Content-Type 并走缓存；
 *   4. 首页声明 feed 自动发现（alternates.types），验证 meta 由 env 驱动。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

const sample = buildSiteFeedXml({
  origin: "https://nav.example/",
  title: "测试站 & 导航",
  description: "A < B 的站点导航",
  lastBuildDate: Date.UTC(2026, 9, 21, 12, 0, 0),
  sites: [
    {
      id: "site-1",
      title: '危险 & <script>"标题"</script>',
      description: "描述里有 ]]> 与 &",
      tags: ["开源", "AI & ML"],
      createdAt: Date.UTC(2026, 9, 20, 8, 0, 0),
    },
    { id: "site-2", title: "无描述站点", tags: [] },
  ],
});

describe("buildSiteFeedXml：合法且可解析的 RSS 2.0", () => {
  it("channel 字段全部转义（标题/描述/self 链接）", () => {
    expect(sample).toContain("<title>测试站 &amp; 导航</title>");
    expect(sample).toContain("<description>A &lt; B 的站点导航</description>");
    expect(sample).toContain(
      '<atom:link href="https://nav.example/feed.xml" rel="self" type="application/rss+xml" />',
    );
    expect(sample).toContain("<lastBuildDate>Wed, 21 Oct 2026 12:00:00 GMT</lastBuildDate>");
  });

  it("item 标题里的尖括号/引号不会提前闭合标签", () => {
    expect(sample).not.toContain("<script>");
    expect(sample).toContain("&lt;script&gt;");
    expect(sample).toContain("&quot;标题&quot;");
    expect(sample).toContain("描述里有 ]]&gt; 与 &amp;");
  });

  it("链接与 guid 同源、同编码规则", () => {
    expect(sample).toContain("<link>https://nav.example/site/site-1</link>");
    expect(sample).toContain('<guid isPermaLink="false">navhub:site:site-1</guid>');
    // origin 尾斜杠不产生双斜杠
    expect(sample).not.toContain("https://nav.example//site/");
  });

  it("标签进 category，缺描述时用标题兜底，缺失 createdAt 不输出 pubDate", () => {
    expect(sample).toContain("<category>开源</category>");
    expect(sample).toContain("<category>AI &amp; ML</category>");
    expect(sample).toContain("<description>无描述站点</description>");
    // 第二条没有 createdAt：它的 item 块里不应有 pubDate
    const secondItem = sample.slice(sample.indexOf("navhub:site:site-2"));
    expect(secondItem).not.toContain("<pubDate>");
  });

  it("limit 截断条目数（feed 不承担分页）", () => {
    const many = Array.from({ length: 70 }, (_, i) => ({ id: `s-${i}`, title: `站点 ${i}` }));
    const xml = buildSiteFeedXml({ origin: "https://nav.example", title: "t", sites: many, limit: 50 });
    expect(xml.split("<item>").length - 1).toBe(50);
  });

  it("escapeXml 清理 XML 1.0 拒绝的控制字符", () => {
    expect(escapeXml("a\u0000b\u0007c\nd")).toBe("abc\nd");
  });
});

describe("路由与入口接线", () => {
  it("/feed.xml 是独立 Route Handler：无布局、RSS Content-Type、走缓存", () => {
    const src = overlayFile("src/app/feed.xml/route.ts");
    expect(src).toContain("export async function GET()");
    expect(src).toContain("application/rss+xml; charset=utf-8");
    expect(src).toContain("export const revalidate = 3600");
    expect(src).toContain("siteOrigin()");
    // 只收录 active：feed 里的链接不能指向 broken/archived
    expect(src).toContain("site.status === 'active'");
  });

  it("首页声明 feed 自动发现，验证 meta 由环境变量驱动", () => {
    const src = overlayFile("src/app/page.tsx");
    expect(src).toContain("'application/rss+xml': '/feed.xml'");
    expect(src).toContain("GOOGLE_SITE_VERIFICATION");
    expect(src).toContain("BING_SITE_VERIFICATION");
    expect(src).toContain("BAIDU_SITE_VERIFICATION");
    expect(src).toContain("msvalidate.01");
    expect(src).toContain("baidu-site-verification");
    // 空值不能输出空标签
    expect(src).toMatch(/if\s*\(google\)\s*verification\.google\s*=/);
  });
});
