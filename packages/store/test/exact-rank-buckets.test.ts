/**
 * 精确通道的排序分档回归。
 *
 * 被锁住的缺陷：此前 channelExact 只用「标题」分档，标签与描述同落最后一档、
 * 再按 trend_score 排序。于是热门但不相关的站点会压过「标签就是这个词」的站点 ——
 * 实测搜「代理」时 OpenHands（tag=开发代理）排在 Nginx（tag=代理）之前，
 * 搜「k8s」时 containerd 压过 Knative（tag=k8s）。标签是人工策划的强相关信号，
 * 必须先于热度。
 *
 * 这里钉住两条：
 *  1. 标签精确命中必须压过「标签只是包含它」的高热度站；
 *  2. 标题命中仍然最优先，不要被新档位推下去。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";

describe("精确通道排序分档", () => {
  let db: Db;
  let repo: Repository;
  let search: SearchEngine;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    search = new SearchEngine({ db, fts: null, vectors: null });
  });

  afterAll(async () => {
    await db.close();
  });

  it("标签精确命中排在『标签仅包含』的高热度站之前", async () => {
    const cat = await repo.createCategory({ title: "排序分档回归分类" });
    // 精确站：tag 就是「代理」
    const exact = await repo.createSite({
      url: "https://exact-tag.example.com",
      title: "ExactTagSite",
      categoryId: cat.id,
      tags: ["代理"],
    });
    // 包含站：tag 是「开发代理」，热度给得很高，靠 trend_score 想压过去
    const sub = await repo.createSite({
      url: "https://substring-tag.example.com",
      title: "SubstringTagSite",
      categoryId: cat.id,
      tags: ["开发代理"],
    });
    await repo.setTrendScores([
      { id: exact.id, trendScore: 1 },
      { id: sub.id, trendScore: 999 },
    ]);

    const result = await search.search({ q: "代理", limit: 10 });
    const ids = result.hits.map((h) => h.siteId);
    expect(ids).toContain(exact.id);
    expect(ids).toContain(sub.id);
    expect(ids.indexOf(exact.id), "tag 精确命中应排在 tag 包含命中之前").toBeLessThan(
      ids.indexOf(sub.id),
    );
  });

  it("标题命中仍然最优先，不被标签档位推下去", async () => {
    const cat = await repo.createCategory({ title: "排序分档回归分类2" });
    const titleHit = await repo.createSite({
      url: "https://title-hit.example.com",
      title: "代理大师",
      categoryId: cat.id,
      tags: ["别的"],
    });
    const tagHit = await repo.createSite({
      url: "https://tag-hit.example.com",
      title: "UnrelatedName",
      categoryId: cat.id,
      tags: ["代理"],
    });
    await repo.setTrendScores([
      { id: titleHit.id, trendScore: 1 },
      { id: tagHit.id, trendScore: 999 },
    ]);

    const result = await search.search({ q: "代理", limit: 10 });
    const ids = result.hits.map((h) => h.siteId);
    expect(ids.indexOf(titleHit.id), "标题命中应最优先").toBeLessThan(ids.indexOf(tagHit.id));
  });
});