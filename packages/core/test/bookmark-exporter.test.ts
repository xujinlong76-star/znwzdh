/**
 * bookmark-exporter.ts 覆盖：Netscape 书签导出、NavHub 冷备打包与校验。
 *
 * 该文件此前没有任何测试引用（0% 覆盖）：数据主权导出是灾备链路，
 * 格式回归（转义、分类归属、非法 URL 过滤）没有任何保护。
 */
import { describe, expect, it } from "vitest";
import {
  exportNavHubBackup,
  exportNetscapeBookmarks,
  validateNavHubBackup,
} from "../src/bookmark-exporter.ts";
import type { Category, Site } from "../src/types.ts";

function cat(over: Partial<Category> = {}): Category {
  return {
    id: "c1",
    title: "开发工具",
    createdAt: 1700000000000,
    updatedAt: 1700000100000,
    ...over,
  } as unknown as Category;
}

function site(over: Partial<Site> = {}): Site {
  return {
    id: "s1",
    title: "GitHub",
    url: "https://github.com",
    categoryId: "c1",
    createdAt: 1700000000000,
    ...over,
  } as unknown as Site;
}

describe("exportNetscapeBookmarks", () => {
  it("空输入只输出文件头尾", () => {
    const out = exportNetscapeBookmarks([], []);
    expect(out).toContain("<!DOCTYPE NETSCAPE-Bookmark-file-1>");
    expect(out).toContain("<TITLE>Bookmarks</TITLE>");
    expect(out).toContain("<DL><p>");
    expect(out.trimEnd().endsWith("</DL><p>")).toBe(true);
    expect(out).not.toContain("<DT><H3");
  });

  it("有站点的分类输出 H3 与 A 链接；空分类被跳过", () => {
    const out = exportNetscapeBookmarks(
      [cat(), cat({ id: "c2", title: "空分类" })],
      [site()],
    );
    expect(out).toContain("开发工具");
    expect(out).not.toContain("空分类");
    expect(out).toContain('<DT><A HREF="https://github.com"');
    expect(out).toContain(">GitHub</A>");
    // 分类 ADD_DATE / LAST_MODIFIED 取自 createdAt / updatedAt（秒）
    expect(out).toContain('ADD_DATE="1700000000"');
    expect(out).toContain('LAST_MODIFIED="1700000100"');
  });

  it("无分类的站点（categoryId 为空或不在分类表里）归入未分类书签", () => {
    const out = exportNetscapeBookmarks(
      [cat()],
      [site({ id: "s2", categoryId: null }), site({ id: "s3", categoryId: "missing" })],
    );
    expect(out).toContain("未分类书签");
    expect(out.match(/未分类书签/g)).toHaveLength(1);
  });

  it("非法 URL（非 http(s)、空、相对路径）被跳过", () => {
    const out = exportNetscapeBookmarks(
      [cat()],
      [
        site({ id: "a", url: "ftp://example.com" }),
        site({ id: "b", url: "" }),
        site({ id: "c", url: "/relative/path" }),
        site({ id: "d", url: "https://ok.example.com" }),
      ],
    );
    expect(out).not.toContain("ftp://example.com");
    expect(out).not.toContain("/relative/path");
    expect(out).toContain("https://ok.example.com");
  });

  it("HTML 转义：标题/描述/链接里的 <>&\"' 都被转义", () => {
    const out = exportNetscapeBookmarks(
      [cat({ title: 'A<B>&"C"' })],
      [
        site({
          url: "https://x.com/?a=1&b=2",
          title: "Tom's <Site>",
          description: 'desc "quoted"',
        }),
      ],
    );
    expect(out).toContain("A&lt;B&gt;&amp;&quot;C&quot;");
    expect(out).toContain("Tom&#039;s &lt;Site&gt;");
    expect(out).toContain("https://x.com/?a=1&amp;b=2");
    expect(out).toContain("<DD>desc &quot;quoted&quot;");
  });

  it("icon 与 tags 属性：有则输出，无则省略；description 缺失时无 DD 行", () => {
    const out = exportNetscapeBookmarks(
      [cat()],
      [
        site({ iconKey: "gh.png", tags: ["dev", "git"], description: "代码托管" }),
        site({ id: "s2", title: "Plain", url: "https://plain.example.com" }),
      ],
    );
    expect(out).toContain('ICON="gh.png"');
    expect(out).toContain('TAGS="dev,git"');
    expect(out).toContain("<DD>代码托管");
    expect(out.match(/<DD>/g)).toHaveLength(1);
  });

  it("icon 字段优先于 iconKey", () => {
    const out = exportNetscapeBookmarks(
      [cat()],
      [site({ icon: "direct.png", iconKey: "fallback.png" } as unknown as Partial<Site>)],
    );
    expect(out).toContain('ICON="direct.png"');
    expect(out).not.toContain("fallback.png");
  });
});

describe("exportNavHubBackup / validateNavHubBackup", () => {
  it("打包 round-trip：版本、统计、字段映射与 slug/icon 回退", () => {
    const json = exportNavHubBackup(
      [cat({ slug: "dev-tools" }), cat({ id: "c2", title: "无 slug 分类" })],
      [site({ tags: ["a"], iconKey: "i.png", enabled: true })],
    );
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe("1.0");
    expect(parsed.generator).toContain("Sovereign Backup Engine");
    expect(parsed.stats).toEqual({ categoryCount: 2, siteCount: 1 });
    expect(parsed.categories[0].slug).toBe("dev-tools");
    expect(parsed.categories[1].slug).toBe("c2");
    expect(parsed.sites[0].icon).toBe("i.png");
    expect(parsed.sites[0].enabled).toBe(true);
    expect(typeof parsed.exportedAt).toBe("number");

    const check = validateNavHubBackup(json);
    expect(check.valid).toBe(true);
    expect(check.backup?.stats.siteCount).toBe(1);
  });

  it("校验失败：非法 JSON / 非对象 / 版本不符 / 缺数组", () => {
    expect(validateNavHubBackup("{not json")).toEqual({ valid: false, error: expect.any(String) });
    expect(validateNavHubBackup("null")).toEqual({ valid: false, error: "无效的 JSON 数据" });
    expect(validateNavHubBackup('"str"')).toEqual({ valid: false, error: "无效的 JSON 数据" });
    expect(validateNavHubBackup(JSON.stringify({ version: "2.0", categories: [], sites: [] }))).toEqual({
      valid: false,
      error: "不支持的备份版本: 2.0",
    });
    expect(validateNavHubBackup(JSON.stringify({ version: "1.0", categories: [] }))).toEqual({
      valid: false,
      error: "缺少 categories 或 sites 数组",
    });
    expect(validateNavHubBackup(JSON.stringify({ version: "1.0", sites: [] }))).toEqual({
      valid: false,
      error: "缺少 categories 或 sites 数组",
    });
  });
});
