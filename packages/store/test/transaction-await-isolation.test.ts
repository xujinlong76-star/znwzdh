import { describe, expect, it } from "vitest";
import { openDb } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";
import { readWithDbGate } from "../src/db-access.ts";
import { logVideoReplacement } from "../src/repository/videos.ts";

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

  it("事务外 SQLite read 必须等待，且只能看到提交后的状态", async () => {
    const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    const repo = new Repository(db);
    const cat = await repo.createCategory({ title: "读隔离测试" });
    const site = await repo.createSite({
      url: "https://read-gate.example.com",
      title: "已提交标题",
      categoryId: cat.id,
    });

    const txStarted = deferred();
    const releaseTx = deferred();
    const tx = repo.withTransaction(async () => {
      await repo.run("UPDATE sites SET title = ? WHERE id = ?", ["未提交标题", site.id]);
      // 同一异步调用链内的 read 仍应看到自己的未提交写入。
      const inside = await repo.raw("SELECT title FROM sites WHERE id = ?", [site.id]);
      expect(inside[0]?.title).toBe("未提交标题");
      txStarted.resolve();
      await releaseTx.promise;
      throw new Error("读隔离事务回滚");
    });

    await txStarted.promise;
    let outsideSettled = false;
    const outside = repo
      .raw("SELECT title FROM sites WHERE id = ?", [site.id])
      .then((rows) => {
        outsideSettled = true;
        return rows;
      });

    // 旧 DbAccessGate.read() 会立即执行，直接读到同一个连接的未提交标题。
    await new Promise((r) => setTimeout(r, 30));
    expect(outsideSettled).toBe(false);

    releaseTx.resolve();
    await expect(tx).rejects.toThrow("读隔离事务回滚");
    const rows = await outside;
    expect(rows[0]?.title).toBe("已提交标题");

    await db.close();
  });

  it("批量等待读与 SearchEngine 直读共享门禁，读完后写锁必须恢复", async () => {
    const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    const repo = new Repository(db);
    const search = new SearchEngine({ db, fts: null, vectors: null });
    const cat = await repo.createCategory({ title: "共享门禁测试" });
    const site = await repo.createSite({
      url: "https://shared-read-gate.example.com",
      title: "共享门禁初始标题",
      categoryId: cat.id,
    });

    const txStarted = deferred();
    const releaseTx = deferred();
    const tx = repo.withTransaction(async () => {
      await repo.run("UPDATE sites SET title = ? WHERE id = ?", ["共享门禁未提交标题", site.id]);
      txStarted.resolve();
      await releaseTx.promise;
      throw new Error("共享门禁事务回滚");
    });

    await txStarted.promise;
    let settled = 0;
    const outside = [
      repo.raw("SELECT title FROM sites WHERE id = ?", [site.id]).then((rows) => {
        settled++;
        return rows;
      }),
      repo.raw("SELECT title FROM sites WHERE id = ?", [site.id]).then((rows) => {
        settled++;
        return rows;
      }),
      search.search({ q: "shared-gate", limit: 1, disableSemantic: true, disablePersonal: true }).then((result) => {
        settled++;
        return result;
      }),
    ];

    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(0);

    releaseTx.resolve();
    await expect(tx).rejects.toThrow("共享门禁事务回滚");
    const [first, second] = await Promise.all(outside);
    expect(first?.[0]?.title).toBe("共享门禁初始标题");
    expect(second?.[0]?.title).toBe("共享门禁初始标题");

    // 旧实现批量放行读者时重复计数，会让 writing 永远为 true；这条后续写用于
    // 确定性钉住「读批次结束后写锁已恢复」，而不是只检查读 Promise 是否完成。
    await repo.run("UPDATE sites SET title = ? WHERE id = ?", ["共享门禁提交标题", site.id]);
    expect((await repo.getSite(site.id))?.title).toBe("共享门禁提交标题");

    await db.close();
  });

  it("repo.db Proxy 的直读必须复用原始 Db 门禁与事务上下文", async () => {
    const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    const repo = new Repository(db);
    const cat = await repo.createCategory({ title: "Proxy 门禁测试" });
    const site = await repo.createSite({
      url: "https://proxy-gate.example.com", title: "已提交", categoryId: cat.id,
    });

    const txStarted = deferred();
    const releaseTx = deferred();
    const tx = repo.withTransaction(async () => {
      await repo.run("UPDATE sites SET title = ? WHERE id = ?", ["未提交", site.id]);
      const inside = await readWithDbGate(repo.db, () =>
        (repo.db.sqlite!.prepare("SELECT title FROM sites WHERE id = ?").get(site.id) as { title: string }).title,
      );
      expect(inside).toBe("未提交");
      txStarted.resolve();
      await releaseTx.promise;
      throw new Error("Proxy 事务回滚");
    });

    await txStarted.promise;
    let settled = false;
    const outside = readWithDbGate(repo.db, () =>
      (repo.db.sqlite!.prepare("SELECT title FROM sites WHERE id = ?").get(site.id) as { title: string }).title,
    ).then((title) => {
      settled = true;
      return title;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);

    releaseTx.resolve();
    await expect(tx).rejects.toThrow("Proxy 事务回滚");
    await expect(outside).resolves.toBe("已提交");
    await db.close();
  });

  it("视频替换审计的事务外写入必须排队，不能被无关事务回滚", async () => {
    const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    const repo = new Repository(db);
    const txStarted = deferred();
    const releaseTx = deferred();
    const tx = repo.withTransaction(async () => {
      await repo.run("UPDATE sites SET title = title WHERE id = 'missing'");
      txStarted.resolve();
      await releaseTx.promise;
      throw new Error("审计隔离事务回滚");
    });

    await txStarted.promise;
    let settled = false;
    const audit = logVideoReplacement(repo, {
      id: "replacement-outside", categoryId: "cat", oldItem: { id: "old" }, newItem: { id: "new" },
    }).then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);

    releaseTx.resolve();
    await expect(tx).rejects.toThrow("审计隔离事务回滚");
    await audit;
    const rows = await repo.raw("SELECT id FROM video_replacements WHERE id = ?", ["replacement-outside"]);
    expect(rows).toHaveLength(1);
    await db.close();
  });

  it("事务内创建的延迟回调在事务结束后必须重新走闸门", async () => {
    const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    const repo = new Repository(db);
    const cat = await repo.createCategory({ title: "过期上下文测试" });
    const site = await repo.createSite({
      url: "https://stale-context.example.com",
      title: "已提交标题",
      categoryId: cat.id,
    });

    let releaseCallback!: () => void;
    const callbackGate = new Promise<void>((resolve) => { releaseCallback = resolve; });
    let delayed!: Promise<Record<string, any>[]>;
    await expect(repo.withTransaction(async () => {
      await repo.run("UPDATE sites SET title = ? WHERE id = ?", ["第一事务未提交", site.id]);
      delayed = callbackGate.then(() => repo.raw("SELECT title FROM sites WHERE id = ?", [site.id]));
      throw new Error("第一事务回滚");
    })).rejects.toThrow("第一事务回滚");

    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let secondStarted!: () => void;
    const secondStartedPromise = new Promise<void>((resolve) => { secondStarted = resolve; });
    const second = repo.withTransaction(async () => {
      await repo.run("UPDATE sites SET title = ? WHERE id = ?", ["第二事务未提交", site.id]);
      secondStarted();
      await secondGate;
      throw new Error("第二事务回滚");
    });
    await secondStartedPromise;

    let settled = false;
    delayed.then(() => { settled = true; });
    releaseCallback();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);

    releaseSecond();
    await expect(second).rejects.toThrow("第二事务回滚");
    const rows = await delayed;
    expect(rows[0]?.title).toBe("已提交标题");
    await db.close();
  });

  it("PostgreSQL 普通读仍走 pool，不被独占写事务阻塞", async () => {
    const txStarted = deferred();
    const releaseTx = deferred();
    const clientCalls: string[] = [];
    const poolCalls: string[] = [];
    const client = {
      query: async (sql: string) => {
        clientCalls.push(sql);
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    };
    const db = {
      dialect: "pg",
      pg: {
        connect: async () => client,
        query: async (sql: string) => {
          poolCalls.push(sql);
          return { rows: [{ title: "pool-read" }], rowCount: 1 };
        },
      },
    } as never;
    const repo = new Repository(db);
    let releaseCallback!: () => void;
    const callbackGate = new Promise<void>((resolve) => { releaseCallback = resolve; });
    let delayed!: Promise<Record<string, any>[]>;

    const tx = repo.withTransaction(async () => {
      delayed = callbackGate.then(() => repo.raw("SELECT title FROM sites", []));
      txStarted.resolve();
      await releaseTx.promise;
    });
    await txStarted.promise;

    const rows = await repo.raw("SELECT title FROM sites", []);
    expect(rows[0]?.title).toBe("pool-read");
    expect(poolCalls).toEqual(["SELECT title FROM sites"]);
    expect(clientCalls).toEqual(["BEGIN"]);

    releaseTx.resolve();
    await tx;
    expect(clientCalls).toEqual(["BEGIN", "COMMIT"]);

    releaseCallback();
    expect((await delayed)[0]?.title).toBe("pool-read");
    expect(poolCalls).toEqual(["SELECT title FROM sites", "SELECT title FROM sites"]);
    expect(clientCalls).toEqual(["BEGIN", "COMMIT"]);
  });
});
