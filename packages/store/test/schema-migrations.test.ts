import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import {
  getAppliedMigrations,
  getMigrationLedger,
  runVersionedMigrations,
  BUILTIN_MIGRATIONS,
  type RegisteredMigration,
} from "../src/migrations/schema-migrations.ts";

describe("版本化数据库迁移台账（DB-01）", () => {
  let db: Db;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  });

  afterAll(async () => {
    await db.close();
  });

  it("openDb 启动时自动建立 _schema_migrations 表并记录已执行迁移", async () => {
    const applied = await getAppliedMigrations(db);
    expect(applied.size).toBeGreaterThanOrEqual(BUILTIN_MIGRATIONS.length);
    for (const m of BUILTIN_MIGRATIONS) {
      expect(applied.has(m.version)).toBe(true);
    }
  });

  it("二次运行迁移自动跳过已应用版本（启动零额外开销）", async () => {
    const res = await runVersionedMigrations(db);
    expect(res.applied).toHaveLength(0);
    expect(res.skipped.length).toBeGreaterThanOrEqual(BUILTIN_MIGRATIONS.length);
  });

  it("sites_patrol_idx 作为独立版本登记（存量库在旧版本已记账时仍能补建）", async () => {
    // 2026-11-26：该索引曾被追加进早已记账的 20261015_site_indexes，存量库永远缺。
    // 单独版本是唯一能让它在新老库都落地的形态；这里钉住版本已进台账且索引实际存在。
    const m = BUILTIN_MIGRATIONS.find((x) => x.version === "20261126_site_patrol_index");
    expect(m).toBeDefined();
    const applied = await getAppliedMigrations(db);
    expect(applied.has("20261126_site_patrol_index")).toBe(true);
    const rows = db.sqlite!
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='sites_patrol_idx'")
      .all() as { name: string }[];
    expect(rows.length).toBe(1);
  });

  it("台账记录包含 version, name, applied_at, checksum", async () => {
    const ledger = await getMigrationLedger(db);
    expect(ledger.length).toBeGreaterThanOrEqual(BUILTIN_MIGRATIONS.length);
    const first = ledger[0];
    expect(first).toBeDefined();
    expect(typeof first.version).toBe("string");
    expect(typeof first.name).toBe("string");
    expect(typeof first.applied_at).toBe("number");
    expect(first.applied_at).toBeGreaterThan(0);
    expect(typeof first.checksum).toBe("string");
    expect(first.checksum.length).toBeGreaterThan(0);
  });

  it("自定义增量迁移执行与记录", async () => {
    let customExecuted = false;
    const customMigration: RegisteredMigration = {
      version: "20991231_test_migration",
      name: "测试自定义增量迁移",
      up: async (database: Db) => {
        database.sqlite?.exec("CREATE TABLE IF NOT EXISTS test_custom_migration (id INTEGER PRIMARY KEY);");
        customExecuted = true;
      },
      checksum: "test_custom_v1",
    };

    const res1 = await runVersionedMigrations(db, { migrations: [customMigration] });
    expect(res1.applied).toEqual(["20991231_test_migration"]);
    expect(customExecuted).toBe(true);

    // 再次执行，跳过
    customExecuted = false;
    const res2 = await runVersionedMigrations(db, { migrations: [customMigration] });
    expect(res2.applied).toHaveLength(0);
    expect(res2.skipped).toEqual(["20991231_test_migration"]);
    expect(customExecuted).toBe(false);

    // 查询台账
    const ledger = await getMigrationLedger(db);
    const item = ledger.find((r) => r.version === "20991231_test_migration");
    expect(item).toBeDefined();
    expect(item?.checksum).toBe("test_custom_v1");
  });
});
