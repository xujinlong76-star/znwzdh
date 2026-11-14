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
    expect(FEATURED_COLLECTION_EDITORIALS.map((e) => e.slug)).toEqual(["drama-guide", "exam-sprint", "ai-video-toolkit", "office-boost", "beginner-web", "senior-services", "job-hunt-express", "academic-toolkit", "shopping-saver", "novel-film-tracking", "agentic-ai", "ai-coding", "frontend-starter", "design-toolkit", "open-source-alternatives", "editors-picks"]);
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
    expect(FEATURED_COLLECTION_EDITORIALS.length).toBe(16);
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
    expect(FEATURED_COLLECTION_EDITORIALS.length).toBe(16);
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

describe("精选专题（第 4 笔：求职招聘直通车、学术科研工具箱）", () => {
  it("两个新合集的策展文案已就位：两幕各 3 站，价值主张在 20 字内", () => {
    expect(FEATURED_COLLECTION_EDITORIALS.length).toBe(16);
    const job = getFeaturedEditorial("job-hunt-express");
    const academic = getFeaturedEditorial("academic-toolkit");
    expect(job).toBeDefined();
    expect(academic).toBeDefined();
    if (!job || !academic) return;
    expect(job.title).toBe("求职招聘直通车");
    expect(job.valueProposition).toBe("好工作，直通车");
    expect(job.valueProposition.length).toBeLessThanOrEqual(20);
    expect(job.issueNo).toBe(1);
    expect(job.acts.length).toBe(2);
    expect(job.acts.map((a) => a.siteUrls.length)).toEqual([3, 3]);
    expect(job.acts[0].title).toBe("第一幕 · 大站投简历");
    expect(job.acts[1].title).toBe("第二幕 · 对症下药");
    expect(validateFeaturedEditorial(job)).toEqual([]);
    expect(academic.title).toBe("学术科研工具箱");
    expect(academic.valueProposition).toBe("查文献，做科研");
    expect(academic.valueProposition.length).toBeLessThanOrEqual(20);
    expect(academic.issueNo).toBe(1);
    expect(academic.acts.length).toBe(2);
    expect(academic.acts.map((a) => a.siteUrls.length)).toEqual([3, 3]);
    expect(academic.acts[0].title).toBe("第一幕 · 查文献找论文");
    expect(academic.acts[1].title).toBe("第二幕 · 追前沿管文献");
    expect(validateFeaturedEditorial(academic)).toEqual([]);
    expect(coverSiteUrls(job).length).toBe(6);
    expect(coverSiteUrls(academic).length).toBe(6);
  });

  it("复用种子已有站点时地址与种子一致（arXiv 裸域名）", () => {
    const academic = getFeaturedEditorial("academic-toolkit");
    expect(academic).toBeDefined();
    if (!academic) return;
    expect(academic.acts.flatMap((a) => a.siteUrls)).toContain("https://arxiv.org");
    const col = seedCollection("academic-toolkit");
    expect(col).toBeDefined();
    if (!col) return;
    expect(seedSiteUrls(col)).toContain("https://arxiv.org");
  });
});

describe("精选专题（第 5 笔：网购省钱指南、小说影视追更）", () => {
  it("两个新合集的策展文案已就位：两幕各 3 站，价值主张在 20 字内", () => {
    expect(FEATURED_COLLECTION_EDITORIALS.length).toBe(16);
    const shopping = getFeaturedEditorial("shopping-saver");
    const novel = getFeaturedEditorial("novel-film-tracking");
    expect(shopping).toBeDefined();
    expect(novel).toBeDefined();
    if (!shopping || !novel) return;
    expect(shopping.title).toBe("网购省钱指南");
    expect(shopping.valueProposition).toBe("先比价，再下单");
    expect(shopping.valueProposition.length).toBeLessThanOrEqual(20);
    expect(shopping.issueNo).toBe(1);
    expect(shopping.acts.length).toBe(2);
    expect(shopping.acts.map((a) => a.siteUrls.length)).toEqual([3, 3]);
    expect(shopping.acts[0].title).toBe("第一幕 · 大站买买买");
    expect(shopping.acts[1].title).toBe("第二幕 · 先比价再下单");
    expect(validateFeaturedEditorial(shopping)).toEqual([]);
    expect(novel.title).toBe("小说影视追更");
    expect(novel.valueProposition).toBe("小说电影，追更不愁");
    expect(novel.valueProposition.length).toBeLessThanOrEqual(20);
    expect(novel.issueNo).toBe(1);
    expect(novel.acts.length).toBe(2);
    expect(novel.acts.map((a) => a.siteUrls.length)).toEqual([3, 3]);
    expect(novel.acts[0].title).toBe("第一幕 · 追小说");
    expect(novel.acts[1].title).toBe("第二幕 · 追电影");
    expect(validateFeaturedEditorial(novel)).toEqual([]);
    expect(coverSiteUrls(shopping).length).toBe(6);
    expect(coverSiteUrls(novel).length).toBe(6);
  });

  it("复用种子已有站点时地址与种子一致（淘宝、京东、豆瓣）", () => {
    const shopping = getFeaturedEditorial("shopping-saver");
    expect(shopping).toBeDefined();
    if (!shopping) return;
    expect(shopping.acts.flatMap((a) => a.siteUrls)).toContain("https://www.taobao.com");
    expect(shopping.acts.flatMap((a) => a.siteUrls)).toContain("https://www.jd.com");
    const novel = getFeaturedEditorial("novel-film-tracking");
    expect(novel).toBeDefined();
    if (!novel) return;
    expect(novel.acts.flatMap((a) => a.siteUrls)).toContain("https://www.douban.com");
    const col1 = seedCollection("shopping-saver");
    expect(col1).toBeDefined();
    if (!col1) return;
    expect(seedSiteUrls(col1)).toContain("https://www.taobao.com");
    expect(seedSiteUrls(col1)).toContain("https://www.jd.com");
    const col2 = seedCollection("novel-film-tracking");
    expect(col2).toBeDefined();
    if (!col2) return;
    expect(seedSiteUrls(col2)).toContain("https://www.douban.com");
  });
});

describe("精选专题（第 6 笔：改造 Agentic AI、AI 编程工具链、前端入门路线）", () => {
  it("三个改造合集的策展文案已就位：两幕、价值主张在 20 字内", () => {
    expect(FEATURED_COLLECTION_EDITORIALS.length).toBe(16);
    const agent = getFeaturedEditorial("agentic-ai");
    const coding = getFeaturedEditorial("ai-coding");
    const fe = getFeaturedEditorial("frontend-starter");
    expect(agent).toBeDefined();
    expect(coding).toBeDefined();
    expect(fe).toBeDefined();
    if (!agent || !coding || !fe) return;
    expect(agent.title).toBe("2026 前沿 Agentic AI 生产力矩阵");
    expect(agent.valueProposition).toBe("让 Agent 替你干活");
    expect(agent.valueProposition.length).toBeLessThanOrEqual(20);
    expect(agent.issueNo).toBe(1);
    expect(agent.acts.length).toBe(2);
    expect(agent.acts.map((a) => a.siteUrls.length)).toEqual([3, 3]);
    expect(agent.acts[0].title).toBe("第一幕 · 写代码的 Agent");
    expect(agent.acts[1].title).toBe("第二幕 · 跑模型的引擎");
    expect(validateFeaturedEditorial(agent)).toEqual([]);
    expect(coding.title).toBe("AI 编程工具链");
    expect(coding.valueProposition).toBe("写代码，有 AI 搭手");
    expect(coding.valueProposition.length).toBeLessThanOrEqual(20);
    expect(coding.issueNo).toBe(1);
    expect(coding.acts.length).toBe(2);
    expect(coding.acts.map((a) => a.siteUrls.length)).toEqual([3, 3]);
    expect(coding.acts[0].title).toBe("第一幕 · 装进编辑器");
    expect(coding.acts[1].title).toBe("第二幕 · 补全与对话");
    expect(validateFeaturedEditorial(coding)).toEqual([]);
    expect(fe.title).toBe("前端入门路线");
    expect(fe.valueProposition).toBe("从零到独立做项目");
    expect(fe.valueProposition.length).toBeLessThanOrEqual(20);
    expect(fe.issueNo).toBe(1);
    expect(fe.acts.length).toBe(2);
    expect(fe.acts.map((a) => a.siteUrls.length)).toEqual([3, 3]);
    expect(fe.acts[0].title).toBe("第一幕 · 先打基础");
    expect(fe.acts[1].title).toBe("第二幕 · 再练技能");
    expect(validateFeaturedEditorial(fe)).toEqual([]);
    expect(coverSiteUrls(agent).length).toBe(6);
    expect(coverSiteUrls(coding).length).toBe(6);
    expect(coverSiteUrls(fe).length).toBe(6);
  });

  it("AI 编程工具链已迁为带收录理由的字典形式，DeepSeek 对话页已换为 Kimi，Devin 收录理由已修正", () => {
    const col = seedCollection("ai-coding");
    expect(col).toBeDefined();
    if (!col) return;
    const notes = col.sites.map((s) => (typeof s === "string" ? "" : (s.note ?? "")));
    expect(notes.length).toBe(6);
    expect(notes.every((n) => n.trim().length > 0)).toBe(true);
    expect(seedSiteUrls(col)).toContain("https://kimi.moonshot.cn");
    expect(seedSiteUrls(col)).not.toContain("https://chat.deepseek.com");
    const coding = getFeaturedEditorial("ai-coding");
    expect(coding).toBeDefined();
    if (!coding) return;
    expect(coding.acts.flatMap((a) => a.siteUrls)).toContain("https://kimi.moonshot.cn");
    expect(coding.acts.flatMap((a) => a.siteUrls)).not.toContain("https://chat.deepseek.com");
    const ag = seedCollection("agentic-ai");
    expect(ag).toBeDefined();
    if (!ag) return;
    const devin = ag.sites.find((s) => typeof s !== "string" && (s.site ?? s.url) === "https://devin.ai/desktop");
    expect(devin).toBeDefined();
    if (typeof devin === "string" || !devin) return;
    expect(devin.note ?? "").toContain("全自主");
    expect(devin.note ?? "").not.toContain("Codeium");
  });
});

describe("第 7 笔：改造设计速查工具箱、开源替代、编辑精选", () => {
  it("三个改造合集的策展文案完整，两幕分组覆盖全部站点", () => {
    const design = getFeaturedEditorial("design-toolkit");
    expect(design.title).toBe("设计速查工具箱");
    expect(design.valueProposition).toBe("配色图标字体，一站备齐");
    expect(design.curator).toBe("山羊胡网编辑部");
    expect(design.issueNo).toBe(1);
    expect(coverSiteUrls(design).length).toBe(6);
    expect(coverSiteUrls(design)).toContain("https://www.photopea.com");
    const oss = getFeaturedEditorial("open-source-alternatives");
    expect(oss.title).toBe("开源替代");
    expect(oss.valueProposition).toBe("开源平替，照样好用");
    expect(coverSiteUrls(oss).length).toBe(6);
    expect(coverSiteUrls(oss)).toContain("https://www.libreoffice.org");
    const picks = getFeaturedEditorial("editors-picks");
    expect(picks.title).toBe("编辑精选");
    expect(picks.valueProposition).toBe("编辑亲选，每天必看");
    expect(coverSiteUrls(picks).length).toBe(10);
  });
  it("编辑精选中 DeepSeek 对话页已换为同类可验证的 Kimi", () => {
    const seed = seedCollection("editors-picks");
    const urls = seedSiteUrls(seed);
    expect(urls).not.toContain("https://chat.deepseek.com");
    expect(urls).toContain("https://kimi.moonshot.cn");
    expect(urls.length).toBe(10);
    expect(seed.sites.every((s) => typeof s !== "string")).toBe(true);
  });
});
