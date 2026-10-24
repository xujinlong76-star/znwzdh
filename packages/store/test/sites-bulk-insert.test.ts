/**
 * `insertSitesBulk` 的契约（备份恢复批量化）。
 *
 * 这条路径替代的是 `createSite` 的「新建」分支，所以测试的靶心是**等价性**：
 * 字段默认值、标签归一、fts/pinyin 索引字段必须与逐条创建一致，
 * 否则恢复出来的库会出现「站内搜不到」这类看不出来的漂移。
 *
 * 第二个靶心是 `hydrate: false`：备份恢复只需要条数，回读 5 万条完整记录是纯浪费。
 * 这个开关必须真的跳过回读（sites 为空），而不是「读完再丢掉」。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";

describe("insertSitesBulk", () => {
  let db: Db;
  let repo: Repository;
  let categoryId: string;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    const category = await repo.createCategory({ title: "批量导入" });
    categoryId = category.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it("字段、标签与索引字段与逐条 createSite 等价", async () => {
    const single = await repo.createSite({
      url: "https://bulk-single.example.com",
      title: "单条创建的站点",
      description: "对照组",
      categoryId,
      tags: ["工具"],
    });

    const { count, sites } = await repo.insertSitesBulk([
      {
        id: "bulk-1",
        url: "https://bulk-1.example.com",
        title: "单条创建的站点",
        description: "对照组",
        categoryId,
        tags: ["工具"],
      },
    ]);

    expect(count).toBe(1);
    expect(sites).toHaveLength(1);
    const bulk = sites[0]!;
    // 默认值必须一致（批量路径最容易在这里手抄错）
    expect(bulk.status).toBe(single.status);
    expect(bulk.enabled).toBe(single.enabled);
    expect(bulk.sort).toBe(single.sort);
    expect(bulk.featured).toBe(single.featured);
    expect(bulk.source).toBe(single.source);
    // 索引字段等价：同一个标题能搜到两条
    const search = new SearchEngine({ db, fts: null, vectors: null, repo });
    const result = await search.search({ q: "单条创建的站点", limit: 10 });
    const ids = result.hits.map((hit) => hit.siteId);
    expect(ids).toContain(single.id);
    expect(ids).toContain("bulk-1");
  });

  it("重复标签被去重（不撞 site_tags 唯一约束）", async () => {
    const { sites } = await repo.insertSitesBulk([
      {
        id: "bulk-dup-tag",
        url: "https://bulk-dup-tag.example.com",
        title: "重复标签",
        categoryId,
        tags: ["前端", "前端", " 前端 ", "后端"],
      },
    ]);
    const site = sites[0]!;
    expect([...site.tags].sort()).toEqual(["前端", "后端"].sort());
  });

  it("hydrate:false 跳过回读，但仍返回准确条数", async () => {
    const inputs = Array.from({ length: 30 }, (_, i) => ({
      id: `bulk-noh-${i}`,
      url: `https://bulk-noh-${i}.example.com`,
      title: `不回读 ${i}`,
      categoryId,
      tags: ["批量"],
    }));
    const result = await repo.insertSitesBulk(inputs, { hydrate: false });
    expect(result.count).toBe(30);
    expect(result.sites).toHaveLength(0);

    // 跳过回读不等于跳过写入：随机抽查一条必须真的在库里
    const persisted = await repo.getSite("bulk-noh-7");
    expect(persisted).not.toBeNull();
    expect(persisted!.title).toBe("不回读 7");
  });

  it("空输入是 no-op", async () => {
    await expect(repo.insertSitesBulk([])).resolves.toEqual({ count: 0, sites: [] });
  });
});
