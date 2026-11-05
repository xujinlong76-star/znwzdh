import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

describe("基于共享标签发现相似站点 (listSimilarSitesByTags)", () => {
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("按共享存活标签数降序返回相似站点", async () => {
    const cat = await repo.createCategory({ title: "前端开发" });
    const target = await repo.createSite({
      url: "https://react.test",
      title: "React",
      categoryId: cat.id,
      tags: ["框架", "UI", "JavaScript", "前端"],
      status: "active",
    });

    // 共享 3 个标签 (框架, UI, JavaScript)
    const vue = await repo.createSite({
      url: "https://vue.test",
      title: "Vue",
      categoryId: cat.id,
      tags: ["框架", "UI", "JavaScript"],
      status: "active",
    });

    // 共享 1 个标签 (JavaScript)
    const lodash = await repo.createSite({
      url: "https://lodash.test",
      title: "Lodash",
      categoryId: cat.id,
      tags: ["JavaScript", "工具库"],
      status: "active",
    });

    // 共享 0 个标签
    await repo.createSite({
      url: "https://python.test",
      title: "Python",
      categoryId: cat.id,
      tags: ["后端", "人工智能"],
      status: "active",
    });

    const similar = await repo.listSimilarSitesByTags(target.id, 6);
    expect(similar.length).toBe(2);
    expect(similar[0]!.id).toBe(vue.id);
    expect(similar[1]!.id).toBe(lodash.id);
  });

  it("排除自身，并且不计入 broken / 软删除站点", async () => {
    const cat = await repo.createCategory({ title: "后端开发" });
    const target = await repo.createSite({
      url: "https://fastapi.test",
      title: "FastAPI",
      categoryId: cat.id,
      tags: ["Python", "API", "后端"],
      status: "active",
    });

    const flaskBroken = await repo.createSite({
      url: "https://flask.test",
      title: "Flask",
      categoryId: cat.id,
      tags: ["Python", "API"],
      status: "broken",
    });

    const django = await repo.createSite({
      url: "https://django.test",
      title: "Django",
      categoryId: cat.id,
      tags: ["Python", "后端"],
      status: "active",
    });

    const similar = await repo.listSimilarSitesByTags(target.id, 6);
    const ids = similar.map((s) => s.id);
    expect(ids).not.toContain(target.id);
    expect(ids).not.toContain(flaskBroken.id);
    expect(ids).toContain(django.id);
  });

  it("无标签或无重合标签站点返回空数组", async () => {
    const cat = await repo.createCategory({ title: "独立分类" });
    const isolated = await repo.createSite({
      url: "https://isolated.test",
      title: "Isolated",
      categoryId: cat.id,
      tags: ["罕见独立标签12345"],
      status: "active",
    });

    const similar = await repo.listSimilarSitesByTags(isolated.id, 6);
    expect(similar).toEqual([]);
  });
});
