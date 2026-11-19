/**
 * listVerifiedProfilesBySiteIds 批量加载（Batch0-02 R9，细化方案 §6.2 step 4）。
 *
 * 钉住三条铁律：
 * 1. 只返回 profile_status='verified' 的行，draft 行永不返回；
 * 2. pricing / requires_account 取自 site_facets 同名键，best_for 取自
 *    site_profiles.best_for（不另发明口径）；
 * 3. 空列表返回空 Map；超 500 个 id 时按片查询仍全量返回。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

describe("listVerifiedProfilesBySiteIds（卡片分片 join 批量加载）", () => {
  let db: Db;
  let repo: Repository;
  let verifiedId: string;
  let draftId: string;
  let verifiedBareId: string;
  let noRowId: string;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    const cat = await repo.createCategory({ title: "档案批量测试分类" });
    const mkSite = async (url: string) =>
      (
        await repo.createSite({
          url,
          title: url,
          categoryId: cat.id,
          status: "active",
        })
      ).id;
    verifiedId = await mkSite("https://batch-verified.example.com");
    draftId = await mkSite("https://batch-draft.example.com");
    verifiedBareId = await mkSite("https://batch-verified-bare.example.com");
    noRowId = await mkSite("https://batch-no-row.example.com");

    const now = Date.now();
    await repo.upsertSiteProfile({
      siteId: verifiedId,
      bestFor: "个人轻量写作",
      notFor: null,
      license: null,
      alternatives: [],
      profileSourceUrl: "https://batch-verified.example.com/about",
      profileStatus: "verified",
      verifiedBy: "batch-test",
      profileVerifiedAt: now,
    });
    await repo.upsertProfileFacets(verifiedId, {
      pricing: ["freemium"],
      requires_account: ["optional"],
    });

    // draft 行同样写了分面与 best_for：批量加载必须把它整个排除。
    await repo.upsertSiteProfile({
      siteId: draftId,
      bestFor: "草稿不渲染",
      notFor: null,
      license: null,
      alternatives: [],
      profileSourceUrl: "https://batch-draft.example.com/about",
      profileStatus: "draft",
      verifiedBy: "batch-test",
      profileVerifiedAt: now,
    });
    await repo.upsertProfileFacets(draftId, {
      pricing: ["paid"],
      requires_account: ["required"],
    });

    // verified 行但三字段全缺：行存在，返回空对象，不编造值。
    await repo.upsertSiteProfile({
      siteId: verifiedBareId,
      bestFor: null,
      notFor: null,
      license: null,
      alternatives: [],
      profileSourceUrl: "https://batch-verified-bare.example.com/about",
      profileStatus: "verified",
      verifiedBy: "batch-test",
      profileVerifiedAt: now,
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it("只返回 verified 行：draft 行与无档案站、库外 id 均不出现", async () => {
    const got = await repo.listVerifiedProfilesBySiteIds([
      verifiedId,
      draftId,
      verifiedBareId,
      noRowId,
      "ghost-site-id",
    ]);
    expect([...got.keys()].sort()).toEqual([verifiedBareId, verifiedId].sort());
    expect(got.get(verifiedId)).toEqual({
      pricing: "freemium",
      requires_account: "optional",
      best_for: "个人轻量写作",
    });
    expect(got.get(verifiedBareId)).toEqual({});
    expect(got.has(draftId)).toBe(false);
  });

  it("空列表直接返回空 Map，不发 SQL", async () => {
    const got = await repo.listVerifiedProfilesBySiteIds([]);
    expect(got.size).toBe(0);
  });

  it("重复 id 去重；超 500 个 id 按片查询仍全量返回", async () => {
    const ghosts = Array.from({ length: 600 }, (_, i) => `ghost-${i}`);
    const got = await repo.listVerifiedProfilesBySiteIds([
      verifiedId,
      verifiedId,
      ...ghosts,
    ]);
    expect(got.size).toBe(1);
    expect(got.get(verifiedId)).toEqual({
      pricing: "freemium",
      requires_account: "optional",
      best_for: "个人轻量写作",
    });
  });
});
