/**
 * 第 15 条 · 种子重跑更新已存在合集（种子与数据库漂移）。
 *
 * 旧行为：已有合集只在站数为 0 时补站，其余一律跳过——标题、描述、排序永不
 * 更新，种子改了要真正生效只能手动删库重导。
 *
 * 新行为（syncSeedCollections，三段式）：(a) 标题/描述/排序与种子不一致 →
 * 纠回种子值；(b) 种子里有、库里没有的站 → 补进去，保留种子 note/sort；
 * (c) 永不删站、永不覆盖 note——运营后加的站、人工改过的备注一律保留，
 * 删站与改备注只能走管理端显式操作。
 *
 * 本文件直接测 runSeed 的合集同步阶段（抽出的 syncSeedCollections，与
 * runSeed 调的是同一段代码），用 :memory: 库，不跑完整种子（完整种子还
 * 包含基线导入、插件、向量回填等，30 秒超时内跑不完；整种子重跑的端到端
 * 验证见提交说明里的本地开发库实测）。
 *
 * 注意 seed-content.test.ts:6 的提醒：upsertCollection 会静默跳过不报错——
 * 这里每次重跑后都显式断言最终状态，不只断言“没抛错”。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, Repository, type Db } from "@navhub/store";
import { syncSeedCollections, type SeedCollectionInput } from "../src/seed.ts";

let db: Db;
let repo: Repository;

beforeEach(async () => {
  db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  repo = new Repository(db);
});

afterEach(async () => {
  await db.close();
});

const URL_A = "https://example.com/seed-drift-a";
const URL_B = "https://example.com/seed-drift-b";
const URL_C = "https://example.com/seed-drift-c";
const URL_MISSING = "https://example.com/seed-drift-missing";

async function makeSite(url: string, title: string): Promise<string> {
  const categoryId = await repo.ensureUncategorized();
  const site = await repo.createSite({
    url,
    title,
    description: title + "的描述",
    categoryId,
    tags: [],
    source: "seed",
  });
  return site.id;
}

/** 种子输入（合成小清单，不依赖 seed-data.json 的真实条目） */
const SEED_INPUT: SeedCollectionInput[] = [
  {
    slug: "test-picks",
    title: "种子标题",
    kind: "topic",
    description: "种子描述",
    sites: [
      { site: URL_A, note: "种子备注", sort: 0 },
      { site: URL_B, sort: 1 },
      // 库里没有的站：静默跳过，不抛错、不计数
      { site: URL_MISSING, sort: 2 },
    ],
  },
  {
    slug: "fresh-col",
    title: "新合集",
    kind: "topic",
    description: "新合集描述",
    sites: [{ site: URL_A, sort: 0 }],
  },
];

describe("syncSeedCollections：种子重跑更新已存在合集（第 15 条）", () => {
  it("标题/描述/排序纠回种子值，缺站补上，运营站与人工备注原样保留", async () => {
    const siteA = await makeSite(URL_A, "站点 A");
    const siteB = await makeSite(URL_B, "站点 B");
    const siteC = await makeSite(URL_C, "站点 C");

    // 预置：标题/描述被改过、sort 被改成 7、少一个站（B）、多一个运营站（C）、
    // A 的 note 被人工改过（sort 也被改成 5，种子里是 0）
    await repo.upsertCollection({
      slug: "test-picks",
      title: "被改过的标题",
      description: "被改过的描述",
      kind: "topic",
      sort: 7,
      sites: [
        { site: URL_A, note: "人工备注", sort: 5 },
        { site: URL_C },
      ],
    });

    const result = await syncSeedCollections(repo, SEED_INPUT);
    expect(result).toEqual({ created: 1, updated: 1, itemsAdded: 1 });

    // (a) 标题/描述/排序纠回种子值（sort 是它在种子列表里的序号 0）
    const fixed = await repo.getCollectionBySlug("test-picks");
    expect(fixed?.title).toBe("种子标题");
    expect(fixed?.description).toBe("种子描述");
    expect(fixed?.sort).toBe(0);

    // (b)+(c) 缺站 B 补上了（种子 sort 1、无备注）；A 的人工备注与 sort 5 原样保留，
    // 运营站 C 原样保留；库里没有的站静默跳过
    const items = await repo.listCollectionItemsDetail(fixed!.id);
    const bySite = new Map(items.map((i) => [i.siteId, i]));
    expect(bySite.get(siteA)?.note).toBe("人工备注");
    expect(bySite.get(siteA)?.sort).toBe(5);
    expect(bySite.get(siteB)?.note).toBeNull();
    expect(bySite.get(siteB)?.sort).toBe(1);
    expect(bySite.has(siteC)).toBe(true);
    expect(items).toHaveLength(3);

    // 新合集照常新建，sort 是它在种子列表里的序号 1
    const fresh = await repo.getCollectionBySlug("fresh-col");
    expect(fresh?.title).toBe("新合集");
    expect(fresh?.sort).toBe(1);
    const freshItems = await repo.listCollectionItemsDetail(fresh!.id);
    expect(freshItems).toHaveLength(1);
    expect(freshItems[0]?.siteId).toBe(siteA);
    expect(freshItems[0]?.sort).toBe(0);
  });

  it("幂等：重跑第二次零改动（标题/站位/备注全部保持不变）", async () => {
    const siteA = await makeSite(URL_A, "站点 A");
    await makeSite(URL_B, "站点 B");
    await makeSite(URL_C, "站点 C");
    await repo.upsertCollection({
      slug: "test-picks",
      title: "被改过的标题",
      description: "被改过的描述",
      kind: "topic",
      sort: 7,
      sites: [
        { site: URL_A, note: "人工备注", sort: 5 },
        { site: URL_C },
      ],
    });

    await syncSeedCollections(repo, SEED_INPUT);
    const second = await syncSeedCollections(repo, SEED_INPUT);
    expect(second).toEqual({ created: 0, updated: 0, itemsAdded: 0 });

    const fixed = await repo.getCollectionBySlug("test-picks");
    expect(fixed?.title).toBe("种子标题");
    const items = await repo.listCollectionItemsDetail(fixed!.id);
    expect(items).toHaveLength(3);
    const bySite = new Map(items.map((i) => [i.siteId, i]));
    expect(bySite.get(siteA)?.note).toBe("人工备注");
    expect(bySite.get(siteA)?.sort).toBe(5);
  });

  it("空库上跑：全部新建，计数与旧行为一致（16 个就是 16 个）", async () => {
    await makeSite(URL_A, "站点 A");
    await makeSite(URL_B, "站点 B");
    const result = await syncSeedCollections(repo, SEED_INPUT);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    // B 在 test-picks 里是新建合集的站位，不计入 itemsAdded（那只计已存在合集的补站）
    expect(result.itemsAdded).toBe(0);
    expect((await repo.getCollectionBySlug("test-picks"))?.sort).toBe(0);
    expect((await repo.getCollectionBySlug("fresh-col"))?.sort).toBe(1);
  });

  it("拼写只差尾斜杠的站位也能认到（findSiteByUrl；getSite 精确匹配会丢）", async () => {
    // 库里存的是带尾斜杠的拼写（createSite 原样存，导航文件里支付宝/微信
    // 就是这么写的），种子引用的是不带斜杠的规范拼写——两者是同一站
    const siteSlash = await makeSite("https://example.com/seed-drift-slash/", "尾斜杠站");
    await makeSite(URL_A, "站点 A");
    // 已存在合集里预置一个站，漂移站位应被补进
    await repo.upsertCollection({
      slug: "drift-existing",
      title: "漂移旧合集",
      kind: "topic",
      sort: 0,
      sites: [{ site: URL_A, sort: 0 }],
    });
    const input: SeedCollectionInput[] = [
      {
        slug: "drift-existing",
        title: "漂移旧合集",
        kind: "topic",
        description: "",
        sites: [
          { site: URL_A, sort: 0 },
          { site: "https://example.com/seed-drift-slash", sort: 1 },
        ],
      },
      {
        slug: "drift-col",
        title: "漂移新合集",
        kind: "topic",
        description: "",
        sites: [{ site: "https://example.com/seed-drift-slash", sort: 0 }],
      },
    ];
    const result = await syncSeedCollections(repo, input);
    expect(result).toEqual({ created: 1, updated: 0, itemsAdded: 1 });

    const existing = await repo.getCollectionBySlug("drift-existing");
    const existingItems = await repo.listCollectionItemsDetail(existing!.id);
    expect(existingItems).toHaveLength(2);
    expect(new Map(existingItems.map((i) => [i.siteId, i])).get(siteSlash)?.sort).toBe(1);

    const fresh = await repo.getCollectionBySlug("drift-col");
    const freshItems = await repo.listCollectionItemsDetail(fresh!.id);
    expect(freshItems).toHaveLength(1);
    expect(freshItems[0]?.siteId).toBe(siteSlash);
  });
});
