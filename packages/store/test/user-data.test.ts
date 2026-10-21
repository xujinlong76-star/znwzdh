import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

/**
 * 第二批用户中心：收藏管理、历史分页、设置、金库版本前置、导出与注销。
 */
describe("用户数据管理", () => {
  let db: Db;
  let repo: Repository;
  let siteA = "";
  let siteB = "";
  const user = "github:u-data";

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    const cat = await repo.createCategory({ title: "数据管理" });
    siteA = (await repo.createSite({ url: "https://data-a.example.com", title: "A", categoryId: cat.id })).id;
    siteB = (await repo.createSite({ url: "https://data-b.example.com", title: "B", categoryId: cat.id })).id;
  });

  afterAll(async () => {
    await db.close();
  });

  it("收藏可改文件夹与备注，文件夹必须属于同一身份", async () => {
    await repo.addFavorite({ userId: user, siteId: siteA });
    const folder = await repo.createFavoriteFolder(user, "工作");
    const other = await repo.createFavoriteFolder("github:someone-else", "别人的");

    const updated = await repo.updateFavorite(user, siteA, { folderId: folder.id, note: "周报用" });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.favorite.folderId).toBe(folder.id);
      expect(updated.favorite.note).toBe("周报用");
    }

    const bad = await repo.updateFavorite(user, siteA, { folderId: other.id });
    expect(bad).toEqual({ ok: false, reason: "folder_not_found" });

    const missing = await repo.updateFavorite(user, "no-such-site", { note: "x" });
    expect(missing).toEqual({ ok: false, reason: "not_found" });

    const renamed = await repo.updateFavoriteFolder(user, folder.id, { name: "工作台", sort: 5 });
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.folder.name).toBe("工作台");
      expect(renamed.folder.sort).toBe(5);
    }
  });

  it("清空收藏只影响该身份；删除文件夹把收藏移出", async () => {
    await repo.addFavorite({ userId: user, siteId: siteB });
    await repo.addFavorite({ userId: "github:other", siteId: siteA });
    const folder = (await repo.listFavoriteFolders(user))[0]!;

    await repo.deleteFavoriteFolder(user, folder.id);
    const afterFolderDelete = await repo.listFavorites(user);
    expect(afterFolderDelete.every((f) => f.folderId === null)).toBe(true);

    const removed = await repo.clearFavorites(user);
    expect(removed).toBe(2);
    expect(await repo.listFavorites(user)).toHaveLength(0);
    expect(await repo.listFavorites("github:other")).toHaveLength(1);
  });

  it("历史分页用探针判断 hasMore，单条删除校验归属", async () => {
    for (let i = 0; i < 5; i++) await repo.recordSearch(user, `查询 ${i}`, i);
    await repo.recordSearch("github:other", "别人的搜索", 0);

    const first = await repo.listSearchHistoryPage(user, 2, 0);
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.items[0]?.id).toBeGreaterThan(0);

    const second = await repo.listSearchHistoryPage(user, 2, 2);
    expect(second.items).toHaveLength(2);
    expect(second.hasMore).toBe(true);

    const last = await repo.listSearchHistoryPage(user, 2, 4);
    expect(last.items).toHaveLength(1);
    expect(last.hasMore).toBe(false);

    const foreign = first.items[0]!;
    expect(await repo.deleteSearchHistoryItem("github:other", foreign.id)).toBe(false);
    expect(await repo.deleteSearchHistoryItem(user, foreign.id)).toBe(true);
    expect(await repo.countSearchHistory(user)).toBe(4);
  });

  it("设置默认开启，更新后可读回", async () => {
    const defaults = await repo.getUserSettings(user);
    expect(defaults.personalizationEnabled).toBe(true);
    expect(defaults.favoriteSignalCutoff).toBe(0);

    const updated = await repo.updateUserSettings(user, { personalizationEnabled: false, favoriteSignalCutoff: 123 });
    expect(updated.personalizationEnabled).toBe(false);
    expect(updated.favoriteSignalCutoff).toBe(123);

    const readBack = await repo.getUserSettings(user);
    expect(readBack.personalizationEnabled).toBe(false);
    expect(readBack.favoriteSignalCutoff).toBe(123);
  });

  it("金库写入带版本前置条件时冲突返回当前版本", async () => {
    const first = await repo.saveUserVaultIfUnchanged(user, "cipher-1", 0);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.version).toBe(1);

    const stale = await repo.saveUserVaultIfUnchanged(user, "cipher-2", 0);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.conflict).toBe(true);
      expect(stale.current?.version).toBe(1);
    }

    const second = await repo.saveUserVaultIfUnchanged(user, "cipher-2", 1);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.version).toBe(2);

    // 无前置条件的老客户端仍然可以覆盖
    const legacy = await repo.saveUserVault(user, "cipher-3");
    expect(legacy.version).toBe(3);
  });

  it("导出脱敏且注销级联清空", async () => {
    await repo.run(
      "INSERT INTO identity_aliases (alias, canonical, created_at) VALUES (?,?,?)",
      ["anon-old", user, Date.now()],
    );
    await repo.saveUserProfile(user, {
      topCategories: ["c1"],
      topTags: ["t1"],
      visitedSiteIds: [siteA],
      favoriteSiteIds: [siteA],
      searchCount: 2,
    });

    const exported = await repo.exportUserData(user);
    expect(exported.identity).toBe(user);
    expect(exported.favorites).toHaveLength(0);
    expect(exported.searchHistory.items.length).toBe(4);
    expect(exported.settings.personalizationEnabled).toBe(false);
    expect(exported.llmConfig).toBeNull();
    expect(exported.vault.exists).toBe(true);

    const counts = await repo.deleteUserData(user);
    expect(counts.searchHistory).toBe(4);
    expect(counts.vault).toBe(1);
    expect(counts.settings).toBe(1);
    expect(counts.profile).toBe(1);
    expect(counts.identityAliases).toBe(1);

    expect(await repo.countSearchHistory(user)).toBe(0);
    expect(await repo.getUserVault(user)).toBeNull();
    expect(await repo.getUserProfile(user)).toBeNull();
    expect((await repo.getUserSettings(user)).personalizationEnabled).toBe(true);
    // 其他身份不受影响
    expect(await repo.countSearchHistory("github:other")).toBe(1);
  });
});
