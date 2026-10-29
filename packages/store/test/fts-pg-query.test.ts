import { describe, expect, it } from "vitest";
import { PgFtsStore, type PgFtsLike } from "../src/fts-pg.ts";

/**
 * PostgreSQL 全文查询的**接线级**验证（P0-4）。
 *
 * 纯语法在 core 的 cjk-pg-query.test.ts 里测；这里证明 PgFtsStore 真的把
 * tsquery 语法传给了数据库，而不是继续复用 FTS5 串。用假 db 捕获 SQL/参数，
 * 不需要真实 PG 也能挡住回归；真实命中率仍由 pg-dialect.e2e 覆盖。
 */
function fakeDb(): { db: PgFtsLike; calls: Array<{ sql: string; params?: unknown[] }> } {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    calls,
    db: {
      async query(sql: string, params?: unknown[]) {
        calls.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    },
  };
}

describe("PgFtsStore 使用 tsquery 语法", () => {
  it("拉丁词前缀传给 to_tsquery 的是 'term':*", async () => {
    const { db, calls } = fakeDb();
    const store = new PgFtsStore(db);
    await store.search("copilot", 5);

    const search = calls.find((c) => c.sql.includes("to_tsquery"));
    expect(search, "没有发出 to_tsquery 查询").toBeTruthy();
    const tsquery = String(search!.params?.[0] ?? "");
    expect(tsquery).toBe("'copilot':*");
    expect(tsquery).not.toContain('"');
  });

  it("中文二元组用单引号词元，且连接符是 |", async () => {
    const { db, calls } = fakeDb();
    const store = new PgFtsStore(db);
    await store.search("启动脚本", 5);

    const tsquery = String(calls.find((c) => c.sql.includes("to_tsquery"))!.params?.[0] ?? "");
    expect(tsquery).toBe("'启动' | '动脚' | '脚本'");
    expect(tsquery).not.toContain(" OR ");
  });

  it("纯标点不发起 FTS 查询（避免无意义全表扫）", async () => {
    const { db, calls } = fakeDb();
    const store = new PgFtsStore(db);
    const hits = await store.search("！！！", 5);
    expect(hits).toEqual([]);
    expect(calls.some((c) => c.sql.includes("to_tsquery"))).toBe(false);
  });
});
