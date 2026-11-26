import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { migrateSiteIndexes } from "../src/migrate.ts";
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

  it("存量库补建：sub_category_id 索引缺失时由 20261127 版本补上（P0-3）", async () => {
    // 2026-11-27 性能审计：sub_category_id 无索引导致 dashboard 分类分布与
    // 插件占用检查的 OR 谓词全表扫。新库 schema.ts/driver.ts 已建，存量库靠本版本补。
    const fresh = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    try {
      const mig = BUILTIN_MIGRATIONS.find((m) => m.version === "20261127_sites_sub_category_idx");
      expect(mig, "BUILTIN_MIGRATIONS 里必须有 20261127_sites_sub_category_idx").toBeDefined();
      const hasIdx = () =>
        fresh.sqlite!
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get("sites_sub_category_idx") !== undefined;

      fresh.sqlite!.exec("DROP INDEX IF EXISTS sites_sub_category_idx");
      fresh.sqlite!.prepare("DELETE FROM _schema_migrations WHERE version = ?").run("20261127_sites_sub_category_idx");
      expect(hasIdx()).toBe(false);

      const first = await runVersionedMigrations(fresh, { migrations: [mig!] });
      expect(first.applied).toEqual(["20261127_sites_sub_category_idx"]);
      expect(hasIdx()).toBe(true);

      const second = await runVersionedMigrations(fresh, { migrations: [mig!] });
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual(["20261127_sites_sub_category_idx"]);
    } finally {
      await fresh.close();
    }
  });

  it("存量库补建：20261015 已记账但缺 sites_patrol_idx 时，新版本才把它补上", async () => {
    // 真实的存量库不会有 sites_patrol_idx：这条 DDL 是事后追加进
    // 20261015_site_indexes 的，而该版本早已记账、不会再跑。
    // 这里直接把「全新库」改造成那个现场：索引不存在 + 新版本未记账。
    const fresh = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    try {
      const patrol = BUILTIN_MIGRATIONS.find((m) => m.version === "20261126_sites_patrol_idx");
      expect(patrol, "BUILTIN_MIGRATIONS 里必须有 20261126_sites_patrol_idx").toBeDefined();
      const hasPatrolIndex = () =>
        fresh.sqlite!
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get("sites_patrol_idx") !== undefined;

      fresh.sqlite!.exec("DROP INDEX IF EXISTS sites_patrol_idx");
      fresh.sqlite!.prepare("DELETE FROM _schema_migrations WHERE version = ?").run("20261126_sites_patrol_idx");
      expect(hasPatrolIndex()).toBe(false);

      const first = await runVersionedMigrations(fresh, { migrations: [patrol!] });
      expect(first.applied).toEqual(["20261126_sites_patrol_idx"]);
      expect(hasPatrolIndex()).toBe(true);

      // 二次启动按台账跳过，不会重复执行
      const second = await runVersionedMigrations(fresh, { migrations: [patrol!] });
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual(["20261126_sites_patrol_idx"]);
    } finally {
      await fresh.close();
    }
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

  it("SQLite 在 BEGIN IMMEDIATE 后才重查 applied，迁移与台账原子提交", async () => {
    const calls: string[] = [];
    const real = db.sqlite!;
    const sqlite = new Proxy(real, {
      get(target, prop) {
        if (prop === "exec") {
          return (sql: string) => {
            calls.push(sql);
            return target.exec(sql);
          };
        }
        if (prop === "prepare") {
          return (sql: string) => {
            if (sql.includes("SELECT version FROM _schema_migrations")) calls.push("LEDGER_READ");
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const migration: RegisteredMigration = {
      version: "20991231_test_atomic_migration",
      name: "测试锁内重查与原子台账",
      up: async (database: Db) => {
        database.sqlite?.exec("CREATE TABLE test_atomic_migration (id INTEGER PRIMARY KEY);");
      },
      checksum: "test_atomic_v1",
    };

    const result = await runVersionedMigrations({ dialect: "sqlite", sqlite } as Db, { migrations: [migration] });
    expect(result.applied).toEqual([migration.version]);
    expect(calls.indexOf("BEGIN IMMEDIATE")).toBeGreaterThanOrEqual(0);
    expect(calls.lastIndexOf("LEDGER_READ")).toBeGreaterThan(calls.indexOf("BEGIN IMMEDIATE"));
    expect(calls.indexOf("COMMIT")).toBeGreaterThan(calls.lastIndexOf("LEDGER_READ"));
    expect(await db.sqlite!.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get("test_atomic_migration"))
      .toMatchObject({ name: "test_atomic_migration" });
    expect((await getAppliedMigrations(db)).has(migration.version)).toBe(true);
  });

  it("SQLite 拒绝在调用方自行开启的未加锁事务中运行迁移", async () => {
    const migration: RegisteredMigration = {
      version: "20991231_test_unlocked_caller_transaction",
      name: "测试未加锁调用方事务",
      up: async () => { throw new Error("must not execute"); },
      checksum: "test_unlocked_caller_v1",
    };
    db.sqlite!.exec("BEGIN");
    try {
      await expect(runVersionedMigrations(db, { migrations: [migration] }))
        .rejects.toThrow("不能复用调用方未加迁移锁的事务");
      expect((await getAppliedMigrations(db)).has(migration.version)).toBe(false);
    } finally {
      db.sqlite!.exec("ROLLBACK");
    }
  });

  it("SQLite 迁移抛错时整批回滚，不写 applied，只写失败诊断", async () => {
    const migration: RegisteredMigration = {
      version: "20991231_test_failed_migration",
      name: "测试失败回滚",
      up: async (database: Db) => {
        database.sqlite?.exec("CREATE TABLE test_failed_migration (id INTEGER PRIMARY KEY);");
        throw new Error("injected migration failure");
      },
      checksum: "test_failed_v1",
    };

    await expect(runVersionedMigrations(db, { migrations: [migration] })).rejects.toThrow("injected migration failure");
    expect(await db.sqlite!.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get("test_failed_migration"))
      .toBeUndefined();
    expect((await getAppliedMigrations(db)).has(migration.version)).toBe(false);
    const failures = await db.sqlite!.prepare("SELECT step, error FROM migration_failures WHERE step = ?").all(migration.version);
    expect(failures).toHaveLength(1);
    expect(String((failures[0] as { error: string }).error)).toContain("injected migration failure");
  });

  it("SQLite 内置迁移的 SQL 失败不被吞掉：整批回滚、不写 applied，修复后可重试", async () => {
    const version = "20991231_test_builtin_sql_failure";
    const tableName = "test_builtin_sql_failure";
    let injectFailure = true;
    const real = db.sqlite!;
    const sqlite = new Proxy(real, {
      get(target, prop) {
        if (prop === "exec") {
          return (sql: string) => {
            if (injectFailure && sql.includes("sites_hot_idx")) throw new Error("injected builtin SQL failure");
            return target.exec(sql);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const migration: RegisteredMigration = {
      version,
      name: "测试内置 schema 迁移失败传播",
      up: async (database: Db) => {
        database.sqlite?.exec(`CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY)`);
        await migrateSiteIndexes({ dialect: "sqlite", sqlite } as Db);
      },
      checksum: "test_builtin_sql_failure_v1",
    };

    await expect(runVersionedMigrations({ dialect: "sqlite", sqlite } as Db, { migrations: [migration] }))
      .rejects.toThrow("injected builtin SQL failure");
    expect(await real.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName))
      .toBeUndefined();
    expect((await getAppliedMigrations(db)).has(version)).toBe(false);
    expect(await real.prepare("SELECT step FROM migration_failures WHERE step = ?").all(version)).toHaveLength(1);

    injectFailure = false;
    await expect(runVersionedMigrations(db, { migrations: [migration] })).resolves.toEqual({
      applied: [version],
      skipped: [],
    });
    expect((await getAppliedMigrations(db)).has(version)).toBe(true);
  });

  it("PostgreSQL 预查后获取 advisory lock，锁内重查发现竞争进程已应用则跳过", async () => {
    const version = "20991231_test_pg_race";
    const poolCalls: string[] = [];
    const clientCalls: string[] = [];
    let lockAcquired = false;
    let executed = false;
    let released = 0;
    const client = {
      query: async (sql: string) => {
        clientCalls.push(sql);
        if (sql.includes("pg_advisory_lock")) {
          lockAcquired = true;
          return { rows: [{ locked: true }], rowCount: 1 };
        }
        if (sql.includes("SELECT version FROM _schema_migrations")) {
          return { rows: lockAcquired ? [{ version }] : [], rowCount: lockAcquired ? 1 : 0 };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => { released++; },
    };
    const pg = {
      query: async (sql: string) => {
        poolCalls.push(sql);
        if (sql.includes("SELECT version FROM _schema_migrations")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
      connect: async () => client,
    };
    const migration: RegisteredMigration = {
      version,
      name: "测试 PostgreSQL 并发锁内重查",
      up: async () => { executed = true; },
      checksum: "test_pg_race_v1",
    };

    const result = await runVersionedMigrations({ dialect: "pg", pg } as never, { migrations: [migration] });
    expect(result).toEqual({ applied: [], skipped: [version] });
    expect(executed).toBe(false);
    expect(poolCalls.some((sql) => sql.includes("SELECT version FROM _schema_migrations"))).toBe(true);
    expect(clientCalls[0]).toContain("pg_advisory_lock(hashtext(current_database()::text), hashtext($1))");
    expect(clientCalls[1]).toBe("BEGIN");
    expect(clientCalls.findIndex((sql) => sql.includes("SELECT version FROM _schema_migrations"))).toBeGreaterThan(1);
    expect(clientCalls.at(-2)).toBe("COMMIT");
    expect(clientCalls.at(-1)).toContain("pg_advisory_unlock(hashtext(current_database()::text), hashtext($1))");
    expect(clientCalls.some((sql) => sql.includes("INSERT INTO _schema_migrations"))).toBe(false);
    expect(released).toBe(1);
  });

  it("PostgreSQL 迁移失败时回滚并解锁，applied 不落库，失败台账走原 pool", async () => {
    const version = "20991231_test_pg_failed_migration";
    const poolCalls: string[] = [];
    const clientCalls: string[] = [];
    let released = 0;
    const client = {
      query: async (sql: string) => {
        clientCalls.push(sql);
        if (sql.includes("SELECT version FROM _schema_migrations")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
      release: () => { released++; },
    };
    const pg = {
      query: async (sql: string) => {
        poolCalls.push(sql);
        return { rows: [], rowCount: 0 };
      },
      connect: async () => client,
    };
    const migration: RegisteredMigration = {
      version,
      name: "测试 PostgreSQL 迁移失败台账",
      up: async () => { throw new Error("injected pg migration failure"); },
      checksum: "test_pg_failed_v1",
    };

    await expect(runVersionedMigrations({ dialect: "pg", pg } as never, { migrations: [migration] }))
      .rejects.toThrow("injected pg migration failure");
    expect(clientCalls.at(-2)).toBe("ROLLBACK");
    expect(clientCalls.at(-1)).toContain("pg_advisory_unlock(hashtext(current_database()::text), hashtext($1))");
    expect(clientCalls.some((sql) => sql.includes("INSERT INTO _schema_migrations"))).toBe(false);
    expect(poolCalls.some((sql) => sql.includes("INSERT INTO migration_failures"))).toBe(true);
    expect(released).toBe(1);
  });

  it("PostgreSQL advisory unlock 失败时销毁独占连接，绝不回池", async () => {
    const calls: string[] = [];
    let released = 0;
    let destroyed = 0;
    const client = {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.includes("pg_advisory_unlock")) throw new Error("injected unlock failure");
        if (sql.includes("SELECT version FROM _schema_migrations")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
      release: () => { released++; },
      destroy: () => { destroyed++; },
    };
    const pg = {
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => client,
    };
    const migration: RegisteredMigration = {
      version: "20991231_test_pg_unlock_destroy",
      name: "测试 PG 解锁失败销毁连接",
      up: async () => {},
      checksum: "test_pg_unlock_destroy_v1",
    };

    await expect(runVersionedMigrations({ dialect: "pg", pg } as never, { migrations: [migration] }))
      .rejects.toThrow("injected unlock failure");
    expect(calls.filter((sql) => sql.includes("pg_advisory_unlock"))).toHaveLength(2);
    expect(destroyed).toBe(1);
    expect(released).toBe(0);
  });

  it("PG 客户端无 destroy() 时以 release(error) 确保连接不回池", async () => {
    const releaseErrors: unknown[] = [];
    const client = {
      query: async (sql: string) => {
        if (sql.includes("pg_advisory_unlock")) throw new Error("injected unlock failure without destroy");
        if (sql.includes("SELECT version FROM _schema_migrations")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
      release: (err?: Error) => { releaseErrors.push(err); },
    };
    const pg = {
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => client,
    };
    const migration: RegisteredMigration = {
      version: "20991231_test_pg_unlock_release_error",
      name: "测试 PG release(error) 销毁回退",
      up: async () => {},
      checksum: "test_pg_unlock_release_error_v1",
    };

    await expect(runVersionedMigrations({ dialect: "pg", pg } as never, { migrations: [migration] }))
      .rejects.toThrow("injected unlock failure without destroy");
    expect(releaseErrors).toHaveLength(1);
    expect(releaseErrors[0]).toBeInstanceOf(Error);
  });
});
