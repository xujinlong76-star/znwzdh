/**
 * 迁移层的方言分派回归。
 *
 * 修的是什么（2026-10-20）：
 *  1. `migrateSiteIndexes` 里 9 处方言判断写成了 `db.dialect === "postgres"`，
 *     而 `Db.dialect` 的实际取值是 `"pg"` —— 分支永远不成立，PostgreSQL 拿到的是
 *     SQLite 版 DDL（INTEGER 时间戳 2038 溢出、REAL 精度不足、0/1 冒充 BOOLEAN）。
 *     DDL_PG 先建过表时这些 CREATE 是空操作，所以问题一直潜伏；
 *     任何「只在 migrate 里新增、忘了进 DDL_PG」的表都会立刻踩中。
 *  2. 分派写成 `dialect === "sqlite" ? sqlite.exec : pg.query`，
 *     libsql 会走进 pg 分支（没有 db.pg）→ 抛错 → 被 catch 静默吞掉，
 *     等于 libsql 的迁移一条都没执行过。
 *
 * 这两个 bug 都不会让测试变红、也不会让服务起不来，只会让「另一套方言」在
 * 某天突然不对——所以必须用假 db 把分派行为钉住。
 */
import { describe, expect, it } from "vitest";
import { migrateColumns, migrateSiteIndexes } from "../src/migrate.ts";

function pgRecorder() {
  const calls: string[] = [];
  return {
    calls,
    db: {
      dialect: "pg",
      pg: {
        query: async (sql: string) => {
          calls.push(sql);
          return { rows: [], rowCount: 0 };
        },
      },
    },
  };
}

describe("migrateSiteIndexes：按方言分派", () => {
  it("pg：使用 PostgreSQL 类型（BOOLEAN / BIGINT / DOUBLE PRECISION）", async () => {
    const { db, calls } = pgRecorder();
    await migrateSiteIndexes(db);

    const relations = calls.find((s) => s.includes("CREATE TABLE IF NOT EXISTS site_relations"));
    expect(relations).toBeTruthy();
    expect(relations).toContain("BOOLEAN");
    expect(relations).toContain("BIGINT");
    expect(relations).toContain("DOUBLE PRECISION");

    const reviews = calls.find((s) => s.includes("CREATE TABLE IF NOT EXISTS plugin_reviews"));
    expect(reviews).toContain("BIGINT");
  });

  it("pg：部分唯一索引与身份索引都下发了", async () => {
    const { db, calls } = pgRecorder();
    await migrateSiteIndexes(db);
    expect(calls.some((s) => s.includes("sites_url_idx") && s.includes("WHERE deleted_at IS NULL"))).toBe(true);
    expect(calls.some((s) => s.includes("events_identity_idx"))).toBe(true);
    // P3 的「每父标题唯一」：两条部分索引（子树 + 根层），PG 不依赖 NULLS NOT DISTINCT
    expect(
      calls.some((s) => s.includes("categories_child_title_uniq") && s.includes("parent_id, title") && s.includes("WHERE parent_id IS NOT NULL")),
    ).toBe(true);
    expect(
      calls.some((s) => s.includes("categories_root_title_uniq") && s.includes("ON categories(title)") && s.includes("WHERE parent_id IS NULL")),
    ).toBe(true);
  });

  it("libsql：走同步 exec，而不是不存在的 pg.query", async () => {
    const executed: string[] = [];
    const db = {
      dialect: "libsql",
      sqlite: {
        exec: (sql: string) => {
          executed.push(sql);
        },
        prepare: () => ({ run: () => ({}), all: () => [], get: () => undefined }),
      },
    };
    await migrateSiteIndexes(db);
    expect(executed.length).toBeGreaterThan(10);
    expect(executed.some((s) => s.includes("site_relations"))).toBe(true);
  });
});

describe("migrateColumns：按方言分派", () => {
  it("pg：先查 information_schema，再按需 ALTER", async () => {
    const existing = new Set(["id", "anchor", "parent_id", "title", "enabled", "sort", "created_at", "updated_at"]);
    const calls: string[] = [];
    const db = {
      dialect: "pg",
      pg: {
        query: async (sql: string) => {
          calls.push(sql);
          if (sql.includes("information_schema")) {
            return { rows: [...existing].map((c) => ({ column_name: c })), rowCount: existing.size };
          }
          return { rows: [], rowCount: 0 };
        },
      },
    };
    const added = await migrateColumns(db);
    // categories.source / alt_labels / related_categories 缺失 → 应被补上
    expect(added).toContain("categories.source");
    expect(added).toContain("categories.alt_labels");
    expect(calls.some((s) => s.startsWith("ALTER TABLE categories ADD COLUMN alt_labels"))).toBe(true);
  });

  it("pg 不识别的方言不误伤：sqlite 走 exec", async () => {
    const executed: string[] = [];
    const cols = new Set(["id", "anchor"]);
    const db = {
      dialect: "sqlite",
      sqlite: {
        prepare: () => ({ all: () => [...cols].map((name) => ({ name })) }),
        exec: (sql: string) => {
          executed.push(sql);
          const m = /ADD COLUMN (\w+)/.exec(sql);
          if (m) cols.add(m[1]!);
        },
      },
    };
    const added = await migrateColumns(db);
    expect(added.length).toBeGreaterThan(0);
    expect(executed.every((s) => s.startsWith("ALTER TABLE"))).toBe(true);
  });
});
