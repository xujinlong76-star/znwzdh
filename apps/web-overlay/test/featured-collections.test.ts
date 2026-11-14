import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURED_COLLECTION_EDITORIALS, coverSiteUrls, getFeaturedEditorial, issueLabel, normalizeSiteUrl, orderUrlsByAct, validateFeaturedEditorial } from "../src/lib/featured-collections";
import { FAVORITE_COLLECTIONS_KEY, SUBSCRIBED_COLLECTIONS_KEY, markVisited, parseSlugList, toggleSlug, visitProgressLabel, visitedCollectionKey, visitedProgress } from "../src/lib/featured-collection-activity";

const HERE = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(resolve(HERE, "..", "..", "api", "src", "seed-data.json"), "utf-8")) as {
  sites: Array<{ url: string; title: string }>;
  collections: Array<{ slug: string; title: string; sites: Array<string | { site?: string; url?: string; note?: string; sort?: number }> }>;
};

function seedCollection(slug: string) {
  return seed.collections.find((c) => c.slug === slug);
}

function seedSiteUrls(col: NonNullable<ReturnType<typeof seedCollection>>): string[] {
  return col.sites.map((s) => (typeof s === "string" ? s : (s.site ?? s.url ?? "")));
}

describe("精选专题编辑层（第 1 笔：列表页 A 壳 + 前 2 个新合集）", () => {
  it("两个新合集都有策展文案且校验通过", () => {
    expect(FEATURED_COLLECTION_EDITORIALS.map((e) => e.slug)).toEqual(["drama-guide", "exam-sprint", "ai-video-toolkit", "office-boost", "beginner-web", "senior-services"]);
    for (const e of FEATURED_COLLECTION_EDITORIALS) {
      expect(validateFeaturedEditorial(e)).toEqual([]);
      expect(e.title.trim().length).toBeGreaterThan(0);
      expect([...e.valueProposition].length).toBeLessThanOrEqual(20);
      expect(e.issueNo).toBe(1);
      expect(issueLabel(e)).toBe("第 1 期");
      expect(e.correctionHref.startsWith("https://github.com/xujinlong76-star/znwzdh/issues/new?title=")).toBe(true);
      expect(getFeaturedEditorial(e.slug)).toBe(e);
    }
  });
  it("策展文案的站点与种子合集的站点一一对应", () => {
    for (const e of FEATURED_COLLECTION_EDITORIALS) {
      const col = seedCollection(e.slug);
      expect(col).toBeDefined();
      expect(col?.title).toBe(e.title);
      const seedUrls = seedSiteUrls(col!);
      const editorialUrls = coverSiteUrls(e);
      expect([...editorialUrls].sort()).toEqual([...seedUrls].sort());
      expect(editorialUrls.length).toBeGreaterThanOrEqual(6);
    }
  });
  it("种子合集的每站都有一句收录理由，且站点都在种子站点表中", () => {
    const known = new Set(seed.sites.map((s) => normalizeSiteUrl(s.url)));
    for (const e of FEATURED_COLLECTION_EDITORIALS) {
      const col = seedCollection(e.slug)!;
      for (const s of col.sites) {
        const url = typeof s === "string" ? s : (s.site ?? s.url ?? "");
        expect(known.has(normalizeSiteUrl(url))).toBe(true);
        if (typeof s !== "string") {
          expect((s.note ?? "").trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
  it("按幕排序不丢站点、不改站数，且第一幕排在第二幕之前", () => {
    for (const e of FEATURED_COLLECTION_EDITORIALS) {
      const col = seedCollection(e.slug)!;
      const ordered = orderUrlsByAct(e, seedSiteUrls(col).map((url) => ({ url })));
      expect(ordered.map((s) => s.url).sort()).toEqual([...seedSiteUrls(col)].sort());
      const firstActFirst = e.acts[0].siteUrls[0];
      const secondActFirst = e.acts[1].siteUrls[0];
      expect(ordered.findIndex((s) => s.url === firstActFirst)).toBeLessThan(ordered.findIndex((s) => s.url === secondActFirst));
    }
  });
  it("列表页 A 壳：今日首映与海报行已接入", () => {
    const board = readFileSync(resolve(HERE, "..", "src", "components", "collection-board.tsx"), "utf-8");
    expect(board).toContain("今日首映");
    expect(board).toContain("精选海报行");
    expect(board).toContain("coverSiteUrls");
    expect(board).toContain("SiteFavicon");
  });
  it("详情页 A 壳：头图带、吸顶目录、按幕分组、编辑手记、相关合集与纠错入口已接入", () => {
    const detail = readFileSync(resolve(HERE, "..", "src", "app", "collections", "[slug]", "collection-detail-view.tsx"), "utf-8");
    expect(detail).toContain("精选专题头图");
    expect(detail).toContain("专题目录");
    expect(detail).toContain("sticky top-0");
    expect(detail).toContain("按幕分组");
    expect(detail).toContain("编辑手记");
    expect(detail).toContain("相关合集");
    expect(detail).toContain('id="correction"');
    expect(detail).toContain("orderedSites");
    expect(detail).toContain("getFeaturedEditorial");
  });
});

describe("精选专题（第 2 笔：AI 视频创作工具箱、打工人效率办公 + 收藏/订阅/进度）", () => {
  it("两个新合集的策展文案已就位：两幕各 3 站，价值主张在 20 字内", () => {
    expect(FEATURED_COLLECTION_EDITORIALS.length).toBe(6);
    const ai = getFeaturedEditorial("ai-video-toolkit");
    const office = getFeaturedEditorial("office-boost");
    expect(ai).toBeDefined();
    expect(office).toBeDefined();
    if (!ai || !office) return;
    expect(ai.title).toBe("AI 视频创作工具箱");
    expect(ai.valueProposition).toBe("一句话，出成片");
    expect(ai.valueProposition.length).toBeLessThanOrEqual(20);
    expect(ai.issueNo).toBe(1);
    expect(ai.acts.length).toBe(2);
    expect(ai.acts.map((a) => a.siteUrls.length)).toEqual([3, 3]);
    expect(ai.acts[0].title).toBe("第一幕 · 文生视频先上手");
    expect(ai.acts[1].title).toBe("第二幕 · 图生视频玩运镜");
    expect(validateFeaturedEditorial(ai)).toEqual([]);
    expect(office.title).toBe("打工人效率办公");
    expect(office.valueProposition).toBe("开工不加班，事事有着落");
    expect(office.valueProposition.length).toBeLessThanOrEqual(20);
    expect(office.issueNo).toBe(1);
    expect(office.acts.length).toBe(2);
    expect(office.acts.map((a) => a.siteUrls.length)).toEqual([3, 3]);
    expect(office.acts[0].title).toBe("第一幕 · 协作沟通");
    expect(office.acts[1].title).toBe("第二幕 · 文档表格");
    expect(validateFeaturedEditorial(office)).toEqual([]);
    expect(coverSiteUrls(ai).length).toBe(6);
    expect(coverSiteUrls(office).length).toBe(6);
  });

  it("互动纯逻辑：收藏/订阅的 slug 列表切换与解析", () => {
    expect(parseSlugList(null)).toEqual([]);
    expect(parseSlugList("")).toEqual([]);
    expect(parseSlugList("not json")).toEqual([]);
    expect(parseSlugList("[]")).toEqual([]);
    expect(parseSlugList("[\"ai-video-toolkit\", \"office-boost\"]")).toEqual(["ai-video-toolkit", "office-boost"]);
    expect(parseSlugList("[1, \"a\", null]")).toEqual(["a"]);
    expect(toggleSlug([], "ai-video-toolkit")).toEqual(["ai-video-toolkit"]);
    expect(toggleSlug(["ai-video-toolkit"], "ai-video-toolkit")).toEqual([]);
    expect(toggleSlug(["a"], "b")).toEqual(["a", "b"]);
    expect(visitedCollectionKey("ai-video-toolkit")).toBe("navhub_collection_visited:ai-video-toolkit");
    expect(FAVORITE_COLLECTIONS_KEY).toBe("navhub_favorite_collections");
    expect(SUBSCRIBED_COLLECTIONS_KEY).toBe("navhub_subscribed_collections");
  });

  it("互动纯逻辑：逛站进度计算与已逛标记", () => {
    expect(visitedProgress(0, 6)).toEqual({ visited: 0, total: 6, percent: 0, done: false });
    expect(visitedProgress(3, 6)).toEqual({ visited: 3, total: 6, percent: 50, done: false });
    expect(visitedProgress(6, 6)).toEqual({ visited: 6, total: 6, percent: 100, done: true });
    expect(visitedProgress(0, 0)).toEqual({ visited: 0, total: 0, percent: 0, done: false });
    expect(visitedProgress(9, 6)).toEqual({ visited: 6, total: 6, percent: 100, done: true });
    expect(visitedProgress(-2, 6)).toEqual({ visited: 0, total: 6, percent: 0, done: false });
    expect(visitProgressLabel({ visited: 2, total: 6, percent: 33, done: false })).toBe("已逛 2/6 站");
    expect(markVisited([], "site-a")).toEqual(["site-a"]);
    expect(markVisited(["site-a"], "site-a")).toEqual(["site-a"]);
    expect(markVisited(["site-a"], "site-b")).toEqual(["site-a", "site-b"]);
  });

  it("详情页已接入收藏合集、订阅更新与逛站进度", () => {
    const detail = readFileSync(resolve(HERE, "..", "src", "app", "collections", "[slug]", "collection-detail-view.tsx"), "utf-8");
    expect(detail).toContain("featured-collection-activity");
    expect(detail).toContain("收藏合集");
    expect(detail).toContain("订阅更新");
    expect(detail).toContain("逛站进度");
    expect(detail).toContain("FAVORITE_COLLECTIONS_KEY");
    expect(detail).toContain("SUBSCRIBED_COLLECTIONS_KEY");
    expect(detail).toContain("visitedCollectionKey");
    expect(detail).toContain("toggleCollectionFavorite");
    expect(detail).toContain("toggleSubscribe");
    expect(detail).toContain("markSiteVisited");
    expect(detail).toContain("onClick={() => markSiteVisited(site.id)}");
    expect(detail).toContain("role=\"progressbar\"");
    expect(detail).toContain("visitProgressLabel");
    expect(detail).toContain("已逛");
  });
});

describe("精选专题（第 3 笔：新手上网必备、长辈便民服务）", () => {
  it("两个新合集的策展文案已就位：两幕各 3 站，价值主张在 20 字内", () => {
    expect(FEATURED_COLLECTION_EDITORIALS.length).toBe(6);
    const beginner = getFeaturedEditorial("beginner-web");
    const senior = getFeaturedEditorial("senior-services");
    expect(beginner).toBeDefined();
    expect(senior).toBeDefined();
    if (!beginner || !senior) return;
    expect(beginner.title).toBe("新手上网必备");
    expect(beginner.valueProposition).toBe("上网第一课，一看就会");
    expect(beginner.valueProposition.length).toBeLessThanOrEqual(20);
    expect(beginner.issueNo).toBe(1);
    expect(beginner.acts.length).toBe(2);
    expect(beginner.acts.map((a) => a.siteUrls.length)).toEqual([3, 3]);
    expect(beginner.acts[0].title).toBe("第一幕 · 先上网");
    expect(beginner.acts[1].title).toBe("第二幕 · 出门办事");
    expect(validateFeaturedEditorial(beginner)).toEqual([]);
    expect(senior.title).toBe("长辈便民服务");
    expect(senior.valueProposition).toBe("办事不用跑，手机全办好");
    expect(senior.valueProposition.length).toBeLessThanOrEqual(20);
    expect(senior.issueNo).toBe(1);
    expect(senior.acts.length).toBe(2);
    expect(senior.acts.map((a) => a.siteUrls.length)).toEqual([3, 3]);
    expect(senior.acts[0].title).toBe("第一幕 · 办事不用跑");
    expect(senior.acts[1].title).toBe("第二幕 · 生活有人帮");
    expect(validateFeaturedEditorial(senior)).toEqual([]);
    expect(coverSiteUrls(beginner).length).toBe(6);
    expect(coverSiteUrls(senior).length).toBe(6);
  });

  it("复用种子已有站点时地址与种子一致（中国天气网无 www 前缀）", () => {
    const beginner = getFeaturedEditorial("beginner-web");
    expect(beginner).toBeDefined();
    if (!beginner) return;
    expect(beginner.acts.flatMap((a) => a.siteUrls)).toContain("https://weather.com.cn");
    expect(beginner.acts.flatMap((a) => a.siteUrls)).toContain("https://www.amap.com");
    expect(beginner.acts.flatMap((a) => a.siteUrls)).toContain("https://www.12306.cn");
    const col = seedCollection("beginner-web");
    expect(col).toBeDefined();
    if (!col) return;
    expect(seedSiteUrls(col)).toContain("https://weather.com.cn");
    expect(seedSiteUrls(col)).toContain("https://www.amap.com");
  });
});
