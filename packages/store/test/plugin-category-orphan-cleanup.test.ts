/**
 * 无主插件类目清扫的回收站口径。
 *
 * 旧 SQL 只把「未删除的站点」当作引用，回收站里的站点不算：分类被删后，
 * 用户从回收站恢复站点，站点会掉进「未分类」或留下悬空 category_id。
 * 正确口径是「只要有站点行引用（无论是否在回收站）就不能删」，
 * 等保留期结束、站点物理清理后，下次启动清扫再移除分类。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { cleanupOrphanPluginCategories } from "../src/migrate.ts";

let dir: string;
let db: Db;
let repo: Repository;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-cat-cleanup-"));
  db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "cleanup.db") });
  repo = new Repository(db);
});

afterAll(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("cleanupOrphanPluginCategories 的回收站口径", () => {
  it("回收站站点仍引用分类时不清理；物理清除后才清理", async () => {
    const categoryId = await repo.ensureCategory("幽灵插件分类", "plugin:ghost-pack");
    const site = await repo.createSite({
      url: "https://ghost-pack.example.com",
      title: "幽灵站点",
      categoryId,
    });
    await repo.deleteSite(site.id);

    expect(await cleanupOrphanPluginCategories(db)).toBe(0);
    expect(await repo.getCategory(categoryId)).not.toBeNull();

    await repo.purgeSite(site.id);
    expect(await cleanupOrphanPluginCategories(db)).toBe(1);
    expect(await repo.getCategory(categoryId)).toBeNull();
  });

  it("完全没有站点引用的无主分类照常清理", async () => {
    const categoryId = await repo.ensureCategory("无站点幽灵分类", "plugin:ghost-empty");
    expect(await cleanupOrphanPluginCategories(db)).toBe(1);
    expect(await repo.getCategory(categoryId)).toBeNull();
  });
});
