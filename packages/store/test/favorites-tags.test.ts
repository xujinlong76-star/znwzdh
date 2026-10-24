import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

/**
 * 收藏标签（T22）：LWW 语义与归一契约。
 * add = 全量覆盖；update 显式传入才写；null = 清除；超限/非法元素静默收敛。
 */
describe("收藏标签：LWW 与归一", () => {
  let db: Db;
  let repo: Repository;
  const user = "github:u-tags";

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("add 携带标签落库（归一：trim/去重/截断/上限 8）", async () => {
    await repo.applyFavoriteOps(user, [
      {
        op: "add",
        siteId: "site-tags-1",
        tags: ["  AI 工具 ", "ai 工具", "开发", "x".repeat(30), 42 as unknown as string, "", "效率", "设计", "前端", "后端", "数据库", "运维"],
        at: 1000,
      },
    ]);
    const fav = (await repo.listFavorites(user)).find((f) => f.siteId === "site-tags-1")!;
    // "  AI 工具 " trim → "AI 工具"；"ai 工具" 是另一个字符串（不去重大小写）；超长截到 24；
    // 非字符串/空串丢弃；只保留前 8 个
    expect(fav.tags).toHaveLength(8);
    expect(fav.tags![0]).toBe("AI 工具");
    expect(fav.tags).not.toContain("");
  });

  it("update 显式传入才写；null 清除；未传保持原值", async () => {
    // 未传 tags：保持
    await repo.applyFavoriteOps(user, [{ op: "update", siteId: "site-tags-1", note: "改备注", at: 2000 }]);
    let fav = (await repo.listFavorites(user)).find((f) => f.siteId === "site-tags-1")!;
    expect(fav.tags).toHaveLength(8);

    // 显式 null：清除
    await repo.applyFavoriteOps(user, [{ op: "update", siteId: "site-tags-1", tags: null, at: 3000 }]);
    fav = (await repo.listFavorites(user)).find((f) => f.siteId === "site-tags-1")!;
    expect(fav.tags).toBeNull();

    // 重新打标（短数组），再验证 LWW：旧 at 不覆盖新状态
    await repo.applyFavoriteOps(user, [{ op: "update", siteId: "site-tags-1", tags: ["新的"], at: 4000 }]);
    await repo.applyFavoriteOps(user, [{ op: "update", siteId: "site-tags-1", tags: ["过期的"], at: 3999 }]);
    fav = (await repo.listFavorites(user)).find((f) => f.siteId === "site-tags-1")!;
    expect(fav.tags).toEqual(["新的"]);
  });

  it("add 全量覆盖语义：重加同站点时标签被整行覆盖（含清空）", async () => {
    await repo.applyFavoriteOps(user, [{ op: "add", siteId: "site-tags-2", tags: ["旧标签"], at: 5000 }]);
    await repo.applyFavoriteOps(user, [{ op: "add", siteId: "site-tags-2", tags: null, at: 6000 }]);
    const fav = (await repo.listFavorites(user)).find((f) => f.siteId === "site-tags-2")!;
    expect(fav.tags).toBeNull();
  });

  it("updateFavorite 路径同样支持 tags（PATCH 通道）", async () => {
    await repo.addFavorite({ userId: user, siteId: "site-tags-3" });
    const r1 = await repo.updateFavorite(user, "site-tags-3", { tags: ["直改"] });
    expect(r1.ok && r1.favorite.tags).toEqual(["直改"]);
    const r2 = await repo.updateFavorite(user, "site-tags-3", { tags: [] });
    expect(r2.ok && r2.favorite.tags).toBeNull();
  });
});
