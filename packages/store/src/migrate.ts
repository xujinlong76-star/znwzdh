/**
 * Schema 演进（幂等列迁移）。
 *
 * 为什么需要它：`driver.ts` 的 DDL 是 `CREATE TABLE IF NOT EXISTS`，只能建新表、
 * 不能给**已存在**的表加列。早期部署的数据库（例如本站 data/navhub.db）没有
 * sites.visit_count / sites.trend_score / users.email 这些新列，
 * 直接跑新代码会 "no such column"。
 *
 * 做法：启动时（openDb 内）检查每张表的实际列，缺什么补什么。
 * 双方言共用同一份「列清单」，SQL 片段按方言分支（SQLite 的 REAL / PG 的 DOUBLE PRECISION）。
 *
 * 幂等性由「先查 information_schema / PRAGMA 再 ALTER」保证，
 * 重复执行不会报 "duplicate column"。
 */

export interface ColumnAlter {
  table: string;
  column: string;
  /** SQLite 的列定义 */
  sqlite: string;
  /** PostgreSQL 的列定义 */
  pg: string;
}

/** 全量列迁移清单。新增列时在这里登记一行即可，两个方言都会生效。 */
export const COLUMN_ALTERS: ColumnAlter[] = [
  { table: "categories", column: "source", sqlite: "TEXT", pg: "TEXT" },
  { table: "sites", column: "visit_count", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "INTEGER NOT NULL DEFAULT 0" },
  { table: "sites", column: "last_visited_at", sqlite: "INTEGER", pg: "BIGINT" },
  { table: "sites", column: "trend_score", sqlite: "REAL NOT NULL DEFAULT 0", pg: "DOUBLE PRECISION NOT NULL DEFAULT 0" },
  { table: "sites", column: "deleted_at", sqlite: "INTEGER", pg: "BIGINT" },
  { table: "sites", column: "metadata", sqlite: "TEXT", pg: "TEXT" },
  { table: "users", column: "email", sqlite: "TEXT", pg: "TEXT" },
  { table: "users", column: "avatar", sqlite: "TEXT", pg: "TEXT" },
  { table: "users", column: "source", sqlite: "TEXT NOT NULL DEFAULT 'local'", pg: "TEXT NOT NULL DEFAULT 'local'" },
  // 任务退避：失败后延迟到 next_run_at 才重新可被认领（见 jobs.ts 的指数退避）
  { table: "jobs", column: "next_run_at", sqlite: "INTEGER", pg: "BIGINT" },
  // API 凭据治理：
  //   revoked_at   软吊销时间戳。硬删会把 audit_logs 里的 target 变成悬空 id，
  //                事后无法追查"哪条凭据做过什么"，所以默认停用而非抹除。
  //   rotated_at   上次轮换时间。轮换不该重写 created_at（那会抹掉凭据的真实服役起点）。
  //   token_prefix 明文的前若干字符，供管理页区分凭据；不含可还原部分，192 位熵不受影响。
  { table: "api_tokens", column: "revoked_at", sqlite: "INTEGER", pg: "BIGINT" },
  { table: "api_tokens", column: "rotated_at", sqlite: "INTEGER", pg: "BIGINT" },
  { table: "api_tokens", column: "token_prefix", sqlite: "TEXT", pg: "TEXT" },
  // 行为事件身份独立列（原藏在 meta JSON 里，LIKE 过滤走不了索引）。
  // 补齐后由 migrateEventIdentity 从 meta 回填历史行。
  { table: "events", column: "identity", sqlite: "TEXT", pg: "TEXT" },
];

/**
 * 软删除（回收站）需要的索引演进。必须在 migrateColumns 之后调用
 * （依赖 deleted_at 列存在），因此不放进 DDL。
 *
 * 1. `sites_url_idx` 从「全表唯一」改为「仅未删除行唯一」（部分唯一索引）。
 *    旧索引会挡住「删完同 URL 站点后重新添加」。删旧建新的窗口极小
 *    且发生在启动期（尚无写入），可接受。
 * 2. `sites_deleted_at_idx`：回收站探针的部分索引，体积只随删除量增长。
 */
export async function migrateSiteIndexes(db: { dialect: string; sqlite?: any; pg?: any }): Promise<void> {
  const statements = [
    "DROP INDEX IF EXISTS sites_url_idx",
    "CREATE UNIQUE INDEX IF NOT EXISTS sites_url_idx ON sites(url) WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS sites_deleted_at_idx ON sites(deleted_at) WHERE deleted_at IS NOT NULL",
    // 存储层补索引（旧库补齐；幂等 IF NOT EXISTS；与 driver.ts DDL 保持一致）
    "CREATE INDEX IF NOT EXISTS sites_source_status_idx ON sites(source, status)",
    "CREATE INDEX IF NOT EXISTS sites_hot_idx ON sites(enabled, trend_score DESC)",
    "CREATE INDEX IF NOT EXISTS events_search_idx ON events(kind, created_at, query)",
    "CREATE INDEX IF NOT EXISTS search_history_user_created_idx ON search_history(user_id, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS health_checks_checked_idx ON health_checks(checked_at)",
    "CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action, id DESC)",
    "CREATE INDEX IF NOT EXISTS collection_items_site_idx ON collection_items(site_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS site_tags_unique_idx ON site_tags(site_id, tag_id)",
    // 行为事件身份等值过滤（behaviorEvents/deleteBehaviorEvents 从 meta LIKE 迁到 identity =）
    "CREATE INDEX IF NOT EXISTS events_identity_idx ON events(identity)",
  ];
  for (const sqlText of statements) {
    try {
      if (db.dialect === "sqlite") {
        db.sqlite.exec(sqlText);
      } else {
        await db.pg.query(sqlText);
      }
    } catch {
      // 并发启动 / 只读副本等场景下允许跳过，下次启动兜底
    }
  }
}

async function tableColumns(db: { dialect: string; sqlite?: any; pg?: any }, table: string): Promise<Set<string>> {
  if (db.dialect === "sqlite") {
    const rows = db.sqlite.prepare("PRAGMA table_info(" + table + ")").all() as Array<{ name: string }>;
    return new Set(rows.map((r) => r.name));
  }
  const res = await db.pg.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = $1",
    [table],
  );
  return new Set((res.rows as Array<{ column_name: string }>).map((r) => r.column_name));
}

/**
 * 执行列迁移，返回实际补齐的列名（空数组 = 已是最新）。
 * 单个列失败不阻断其它列（例如并发启动时的竞争），由下次启动兜底。
 */
export async function migrateColumns(db: { dialect: string; sqlite?: any; pg?: any }): Promise<string[]> {
  const added: string[] = [];
  // 按表分组，避免对同一张表重复查 information_schema
  const byTable = new Map<string, ColumnAlter[]>();
  for (const a of COLUMN_ALTERS) {
    const list = byTable.get(a.table) ?? [];
    list.push(a);
    byTable.set(a.table, list);
  }

  for (const [table, alters] of byTable) {
    let existing: Set<string> | null = null;
    for (const a of alters) {
      try {
        if (!existing) existing = await tableColumns(db, table);
        if (existing.has(a.column)) continue;
        const ddl = db.dialect === "sqlite" ? a.sqlite : a.pg;
        const statement = "ALTER TABLE " + table + " ADD COLUMN " + a.column + " " + ddl;
        if (db.dialect === "sqlite") {
          db.sqlite.exec(statement);
        } else {
          await db.pg.query(statement);
        }
        added.push(table + "." + a.column);
        existing.add(a.column);
      } catch {
        // 并发启动 / 只读副本等场景下允许跳过，下次启动再补
      }
    }
  }
  return added;
}

/**
 * 回填 events.identity：历史行的身份藏在 meta JSON（{"identity":"..."}）里，
 * behaviorEvents/deleteBehaviorEvents 已改为等值过滤（走 events_identity_idx），
 * 不回填就等于丢历史个性化数据。
 *
 * - 必须在 migrateColumns 之后调用（依赖 identity 列存在）。
 * - 只扫「有 identity 键且未回填」的行；回填过的行不再扫，重复启动近似零成本。
 * - SQLite 用 json_valid 守护（meta 非法 JSON 时 json_extract 会抛错）；
 *   PG 用子串提取而非 meta::jsonb 转型（转型对非法 JSON 抛错，会中断整条 UPDATE）。
 * - best-effort：失败不阻断启动，下次启动兜底。
 */
export async function migrateEventIdentity(db: { dialect: string; sqlite?: any; pg?: any }): Promise<number> {
  try {
    if (db.dialect === "sqlite") {
      const res = db.sqlite.prepare(
        `UPDATE events SET identity = json_extract(meta, '$.identity')
          WHERE identity IS NULL AND meta IS NOT NULL AND meta LIKE '%"identity"%' AND json_valid(meta)`,
      ).run();
      return Number(res.changes ?? 0);
    }
    const res = await db.pg.query(
      `UPDATE events SET identity = substring(meta from '"identity":"([^"]*)"')
        WHERE identity IS NULL AND meta LIKE '%"identity"%'`,
    );
    return res.rowCount ?? 0;
  } catch {
    return 0;
  }
}
