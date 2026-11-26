import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SqliteVecStore } from "../src/vector/sqlite-vec.ts";

const dim = 3;
const databases: Db[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});

async function vectorContext() {
  const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  databases.push(db);
  const sqliteVec = await import("sqlite-vec");
  sqliteVec.load(db.sqlite as never);
  const repo = new Repository(db);
  const vectors = new SqliteVecStore({ db: db.sqlite as never, gateDb: db, dim });
  vectors.init();
  return { db, repo, vectors };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("SqliteVecStore 共享数据库门禁", () => {
  it("事务挂起时向量写排队，事务回滚不会抹掉随后提交的向量", async () => {
    const { db, repo, vectors } = await vectorContext();
    const entered = deferred();
    const release = deferred();
    const tx = repo.withTransaction(async () => {
      await repo.run("UPDATE sites SET title = title WHERE id = 'missing'");
      entered.resolve();
      await release.promise;
      throw new Error("无关事务回滚");
    });
    await entered.promise;

    const write = vectors.upsert([{ key: 1, siteId: "site-gated", vector: new Float32Array([1, 0, 0]) }]);
    await new Promise((r) => setTimeout(r, 20));
    const during = db.sqlite!.prepare("SELECT COUNT(*) AS c FROM sites_vec").get() as { c: number };
    expect(during.c).toBe(0);

    release.resolve();
    await expect(tx).rejects.toThrow("无关事务回滚");
    await write;
    expect(await vectors.count()).toBe(1);
  });

  it("事务外计数等待提交，不能读到同一连接上的未提交向量", async () => {
    const { db, repo, vectors } = await vectorContext();
    const entered = deferred();
    const release = deferred();
    const tx = repo.withTransaction(async () => {
      db.sqlite!.prepare("INSERT INTO sites_vec(site_key, site_id, embedding) VALUES (?, ?, ?)")
        .run(1n, "site-uncommitted", new Float32Array([1, 0, 0]));
      entered.resolve();
      await release.promise;
      throw new Error("向量事务回滚");
    });
    await entered.promise;

    let settled = false;
    const count = vectors.count().then((value) => { settled = true; return value; });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    release.resolve();
    await expect(tx).rejects.toThrow("向量事务回滚");
    await expect(count).resolves.toBe(0);
  });

  it("调用方事务内直接维护向量被拒绝，不能借外层事务成功", async () => {
    const { repo, vectors } = await vectorContext();
    await expect(repo.withTransaction(async () => {
      await vectors.upsert([{ key: 1, siteId: "site-inside", vector: new Float32Array([1, 0, 0]) }]);
    })).rejects.toThrow("事务外");
    expect(await vectors.count()).toBe(0);
  });
});
