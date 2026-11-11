/**
 * A3 静默放宽修复（SearchResult.relaxedFacets）：
 * 用户筛「免费」归零时，中枢仍会放宽给结果（不让页面开天窗），但必须点名
 * 被丢弃的付费条件——旧行为是静默放宽，用户看到收费站还以为筛选生效。
 *  1. 只有收费短剧站时搜「免费短剧」：fallback=filter 且 relaxedFacets
 *     点名 pricing=free；
 *  2. 补一个真免费短剧站后：严格命中，只出免费站、无 fallback/relaxedFacets。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";

describe("搜索放宽点名 relaxedFacets", () => {
  let db: Db;
  let repo: Repository;
  let search: SearchEngine;
  let paidDramaId: string;
  let freeDramaId: string;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    search = new SearchEngine({ db, fts: null, vectors: null, repo });
    const cat = await repo.createCategory({ title: "短剧" });
    const paid = await repo.createSite({
      url: "https://paid-drama.example.com",
      title: "付费短剧站",
      description: "热门短剧连看，会员解锁全集",
      categoryId: cat.id,
      facets: { pricing: ["paid"] },
    });
    paidDramaId = paid.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it("免费短剧归零放宽：点名 pricing=free 被丢弃", async () => {
    const res = await search.search({ q: "免费短剧" });
    expect(res.fallback).toBe("filter");
    expect(res.relaxedFacets?.pricing).toEqual(["free"]);
    // 放宽后确实给了结果（收费站），但带着点名标记，不再静默
    expect(res.hits.map((h) => h.siteId)).toContain(paidDramaId);
  });

  it("有真免费站时严格命中：只出免费站、无放宽标记", async () => {
    const cat = (await repo.listCategories())[0];
    const free = await repo.createSite({
      url: "https://free-drama.example.com",
      title: "免费短剧屋",
      description: "看广告免费看全集的短剧平台",
      categoryId: cat.id,
      facets: { pricing: ["free"] },
    });
    freeDramaId = free.id;
    const res = await search.search({ q: "免费短剧" });
    const ids = res.hits.map((h) => h.siteId);
    expect(ids).toContain(freeDramaId);
    expect(ids).not.toContain(paidDramaId);
    expect(res.fallback).toBeUndefined();
    expect(res.relaxedFacets).toBeUndefined();
  });

  it("显式 facets 参数归零放宽同样点名", async () => {
    const res = await search.search({ q: "短剧", facets: { pricing: ["open_source"] } });
    expect(res.fallback).toBe("filter");
    expect(res.relaxedFacets?.pricing).toEqual(["open_source"]);
  });
});
