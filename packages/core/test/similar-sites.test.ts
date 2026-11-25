import { describe, expect, it } from "vitest";
import {
  computeSimilarSitesForTarget,
  computeTopicSimilarSites,
  extractRegistrableDomain,
  normalizeSiteHost,
  resolveSiteByLookupQuery,
} from "../src/similar-sites.ts";
import type { Category, Site } from "../src/types.ts";

const CATEGORIES: Category[] = [
  { id: "ent", anchor: "ent", parentId: null, title: "影音娱乐", enabled: true, sort: 1, createdAt: 1, updatedAt: 1 },
  { id: "ent-rating", anchor: "ent/rating", parentId: "ent", title: "影视评分", enabled: true, sort: 1, createdAt: 1, updatedAt: 1 },
  { id: "ent-stream", anchor: "ent/stream", parentId: "ent", title: "在线影院", enabled: true, sort: 2, createdAt: 1, updatedAt: 1 },
  { id: "dev", anchor: "dev", parentId: null, title: "开发者工具", enabled: true, sort: 2, createdAt: 1, updatedAt: 1 },
  { id: "dev-git", anchor: "dev/git", parentId: "dev", title: "代码托管", enabled: true, sort: 1, createdAt: 1, updatedAt: 1 },
];

function mkSite(partial: Partial<Site> & Pick<Site, "id" | "title" | "url" | "categoryId">): Site {
  return {
    tags: [],
    status: "active",
    enabled: true,
    sort: 10,
    weight: 10,
    visitCount: 10,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...partial,
  };
}

const SITES: Site[] = [
  mkSite({
    id: "douban",
    title: "豆瓣 · 影视评分",
    titleEn: "Douban Movie",
    url: "https://movie.douban.com/",
    categoryId: "ent-rating",
    description: "中文电影电视剧评分、影评社区与观影记录管理",
    tags: ["影视评分", "影评", "观影记录", "中文社区"],
    visitCount: 520,
    facets: { pricing: ["免费"], language: ["中文"] },
    health: { ok: true, latencyMs: 140, httpStatus: 200 },
  }),
  mkSite({
    id: "imdb",
    title: "IMDb",
    url: "https://www.imdb.com/",
    categoryId: "ent-rating",
    description: "全球权威电影电视剧资料库与观众评分榜单",
    tags: ["影视评分", "影评", "电影资料库"],
    visitCount: 410,
    facets: { pricing: ["免费"], language: ["英文"] },
    health: { ok: true, latencyMs: 280, httpStatus: 200 },
  }),
  mkSite({
    id: "letterboxd",
    title: "Letterboxd",
    url: "https://letterboxd.com/",
    categoryId: "ent-rating",
    description: "影迷社交网络，记录观影日记、影评打分与片单",
    tags: ["影视评分", "影评", "观影记录"],
    visitCount: 240,
    facets: { pricing: ["免费"], language: ["英文"] },
    health: { ok: true, latencyMs: 210, httpStatus: 200 },
  }),
  mkSite({
    id: "bangumi",
    title: "Bangumi 番组计划",
    url: "https://bgm.tv/",
    categoryId: "ent-stream",
    description: "专注动画、游戏、电影的中文评分与观影记录社区",
    tags: ["观影记录", "中文社区", "二次元"],
    visitCount: 310,
    liveMetrics: { openSource: true },
    facets: { pricing: ["免费"], language: ["中文"] },
    health: { ok: true, latencyMs: 95, httpStatus: 200 },
  }),
  mkSite({
    id: "github",
    title: "GitHub",
    url: "https://github.com/",
    categoryId: "dev-git",
    description: "全球最大的开源代码托管与协作开发平台",
    tags: ["开源", "代码托管", "Git"],
    visitCount: 990,
    liveMetrics: { openSource: true },
    health: { ok: true, latencyMs: 120, httpStatus: 200 },
  }),
];

describe("similar-sites 多信号相似推荐引擎", () => {
  it("normalizeSiteHost & extractRegistrableDomain 规范化域名", () => {
    expect(normalizeSiteHost("https://www.movie.douban.com/top250")).toBe("movie.douban.com");
    expect(extractRegistrableDomain("https://movie.douban.com/")).toBe("douban.com");
    expect(extractRegistrableDomain("https://docs.example.com.cn/")).toBe("example.com.cn");
  });

  it("融合标签、内容、分类与图谱边排序，且产出可解释理由与真实排名", () => {
    const report = computeSimilarSitesForTarget(SITES[0]!, SITES, CATEGORIES, {
      targetRelations: [
        {
          targetSiteId: "letterboxd",
          targetTitle: "Letterboxd",
          targetUrl: "https://letterboxd.com/",
          relationType: "alternative",
          note: "国际影迷首选观影记录平替",
        },
      ],
    });

    expect(report.target?.siteRank).toBe(2); // github(990) #1, douban(520) #2
    expect(report.target?.categoryRank).toBe(1);
    expect(report.items.length).toBeGreaterThanOrEqual(3);

    // 认证平替 + 3 共享标签 + 同分类的 Letterboxd 应排第一
    expect(report.items[0]!.site.id).toBe("letterboxd");
    expect(report.items[0]!.similarityPercent).toBeGreaterThanOrEqual(75);
    expect(report.items[0]!.relationType).toBe("alternative");
    expect(report.items[0]!.sharedTags).toContain("影视评分");
    expect(report.items[0]!.reasons.some((r) => r.includes("认证平替"))).toBe(true);

    // 不相关的 GitHub 不应被推荐给豆瓣
    expect(report.items.some((i) => i.site.id === "github")).toBe(false);
  });

  it("支持跨分类、开源、延迟排序与标签过滤", () => {
    const crossOnly = computeSimilarSitesForTarget(SITES[0]!, SITES, CATEGORIES, {
      scope: "cross-category",
      openSourceOnly: true,
    });
    expect(crossOnly.items.map((i) => i.site.id)).toEqual(["bangumi"]);

    const byLatency = computeSimilarSitesForTarget(SITES[0]!, SITES, CATEGORIES, {
      sort: "latency",
    });
    expect(byLatency.items[0]!.site.id).toBe("bangumi"); // 95ms 最快
  });

  it("resolveSiteByLookupQuery 支持 URL / 主域 / 中英文名模糊定位", () => {
    expect(resolveSiteByLookupQuery("douban.com", SITES)?.site.id).toBe("douban");
    expect(resolveSiteByLookupQuery("https://www.imdb.com/chart/top", SITES)?.site.id).toBe("imdb");
    expect(resolveSiteByLookupQuery("豆瓣", SITES)?.site.id).toBe("douban");
    expect(resolveSiteByLookupQuery("unlisted-movie-site.org", SITES)).toBeNull();
  });

  it("自动识别同品牌子站（isSameBrand）、提取差异特色标签（uniqueTags）并支持排除同品牌", () => {
    const withCompanion: Site[] = [
      ...SITES,
      mkSite({
        id: "douban-music",
        title: "豆瓣音乐",
        url: "https://music.douban.com/",
        categoryId: "ent-rating",
        description: "豆瓣音乐评分与唱片社区",
        tags: ["影视评分", "影评", "音乐唱片"],
      }),
    ];
    const allReport = computeSimilarSitesForTarget(SITES[0]!, withCompanion, CATEGORIES);
    const companion = allReport.items.find((i) => i.site.id === "douban-music");
    expect(companion?.isSameBrand).toBe(true);
    expect(companion?.uniqueTags).toContain("音乐唱片");
    expect(allReport.summary.sameBrandCount).toBe(1);

    const pureCompetitors = computeSimilarSitesForTarget(SITES[0]!, withCompanion, CATEGORIES, {
      excludeSameBrand: true,
    });
    expect(pureCompetitors.items.some((i) => i.site.id === "douban-music")).toBe(false);
  });

  it("computeTopicSimilarSites 支持外部未收录站点或自由主题词探索", () => {
    const report = computeTopicSimilarSites("电影影评评分观影记录", SITES, CATEGORIES);
    expect(report.matchType).toBe("topic-discovery");
    expect(report.items.length).toBeGreaterThanOrEqual(2);
    expect(report.items.map((i) => i.site.id)).toContain("douban");
  });
});
