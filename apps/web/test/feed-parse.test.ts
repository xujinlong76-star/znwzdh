/**
 * 订阅源解析器的契约测试。
 *
 * 小卡以前不取数（config.feedUrl 读了不用），列表是五条写死的假新闻。现在内容全部
 * 来自 /api/rss 解析的真实条目，所以要把「解析不出来的东西不能编」钉住：
 *  - 链接只留干净 http(s)，伪协议条目变 null 而不是可点跳转；
 *  - 没有时间的条目返回 null，不能显示成「刚刚」；
 *  - 畸形/截断 XML 不抛错，也不把半条内容当真条目。
 */
import { describe, expect, it } from "vitest";

import {
  MAX_FEED_ITEMS,
  decodeEntities,
  looksLikeFeed,
  parseFeed,
  relativeTime,
  stripTags,
  toPlainText,
} from "../src/lib/modular/feed-parse";

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>引擎周报 &amp; 评论</title>
  <link>https://example.com</link>
  <item>
    <title>第一条：&lt;script&gt;alert(1)&lt;/script&gt; 与 &amp;nbsp; 空格</title>
    <link>https://example.com/one</link>
    <pubDate>Mon, 05 Oct 2026 08:00:00 GMT</pubDate>
    <description><![CDATA[<p>摘要<strong>带标签</strong>与 &#39;引号&#39;</p>]]></description>
    <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">阿澄</dc:creator>
  </item>
  <item>
    <title>第二条走 atom 时间</title>
    <link>https://example.com/two</link>
    <dc:date xmlns:dc="http://purl.org/dc/elements/1.1/">2026-10-04T10:20:00Z</dc:date>
  </item>
  <item><title>缺链接的一条</title><pubDate>not-a-date</pubDate></item>
  <item><title>伪协议条目</title><link>javascript:alert(1)</link></item>
  <item><link>https://example.com/no-title</link></item>
</channel></rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom 站点</title>
  <link rel="self" href="https://example.com/feed"/>
  <entry>
    <title>Atom 条目标题</title>
    <link rel="self" href="https://example.com/self"/>
    <link rel="alternate" href="https://example.com/post?utm=a&amp;b=1"/>
    <published>2026-10-01T00:00:00Z</published>
    <author><name>某作者</name><email>a@b.c</email></author>
    <summary type="html">&lt;div&gt;摘要&lt;/div&gt;</summary>
  </entry>
</feed>`;

const RDF_FIXTURE = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
  <channel rdf:about="https://example.com"><title>RDF 源</title></channel>
  <item rdf:about="https://example.com/rdf-one"><title>只有 about 的条目</title></item>
  <item rdf:about="https://example.com/rdf-two"><title>带 resource 链接</title><link rdf:resource="https://resource.example/two"/></item>
</rdf:RDF>`;

describe("decodeEntities / toPlainText：纯文本化但不双重解码", () => {
  it("数字与命名实体都解，双重转义只解一层", () => {
    expect(decodeEntities("a&amp;b")).toBe("a&b");
    expect(decodeEntities("&#39;x&#39;")).toBe("'x'");
    expect(decodeEntities("&#x27;y</b>")).toContain("y");
    expect(decodeEntities("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
  });

  it("控制字符与代理区码点被丢掉", () => {
    expect(decodeEntities("&#0;bell&#x7;")).toBe("bell");
    expect(decodeEntities("&#xd800;")).toBe("");
  });

  it("先脱标签再压空白，超长截断会申报", () => {
    expect(toPlainText("<p>你好   <strong>世界</strong></p>")).toEqual({ text: "你好 世界", truncated: false });
    // 行内标签不留空格，块级标签才断词
    expect(toPlainText("<p>摘要<strong>加粗</strong>尾部</p>")).toEqual({ text: "摘要加粗尾部", truncated: false });
    const long = toPlainText("x".repeat(500));
    expect(long.text.length).toBeLessThanOrEqual(400);
    expect(long.truncated).toBe(true);
    expect(stripTags("a<br/>b")).toBe("a b");
  });
});

describe("parseFeed：三种源格式都按真实字段解析", () => {
  const rss = parseFeed(RSS_FIXTURE);

  it("RSS 2.0：源标题、条目顺序与时间", () => {
    expect(rss.format).toBe("rss");
    expect(rss.feedTitle).toBe("引擎周报 & 评论");
    expect(rss.items[0]?.title).toBe("第一条：alert(1) 与 &nbsp; 空格");
    expect(rss.items[0]?.link).toBe("https://example.com/one");
    expect(rss.items[0]?.summary).toBe("摘要带标签与 '引号'");
    expect(rss.items[0]?.author).toBe("阿澄");
    expect(rss.items[0]?.publishedAt).toBe(new Date("Mon, 05 Oct 2026 08:00:00 GMT").toISOString());
    expect(rss.items[1]?.publishedAt).toBe(new Date("2026-10-04T10:20:00Z").toISOString());
  });

  it("转义过的 HTML 不会原样上卡；双重转义的字面文本保留", () => {
    expect(rss.items[0]?.title).not.toContain("<script>");
    expect(rss.items[0]?.title).toContain("alert(1)");
    // 标题里写的是 `&amp;nbsp;`（源自己转义过），解一层得到字面 `&nbsp;` 就停手：
    // 双重解码会把用户想看的文本变成空白，也会给构造数据留出绕过口
    expect(rss.items[0]?.title).toContain("&nbsp;");
    expect(toPlainText("空&nbsp;格")).toEqual({ text: "空 格", truncated: false });
    const literal = parseFeed(`<rss><channel><title>t</title><item><title>&amp;lt;em&amp;gt;字面&amp;lt;/em&amp;gt;</title><link>https://a.example/1</link></item></channel></rss>`);
    expect(literal.items[0]?.title).toBe("&lt;em&gt;字面&lt;/em&gt;");
  });

  it("缺链接/坏时间保留条目但 link=null；伪协议链接被拒", () => {
    const noLink = rss.items.find((i) => i.title === "缺链接的一条");
    expect(noLink?.link).toBeNull();
    expect(noLink?.publishedAt).toBeNull();
    const jsLink = rss.items.find((i) => i.title === "伪协议条目");
    expect(jsLink?.link).toBeNull();
  });

  it("没有标题的条目直接丢弃并计数", () => {
    expect(rss.items.some((i) => i.title === "")).toBe(false);
    expect(rss.dropped).toBe(1);
    expect(rss.items).toHaveLength(4);
  });

  it("Atom：优先 alternate 链接，作者取 name，时间取 published", () => {
    const atom = parseFeed(ATOM_FIXTURE);
    expect(atom.format).toBe("atom");
    expect(atom.feedTitle).toBe("Atom 站点");
    expect(atom.items[0]?.link).toBe("https://example.com/post?utm=a&b=1");
    expect(atom.items[0]?.author).toBe("某作者");
    expect(atom.items[0]?.publishedAt).toBe(new Date("2026-10-01T00:00:00Z").toISOString());
    expect(atom.items[0]?.summary).toBe("摘要");
  });

  it("RDF：about 与 link rdf:resource 两种条目地址都认", () => {
    const rdf = parseFeed(RDF_FIXTURE);
    expect(rdf.format).toBe("rdf");
    expect(rdf.items[0]?.link).toBe("https://example.com/rdf-one");
    expect(rdf.items[1]?.link).toBe("https://resource.example/two");
  });

  it("条数上限与 truncated 申报", () => {
    const many = `<rss><channel><title>大源</title>${Array.from({ length: 40 }, (_, i) => `<item><title>t${i}</title><link>https://example.com/${i}</link></item>`).join("")}</channel></rss>`;
    const capped = parseFeed(many, { maxItems: 10 });
    expect(capped.items).toHaveLength(10);
    expect(capped.truncated).toBe(true);
    expect(parseFeed(many).items.length).toBeLessThanOrEqual(MAX_FEED_ITEMS);
  });

  it("非订阅内容 / 畸形 XML 不抛错，只报 unknown 与 0 条", () => {
    expect(() => parseFeed("<html><body>不是源</body></html>")).not.toThrow();
    expect(parseFeed("<html><body>不是源</body></html>").items).toHaveLength(0);
    // 尾部被截断的半条不应变成条目
    const cut = `<rss><channel><title>截断</title><item><title>完整的一条</title><link>https://a.example/1</link></item><item><title>半条`;
    const parsed = parseFeed(cut);
    expect(parsed.items.map((i) => i.title)).toEqual(["完整的一条"]);
  });
});

describe("relativeTime：没有时间就说没有", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("null / 非法时间返回 null，不返回「刚刚」", () => {
    expect(relativeTime(null, now)).toBeNull();
    expect(relativeTime("not-a-date", now)).toBeNull();
  });

  it("分档：刚刚 / 分钟 / 小时 / 天 / 月 / 年", () => {
    expect(relativeTime(ago(30_000), now)).toBe("刚刚");
    expect(relativeTime(ago(5 * 60_000), now)).toBe("5 分钟前");
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe("3 小时前");
    expect(relativeTime(ago(10 * 86_400_000), now)).toBe("10 天前");
    expect(relativeTime(ago(70 * 86_400_000), now)).toBe("2 个月前");
    expect(relativeTime(ago(400 * 86_400_000), now)).toBe("1 年前");
  });

  it("未来时间按 0 处理，显示刚刚而不是负数", () => {
    expect(relativeTime(ago(-600_000), now)).toBe("刚刚");
  });
});

describe("looksLikeFeed：填错地址要说这不是源", () => {
  it("Content-Type 或正文特征命中即认为是源", () => {
    expect(looksLikeFeed("application/rss+xml; charset=utf-8", "")).toBe(true);
    expect(looksLikeFeed("application/atom+xml", "")).toBe(true);
    expect(looksLikeFeed("text/html", "<?xml version=\"1.0\"?><rss>")).toBe(true);
    expect(looksLikeFeed("text/html", "<!DOCTYPE html><FEED>x</FEED")).toBe(true);
  });

  it("普通网页返回 false", () => {
    expect(looksLikeFeed("text/html; charset=utf-8", "<!DOCTYPE html><html><body>登录</body></html>")).toBe(false);
    expect(looksLikeFeed("application/json", "{\"ok\":true}")).toBe(false);
  });
});
