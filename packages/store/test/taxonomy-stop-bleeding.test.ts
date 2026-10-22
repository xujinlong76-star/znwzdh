/**
 * P0「止血」回归测试（2026-10-22 类目树升级方案 §8 P0）。
 *
 * 锁住四条会让类目体系反复塌缩的机制：
 * 1. 启动孤儿清扫必须可停用 —— 类目迁移窗口里新树叶子暂无站点引用，
 *    正好落在清扫的删除条件上（今天 962 条回收站站点的 category_id 全悬空即由此而来）。
 * 2. mergeCategories 必须搬走**所有**引用行（含回收站、含 100 名之后），
 *    旧实现按 listSites（deleted_at IS NULL + 默认 limit 100）取站点再逐个改，
 *    等于把超出部分的站点指向已删除的类目行。
 * 3. 「未分类」是有固定 id 的系统类目，且不能被删（它是删除路径的落点）。
 * 4. 类目过滤按标题解析时必须唯一命中：重名（实测「语言」×3）时
 *    旧实现 LIMIT 1 静默选一个节点，结果由存储顺序决定。
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";
import { cleanupOrphanPluginCategories } from "../src/migrate.ts";
import { UNCATEGORIZED_CATEGORY_ID } from "@navhub/core";

let db: Db;
let repo: Repository;

beforeEach(async () => {
  db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  repo = new Repository(db);
});

describe("cleanupOrphanPluginCategories 的停用开关", () => {
  async function makeOrphan(): Promise<string> {
    const categoryId = await repo.ensureCategory("清扫演练分类", "plugin:stop-bleeding-pack");
    await repo.run(
      "INSERT INTO plugins (id, slug, kind, name, description, version, manifest, status, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [
        "plug-stop-bleeding",
        "stop-bleeding-pack",
        "site-pack",
        "清扫演练包",
        "",
        "1.0.0",
        "{}",
        "published",
        "user",
        Date.now(),
        Date.now(),
      ],
    );
    await repo.run(
      "INSERT INTO plugin_installs (plugin_id, identity, version, meta, installed_at, removed_at) VALUES (?,?,?,?,?,?)",
      ["plug-stop-bleeding", "visitor-1", "1.0.0", "{}", Date.now(), Date.now()],
    );
    return categoryId;
  }

  it("skip=true 时不删除无主插件类目（迁移窗口用）", async () => {
    const categoryId = await makeOrphan();
    expect(await cleanupOrphanPluginCategories(db, { skip: true })).toBe(0);
    expect(await repo.getCategory(categoryId)).not.toBeNull();
  });

  it("未 skip 时照常清扫", async () => {
    const categoryId = await makeOrphan();
    expect(await cleanupOrphanPluginCategories(db)).toBe(1);
    expect(await repo.getCategory(categoryId)).toBeNull();
  });
});

describe("mergeCategories 不留悬空 category_id", () => {
  it("回收站站点与 100 名之后的站点一起搬走", async () => {
    const parent = await repo.createCategory({ title: "合并父" });
    const child = await repo.createCategory({ title: "合并子", parentId: parent.id });
    const target = await repo.createCategory({ title: "合并目标" });
    const elsewhere = await repo.createCategory({ title: "别处" });

    const total = 130;
    for (let i = 0; i < total; i += 1) {
      await repo.createSite({
        url: `https://merge-${i}.example.com`,
        title: `合并站点 ${i}`,
        categoryId: child.id,
      });
    }
    const trashed = await repo.createSite({
      url: "https://merge-trash.example.com",
      title: "回收站里的合并站点",
      categoryId: child.id,
    });
    await repo.deleteSite(trashed.id);
    // 主指针挂在别处、子指针指向被并入的子类目：子指针也要清
    const subReferencing = await repo.createSite({
      url: "https://merge-sub.example.com",
      title: "子指针引用站点",
      categoryId: elsewhere.id,
      subCategoryId: child.id,
    });

    const result = await repo.mergeCategories(parent.id, target.id);
    expect(result.removedCategories).toBe(2);
    expect(result.movedSites).toBe(total + 1);

    const dangling = await repo.raw(
      "SELECT COUNT(*) AS c FROM sites WHERE category_id IN (?, ?) OR sub_category_id IN (?, ?)",
      [parent.id, child.id, parent.id, child.id],
    );
    expect(Number(dangling[0]!.c)).toBe(0);
    const kept = await repo.getSite(subReferencing.id);
    // 主指针在「别处」，合并只该清掉它的子指针
    expect(kept!.categoryId).toBe(elsewhere.id);
    expect(kept!.subCategoryId).toBeNull();
    const restored = await repo.restoreSite(trashed.id);
    expect(restored!.categoryId).toBe(target.id);
  });

  it("拒绝把类目合并进它自己的子树", async () => {
    const parent = await repo.createCategory({ title: "环检查父" });
    const child = await repo.createCategory({ title: "环检查子", parentId: parent.id });
    await expect(repo.mergeCategories(parent.id, child.id)).rejects.toThrow(/子类目/);
  });
});

describe("「未分类」是显式系统类目", () => {
  it("按固定 id 取，缺则建", async () => {
    expect(await repo.getCategory(UNCATEGORIZED_CATEGORY_ID)).toBeNull();
    const id = await repo.ensureUncategorized();
    expect(id).toBe(UNCATEGORIZED_CATEGORY_ID);
    const cat = await repo.getCategory(id);
    expect(cat!.title).toBe("未分类");
    expect(cat!.sort).toBe(999);
    // 快照托管集（null / navsphere / seed）里的类目会因「快照缺席」被删；
    // 兜底类目不能进那个集合。
    expect(cat!.source).toBe("system");
    expect(await repo.ensureUncategorized()).toBe(id);
  });

  it("删除其它类目时站点落到固定 id，而不是按标题新建", async () => {
    const doomed = await repo.createCategory({ title: "待删类目" });
    const site = await repo.createSite({ url: "https://fallback.example.com", title: "兜底站点", categoryId: doomed.id });
    await repo.deleteCategory(doomed.id);
    expect((await repo.getSite(site.id))!.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
  });

  it("「未分类」本身不可删除", async () => {
    await repo.ensureUncategorized();
    await expect(repo.deleteCategory(UNCATEGORIZED_CATEGORY_ID)).rejects.toThrow(/兜底类目/);
  });
});

describe("categorySiteCounts", () => {
  it("只按主指针聚合，且只算 active 未删站点", async () => {
    const a = await repo.createCategory({ title: "计数甲" });
    const b = await repo.createCategory({ title: "计数乙" });
    await repo.createSite({ url: "https://count-1.example.com", title: "一", categoryId: a.id });
    await repo.createSite({ url: "https://count-2.example.com", title: "二", categoryId: a.id, subCategoryId: b.id });
    // 主副指针同类目：只能计一次
    await repo.createSite({ url: "https://count-3.example.com", title: "三", categoryId: a.id, subCategoryId: a.id });
    await repo.createSite({ url: "https://count-4.example.com", title: "四", categoryId: a.id, status: "broken" });
    const trashed = await repo.createSite({ url: "https://count-5.example.com", title: "五", categoryId: b.id });
    await repo.deleteSite(trashed.id);
    // 只有副指针（浏览侧 search 不可见）：不得计给 b
    await repo.createSite({ url: "https://count-6.example.com", title: "六", categoryId: "", subCategoryId: b.id });

    const counts = new Map((await repo.categorySiteCounts()).map((r) => [r.categoryId, r.sites]));
    // 副指针是只读镜像：并集会让一级根计数 > 子叶之和，与类目页 /api/search 口径分叉
    expect(counts.get(a.id)).toBe(3);
    expect(counts.has(b.id)).toBe(false);
  });
});

describe("类目过滤的标题解析必须唯一命中", () => {
  let search: SearchEngine;

  beforeEach(() => {
    search = new SearchEngine({ db, fts: null, vectors: null });
  });

  /** 绕过写入层校验，造一条「旧库里就存在的同名根类目」（slug 为 NULL，同 legacy 行） */
  async function insertLegacyDuplicateRoot(title: string): Promise<string> {
    // P3 登记了根层标题唯一索引；这里先摘掉索引，模拟「索引登记之前」的存量重名库
    await repo.run("DROP INDEX IF EXISTS categories_root_title_uniq");
    const id = randomUUID();
    const now = Date.now();
    await repo.run(
      "INSERT INTO categories (id, anchor, parent_id, title, title_en, slug, description, icon, enabled, sort, source, alt_labels, related_categories, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [id, id, null, title, null, null, null, null, 1, 0, "api", "[]", "[]", now, now],
    );
    return id;
  }

  it("id 解析含后代；重名标题不再静默挑一个节点", async () => {
    const root1 = await repo.createCategory({ title: "语言" });
    const sub1 = await repo.createCategory({ title: "语言子一", parentId: root1.id });
    // 第二个「语言」是**历史遗留**：写入层的同级唯一校验（createCategory）只挡新写，
    // 存量重名要靠 P3 的 remap/merge 收敛。这里直插一行 legacy 数据，
    // 因为要测的正是「库里已经有两个同名根时，过滤不能凭存储顺序选一个」。
    const root2 = await insertLegacyDuplicateRoot("语言");
    const langSite = await repo.createSite({ url: "https://lang-1.example.com", title: "Alpha 语言站", categoryId: sub1.id });
    const otherSite = await repo.createSite({ url: "https://lang-2.example.com", title: "Alpha 语言二站", categoryId: root2 });

    const byId = await search.search({ q: "Alpha", categoryId: root1.id, disableSemantic: true });
    expect(byId.hits.map((h) => h.siteId)).toEqual([langSite.id]);

    // 重名 → 按「无法解析」处理，过滤条件命中 0 条；
    // 随后走既有的「零结果放宽」兜底，落到 fallback:"filter" 上（可观测）。
    // 旧实现是 LIMIT 1 静默选中某一个「语言」根：结果只剩 1 条且无任何标记。
    const ambiguous = await search.search({ q: "Alpha", categoryId: "语言", disableSemantic: true });
    expect(ambiguous.fallback).toBe("filter");
    expect(ambiguous.hits.map((h) => h.siteId).sort()).toEqual([langSite.id, otherSite.id].sort());

    const unique = await search.search({ q: "Alpha", categoryId: "语言子一", disableSemantic: true });
    expect(unique.hits.map((h) => h.siteId)).toEqual([langSite.id]);
  });

  it("slug 也能解析，且同样展开到后代", async () => {
    // /category/{slug} 的页面直接把 slug 透给检索：少一次「先换成 id」的往返，
    // 也让外部调用方拿到的 URL 标识与查询参数是同一个东西。
    const root = await repo.createCategory({ title: "影音娱乐", titleEn: "Entertainment" });
    const leaf = await repo.createCategory({ title: "播客与音频", parentId: root.id });
    const site = await repo.createSite({ url: "https://slug-1.example.com", title: "Alpha 播客站", categoryId: leaf.id });
    expect(root.slug).toBe("entertainment");

    const bySlug = await search.search({ q: "Alpha", categoryId: "entertainment", disableSemantic: true });
    expect(bySlug.hits.map((h) => h.siteId)).toEqual([site.id]);

    // 大小写不敏感：slug 落库前统一小写，URL 里手写成大写也不该查空
    const byUpper = await search.search({ q: "Alpha", categoryId: "Entertainment", disableSemantic: true });
    expect(byUpper.hits.map((h) => h.siteId)).toEqual([site.id]);
  });
});
