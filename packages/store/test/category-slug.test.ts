/**
 * P1-2 类目 slug 回归（2026-10-22 类目树升级方案 §5.1）。
 *
 * slug 是类目的外部标识：/category/{slug} 取代 /category/{uuid}。
 * 因此它的规矩和内部 id 不一样，这套测试逐条锁住：
 * 1. 新建即有 slug（英文优先，纯中文走拼音兜底）；显式 slug 撞库要**报错**，
 *    不能静默加 -2 —— registry 里写死的 slug 和库里的对不上，比撞名更糟。
 * 2. 自动生成的 slug 判**全局**冲突，而不是判同父：URL 里没有父级路径。
 * 3. 改名不重写 slug（外链/导航/sitemap 已经发出去了）。
 * 4. 存量行 slug 为 NULL：唯一索引是部分索引（WHERE slug IS NOT NULL），
 *    多条 NULL 必须共存；启动回填把它们补上。
 * 5. 「每父标题唯一」是写入层校验（同级重名拒绝、跨父重名允许）。
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { migrateCategorySlugs } from "../src/migrate.ts";

let db: Db;
let repo: Repository;

beforeEach(async () => {
  db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  repo = new Repository(db);
});

/** 造一条「迁移前的旧行」：slug 为 NULL，绕过写入层校验 */
async function insertLegacyCategory(title: string): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await repo.run(
    "INSERT INTO categories (id, anchor, parent_id, title, title_en, slug, description, icon, enabled, sort, source, alt_labels, related_categories, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, id, null, title, null, null, null, null, 1, 0, "api", "[]", "[]", now, now],
  );
  return id;
}

describe("createCategory 生成 slug", () => {
  it("英文名走 ASCII，纯中文走拼音兜底", async () => {
    const en = await repo.createCategory({ title: "前端开发", titleEn: "Frontend Development" });
    expect(en.slug).toBe("frontend-development");
    const zh = await repo.createCategory({ title: "语言学习" });
    expect(zh.slug).toBe("yuyanxuexi");
  });

  it("显式 slug 规范化后入库，撞库报错而不是静默改名", async () => {
    const taken = await repo.createCategory({ title: "已占用", slug: "ai-tools" });
    expect(taken.slug).toBe("ai-tools");
    await expect(repo.createCategory({ title: "再来一个", slug: " AI-Tools " })).rejects.toThrow(/已被占用/);
    // registry 播种依赖这条：slug 被占就整批失败，好过悄悄生成 ai-tools-2
    expect((await repo.getCategoryBySlug("ai-tools-2"))).toBeNull();
  });

  it("自动 slug 的冲突判全局，不判同父", async () => {
    const a = await repo.createCategory({ title: "设计素材" });
    const b = await repo.createCategory({ title: "父甲" });
    // 跨父同名标题是允许的（每父唯一），但两个 slug 不能撞同一个 URL
    const c = await repo.createCategory({ title: "设计素材", parentId: b.id });
    expect(c.slug).toBe(`${a.slug}-2`);
    expect((await repo.getCategoryBySlug(a.slug!))!.id).toBe(a.id);
    expect((await repo.getCategoryBySlug(c.slug!))!.id).toBe(c.id);
  });

  it("标题 trim 后入库", async () => {
    const cat = await repo.createCategory({ title: "  仪表盘  " });
    expect(cat.title).toBe("仪表盘");
  });
});

describe("getCategoryBySlug", () => {
  it("命中返回类目，未命中返回 null，输入做规范化", async () => {
    const cat = await repo.createCategory({ title: "效率办公", titleEn: "Office Productivity" });
    expect((await repo.getCategoryBySlug("office-productivity"))!.id).toBe(cat.id);
    expect((await repo.getCategoryBySlug("  Office-Productivity  "))!.id).toBe(cat.id);
    expect(await repo.getCategoryBySlug("no-such-slug")).toBeNull();
    expect(await repo.getCategoryBySlug("")).toBeNull();
  });

  it("改名不会重写 slug", async () => {
    const cat = await repo.createCategory({ title: "影音娱乐", titleEn: "Entertainment" });
    const renamed = await repo.updateCategory(cat.id, { title: "影音与直播" });
    expect(renamed!.title).toBe("影音与直播");
    expect(renamed!.slug).toBe("entertainment");
    expect((await repo.getCategoryBySlug("entertainment"))!.id).toBe(cat.id);
  });

  it("显式换 slug 也做冲突检查，且不允许空", async () => {
    const a = await repo.createCategory({ title: "甲", slug: "alpha" });
    await repo.createCategory({ title: "乙", slug: "beta" });
    await expect(repo.updateCategory(a.id, { slug: "beta" })).rejects.toThrow(/已被占用/);
    await expect(repo.updateCategory(a.id, { slug: "  " })).rejects.toThrow(/不能为空/);
    expect((await repo.updateCategory(a.id, { slug: "Alpha-2 " }))!.slug).toBe("alpha-2");
  });
});

describe("存量行的 slug 回填", () => {
  it("NULL slug 可以共存（部分唯一索引），回填后补齐且全局唯一", async () => {
    // P3 登记了根层标题唯一索引；先摘掉索引，模拟「索引登记之前」的存量库
    await repo.run("DROP INDEX IF EXISTS categories_root_title_uniq");
    // 多条 NULL 同时存在：若索引没写成 WHERE slug IS NOT NULL，这条 INSERT 就会炸
    const first = await insertLegacyCategory("游戏电竞");
    const second = await insertLegacyCategory("游戏电竞");
    expect(await repo.getCategoryBySlug("youxidianjing")).toBeNull();

    expect(await migrateCategorySlugs(db)).toBe(2);
    // 两条同 sort 同标题的旧行，谁先拿到裸 slug 取决于扫描顺序 —— 只锁「不撞车」
    const slugs = [(await repo.getCategory(first))!.slug, (await repo.getCategory(second))!.slug];
    expect(new Set(slugs)).toEqual(new Set(["youxidianjing", "youxidianjing-2"]));
  });

  it("已有 slug 的行不会被改写（回填只补 NULL）", async () => {
    const cat = await repo.createCategory({ title: "数据与分析", titleEn: "Data & Analytics" });
    await insertLegacyCategory("公益志愿");
    expect(await migrateCategorySlugs(db)).toBe(1);
    expect((await repo.getCategory(cat.id))!.slug).toBe("data-and-analytics");
    // 幂等：第二次没有待补的行
    expect(await migrateCategorySlugs(db)).toBe(0);
  });

  it("回填结果与 createCategory 的保留规则不冲突", async () => {
    await insertLegacyCategory("学术科研");
    await migrateCategorySlugs(db);
    const created = await repo.createCategory({ title: "学术科研", parentId: (await repo.createCategory({ title: "父乙" })).id });
    expect(created.slug).toBe("xueshukeyan-2");
  });
});

describe("每父标题唯一", () => {
  it("同级重名拒绝，跨父重名允许", async () => {
    const parent = await repo.createCategory({ title: "父级" });
    const child = await repo.createCategory({ title: "子级甲", parentId: parent.id });
    await expect(repo.createCategory({ title: "子级甲", parentId: parent.id })).rejects.toThrow(/同级/);
    await repo.createCategory({ title: "子级甲" });
    await repo.createCategory({ title: "子级甲", parentId: (await repo.createCategory({ title: "另一个父" })).id });
    expect(child.title).toBe("子级甲");
  });

  it("改名与移动同样受约束", async () => {
    const parent = await repo.createCategory({ title: "父级二" });
    await repo.createCategory({ title: "已有子", parentId: parent.id });
    const sibling = await repo.createCategory({ title: "待改名", parentId: parent.id });
    // 同级改名撞名要拒（跨父撞名是允许的，所以「已有子」在根层随便起）
    await expect(repo.updateCategory(sibling.id, { title: "已有子" })).rejects.toThrow(/同级/);
    // 换父本身没有同名冲突时是允许的
    const outside = await repo.createCategory({ title: "可移动的" });
    await expect(repo.moveCategory(outside.id, parent.id)).resolves.not.toBeNull();
    // 跨父重名可以留在根层，但把第二个同名根移进同一个父就会带进重名
    const second = await repo.createCategory({ title: "可移动的" });
    await expect(repo.moveCategory(second.id, parent.id)).rejects.toThrow(/同级/);
  });
});
