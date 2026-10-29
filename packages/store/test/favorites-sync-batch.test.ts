import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

/**
 * 收藏同步换代（M1）：墓碑软删 / 增量游标 / LWW 批量 ops。
 *
 * 每个用例用独立身份：版本水位是该身份的 MAX(updated_at)，
 * 共用身份会让上一条用例的真实时钟时间戳污染下一条的显式 at。
 */
describe("收藏同步：软删墓碑 + 版本游标 + 批量 ops", () => {
  let db: Db;
  let repo: Repository;
  const user = "github:u-sync";

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("软删后列表不含该条，但行还在（墓碑）", async () => {
    await repo.addFavorite({ userId: user, siteId: "site-soft-1" });
    expect(await repo.listFavorites(user)).toHaveLength(1);

    expect(await repo.removeFavorite(user, "site-soft-1")).toBe(true);
    expect(await repo.listFavorites(user)).toHaveLength(0);
    // 重复删除不再计数（已无未删行可删）
    expect(await repo.removeFavorite(user, "site-soft-1")).toBe(false);

    const slice = await repo.listFavoritesSince(user, 0);
    expect(slice.items).toHaveLength(1);
    expect(slice.items[0]!.siteId).toBe("site-soft-1");
    expect(slice.items[0]!.deletedAt).toBeGreaterThan(0);
  });

  it("since 游标只返回更新的行，且包含墓碑", async () => {
    const cursorUser = "github:u-sync-cursor";
    await repo.applyFavoriteOps(cursorUser, [
      { op: "add", siteId: "site-a", at: 1_000 },
      { op: "add", siteId: "site-b", at: 2_000 },
    ]);

    const first = await repo.listFavoritesSince(cursorUser, 0);
    expect(first.items.map((i) => i.siteId).sort()).toEqual(["site-a", "site-b"]);
    expect(first.version).toBe(2_000);

    await repo.applyFavoriteOps(cursorUser, [{ op: "remove", siteId: "site-a", at: 3_000 }]);
    const delta = await repo.listFavoritesSince(cursorUser, first.version);
    // 只回增量：一条墓碑（site-b 无变化不回传）
    expect(delta.items).toHaveLength(1);
    expect(delta.items[0]!.siteId).toBe("site-a");
    expect(delta.items[0]!.deletedAt).toBe(3_000);
    expect(delta.version).toBe(3_000);

    // 水位推进后同一游标不再重复下发
    const again = await repo.listFavoritesSince(cursorUser, delta.version);
    expect(again.items).toHaveLength(0);
    expect(again.version).toBe(3_000);
  });

  it("LWW：旧 add 不能覆盖更新的 remove", async () => {
    const lwwUser = "github:u-sync-lww";
    await repo.applyFavoriteOps(lwwUser, [{ op: "remove", siteId: "site-lww", at: 2_000 }]);
    const res = await repo.applyFavoriteOps(lwwUser, [{ op: "add", siteId: "site-lww", at: 1_000 }]);
    expect(res.applied).toBe(0);

    const list = await repo.listFavorites(lwwUser);
    expect(list.some((f) => f.siteId === "site-lww")).toBe(false);
    // 墓碑仍是 updated_at=2000 的删除态，没有被旧 add 复活
    const slice = await repo.listFavoritesSince(lwwUser, 0);
    expect(slice.items).toHaveLength(1);
    expect(slice.items[0]!.deletedAt).toBe(2_000);
    expect(slice.version).toBe(2_000);
  });

  it("复活：软删后再 add 生效且 existed=false", async () => {
    const reviveUser = "github:u-sync-revive";
    await repo.addFavorite({ userId: reviveUser, siteId: "site-revive" });
    await repo.removeFavorite(reviveUser, "site-revive");
    expect((await repo.listFavorites(reviveUser)).some((f) => f.siteId === "site-revive")).toBe(false);

    const revived = await repo.addFavorite({ userId: reviveUser, siteId: "site-revive", note: "回来了" });
    expect(revived.existed).toBe(false);
    expect(revived.favorite.deletedAt ?? null).toBeNull();
    expect(revived.favorite.note).toBe("回来了");

    const list = await repo.listFavorites(reviveUser);
    expect(list.filter((f) => f.siteId === "site-revive")).toHaveLength(1);
  });

  it("applyFavoriteOps 在一个事务里应用全部 3 条 ops", async () => {
    const opsUser = "github:u-sync-batch";
    // 夹子必须真实存在且归该用户所有：applyFavoriteOps 对「外夹」按 BOLA 口径降级成 null
    // （收藏照样落库，只是未归档），所以要验「合法夹子会被保留」得先建出来。
    const folder = await repo.createFavoriteFolder(opsUser, "同步夹");
    const { applied, version } = await repo.applyFavoriteOps(opsUser, [
      { op: "add", siteId: "batch-1", folderId: folder.id, at: 5_000 },
      { op: "add", siteId: "batch-2", note: "备注", at: 5_001 },
      { op: "add", siteId: "batch-3", at: 5_002 },
    ]);
    expect(applied).toBe(3);
    expect(version).toBe(5_002);

    const list = await repo.listFavorites(opsUser);
    expect(list.map((f) => f.siteId).sort()).toEqual(["batch-1", "batch-2", "batch-3"]);
    expect(list.find((f) => f.siteId === "batch-1")!.folderId).toBe(folder.id);
    expect(list.find((f) => f.siteId === "batch-2")!.note).toBe("备注");
  });

  it("身份隔离：他人的水位与增量互不可见", async () => {
    const other = "github:u-sync-other";
    await repo.applyFavoriteOps(other, [{ op: "add", siteId: "other-1", at: 9_000 }]);
    const mine = await repo.listFavoritesSince(user, 0);
    expect(mine.items.some((i) => i.siteId === "other-1")).toBe(false);
    const theirs = await repo.listFavoritesSince(other, 0);
    expect(theirs.items.map((i) => i.siteId)).toEqual(["other-1"]);
  });
});
