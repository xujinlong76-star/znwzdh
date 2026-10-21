/**
 * openDb 的 SQLite pragma 生效断言。
 *
 * 这些 pragma 都是"不设也能跑，设了才是省"的项，回归后无声无息，
 * 所以必须读回验证：
 *   - journal_mode=wal / synchronous=normal：并发读不阻塞写；
 *   - temp_store=memory：FTS5 bm25 排序与向量 KNN 的临时 b-tree 不落盘；
 *   - mmap_size=256MB：顺序扫描走页缓存直读，省 read 系统调用拷贝。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../src/driver.ts";

const opened: Db[] = [];
const dirs: string[] = [];

afterEach(() => {
  while (opened.length) opened.pop()?.close();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function freshSqlitePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "navhub-pragma-"));
  dirs.push(dir);
  return join(dir, "navhub.db");
}

describe("openDb(sqlite) pragma 生效", () => {
  it("journal_mode=wal、synchronous=normal、foreign_keys=on", async () => {
    const db = await openDb({ dialect: "sqlite", sqlitePath: freshSqlitePath() });
    opened.push(db);

    expect(db.sqlite!.pragma("journal_mode")).toEqual([{ journal_mode: "wal" }]);
    expect(db.sqlite!.pragma("synchronous")).toEqual([{ synchronous: 1 }]); // 1 = NORMAL
    expect(db.sqlite!.pragma("foreign_keys")).toEqual([{ foreign_keys: 1 }]);
    expect(db.sqlite!.pragma("busy_timeout")).toEqual([{ timeout: 10000 }]);
    expect(db.sqlite!.pragma("wal_autocheckpoint")).toEqual([{ wal_autocheckpoint: 1000 }]);
  });

  it("temp_store=memory：临时 b-tree 不落盘", async () => {
    const db = await openDb({ dialect: "sqlite", sqlitePath: freshSqlitePath() });
    opened.push(db);

    // 2 = MEMORY（0=default 落盘，1=file，2=memory）
    expect(db.sqlite!.pragma("temp_store")).toEqual([{ temp_store: 2 }]);
  });

  it("mmap_size=256MB：读扫描走内存映射", async () => {
    const db = await openDb({ dialect: "sqlite", sqlitePath: freshSqlitePath() });
    opened.push(db);

    expect(db.sqlite!.pragma("mmap_size")).toEqual([{ mmap_size: 268435456 }]);
  });
});

/**
 * libsql 必须 fail fast。
 *
 * 原因：Db 的 sqlite 接口是同步的（better-sqlite3 语义），而 @libsql/client 的
 * execute() 是 Promise。旧适配层把 Promise 当 `{ rows }` 返回 —— 每次查询都在
 * 上层表现为「空数组」，不报错、只是数据悄悄消失。宁可启动失败并说清原因，
 * 也不要让一次部署在「没有任何数据」的假象里跑下去。
 */
describe("openDb(libsql) 明确拒绝", () => {
  it("抛错并给出可操作的说明", async () => {
    await expect(openDb({ dialect: "libsql", sqlitePath: freshSqlitePath() })).rejects.toThrow(
      /libsql 方言尚未实现/,
    );
  });
});
