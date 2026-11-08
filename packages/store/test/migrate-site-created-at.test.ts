import { describe, expect, it, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { normalizeSiteCreatedAt } from "../src/migrate.ts";

/**
 * 回归网：`sites.created_at` 的存量脏值归一（2026-11-08 实测故障）。
 *
 * 现场：3 行 created_at 是 TEXT 日期串 → Number() 得 NaN → 热度分 NaN
 * → SQL 绑参变 NULL → 撞 `sites.weight NOT NULL` → recompute_rank 每小时整任务失败。
 * 代码侧加了 NaN 闸门（不再崩），本迁移负责把脏数据本身修掉（不再脏）。
 */

function makeDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE sites (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      weight REAL NOT NULL DEFAULT 0
    );
  `);
  return { dialect: "sqlite", sqlite } as never as { dialect: string; sqlite: any };
}

describe("normalizeSiteCreatedAt", () => {
  let db: { dialect: string; sqlite: any };

  beforeEach(() => {
    db = makeDb();
  });

  it("把 TEXT 日期串（SQLite datetime 格式）转成 epoch 毫秒", async () => {
    // 注意：列声明是 INTEGER NOT NULL，但 SQLite 的动态类型允许存进 TEXT
    db.sqlite.prepare("INSERT INTO sites (id, url, title, created_at) VALUES (?,?,?,?)").run(
      "dirty-1", "https://a.com", "A", "2026-11-07 06:47:11",
    );
    const expected = Date.parse("2026-11-07T06:47:11");

    const fixed = await normalizeSiteCreatedAt(db);
    expect(fixed).toBe(1);

    const row = db.sqlite.prepare("SELECT created_at, typeof(created_at) t FROM sites WHERE id = ?").get("dirty-1");
    expect(row.created_at).toBe(expected);
    expect(row.t).toBe("integer");
  });

  it("已经是整数的行不被触碰（幂等）", async () => {
    const good = 1_700_000_000_000;
    db.sqlite.prepare("INSERT INTO sites (id, url, title, created_at) VALUES (?,?,?,?)").run("ok-1", "https://b.com", "B", good);

    expect(await normalizeSiteCreatedAt(db)).toBe(0);
    expect(await normalizeSiteCreatedAt(db)).toBe(0); // 再跑一次仍然是 0
    expect(db.sqlite.prepare("SELECT created_at FROM sites WHERE id = ?").get("ok-1").created_at).toBe(good);
  });

  it("非日期垃圾串回落到当前时间，且绝不留 NULL", async () => {
    db.sqlite.prepare("INSERT INTO sites (id, url, title, created_at) VALUES (?,?,?,?)").run("junk-1", "https://d.com", "D", "not-a-date");

    const before = Date.now();
    expect(await normalizeSiteCreatedAt(db)).toBe(1);

    const row = db.sqlite.prepare("SELECT created_at, typeof(created_at) t FROM sites WHERE id = ?").get("junk-1");
    expect(row.t).toBe("integer");
    expect(row.created_at).toBeGreaterThanOrEqual(before);
  });

  /**
   * NULL 分支：真实 schema 是 `created_at INTEGER NOT NULL`，SQLite 会直接拒绝
   * 显式 NULL 插入——也就是说这一支在 SQLite 侧**打不出来**，属于给
   * 放宽约束的旧库 / PG 侧留的防御。这里用一张允许 NULL 的同构表来覆盖它，
   * 避免"代码里有分支但永远没被跑过"。
   */
  it("created_at 为 NULL 时也能被兜住（用允许 NULL 的同构表覆盖该分支）", async () => {
    const loose = { dialect: "sqlite", sqlite: new DatabaseSync(":memory:") } as { dialect: string; sqlite: any };
    loose.sqlite.exec(`CREATE TABLE sites (id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER, weight REAL NOT NULL DEFAULT 0);`);
    loose.sqlite.prepare("INSERT INTO sites (id, url, title, created_at) VALUES (?,?,?,NULL)").run("null-1", "https://c.com", "C");

    const before = Date.now();
    expect(await normalizeSiteCreatedAt(loose)).toBe(1);

    const row = loose.sqlite.prepare("SELECT created_at, typeof(created_at) t FROM sites WHERE id = ?").get("null-1");
    expect(row.t).toBe("integer");
    expect(row.created_at).toBeGreaterThanOrEqual(before);
  });

  it("混合场景：只修脏行，干净行数值不变", async () => {
    const good = 1_600_000_000_000;
    db.sqlite.prepare("INSERT INTO sites (id, url, title, created_at) VALUES (?,?,?,?)").run("g", "https://e.com", "E", good);
    db.sqlite.prepare("INSERT INTO sites (id, url, title, created_at) VALUES (?,?,?,?)").run("bad", "https://f.com", "F", "2026-01-02 03:04:05");

    expect(await normalizeSiteCreatedAt(db)).toBe(1);
    expect(db.sqlite.prepare("SELECT created_at FROM sites WHERE id = ?").get("g").created_at).toBe(good);
    expect(db.sqlite.prepare("SELECT created_at FROM sites WHERE id = ?").get("bad").created_at).toBe(Date.parse("2026-01-02T03:04:05"));
  });
});
