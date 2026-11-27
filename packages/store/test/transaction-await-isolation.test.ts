import { describe, expect, it } from "vitest";
import { openDb } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("Repository 事务与普通查询隔离", () => {
  it("事务挂起时普通写入必须排队，不能被回滚连带丢失", async () => {
    const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    const repo = new Repository(db);
    const cat = await repo.createCategory({ title: "并发写入测试" });
    const site = await repo.createSite({
      url: "https://await-gate.example.com",
      title: "初始标题",
      categoryId: cat.id,
    });

    const txStarted = deferred();
    const releaseTx = deferred();

    const tx = repo.withTransaction(async () => {
      await repo.run("UPDATE sites SET title = ? WHERE id = ?", ["事务内标题", site.id]);
      txStarted.resolve();
      await releaseTx.promise;
      throw new Error("事务故意回滚");
    });

    await txStarted.promise;

    let outsideSettled = false;
    const outside = repo
      .run("UPDATE sites SET title = ? WHERE id = ?", ["事务外标题", site.id])
      .then(() => {
        outsideSettled = true;
      });

    // 事务仍挂起时，普通写入必须被闸门挡住；旧实现会直接执行并最终被 ROLLBACK 抹掉
    await new Promise((r) => setTimeout(r, 30));
    expect(outsideSettled).toBe(false);

    releaseTx.resolve();
    await expect(tx).rejects.toThrow("事务故意回滚");
    await outside;

    const found = await repo.getSite(site.id);
    expect(found?.title).toBe("事务外标题");

    await db.close();
  });
});
