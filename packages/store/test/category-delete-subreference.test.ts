/**
 * 删除类目时的引用完整性。
 *
 * `sites` 用两个列指向类目：`category_id`（一级）与 `sub_category_id`（二级）。
 * 旧实现只安置了 `category_id`，被当作「子类目」引用的站点会留下悬空 id：
 * 界面按 (category, sub) 归组时这些站点既不在原子类目不属任何子类目，
 * 卸载网址包（批量删插件类目）后成批出现，用户看到「站点凭空消失」。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

let dir: string;
let db: Db;
let repo: Repository;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-cat-subref-"));
  db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "subref.db") });
  repo = new Repository(db);
});

afterAll(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("deleteCategory 的类目引用清理", () => {
  it("站点以被删类目为子类目时，清空子引用并保留父类目", async () => {
    const parent = await repo.createCategory({ title: "设计" });
    const child = await repo.createCategory({ title: "灵感站", parentId: parent.id });
    await repo.createSite({ url: "https://subref-keep.test", title: "灵感站点", categoryId: parent.id, subCategoryId: child.id });

    await repo.deleteCategory(child.id);

    const site = (await repo.findSiteByUrl("https://subref-keep.test"))!;
    expect(site).toBeTruthy();
    expect(site.categoryId).toBe(parent.id);
    expect(site.subCategoryId).toBeNull();
  });

  it("站点随父类目移入「未分类」时，不再指向被提升的子类目", async () => {
    const parent = await repo.createCategory({ title: "开发" });
    const child = await repo.createCategory({ title: "前端", parentId: parent.id });
    await repo.createSite({ url: "https://subref-move.test", title: "前端站点", categoryId: parent.id, subCategoryId: child.id });

    await repo.deleteCategory(parent.id);

    const site = (await repo.findSiteByUrl("https://subref-move.test"))!;
    const fallback = (await repo.listCategories()).find((c) => c.title === "未分类")!;
    expect(site).toBeTruthy();
    expect(site.categoryId).toBe(fallback.id);
    // 子类目被提升到根，若仍指过去就成了「父类=未分类、子类=根类目」的错配
    expect(site.subCategoryId).toBeNull();
    expect(await repo.getCategory(child.id)).not.toBeNull();
  });

  it("回收站里的站点同样不留悬空子引用", async () => {
    const parent = await repo.createCategory({ title: "办公" });
    const child = await repo.createCategory({ title: "文档", parentId: parent.id });
    await repo.createSite({ url: "https://subref-trash.test", title: "文档站点", categoryId: parent.id, subCategoryId: child.id });
    const live = (await repo.findSiteByUrl("https://subref-trash.test"))!;
    await repo.deleteSite(live.id);

    await repo.deleteCategory(child.id);

    const restored = await repo.restoreSite(live.id);
    expect(restored).toBeTruthy();
    expect(restored!.subCategoryId).toBeNull();
  });
});
