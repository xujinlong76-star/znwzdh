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
  migrateWantedSearches,
  migrateUserSyncState,
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
    try {
      await db.pg.query(ddlPg);
    } catch (err) {
      // 并发冷启动：多个 vitest worker（pg-dialect / rollup-pg /
      // llm-quota-reservation-pg）同时对全新库跑 openDb 时，都会走到这里。
      // CREATE TABLE IF NOT EXISTS 的存在检查与建表不是原子的：输的一方报
      // duplicate key violates unique constraint "pg_type_typname_nsp_index"
      //（23505，复合类型行撞键），偶发还会漏出 relation already exists（42P07）
      // 或 type "..." already exists（42710）——同一竞态的三种报错面孔。
      // 表已存在即说明另一路已建好，直接放行；否则原样抛出，不掩盖真错误。
      // 复现实测（2026-11-16，本地 PG 16.2 + pg_trgm + pgvector）：
      // 修前 5 路并发建表 10/10 轮撞键（每轮 1–4 路失败）；修后 20/20 轮、
      // 100/100 路全部成功。中间态只覆 23505/42P07 时 36 轮漏网 2 次，
      // 均为 42710，补上后归零。
      const code = (err as { code?: string } | null)?.code;
      if (code !== "23505" && code !== "42P07" && code !== "42710") throw err;
      const exists = await db.pg.query(
        "SELECT to_regclass('public._schema_migrations') AS t",
      );
      // to_regclass 未找到时返回 NULL；rows 为 unknown[]，显式标注行类型
      //（PgRunner.query 不带泛型，直接读 .t 会在 TS 7 下报 TS2339）。
      const row = exists.rows[0] as { t: string | null } | undefined;
      if (!row?.t) throw err;
    }
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
  {
    // 2026-11-13：待找（wanted_searches）建表 + (identity, query) 唯一索引。
    version: "20261113_wanted_searches",
    name: "待找（零结果存为待找）建表",
    up: async (db: Db) => {
      await migrateWantedSearches(db);
    },
    checksum: "v1_wanted_searches",
  },
  {
    // 2026-11-13：数据安全可见补完（第 15 项）——同步成功/失败水位表 user_sync_state。
    version: "20261113_user_sync_state",
    name: "同步成功/失败水位表 user_sync_state 建表",
    up: async (db: Db) => {
      await migrateUserSyncState(db);
    },
    checksum: "v1_user_sync_state",
  },
  {
    version: "20261124_durable_crawl_governance",
    name: "持久化采集任务队列、域名租约与页面指纹",
    up: async (db: Db) => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS crawl_tasks (
          id TEXT PRIMARY KEY, url TEXT NOT NULL, canonical_url TEXT NOT NULL UNIQUE,
          host TEXT NOT NULL, source TEXT NOT NULL, payload_json TEXT,
          status TEXT NOT NULL DEFAULT 'queued', priority INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 6,
          next_run_at BIGINT NOT NULL, lease_owner TEXT, lease_expires_at BIGINT,
          last_error TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS crawl_tasks_due_idx ON crawl_tasks(status, next_run_at, priority, created_at)",
        "CREATE INDEX IF NOT EXISTS crawl_tasks_host_idx ON crawl_tasks(host, status)",
        `CREATE TABLE IF NOT EXISTS crawl_domain_state (
          host TEXT PRIMARY KEY, next_allowed_at BIGINT NOT NULL DEFAULT 0,
          lease_task_id TEXT, lease_expires_at BIGINT, updated_at BIGINT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS crawl_page_fingerprints (
          canonical_url TEXT PRIMARY KEY, site_id TEXT, content_hash TEXT NOT NULL,
          simhash64 TEXT NOT NULL, language TEXT, fetched_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS crawl_fingerprints_site_idx ON crawl_page_fingerprints(site_id)",
        "CREATE INDEX IF NOT EXISTS crawl_fingerprints_hash_idx ON crawl_page_fingerprints(content_hash)",
      ];
      if (db.dialect === "pg" && db.pg) {
        for (const statement of statements) await db.pg.query(statement);
      } else if (db.sqlite) {
        db.sqlite.exec(statements.join(";"));
      }
    },
    checksum: "v1_durable_crawl_governance",
  },
  {
    version: "20261124_crawl_fingerprint_recent_idx",
    name: "采集页面指纹最近记录索引",
    up: async (db: Db) => {
      const statement = "CREATE INDEX IF NOT EXISTS crawl_fingerprints_recent_idx ON crawl_page_fingerprints(fetched_at DESC)";
      if (db.dialect === "pg" && db.pg) await db.pg.query(statement);
      else if (db.sqlite) db.sqlite.exec(statement);
    },
    checksum: "v1_crawl_fingerprint_recent_idx",
  },
  {
    version: "20261124_crawl_source_registry",
    name: "持久化采集来源注册表与调度租约",
    up: async (db: Db) => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS crawl_sources (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          canonical_url TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL CHECK (kind IN ('sitemap','rss','page')),
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          priority INTEGER NOT NULL DEFAULT 0,
          interval_ms BIGINT NOT NULL DEFAULT 1800000,
          next_run_at BIGINT NOT NULL,
          last_run_at BIGINT,
          last_status TEXT,
          last_error TEXT,
          lease_owner TEXT,
          lease_expires_at BIGINT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS crawl_sources_due_idx ON crawl_sources(enabled, next_run_at, priority)",
      ];
      if (db.dialect === "pg" && db.pg) {
        for (const statement of statements) await db.pg.query(statement);
      } else if (db.sqlite) {
        db.sqlite.exec(statements.join(";"));
      }
    },
    checksum: "v1_crawl_source_registry",
  },

  {
    version: "20261124_crawl_ai_decision_ledger",
    name: "AI 采集审核追加式决策历史",
    up: async (db: Db) => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS crawl_ai_moderation_decisions (
          id TEXT PRIMARY KEY,
          candidate_id TEXT NOT NULL,
          decision_source TEXT NOT NULL CHECK (decision_source IN ('ai','human')),
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          verdict TEXT,
          confidence DOUBLE PRECISION,
          quality_score INTEGER,
          risks_json TEXT NOT NULL DEFAULT '[]',
          reasons_json TEXT NOT NULL DEFAULT '[]',
          model TEXT,
          policy_version TEXT,
          actor TEXT,
          created_at BIGINT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS crawl_ai_decisions_candidate_idx ON crawl_ai_moderation_decisions(candidate_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS crawl_ai_decisions_time_idx ON crawl_ai_moderation_decisions(created_at DESC)",
        "CREATE INDEX IF NOT EXISTS crawl_ai_decisions_source_idx ON crawl_ai_moderation_decisions(decision_source, created_at DESC)"
      ];
      if (db.dialect === "pg" && db.pg) {
        for (const statement of statements) await db.pg.query(statement);
      } else if (db.sqlite) {
        db.sqlite.exec(statements.join(";"));
      }
    },
    checksum: "v1_crawl_ai_decision_ledger",
  },
  {
    version: "20261124_crawl_moderation_gold_annotation",
    name: "审核金标样本双人标注与仲裁",
    up: async (db: Db) => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS crawl_moderation_gold_cases (
          id TEXT PRIMARY KEY,
          source_fingerprint TEXT NOT NULL,
          title TEXT,
          description TEXT,
          category TEXT,
          sanitized_excerpt TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','annotating','needs_adjudication','gold_ready')),
          final_label TEXT CHECK (final_label IS NULL OR final_label IN ('approve','reject','review')),
          final_risk BOOLEAN,
          adjudicator_id TEXT,
          adjudication_reason TEXT,
          created_by TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          adjudicated_at BIGINT
        )`,
        `CREATE TABLE IF NOT EXISTS crawl_moderation_gold_annotations (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES crawl_moderation_gold_cases(id) ON DELETE CASCADE,
          annotator_id TEXT NOT NULL,
          label TEXT NOT NULL CHECK (label IN ('approve','reject','review')),
          risk BOOLEAN NOT NULL,
          evidence TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          UNIQUE(case_id, annotator_id)
        )`,
        "CREATE INDEX IF NOT EXISTS crawl_gold_cases_status_idx ON crawl_moderation_gold_cases(status, created_at)",
        "CREATE INDEX IF NOT EXISTS crawl_gold_annotations_case_idx ON crawl_moderation_gold_annotations(case_id, created_at)"
      ];
      if (db.dialect === "pg" && db.pg) {
        for (const statement of statements) await db.pg.query(statement);
      } else if (db.sqlite) {
        db.sqlite.exec(statements.join(";"));
      }
    },
    checksum: "v1_crawl_moderation_gold_annotation",
  },
  {
    version: "20261124_crawl_gold_candidate_source_unique",
    name: "金标采集候选来源指纹并发唯一约束",
    up: async (db: Db) => {
      const statement = "CREATE UNIQUE INDEX IF NOT EXISTS crawl_gold_candidate_source_unique_idx ON crawl_moderation_gold_cases(source_fingerprint) WHERE source_fingerprint LIKE 'candidate:%'";
      if (db.dialect === "pg" && db.pg) await db.pg.query(statement);
      else if (db.sqlite) db.sqlite.exec(statement);
    },
    checksum: "v1_crawl_gold_candidate_source_unique",
  },
  {
    version: "20261124_crawl_moderation_gold_task_claims",
    name: "金标双盲标注任务领取与租约",
    up: async (db: Db) => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS crawl_moderation_gold_assignments (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES crawl_moderation_gold_cases(id) ON DELETE CASCADE,
          annotator_id TEXT NOT NULL,
          slot INTEGER NOT NULL CHECK (slot IN (1,2)),
          status TEXT NOT NULL CHECK (status IN ('claimed','completed','expired')),
          lease_expires_at BIGINT NOT NULL,
          created_at BIGINT NOT NULL,
          claimed_at BIGINT NOT NULL,
          completed_at BIGINT
        )`,
        "CREATE INDEX IF NOT EXISTS crawl_gold_assignments_annotator_idx ON crawl_moderation_gold_assignments(annotator_id,status,lease_expires_at)",
        "CREATE INDEX IF NOT EXISTS crawl_gold_assignments_case_idx ON crawl_moderation_gold_assignments(case_id,status,slot)",
        "CREATE UNIQUE INDEX IF NOT EXISTS crawl_gold_assignments_active_slot_idx ON crawl_moderation_gold_assignments(case_id,slot) WHERE status='claimed'",
        "CREATE UNIQUE INDEX IF NOT EXISTS crawl_gold_assignments_active_annotator_idx ON crawl_moderation_gold_assignments(case_id,annotator_id) WHERE status='claimed'"
      ];
      if (db.dialect === "pg" && db.pg) {
        for (const statement of statements) await db.pg.query(statement);
      } else if (db.sqlite) {
        db.sqlite.exec(statements.join(";"));
      }
    },
    checksum: "v1_crawl_moderation_gold_task_claims",
  },
  {
    version: "20261124_crawl_moderation_model_evaluations",
    name: "审核模型离线金标评测历史",
    up: async (db: Db) => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS crawl_moderation_model_evaluations (
          id TEXT PRIMARY KEY,
          model TEXT NOT NULL,
          dataset_version TEXT NOT NULL,
          sample_size INTEGER NOT NULL,
          metrics_json TEXT NOT NULL,
          created_by TEXT NOT NULL,
          created_at BIGINT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS crawl_moderation_model_eval_model_idx ON crawl_moderation_model_evaluations(model,created_at DESC)",
        "CREATE INDEX IF NOT EXISTS crawl_moderation_model_eval_dataset_idx ON crawl_moderation_model_evaluations(dataset_version,created_at DESC)"
      ];
      if (db.dialect === "pg" && db.pg) {
        for (const statement of statements) await db.pg.query(statement);
      } else if (db.sqlite) {
        db.sqlite.exec(statements.join(";"));
      }
    },
    checksum: "v1_crawl_moderation_model_evaluations",
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
