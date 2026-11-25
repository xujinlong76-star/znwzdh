import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext, type AppContext } from "../src/context.ts";
import { buildServer } from "../src/server.ts";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../src/config.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("SimilarSites 级多信号相似站点 API (/api/sites/:id/similar-insights & /api/similar/lookup)", () => {
  let dir: string;
  let ctx: AppContext;
  let app: FastifyInstance;
  let doubanId = "";

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-similar-test-"));
    const cfg = loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "similar.db"),
      embedding: { model: "none", endpoint: "", dtype: "q8", dim: 512, cacheDir: join(dir, "models"), enabled: false },
      corsOrigins: ["*"],
    });
    ctx = await createContext(cfg);
    app = await buildServer(ctx);

    const ent = await ctx.repo.createCategory({ title: "测试影音娱乐", anchor: "test-ent", parentId: null, enabled: true, sort: 1 });
    const rating = await ctx.repo.createCategory({ title: "测试影视评分", anchor: "test-ent/rating", parentId: ent.id, enabled: true, sort: 1 });
    const dev = await ctx.repo.createCategory({ title: "测试代码托管", anchor: "test-dev/git", parentId: null, enabled: true, sort: 2 });

    const douban = await ctx.repo.createSite({
      title: "豆瓣 · 影视评分",
      url: "https://movie.douban.com/",
      categoryId: rating.id,
      description: "电影电视剧评分、影评社区与观影记录",
      tags: ["影视评分", "影评", "观影记录"],
      status: "active",
      enabled: true,
    });
    doubanId = douban.id;

    const letterboxd = await ctx.repo.createSite({
      title: "Letterboxd",
      url: "https://letterboxd.com/",
      categoryId: rating.id,
      description: "国际影迷观影日记与影评评分社区",
      tags: ["影视评分", "影评", "观影记录"],
      status: "active",
      enabled: true,
    });
    await ctx.repo.createSite({
      title: "IMDb",
      url: "https://www.imdb.com/",
      categoryId: rating.id,
      description: "全球影视数据库与观众评分",
      tags: ["影视评分", "影评"],
      status: "active",
      enabled: true,
    });
    await ctx.repo.createSite({
      title: "GitHub",
      url: "https://github.com/",
      categoryId: dev.id,
      description: "开源代码托管平台",
      tags: ["开源", "代码托管"],
      status: "active",
      enabled: true,
    });

    await ctx.repo.setSiteRelations(douban.id, [
      {
        targetSiteId: letterboxd.id,
        targetTitle: letterboxd.title,
        targetUrl: letterboxd.url,
        relationType: "alternative",
        note: "国际影迷平替",
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("GET /api/sites/:id/similar-insights 返回相似度百分比、维度拆解、排名与理由", async () => {
    const res = await app.inject({ method: "GET", url: `/api/sites/${doubanId}/similar-insights` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.target.site.id).toBe(doubanId);
    expect(body.target.totalActiveSites).toBe(4);
    expect(body.items.length).toBe(2);
    expect(body.items[0].site.title).toBe("Letterboxd");
    expect(body.items[0].similarityPercent).toBeGreaterThanOrEqual(75);
    expect(body.items[0].breakdown.graph).toBe(100);
    expect(body.items[0].sharedTags).toContain("影视评分");
    expect(body.summary.sameCategoryCount).toBe(2);
  });

  it("GET /api/similar/lookup 支持按域名/URL 精确查找与未收录主题词兜底", async () => {
    const byDomain = await app.inject({ method: "GET", url: "/api/similar/lookup?q=douban.com" });
    expect(byDomain.statusCode).toBe(200);
    expect(byDomain.json().target.site.id).toBe(doubanId);
    expect(byDomain.json().items.length).toBeGreaterThanOrEqual(2);

    const byTopic = await app.inject({
      method: "GET",
      url: `/api/similar/lookup?q=${encodeURIComponent("开源代码托管")}`,
    });
    expect(byTopic.statusCode).toBe(200);
    expect(byTopic.json().matchType).toBe("topic-discovery");
    expect(byTopic.json().items[0].site.title).toBe("GitHub");
  });

  it("GET /api/similar/suggestions 返回精选种子站列表", async () => {
    const res = await app.inject({ method: "GET", url: "/api/similar/suggestions?limit=6" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalActiveSites).toBe(4);
    expect(body.items.length).toBeGreaterThanOrEqual(3);
  });
});
