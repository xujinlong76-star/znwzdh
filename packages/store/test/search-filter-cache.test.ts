/**
 * 检索过滤集合的「单次查询内只算一次」回归测试。
 *
 * 背景：category / tag / facets 三组过滤与通道无关，但四个通道各自调一次
 * postFilter。改造前，一个带「类目 + 标签 + 分面」的查询会把同一份过滤集合
 * 重复计算 4 次（每次 1~2 条 SQL），属于纯浪费；而且这类退化不会让任何
 * 功能测试变红 —— 只能靠调用次数断言锁住。
 *
 * 同时锁定「通道耗时随 result 返回」：SearchEngine 是单例，
 * 耗时若挂在实例字段上，并发请求会互相覆盖。
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";

describe("Search: 过滤集合复用与请求级耗时", () => {
  let db: Db;
  let repo: Repository;
  let search: SearchEngine;
  let categoryId: string;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    search = new SearchEngine({ db, fts: null, vectors: null });

    const cat = await repo.createCategory({ title: "开发工具" });
    categoryId = cat.id;
    await repo.createSite({
      url: "https://penpot.app",
      title: "Penpot 原型设计",
      description: "开源设计协作平台",
      categoryId,
      tags: ["design"],
      facets: { pricing: ["open_source"], platform: ["web"] },
    });
    await repo.createSite({
      url: "https://figma.com",
      title: "Figma 设计",
      description: "在线协作设计工具",
      categoryId,
      tags: ["design"],
      facets: { pricing: ["freemium"], platform: ["web"] },
    });
  });

  it("一次检索只解析一次类目/标签/分面（不再按通道重复查询）", async () => {
    const proto = SearchEngine.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    const catSpy = vi.spyOn(proto, "categoryWithDescendants");
    const tagSpy = vi.spyOn(proto, "siteIdsWithTag");
    const facetSpy = vi.spyOn(proto, "siteIdsWithFacets");

    const result = await search.search({
      q: "设计",
      categoryId,
      tag: "design",
      facets: { pricing: ["open_source"] },
      disableSemantic: true,
    });

    expect(result.hits.length).toBeGreaterThan(0);
    // 改造前分别是 3/3/3 次（exact + fts + pinyin 各一次）
    expect(catSpy).toHaveBeenCalledTimes(1);
    expect(tagSpy).toHaveBeenCalledTimes(1);
    expect(facetSpy).toHaveBeenCalledTimes(1);

    catSpy.mockRestore();
    tagSpy.mockRestore();
    facetSpy.mockRestore();
  });

  it("通道耗时随 result 返回，不依赖实例字段", async () => {
    const result = await search.search({ q: "设计", disableSemantic: true });
    expect(result.channelTimings).toBeDefined();
    expect(result.channelTimings?.exactMs).toBeGreaterThanOrEqual(0);
    // 关闭语义通道时必须如实标记为 skipped，而不是报 0ms 假装跑过
    expect(result.channelTimings?.skippedSemantic).toBe(true);
    expect(result.channelTimings?.semanticMs).toBe(0);
  });

  it("零结果兜底不会把过滤集合缓存串到放宽后的查询上", async () => {
    // 带一个不存在的类目：第 1 级兜底会去掉正向过滤重试，
    // 必须真的能召回，而不是复用「空集合」的缓存结果。
    const result = await search.search({ q: "Figma", categoryId: "no-such-category", disableSemantic: true });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.fallback).toBe("filter");
  });
});
