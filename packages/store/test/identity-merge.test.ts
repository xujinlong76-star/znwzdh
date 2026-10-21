import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

/**
 * 匿名 -> 登录身份合并的回归。
 *
 * 关键断言：
 *  - 收藏按 (user, site) 去重，目标已有不重复；
 *  - 文件夹/history/events 改归属，源不再残留；
 *  - 源画像删除、别名可解析；
 *  - 重复合并幂等（返回 alreadyMerged 与首次统计）。
 */
describe("身份合并：匿名数据并入登录身份", () => {
  let db: Db;
  let repo: Repository;
  const anon = "anon-11111111-1111-1111-1111-111111111111";
  const user = "github:u-merge";

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);

    const cat = await repo.createCategory({ title: "合并测试" });
    const s1 = await repo.createSite({ url: "https://merge-1.example.com", title: "M1", categoryId: cat.id });
    const s2 = await repo.createSite({ url: "https://merge-2.example.com", title: "M2", categoryId: cat.id });
    const s3 = await repo.createSite({ url: "https://merge-3.example.com", title: "M3", categoryId: cat.id });

    // 目标已有 s1；源有 s1/s2/s3（s3 在文件夹里）
    await repo.addFavorite({ userId: user, siteId: s1.id });
    const folder = await repo.createFavoriteFolder(anon, "灵感");
    await repo.addFavorite({ userId: anon, siteId: s1.id });
    await repo.addFavorite({ userId: anon, siteId: s2.id });
    await repo.addFavorite({ userId: anon, siteId: s3.id, folderId: folder.id });

    await repo.recordSearch(anon, "合并前搜索", 2);
    await repo.recordSearch(user, "目标已有搜索", 1);
    await repo.recordEvent("click", { siteId: s1.id, identity: anon });
    await repo.saveUserProfile(anon, {
      topCategories: [],
      topTags: [],
      visitedSiteIds: [s1.id],
      favoriteSiteIds: [s1.id],
      searchCount: 1,
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it("合并收藏/文件夹/历史/事件并写别名", async () => {
    const result = await repo.mergeIdentity(anon, user);
    expect(result.alreadyMerged).toBe(false);
    expect(result.favoritesMoved).toBe(2); // s2 + s3（s1 目标已有）
    expect(result.favoritesSkipped).toBe(1);
    expect(result.foldersMoved).toBe(1);
    expect(result.searchesMoved).toBe(1);
    expect(result.eventsMoved).toBe(1);

    expect(await repo.listFavorites(anon)).toHaveLength(0);
    const merged = await repo.listFavorites(user);
    expect(merged).toHaveLength(3);

    const folders = await repo.listFavoriteFolders(user);
    expect(folders.map((f) => f.name)).toContain("灵感");

    const history = await repo.listSearchHistory(user, 10);
    expect(history.map((h) => h.query)).toContain("合并前搜索");
    expect(history.map((h) => h.query)).toContain("目标已有搜索");

    const eventRows = await repo.raw("SELECT COUNT(*) AS c FROM events WHERE identity = ?", [user]);
    expect(Number(eventRows[0]?.c ?? 0)).toBe(1);

    expect(await repo.getUserProfile(anon)).toBeNull();
    expect(await repo.resolveIdentity(anon)).toBe(user);

    const overview = await repo.getUserCenterOverview(anon);
    expect(overview.identity).toBe(user);
    expect(overview.aliases).toContain(anon);
  });

  it("重复合并幂等：返回首次统计，不重复搬运", async () => {
    const again = await repo.mergeIdentity(anon, user);
    expect(again.alreadyMerged).toBe(true);
    expect(again.favoritesMoved).toBe(2);
    expect(await repo.listFavorites(user)).toHaveLength(3);
  });
});
