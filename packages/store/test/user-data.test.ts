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

describe("数据主权补齐（M2）：导出覆盖四类、注销不留残渣", () => {
  let db: Db;
  let repo: Repository;
  const user = "github:u-full";
  const admin = "local-admin";

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    const now = Date.now();
    // 造数：评价 / 会话 / 用量 / 工作区 / OAuth 用户行 / 内置管理员行
    await repo.run(
      "INSERT INTO plugin_reviews (id, plugin_id, identity, rating, title, content, installed_version, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ["rv-1", "pl-1", user, 5, "好评", "正文属于用户内容", "1.0.0", "visible", now, now],
    );
    await repo.run("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?,?,?,?)", [
      "tk-1",
      user,
      now + 86400000,
      now,
    ]);
    await repo.run(
      "INSERT INTO llm_usage (id, scenario, source, model, identity, prompt_tokens, completion_tokens, latency_ms, ok, thinking, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      ["lu-1", "search", "user", "gpt-x", user, 10, 5, 100, 1, 0, now],
    );
    // 工作区明文已迁出 E2EE 表（M3）→ 写入专用表
    await repo.run("INSERT INTO user_workspace_blobs (user_id, payload, updated_at) VALUES (?,?,?)", [
      "workspaces:" + user,
      "[]",
      now,
    ]);
    await repo.run("INSERT INTO user_workspace_blobs (user_id, payload, updated_at) VALUES (?,?,?)", [
      "ws_members:" + user + ":ws-1",
      "[]",
      now,
    ]);
    await repo.run(
      "INSERT INTO users (id, username, password_hash, role, source, created_at) VALUES (?,?,?,?,?,?)",
      [user, "u-full", "x", "admin", "github", now],
    );
    await repo.run(
      "INSERT INTO users (id, username, password_hash, role, source, created_at) VALUES (?,?,?,?,?,?)",
      [admin, "local-admin", "x", "admin", "local", now],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("导出包含星标/评价/工作区/事件聚合", async () => {
    const now = Date.now();
    await repo.run("INSERT INTO plugin_stars (plugin_id, identity, created_at) VALUES (?,?,?)", ["pl-1", user, now]);
    await repo.run("INSERT INTO events (kind, site_id, identity, created_at) VALUES (?,?,?,?)", [
      "click",
      "s-1",
      user,
      now,
    ]);
    const exported = await repo.exportUserData(user);
    expect(exported.pluginReviews).toHaveLength(1);
    expect(exported.pluginReviews[0].content).toContain("正文");
    expect(exported.pluginStars).toHaveLength(1);
    expect(exported.workspaces.map((w) => w.key).sort()).toEqual([
      "workspaces:" + user,
      "ws_members:" + user + ":ws-1",
    ]);
    expect(exported.eventsSummary.find((e) => e.kind === "click")?.count).toBe(1);
  });

  it("注销清空评价/会话/工作区，匿名化用量，删除 OAuth 行但保留内置管理员", async () => {
    const counts = await repo.deleteUserData(user);
    expect(counts.pluginReviews).toBe(1);
    expect(counts.sessions).toBe(1);
    expect(counts.llmUsage).toBe(1);
    expect(counts.workspaces).toBe(2);
    expect(counts.userRow).toBe(1);

    expect((await repo.raw("SELECT 1 AS ok FROM plugin_reviews WHERE identity = ?", [user])).length).toBe(0);
    expect((await repo.raw("SELECT 1 AS ok FROM sessions WHERE user_id = ?", [user])).length).toBe(0);
    // 用量行仍在，但身份已抹掉
    const usage = await repo.raw("SELECT identity FROM llm_usage WHERE id = ?", ["lu-1"]);
    expect(usage).toHaveLength(1);
    expect(usage[0].identity).toBeNull();
    expect((await repo.raw("SELECT 1 AS ok FROM user_workspace_blobs WHERE user_id LIKE ?", ["%u-full%"])).length).toBe(0);
    expect((await repo.raw("SELECT 1 AS ok FROM user_vault_sync WHERE user_id LIKE ?", ["%u-full%"])).length).toBe(0);
    expect((await repo.raw("SELECT 1 AS ok FROM users WHERE id = ?", [user])).length).toBe(0);
    // 内置管理员（id 不含 ':'）不受影响
    expect((await repo.raw("SELECT 1 AS ok FROM users WHERE id = ?", [admin])).length).toBe(1);
  });
});
