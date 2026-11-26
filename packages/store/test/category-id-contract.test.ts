/**
 * categoryId 契约测试（2026-11-26 20:22 轮）。
 *
 * 锁住 /api/search 与 /api/sites 对 categoryId 的同一口径：
 *  1. 接受 id 或 slug，含后代展开（anchor 前缀）；
 *  2. 解析不到（不存在/重名歧义）返回空，不把原字符串当 id 匹配；
 *  3. 显式 categoryId 被 L1 零结果兜底丢掉时，响应点名 relaxedCategoryId
 *     （A3 同款；推断出的类目不点名，它已由 inferredCategory 上报）。
 *
 * 背景：此前 listSites 只做精确等值匹配，父分类自身 0 站 → 恒返 []，
 * 而 search 侧早已是子树 + slug 解析——同一参数名在两个接口上语义不同。
 * L1 放宽本身是既有设计（taxonomy-stop-bleeding 已钉死：歧义类目归零后
 * 放宽给全站结果并标 fallback:"filter"），本轮不改放宽，只补点名。
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";

let db: Db;
let repo: Repository;
let search: SearchEngine;

beforeEach(async () => {
  db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  repo = new Repository(db);
  search = new SearchEngine({ db, fts: null, vectors: null, repo });
});

/** 父分类 1 个，下挂 1 个有站叶子（5 站）+ 1 个空叶子；父自身 0 站。 */
async function seedDevopsTree() {
  const parent = await repo.createCategory({ title: "运维与安全", titleEn: "DevOps" });
  const leaf = await repo.createCategory({ title: "网关与流量", parentId: parent.id });
  await repo.createCategory({ title: "空子分类", parentId: parent.id });
  const sites = [];
  for (let i = 1; i <= 5; i++) {
    sites.push(
      await repo.createSite({
        url: `https://gw-${i}.example.com`,
        title: `网关站 ${i}`,
        categoryId: leaf.id,
      }),
    );
  }
  return { parent, leaf, sites };
}

async function seedOtherCategoryWithDocker() {
  const other = await repo.createCategory({ title: "容器与编排", titleEn: "Containers" });
  const docker = await repo.createSite({
    url: "https://docker.example.com",
    title: "Docker 容器站",
    description: "容器镜像与编排入门",
    categoryId: other.id,
  });
  return { other, docker };
}

describe("listSites 的 categoryId 契约", () => {
  it("父分类 id 返回整棵子树，与叶子分类结果一致", async () => {
    const { parent, leaf, sites } = await seedDevopsTree();
    const byParent = await repo.listSites({ categoryId: parent.id });
    const byLeaf = await repo.listSites({ categoryId: leaf.id });
    expect(byParent.map((s) => s.id).sort()).toEqual(sites.map((s) => s.id).sort());
    expect(byLeaf.map((s) => s.id).sort()).toEqual(sites.map((s) => s.id).sort());
    for (const s of byParent) expect(s.categoryId).toBe(leaf.id);
  });

  it("slug 与 id 同结果", async () => {
    const { parent, sites } = await seedDevopsTree();
    expect(parent.slug).toBeTruthy();
    const bySlug = await repo.listSites({ categoryId: parent.slug });
    expect(bySlug.map((s) => s.id).sort()).toEqual(sites.map((s) => s.id).sort());
  });

  it("叶子分类行为不变（回归）", async () => {
    const { leaf, sites } = await seedDevopsTree();
    const list = await repo.listSites({ categoryId: leaf.id });
    expect(list).toHaveLength(5);
    expect(list.map((s) => s.id).sort()).toEqual(sites.map((s) => s.id).sort());
  });

  it("不存在的分类返回 []", async () => {
    await seedDevopsTree();
    expect(await repo.listSites({ categoryId: "zzz-no-such-cat" })).toEqual([]);
  });

  it("重名标题歧义返回 []（不静默挑一个节点）", async () => {
    const root1 = await repo.createCategory({ title: "语言" });
    const sub1 = await repo.createCategory({ title: "语言子一", parentId: root1.id });
    await repo.createSite({ url: "https://lang-1.example.com", title: "Alpha 语言站", categoryId: sub1.id });
    // 第二个「语言」是历史遗留：直插一行（同 taxonomy-stop-bleeding 的做法）。
    await repo.run("DROP INDEX IF EXISTS categories_root_title_uniq");
    const id = randomUUID();
    const now = Date.now();
    await repo.run(
      "INSERT INTO categories (id, anchor, parent_id, title, title_en, slug, description, icon, enabled, sort, source, alt_labels, related_categories, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [id, id, null, "语言", null, null, null, null, 1, 0, "api", "[]", "[]", now, now],
    );
    expect(await repo.listSites({ categoryId: "语言" })).toEqual([]);
    // 但按 id 查仍能命中唯一节点（歧义只影响标题解析）。
    expect((await repo.listSites({ categoryId: root1.id })).map((s) => s.title)).toEqual(["Alpha 语言站"]);
  });
});

describe("search 的 categoryId 契约", () => {
  it("空查询浏览：父分类返回子树", async () => {
    const { parent, sites } = await seedDevopsTree();
    const res = await search.search({ q: "", categoryId: parent.id });
    expect(res.hits.map((h) => h.siteId).sort()).toEqual(sites.map((s) => s.id).sort());
    expect(res.hasMore).toBe(false);
  });

  it("空查询浏览：不存在的分类返回 0 条", async () => {
    await seedDevopsTree();
    const res = await search.search({ q: "", categoryId: "zzz-no-such-cat" });
    expect(res.hits).toEqual([]);
    expect(res.hasMore).toBe(false);
  });

  it("有 q + 不存在的分类：放宽并点名 relaxedCategoryId", async () => {
    await seedDevopsTree();
    const { docker } = await seedOtherCategoryWithDocker();
    const res = await search.search({ q: "Docker", categoryId: "zzz-no-such-cat", disableSemantic: true });
    expect(res.fallback).toBe("filter");
    expect(res.relaxedCategoryId).toBe("zzz-no-such-cat");
    expect(res.hits.map((h) => h.siteId)).toContain(docker.id);
  });

  it("有 q + 真实分类但类目内零命中：放宽并点名", async () => {
    const { parent } = await seedDevopsTree();
    const { docker } = await seedOtherCategoryWithDocker();
    const res = await search.search({ q: "Docker", categoryId: parent.id, disableSemantic: true });
    expect(res.fallback).toBe("filter");
    expect(res.relaxedCategoryId).toBe(parent.id);
    expect(res.hits.map((h) => h.siteId)).toContain(docker.id);
  });

  it("有 q + 类目内有命中：不放宽、不点名", async () => {
    const { parent, leaf } = await seedDevopsTree();
    const alpha = await repo.createSite({
      url: "https://alpha-gw.example.com",
      title: "Alpha 网关站",
      categoryId: leaf.id,
    });
    const res = await search.search({ q: "Alpha", categoryId: parent.id, disableSemantic: true });
    expect(res.hits.map((h) => h.siteId)).toEqual([alpha.id]);
    expect(res.fallback).toBeUndefined();
    expect(res.relaxedCategoryId).toBeUndefined();
  });
});
