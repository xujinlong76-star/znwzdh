/**
 * 事务并发隔离回归测试。
 *
 * 背景缺陷：`withTransaction` 用实例字段 `txDepth` 判断「是否已在事务中」。
 * 这个字段是**跨请求共享**的 —— A 请求开事务后，B 请求进来看到 txDepth>0，
 * 会直接在自己的事务外执行 action，其写操作被并入 A 的事务：
 *   - A 回滚 → B 的数据一起消失；
 *   - B 自己既没 BEGIN 也没 COMMIT，B 抛错时 A 的事务被污染。
 *
 * 这类缺陷在单请求测试里永远看不见，只有并发才暴露。这里用两个交错的事务锁住它。
 */
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

describe("Repository.withTransaction 并发隔离", () => {
  it("一个事务回滚不得带走另一个并发事务的写入", async () => {
    const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    const repo = new Repository(db);
    const cat = await repo.createCategory({ title: "并发测试" });

    const aStarted = deferred();
    const letARollback = deferred();

    // A：开事务 → 写入 → 挂住 → 抛错回滚
    const txA = repo.withTransaction(async () => {
      await repo.createSite({ url: "https://a.example.com", title: "A 站点", categoryId: cat.id });
      aStarted.resolve();
      await letARollback.promise;
      throw new Error("A 故意失败");
    });

    await aStarted.promise;

    // B：在 A 挂住期间发起自己的事务。事务是串行的，B 会排队等 A 结束 ——
    // 关键是它**不能**被并进 A 的事务（否则 A 回滚会把 B 一起抹掉）。
    let bSettled = false;
    const txB = repo
      .withTransaction(async () => {
        await repo.createSite({ url: "https://b.example.com", title: "B 站点", categoryId: cat.id });
        return "b-ok";
      })
      .then((v) => {
        bSettled = true;
        return v;
      });

    // 给事件循环一点时间：B 此刻必须仍在排队（没有提前拿到事务）
    await new Promise((r) => setTimeout(r, 30));
    expect(bSettled).toBe(false);

    letARollback.resolve();
    await expect(txA).rejects.toThrow("A 故意失败");
    await expect(txB).resolves.toBe("b-ok");

    // B 已提交，必须存在；A 已回滚，必须不存在
    expect(await repo.findSiteByUrl("https://b.example.com")).not.toBeNull();
    expect(await repo.findSiteByUrl("https://a.example.com")).toBeNull();

    await db.close();
  });

  it("同一异步上下文中的嵌套调用复用外层事务（不重复 BEGIN）", async () => {
    const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    const repo = new Repository(db);
    const cat = await repo.createCategory({ title: "嵌套测试" });

    // createSite 内部自己也会开事务；外层再包一层必须安全
    const site = await repo.withTransaction(async () => {
      return repo.createSite({ url: "https://nested.example.com", title: "嵌套站点", categoryId: cat.id });
    });
    expect(site.id).toBeTruthy();
    expect(await repo.findSiteByUrl("https://nested.example.com")).not.toBeNull();

    await db.close();
  });
});
