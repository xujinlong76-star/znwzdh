import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

/**
 * 标签共现相关标签（信息组织清晰度的真实缺口）。
 *
 * 之前整套代码对标签共现零实现：标签页是浏览死胡同。这里验证
 * listRelatedTags 的纯 SQL 共现聚合：两个标签被同一批存活站点同时挂得越多，
 * 排名越靠前；软删除站点不计入共现（与 listTagsWithCounts 同口径）。
 */
describe("标签共现相关标签 (listRelatedTags)", () => {
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("按共现存活站点数降序返回相关标签", async () => {
    const cat = await repo.createCategory({ title: "开发" });
    // A/B 共现 3 个存活站点；A/C 共现 1 个存活站点
    await repo.createSite({ url: "https://a1.test", title: "A1", categoryId: cat.id, tags: ["A", "B"], status: "active" });
    await repo.createSite({ url: "https://a2.test", title: "A2", categoryId: cat.id, tags: ["A", "B"], status: "active" });
    await repo.createSite({ url: "https://a3.test", title: "A3", categoryId: cat.id, tags: ["A", "B"], status: "active" });
    await repo.createSite({ url: "https://a4.test", title: "A4", categoryId: cat.id, tags: ["A", "C"], status: "active" });
    // 只挂 A 的站点不影响共现计数
    await repo.createSite({ url: "https://a5.test", title: "A5", categoryId: cat.id, tags: ["A"], status: "active" });

    const aTag = (await repo.listTagsWithCounts()).find((t) => t.name === "A")!;
    const related = await repo.listRelatedTags(aTag.id, 12);
    const names = related.map((t) => t.name);
    expect(names).toContain("B");
    expect(names).toContain("C");
    const b = related.find((t) => t.name === "B")!;
    const c = related.find((t) => t.name === "C")!;
    // B 共现 3 个、C 共现 1 个 → B 排前
    expect(b.sharedSites).toBe(3);
    expect(c.sharedSites).toBe(1);
    expect(names.indexOf("B")).toBeLessThan(names.indexOf("C"));
  });

  it("排除自身且不计入软删除站点的共现", async () => {
    const cat = await repo.createCategory({ title: "开发2" });
    await repo.createSite({ url: "https://b1.test", title: "B1", categoryId: cat.id, tags: ["X", "Y"], status: "active" });
    // 软删除站点：曾把 X 与 Y 共现，但不应计入
    const broken = await repo.createSite({ url: "https://b2.test", title: "B2", categoryId: cat.id, tags: ["X", "Y"], status: "active" });
    await repo.updateSite(broken.id, { status: "broken" });
    // 只挂 X 的（确认 X 自身不回显）
    await repo.createSite({ url: "https://b3.test", title: "B3", categoryId: cat.id, tags: ["X"], status: "active" });

    const xTag = (await repo.listTagsWithCounts()).find((t) => t.name === "X")!;
    const related = await repo.listRelatedTags(xTag.id, 12);
    expect(related.map((t) => t.name)).not.toContain("X");
    const y = related.find((t) => t.name === "Y");
    expect(y).toBeDefined();
    expect(y!.sharedSites).toBe(1); // 只算存活的 b1，broken 的 b2 不算
  });

  it("无共现时返回空集（而不是报错或自回显）", async () => {
    const cat = await repo.createCategory({ title: "开发3" });
    await repo.createSite({ url: "https://z1.test", title: "Z1", categoryId: cat.id, tags: ["Z"], status: "active" });
    const zTag = (await repo.listTagsWithCounts()).find((t) => t.name === "Z")!;
    const related = await repo.listRelatedTags(zTag.id, 12);
    expect(related).toEqual([]);
  });

  it("limit 截断且不越界", async () => {
    const cat = await repo.createCategory({ title: "开发4" });
    for (let i = 0; i < 8; i++) {
      await repo.createSite({ url: `https://l${i}.test`, title: "L" + i, categoryId: cat.id, tags: ["L", "T" + i], status: "active" });
    }
    const lTag = (await repo.listTagsWithCounts()).find((t) => t.name === "L")!;
    const related = await repo.listRelatedTags(lTag.id, 3);
    expect(related).toHaveLength(3);
  });
});
