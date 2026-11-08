/**
 * 版本化数据库迁移台账（_schema_migrations）。
 *
 * 架构目标（DB-01）：
 * 1. 提供确定性、幂等、可审计的迁移执行记录；
 * 2. 避免冷启动及每次建立连接时重复跑几十个 DDL / PRAGMA / 字符串扫描；
 * 3. 双方言对齐（SQLite 与 PostgreSQL 同构）；
 * 4. 记录校验和（checksum）与执行时间戳（applied_at），支持诊断与健康巡检。
 */

import { createHash } from "node:crypto";
import type { Db } from "../driver.ts";
import {
  migrateColumns,
  dedupeUserEmails,
  migrateSiteIndexes,
  migrateEventIdentity,
  migrateCategorySlugs,
  migrateWorkspaceBlobs,
  cleanTaxonomyAndDuplicates,
  normalizeSiteCreatedAt,
} from "../migrate.ts";

export interface MigrationRecord {
  version: string;
  name: string;
  applied_at: number;
  checksum: string;
}

export interface RegisteredMigration {
  version: string;
  name: string;
  up: (db: Db) => Promise<void>;
  checksum?: string;
}

/** 计算迁移定义的稳定指纹 */
export function computeMigrationChecksum(name: string, content: string): string {
  return createHash("sha256").update(`${name}:${content}`).digest("hex").slice(0, 16);
}

/**
 * 初始化迁移台账表（_schema_migrations）
 */
export async function initSchemaMigrationsTable(db: Db): Promise<void> {
  const ddlSqlite = `
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      checksum TEXT NOT NULL
    );
  `;
  const ddlPg = `
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at BIGINT NOT NULL,
      checksum TEXT NOT NULL
    );
  `;

  if (db.dialect === "pg" && db.pg) {
    await db.pg.query(ddlPg);
  } else if (db.sqlite) {
    db.sqlite.exec(ddlSqlite);
  }
}

/**
 * 查询已执行的迁移版本列表
 */
export async function getAppliedMigrations(db: Db): Promise<Set<string>> {
  await initSchemaMigrationsTable(db);
  const set = new Set<string>();

  if (db.dialect === "pg" && db.pg) {
    const res = await db.pg.query("SELECT version FROM _schema_migrations ORDER BY version ASC");
    for (const row of res.rows as any[]) {
      if (row.version) set.add(String(row.version));
    }
  } else if (db.sqlite) {
    try {
      const rows = db.sqlite.prepare("SELECT version FROM _schema_migrations ORDER BY version ASC").all() as any[];
      for (const row of rows) {
        if (row.version) set.add(String(row.version));
      }
    } catch {
      // 表尚不存在时直接返回空集合
    }
  }

  return set;
}

/**
 * 记录单条迁移完成
 */
export async function recordMigration(
  db: Db,
  record: { version: string; name: string; checksum?: string }
): Promise<void> {
  const appliedAt = Date.now();
  const checksum = record.checksum ?? computeMigrationChecksum(record.name, record.version);

  if (db.dialect === "pg" && db.pg) {
    await db.pg.query(
      `INSERT INTO _schema_migrations (version, name, applied_at, checksum)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (version) DO UPDATE SET
         applied_at = EXCLUDED.applied_at,
         checksum = EXCLUDED.checksum`,
      [record.version, record.name, appliedAt, checksum]
    );
  } else if (db.sqlite) {
    db.sqlite
      .prepare(
        `INSERT INTO _schema_migrations (version, name, applied_at, checksum)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(version) DO UPDATE SET
           applied_at = excluded.applied_at,
           checksum = excluded.checksum`
      )
      .run(record.version, record.name, appliedAt, checksum);
  }
}

/**
 * 获取完整迁移台账（用于监控诊断 API 与仪表板）
 */
export async function getMigrationLedger(db: Db): Promise<MigrationRecord[]> {
  await initSchemaMigrationsTable(db);
  if (db.dialect === "pg" && db.pg) {
    const res = await db.pg.query(
      "SELECT version, name, applied_at, checksum FROM _schema_migrations ORDER BY version ASC"
    );
    return (res.rows as any[]).map((r) => ({
      version: String(r.version),
      name: String(r.name),
      applied_at: Number(r.applied_at),
      checksum: String(r.checksum),
    }));
  } else if (db.sqlite) {
    const rows = db.sqlite
      .prepare("SELECT version, name, applied_at, checksum FROM _schema_migrations ORDER BY version ASC")
      .all() as any[];
    return rows.map((r) => ({
      version: String(r.version),
      name: String(r.name),
      applied_at: Number(r.applied_at),
      checksum: String(r.checksum),
    }));
  }
  return [];
}

/**
 * 仓库标准版本化迁移列表（按时间排序）
 */
export const BUILTIN_MIGRATIONS: RegisteredMigration[] = [
  {
    version: "20261001_column_alters",
    name: "全量列迁移与动态列扩容",
    up: async (db: Db) => {
      await migrateColumns(db);
    },
    checksum: "v1_col_alters",
  },
  {
    version: "20261010_dedupe_user_emails",
    name: "用户唯一邮箱清洗与多账号冲突处理",
    up: async (db: Db) => {
      await dedupeUserEmails(db);
    },
    checksum: "v1_dedupe_emails",
  },
  {
    version: "20261015_site_indexes",
    name: "站点与事件高性能索引/部分索引迁移",
    up: async (db: Db) => {
      await migrateSiteIndexes(db);
    },
    checksum: "v1_site_indexes",
  },
  {
    version: "20261020_event_identity",
    name: "事件流身份回填与物化日桶",
    up: async (db: Db) => {
      await migrateEventIdentity(db);
    },
    checksum: "v1_event_identity",
  },
  {
    version: "20261025_category_slugs",
    name: "分类层级 Slug 历史生成与去重",
    up: async (db: Db) => {
      await migrateCategorySlugs(db);
    },
    checksum: "v1_cat_slugs",
  },
  {
    version: "20261028_workspace_blobs",
    name: "工作区数据从 Vault 安全解耦迁移",
    up: async (db: Db) => {
      await migrateWorkspaceBlobs(db);
    },
    checksum: "v1_workspace_blobs",
  },
  {
    version: "20261107_clean_taxonomy_and_duplicates",
    name: "类目重构、错位纠偏与存量重复站点数据清洗",
    up: async (db: Db) => {
      await cleanTaxonomyAndDuplicates(db);
    },
    checksum: "v1_clean_taxonomy_and_duplicates",
  },
  {
    // 2026-11-08：修掉 3 行 TEXT 日期串的 sites.created_at。
    // 它是 recompute_rank 每小时整任务失败（NOT NULL constraint failed: sites.weight）
    // 的源头脏数据，细节见 packages/store/src/migrate.ts 的 normalizeSiteCreatedAt。
    version: "20261108_normalize_site_created_at",
    name: "站点创建时间存量数据归一（TEXT 日期串 → epoch 毫秒）",
    up: async (db: Db) => {
      await normalizeSiteCreatedAt(db);
    },
    checksum: "v1_normalize_site_created_at",
  },
];

/**
 * 执行所有尚未运行的版本化迁移
 */
export async function runVersionedMigrations(
  db: Db,
  options?: { force?: boolean; migrations?: RegisteredMigration[] }
): Promise<{ applied: string[]; skipped: string[] }> {
  await initSchemaMigrationsTable(db);
  const appliedSet = options?.force ? new Set<string>() : await getAppliedMigrations(db);
  const migrationsToRun = options?.migrations ?? BUILTIN_MIGRATIONS;

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const m of migrationsToRun) {
    if (appliedSet.has(m.version)) {
      skipped.push(m.version);
      continue;
    }

    // 执行迁移
    await m.up(db);
    // 写入台账
    await recordMigration(db, {
      version: m.version,
      name: m.name,
      checksum: m.checksum,
    });
    applied.push(m.version);
  }

  return { applied, skipped };
}
