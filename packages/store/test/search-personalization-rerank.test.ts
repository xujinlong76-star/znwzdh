import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";

describe("搜索个性化是已召回站点的 rerank，不是第五路召回", () => {
  let db: Db;
  let repo: Repository;
  let search: SearchEngine;
  let recalledId: string;
  let notRecalledId: string;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    search = new SearchEngine({ db, fts: null, vectors: null, repo });
    const category = await repo.createCategory({ title: "偏好重排测试" });
    recalledId = (await repo.createSite({
      url: "https://alpha.example.com", title: "Alpha", categoryId: category.id,
    })).id;
    notRecalledId = (await repo.createSite({
      url: "https://beta.example.com", title: "Beta", categoryId: category.id,
    })).id;
  });

  afterAll(async () => {
    await db.close();
  });

  it("personal 可以改变已召回站点的贡献，但不能把未召回站点带进结果", async () => {
    const base = { q: "alpha", disableSemantic: true, disableCorrection: true };
    const plain = await search.search({ ...base, disablePersonal: true });
    const personalized = await search.search({
      ...base,
      personalize: { topCategories: [(await repo.getSite(recalledId))!.categoryId] },
    });

    expect(plain.hits.map((h) => h.siteId)).toEqual([recalledId]);
    expect(personalized.hits.map((h) => h.siteId)).toEqual([recalledId]);
    expect(personalized.hits[0]?.contributions.personal).toBeDefined();
    expect(personalized.hits.some((h) => h.siteId === notRecalledId)).toBe(false);
  });

  it("recordFeedback 丢弃非有限/越界 reward，不增加学习计数", () => {
    const before = search.getLinUCBTelemetry();
    for (const reward of [Number.NaN, Number.POSITIVE_INFINITY, -1.01, 2.01]) {
      search.recordFeedback("fts", "alpha", { reward });
    }
    expect(search.getLinUCBTelemetry()).toEqual(before);
  });

  it("recordFeedback 在 dwell 映射前丢弃非有限/负驻留时长", () => {
    const before = search.getLinUCBTelemetry();
    for (const dwellSeconds of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      search.recordFeedback("fts", "alpha", { dwellSeconds });
      search.recordFeedback("fts", "alpha", { dwellSeconds, interactionType: "copy" });
    }
    expect(search.getLinUCBTelemetry()).toEqual(before);
  });
});
