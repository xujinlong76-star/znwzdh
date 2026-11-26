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
import {
  dedupeUserEmails,
  migrateCategorySlugs,
  migrateColumns,
  migrateEventIdentity,
  migrateNavVersionTriggers,
  migrateSiteIndexes,
  migrateSiteReportsAndReviews,
  migrateWorkspaceBlobs,
  normalizeSiteCreatedAt,
} from "../src/migrate.ts";

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
    // 部分唯一索引改名 v2 是刻意的：先建新索引再删旧索引，CREATE 失败时旧索引仍在，
    // 唯一性不会出现「DROP 成功、CREATE 失败」空窗（见 migrateSiteIndexes 注释）。
    expect(calls.some((s) => s.includes("sites_url_uniq_v2") && s.includes("WHERE deleted_at IS NULL"))).toBe(true);
    expect(calls.some((s) => s.includes("events_identity_created_idx"))).toBe(true);
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

describe("migrateWorkspaceBlobs：PostgreSQL 冲突安全 SQL", () => {
  it("仅覆盖较旧目标，并且只删除内容与时间戳都已确认的源行", async () => {
    const calls: string[] = [];
    let countCalls = 0;
    const db = {
      dialect: "pg",
      pg: {
        query: async (sql: string) => {
          calls.push(sql);
          if (sql.includes("SELECT COUNT(*)")) {
            countCalls++;
            return { rows: [{ c: countCalls === 1 ? 1 : 0 }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      },
    };

    expect(await migrateWorkspaceBlobs(db)).toEqual({ copied: 1, skipped: false });
    const insert = calls.find((sql) => sql.includes("INSERT INTO user_workspace_blobs"));
    const remove = calls.find((sql) => sql.includes("DELETE FROM user_vault_sync"));
    expect(insert).toContain("DO UPDATE SET");
    expect(insert).toContain("user_workspace_blobs.updated_at < excluded.updated_at");
    expect(remove).toContain("b.payload = user_vault_sync.payload");
    expect(remove).toContain("b.updated_at >= user_vault_sync.updated_at");
  });
});

describe("关键迁移 SQL 错误传播", () => {
  it("dedupeUserEmails 不把 UPDATE 失败当成 0 条成功", async () => {
    const db = {
      dialect: "sqlite",
      sqlite: {
        prepare: (sql: string) => ({
          all: () => sql.includes("GROUP BY email")
            ? [{ email: "same@example.com", c: 2 }]
            : [{ id: "keep" }, { id: "clear" }],
          run: () => { throw new Error("injected dedupe failure"); },
        }),
      },
    };
    await expect(dedupeUserEmails(db)).rejects.toThrow("injected dedupe failure");
  });

  it("migrateColumns 在 ALTER 真失败时抛出，只有重查确认列已存在才容忍竞态", async () => {
    const db = {
      dialect: "sqlite",
      sqlite: {
        prepare: () => ({ all: () => [{ name: "id" }] }),
        exec: () => { throw new Error("injected alter failure"); },
      },
    };
    await expect(migrateColumns(db)).rejects.toThrow("injected alter failure");
  });

  it("migrateEventIdentity 不把回填失败当成 0 条成功", async () => {
    const db = {
      dialect: "sqlite",
      sqlite: { prepare: () => ({ run: () => { throw new Error("injected identity failure"); } }) },
    };
    await expect(migrateEventIdentity(db)).rejects.toThrow("injected identity failure");
  });

  it("migrateCategorySlugs 不把写入失败当成 0 条成功", async () => {
    const db = {
      dialect: "sqlite",
      sqlite: {
        prepare: (sql: string) => sql.startsWith("SELECT")
          ? { all: () => sql.includes("slug IS NULL") ? [{ id: "cat", title: "类目" }] : [] }
          : { run: () => { throw new Error("injected slug failure"); } },
      },
    };
    await expect(migrateCategorySlugs(db)).rejects.toThrow("injected slug failure");
  });

  it("normalizeSiteCreatedAt 不把数据修复失败静默降级", async () => {
    const db = {
      dialect: "sqlite",
      sqlite: {
        prepare: (sql: string) => sql.startsWith("SELECT")
          ? { all: () => [{ id: "site", created_at: "2026-11-07 06:47:11" }] }
          : { run: () => { throw new Error("injected created_at failure"); } },
      },
    };
    await expect(normalizeSiteCreatedAt(db)).rejects.toThrow("injected created_at failure");
  });

  it("migrateSiteReportsAndReviews 的首条 DDL 失败即中止", async () => {
    const db = {
      dialect: "sqlite",
      sqlite: { exec: () => { throw new Error("injected reports ddl failure"); } },
    };
    await expect(migrateSiteReportsAndReviews(db)).rejects.toThrow("injected reports ddl failure");
  });

  it("migrateNavVersionTriggers 的 DDL 失败即中止", async () => {
    const db = {
      dialect: "sqlite",
      sqlite: { exec: () => { throw new Error("injected trigger failure"); } },
    };
    await expect(migrateNavVersionTriggers(db)).rejects.toThrow("injected trigger failure");
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
    expect(added).toContain("users.password_version");
    expect(calls.some((s) => s.startsWith("ALTER TABLE categories ADD COLUMN alt_labels"))).toBe(true);
    expect(calls.some((s) => s === "ALTER TABLE users ADD COLUMN password_version INTEGER NOT NULL DEFAULT 0")).toBe(true);
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
    expect(added).toContain("users.password_version");
    expect(executed).toContain("ALTER TABLE users ADD COLUMN password_version INTEGER NOT NULL DEFAULT 0");
    expect(executed.every((s) => s.startsWith("ALTER TABLE"))).toBe(true);
  });
});
