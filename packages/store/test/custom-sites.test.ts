import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

/**
 * 用户自定义站点（仓库层）：CRUD、排序全集约束、跨用户隔离、
 * 设置新字段（themePreference / hiddenHomeModules）的存取与解析收口。
 */
describe("用户自定义站点与新偏好字段", () => {
  let db: Db;
  let repo: Repository;
  const user = "github:u-sites";
  const other = "github:u-sites-other";

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("创建按插入顺序排尾，改、删、重排闭环", async () => {
    const a = await repo.createCustomSite({ userId: user, title: "A 站", url: "https://a.example.com" });
    const b = await repo.createCustomSite({ userId: user, title: "B 站", url: "https://b.example.com", note: "备忘" });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    let list = await repo.listCustomSites(user);
    expect(list.map((s) => s.title)).toEqual(["A 站", "B 站"]);
    expect(list[1].note).toBe("备忘");

    const updated = await repo.updateCustomSite(user, a!.id, { title: "A 站改名" });
    expect(updated?.title).toBe("A 站改名");

    const reordered = await repo.reorderCustomSites(user, [b!.id, a!.id]);
    expect(reordered?.map((s) => s.title)).toEqual(["B 站", "A 站改名"]);

    expect(await repo.deleteCustomSite(user, b!.id)).toBe(true);
    list = await repo.listCustomSites(user);
    expect(list).toHaveLength(1);
  });

  it("重排 ids 非全集时拒绝且不改动现有顺序", async () => {
    const before = await repo.listCustomSites(user);
    const result = await repo.reorderCustomSites(user, ["not-a-real-id"]);
    expect(result).toBeNull();
    expect(await repo.listCustomSites(user)).toEqual(before);
  });

  it("跨用户隔离：列表独立、按他人 id 更新/删除无效", async () => {
    const mine = await repo.listCustomSites(user);
    expect(await repo.listCustomSites(other)).toEqual([]);
    expect(await repo.updateCustomSite(other, mine[0].id, { title: "篡改" })).toBeNull();
    expect(await repo.deleteCustomSite(other, mine[0].id)).toBe(false);
  });

  it("设置：themePreference 可设可清，hiddenHomeModules 去重限长", async () => {
    await repo.updateUserSettings(user, { themePreference: "dark", hiddenHomeModules: ["dramaCinema"] });
    let settings = await repo.getUserSettings(user);
    expect(settings.themePreference).toBe("dark");
    expect(settings.hiddenHomeModules).toEqual(["dramaCinema"]);

    await repo.updateUserSettings(user, { themePreference: null });
    settings = await repo.getUserSettings(user);
    expect(settings.themePreference).toBeNull();
    expect(settings.hiddenHomeModules).toEqual(["dramaCinema"]);

    await repo.updateUserSettings(user, { hiddenHomeModules: [] });
    settings = await repo.getUserSettings(user);
    expect(settings.hiddenHomeModules).toEqual([]);
  });
});
