import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { FavoriteFolderNotOwnedError } from "../src/repository/favorites.ts";

/**
 * 收藏夹归属（run112）：三条写路径全部校验 folder_id 属于谁。
 *
 * 改造前只有 updateFavorite（PATCH）校验，addFavorite（POST）与 applyFavoriteOps（同步）
 * 都不校验——而 favorites.folder_id 是裸 text 列、没有外键（schema.ts），
 * 别人的夹子 id 能被库原样收下，收藏就挂进了他人的文件夹树。
 *
 * 两条路径的口径不同，都在这里钉住：
 *  - 单条 REST 写入：抛 FavoriteFolderNotOwnedError（路由映射 400）
 *  - 批量同步：不抛，add 降级成未归档 / update 跳过该字段（整批回滚会让客户端无限重放）
 */
describe("收藏夹归属：三条写路径", () => {
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  describe("addFavorite（单条）", () => {
    const me = "github:u-own-add";
    const other = "github:u-own-add-other";
    let myFolder = "";
    let theirFolder = "";

    beforeAll(async () => {
      myFolder = (await repo.createFavoriteFolder(me, "我的夹子")).id;
      theirFolder = (await repo.createFavoriteFolder(other, "他人的夹子")).id;
    });

    it("挂进自己的夹子：正常落库（新校验不能打死合法路径）", async () => {
      const { favorite } = await repo.addFavorite({ userId: me, siteId: "site-own-1", folderId: myFolder });
      expect(favorite.folderId).toBe(myFolder);
    });

    it("folderId 为 null / 缺省：照常允许（移出文件夹的合法语义）", async () => {
      const a = await repo.addFavorite({ userId: me, siteId: "site-null-1", folderId: null });
      const b = await repo.addFavorite({ userId: me, siteId: "site-null-2" });
      expect(a.favorite.folderId).toBeNull();
      expect(b.favorite.folderId).toBeNull();
    });

    it("挂进他人的夹子：抛 FavoriteFolderNotOwnedError，且一行都没落库", async () => {
      const before = (await repo.listFavorites(me)).length;
      await expect(
        repo.addFavorite({ userId: me, siteId: "site-steal", folderId: theirFolder }),
      ).rejects.toBeInstanceOf(FavoriteFolderNotOwnedError);
      expect(await repo.listFavorites(me)).toHaveLength(before);
      expect((await repo.listFavorites(me)).find((f) => f.siteId === "site-steal")).toBeUndefined();
      // 他人侧同样没被写入
      expect(await repo.listFavorites(other)).toHaveLength(0);
    });

    it("悬空夹子 id（不存在）：与外夹同口径", async () => {
      await expect(
        repo.addFavorite({ userId: me, siteId: "site-dangling", folderId: "folder-does-not-exist" }),
      ).rejects.toBeInstanceOf(FavoriteFolderNotOwnedError);
    });

    it("错误对象带身份与夹子 id（日志可归因）", async () => {
      const err = await repo
        .addFavorite({ userId: me, siteId: "site-err-shape", folderId: theirFolder })
        .then(() => null, (e: unknown) => e as FavoriteFolderNotOwnedError);
      expect(err).toBeInstanceOf(FavoriteFolderNotOwnedError);
      expect(err?.userId).toBe(me);
      expect(err?.folderId).toBe(theirFolder);
      expect(err?.name).toBe("FavoriteFolderNotOwnedError");
    });
  });

  describe("复活不丢标签", () => {
    const user = "github:u-own-resurrect";

    it("收藏→删除→再收藏：tags 随复活写回", async () => {
      await repo.addFavorite({ userId: user, siteId: "site-res", tags: ["设计", "效率"] });
      expect((await repo.listFavorites(user))[0]?.tags).toEqual(["设计", "效率"]);

      await repo.removeFavorite(user, "site-res");
      expect(await repo.listFavorites(user)).toHaveLength(0);

      await repo.addFavorite({ userId: user, siteId: "site-res", tags: ["前端"] });
      const back = (await repo.listFavorites(user))[0];
      expect(back?.deletedAt ?? null).toBeNull();
      // 改造前复活分支只写 folder_id/note，tags 留在墓碑上的旧值
      expect(back?.tags).toEqual(["前端"]);
    });

    it("复活时不传 tags：按全覆盖语义清空（与 INSERT 分支一致）", async () => {
      const u = "github:u-own-resurrect-clear";
      await repo.addFavorite({ userId: u, siteId: "site-clear", tags: ["旧标签"] });
      await repo.removeFavorite(u, "site-clear");
      await repo.addFavorite({ userId: u, siteId: "site-clear" });
      expect((await repo.listFavorites(u))[0]?.tags).toBeNull();
    });
  });

  describe("applyFavoriteOps（批量同步）", () => {
    const me = "github:u-own-batch";
    const other = "github:u-own-batch-other";
    let myFolder = "";
    let theirFolder = "";

    beforeAll(async () => {
      myFolder = (await repo.createFavoriteFolder(me, "我的夹子")).id;
      theirFolder = (await repo.createFavoriteFolder(other, "他人的夹子")).id;
    });

    it("add 带外夹：降级成未归档，整批不失败（同批合法 op 照常生效）", async () => {
      const res = await repo.applyFavoriteOps(me, [
        { op: "add", siteId: "site-b-steal", folderId: theirFolder, at: 1000 },
        { op: "add", siteId: "site-b-own", folderId: myFolder, at: 1001 },
      ]);
      expect(res.applied).toBe(2);
      const items = await repo.listFavorites(me);
      const stolen = items.find((f) => f.siteId === "site-b-steal");
      expect(stolen?.folderId).toBeNull();
      expect(items.find((f) => f.siteId === "site-b-own")?.folderId).toBe(myFolder);
      // 他人侧没有因为这批 op 多出收藏
      expect(await repo.listFavorites(other)).toHaveLength(0);
    });

    it("已存在的行上 add 带外夹：同样降级为未归档并清墓碑", async () => {
      await repo.applyFavoriteOps(me, [{ op: "add", siteId: "site-b-exist", folderId: myFolder, at: 2000 }]);
      await repo.applyFavoriteOps(me, [{ op: "remove", siteId: "site-b-exist", at: 2001 }]);
      const res = await repo.applyFavoriteOps(me, [
        { op: "add", siteId: "site-b-exist", folderId: theirFolder, at: 2002 },
      ]);
      expect(res.applied).toBe(1);
      const back = (await repo.listFavorites(me)).find((f) => f.siteId === "site-b-exist");
      expect(back?.deletedAt ?? null).toBeNull();
      expect(back?.folderId).toBeNull();
    });

    it("update 带外夹：跳过 folder_id（保持原值），其余字段照常生效", async () => {
      await repo.applyFavoriteOps(me, [
        { op: "add", siteId: "site-b-patch", folderId: myFolder, note: "原备注", at: 3000 },
      ]);
      const res = await repo.applyFavoriteOps(me, [
        { op: "update", siteId: "site-b-patch", folderId: theirFolder, note: "新备注", tags: ["补丁"], at: 3001 },
      ]);
      expect(res.applied).toBe(1);
      const row = (await repo.listFavorites(me)).find((f) => f.siteId === "site-b-patch");
      expect(row?.folderId).toBe(myFolder);
      expect(row?.note).toBe("新备注");
      expect(row?.tags).toEqual(["补丁"]);
    });

    it("update folderId:null：仍能移出文件夹（null 是合法语义，不是外夹）", async () => {
      await repo.applyFavoriteOps(me, [
        { op: "add", siteId: "site-b-unfile", folderId: myFolder, at: 4000 },
        { op: "update", siteId: "site-b-unfile", folderId: null, at: 4001 },
      ]);
      const row = (await repo.listFavorites(me)).find((f) => f.siteId === "site-b-unfile");
      expect(row?.folderId).toBeNull();
    });

    it("update 不传 folderId：不碰 folder_id（未传 = 保持原值）", async () => {
      await repo.applyFavoriteOps(me, [
        { op: "add", siteId: "site-b-keep", folderId: myFolder, at: 5000 },
        { op: "update", siteId: "site-b-keep", note: "只改备注", at: 5001 },
      ]);
      const row = (await repo.listFavorites(me)).find((f) => f.siteId === "site-b-keep");
      expect(row?.folderId).toBe(myFolder);
      expect(row?.note).toBe("只改备注");
    });

    it("自己的夹子照常写通（新校验不改变合法批量）", async () => {
      const res = await repo.applyFavoriteOps(me, [
        { op: "add", siteId: "site-b-ok", folderId: myFolder, note: "合法", at: 6000 },
      ]);
      expect(res.applied).toBe(1);
      expect((await repo.listFavorites(me)).find((f) => f.siteId === "site-b-ok")?.folderId).toBe(myFolder);
    });
  });
});
