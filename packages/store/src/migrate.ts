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

import { categorySlug } from "@navhub/core";
import { createHash } from "node:crypto";
import { toPgSql } from "./repository/dialect.ts";

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
  // 任务进度（异步恢复等长任务用）：存「最新值」而不是事件流。
  // 老库必须靠这两条 ALTER 才能拿到列——只改 CREATE TABLE 的话，
  // 表已存在的部署永远停在缺列状态，而读取端会把缺失读成 0（看起来像「没开始」）。
  { table: "jobs", column: "progress_done", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "INTEGER NOT NULL DEFAULT 0" },
  { table: "jobs", column: "progress_total", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "INTEGER NOT NULL DEFAULT 0" },
  // 单次执行耗时：排查「这次 tick 为什么慢」时，不必再靠二分猜是哪个任务。
  { table: "jobs", column: "duration_ms", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "INTEGER NOT NULL DEFAULT 0" },
  { table: "categories", column: "source", sqlite: "TEXT", pg: "TEXT" },
  // 类目 URL 标识（/category/{slug}）。可空：历史行由 migrateCategorySlugs 回填，
  // 回填失败时读路径退回 id，不影响可用性。
  { table: "categories", column: "slug", sqlite: "TEXT", pg: "TEXT" },
  { table: "sites", column: "visit_count", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "INTEGER NOT NULL DEFAULT 0" },
  { table: "sites", column: "last_visited_at", sqlite: "INTEGER", pg: "BIGINT" },
  { table: "sites", column: "trend_score", sqlite: "REAL NOT NULL DEFAULT 0", pg: "DOUBLE PRECISION NOT NULL DEFAULT 0" },
  { table: "sites", column: "deleted_at", sqlite: "INTEGER", pg: "BIGINT" },
  // 站点子类目指针：早期库没有这一列，而读路径（categorySiteCounts、
  // cleanupOrphanPluginCategories、dashboard 分布）都按双指针写 SQL ——
  // 缺列时这些语句直接抛 "no such column" 并被 catch 吞掉，
  // 等于旧部署的类目清扫从未生效。
  { table: "sites", column: "sub_category_id", sqlite: "TEXT", pg: "TEXT" },
  { table: "sites", column: "metadata", sqlite: "TEXT", pg: "TEXT" },
  { table: "users", column: "email", sqlite: "TEXT", pg: "TEXT" },
  { table: "users", column: "avatar", sqlite: "TEXT", pg: "TEXT" },
  // 会话治理（T8）：sessions 激活为可吊销设备记录（列补齐走 ALTER，存量库平滑升级）
  { table: "sessions", column: "user_agent", sqlite: "TEXT", pg: "TEXT" },
  { table: "sessions", column: "revoked_at", sqlite: "INTEGER", pg: "BIGINT" },
  { table: "sessions", column: "last_seen_at", sqlite: "INTEGER", pg: "BIGINT" },
  // 用户级 API 令牌（T20）：owner_identity 非空 = 用户自建个人令牌
  { table: "api_tokens", column: "owner_identity", sqlite: "TEXT", pg: "TEXT" },
  // 收藏标签（T22）：JSON 字符串数组；契约与上限见 normalizeFavoriteTags
  { table: "favorites", column: "tags", sqlite: "TEXT", pg: "TEXT" },
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
  // 标签多维分组与概念别名（Taxonomy Phase 1）
  { table: "tags", column: "group_name", sqlite: "TEXT NOT NULL DEFAULT 'topic'", pg: "TEXT NOT NULL DEFAULT 'topic'" },
  { table: "tags", column: "color", sqlite: "TEXT", pg: "TEXT" },
  { table: "tags", column: "description", sqlite: "TEXT", pg: "TEXT" },
  // 类目 SKOS 概念模型演进（Taxonomy Phase 3）
  { table: "categories", column: "alt_labels", sqlite: "TEXT NOT NULL DEFAULT '[]'", pg: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "categories", column: "related_categories", sqlite: "TEXT NOT NULL DEFAULT '[]'", pg: "TEXT NOT NULL DEFAULT '[]'" },
  // 插件作者归属 / 编辑精选（2026-10 E·F 批）
  { table: "plugins", column: "owner_identity", sqlite: "TEXT", pg: "TEXT" },
  { table: "plugins", column: "owner_key", sqlite: "TEXT", pg: "TEXT" },
  { table: "plugins", column: "featured", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "BOOLEAN NOT NULL DEFAULT FALSE" },
  { table: "plugins", column: "featured_rank", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "INTEGER NOT NULL DEFAULT 0" },
  { table: "plugins", column: "pending_changelog", sqlite: "TEXT", pg: "TEXT" },
  { table: "plugins", column: "pending_version", sqlite: "TEXT", pg: "TEXT" },
  { table: "plugins", column: "pending_manifest", sqlite: "TEXT", pg: "TEXT" },
  { table: "plugins", column: "author_verified", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "BOOLEAN NOT NULL DEFAULT FALSE" },
  { table: "plugins", column: "forked_from_slug", sqlite: "TEXT", pg: "TEXT" },
  { table: "plugins", column: "remix_count", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "INTEGER NOT NULL DEFAULT 0" },
  // 评价治理：默认 visible；举报计数用于治理面板排序
  { table: "plugin_reviews", column: "status", sqlite: "TEXT NOT NULL DEFAULT 'visible'", pg: "TEXT NOT NULL DEFAULT 'visible'" },
  { table: "plugin_reviews", column: "report_count", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "INTEGER NOT NULL DEFAULT 0" },
  { table: "plugin_reviews", column: "moderation_note", sqlite: "TEXT", pg: "TEXT" },
  { table: "plugin_reviews", column: "moderated_at", sqlite: "INTEGER", pg: "BIGINT" },
  { table: "plugin_reviews", column: "moderated_by", sqlite: "TEXT", pg: "TEXT" },
  { table: "plugin_reviews", column: "author_reply", sqlite: "TEXT", pg: "TEXT" },
  { table: "plugin_reviews", column: "author_replied_at", sqlite: "INTEGER", pg: "BIGINT" },
  // 收藏同步换代（M1）：软删墓碑。硬删会让「删除」事件在增量同步里
  // 无处表达——客户端按 updated_at 拉增量时看不见任何痕迹，于是删除永不传播。
  { table: "favorites", column: "deleted_at", sqlite: "INTEGER", pg: "BIGINT" },
  { table: "user_settings", column: "preferences_json", sqlite: "TEXT NOT NULL DEFAULT '{}'", pg: "TEXT NOT NULL DEFAULT '{}'" },
];

/**
 * 收敛 users.email 的重复值，为部分唯一索引 `users_email_unique_idx` 铺路。
 *
 * 背景：`users.email` 长期可重复（OAuth sync 曾按 email 绑定、也没有唯一约束），
 * 于是同一邮箱可能挂在多行上。一旦建唯一索引就会因为存量重复而**每次都失败**
 * （migrateSiteIndexes 里是逐语句 try/catch，失败被静默吞掉 → 规则写在文档里、
 * 数据库不认的假绿灯）。所以先 dedupe，再建索引。
 *
 * 口径：
 * - 每个重复组保留 `created_at` 最早的一行（并列取 id 字典序最小）——那是账号的
 *   原始主人；其余行把 email 置 NULL，而不是删行（行上挂着收藏/画像/凭据，
 *   删行等于连带销毁数据）。
 * - `email = ''` 与 NULL 都属于「没有邮箱」，不参与去重（与部分索引条件一致）。
 * - best-effort：失败返回 0 不阻断启动，下次启动兜底（索引建不上就继续不建）。
 *
 * @returns 被清空 email 的行数
 */
export async function dedupeUserEmails(db: { dialect: string; sqlite?: any; pg?: any }): Promise<number> {
  try {
    const isSqlite = db.dialect !== "pg" && !!db.sqlite;
    const read = async (sql: string, params: unknown[] = []): Promise<Array<Record<string, any>>> => {
      if (isSqlite) {
        const maybe = db.sqlite.prepare(sql).all(...params);
        // libsql 的 runner 返回 Promise，better-sqlite3 返回数组
        return maybe && typeof maybe.then === "function" ? await maybe : maybe;
      }
      if (!db.pg) return [];
      return (await db.pg.query(toPgSql(sql), params)).rows;
    };
    const write = async (sql: string, params: unknown[]): Promise<void> => {
      if (isSqlite) {
        const maybe = db.sqlite.prepare(sql).run(...params);
        if (maybe && typeof maybe.then === "function") await maybe;
        return;
      }
      await db.pg.query(toPgSql(sql), params);
    };

    const dupGroups = await read(
      "SELECT email, COUNT(*) AS c FROM users WHERE email IS NOT NULL AND email <> '' GROUP BY email HAVING COUNT(*) > 1",
    );
    if (dupGroups.length === 0) return 0;

    let cleared = 0;
    for (const group of dupGroups) {
      const email = String(group.email);
      const ids = (await read(
        "SELECT id FROM users WHERE email = ? ORDER BY created_at ASC, id ASC",
        [email],
      )).map((r) => String(r.id));
      if (ids.length < 2) continue;
      const keepId = ids[0]!;
      const otherIds = ids.slice(1);
      for (const id of otherIds) {
        await write("UPDATE users SET email = NULL WHERE id = ?", [id]);
        cleared += 1;
      }
      console.warn(`[migrate] users.email 重复，保留 ${keepId}，已清空 ${otherIds.join(",")} 的 email`);
    }
    return cleared;
  } catch (err) {
    console.warn("[migrate] dedupeUserEmails 失败:", err instanceof Error ? err.message : err);
    return 0;
  }
}

/**
 * 迁移失败台账。
 *
 * 旧实现的逐语句 `catch {}` 是空的：一条 DDL 因权限/重复数据/扩展缺失失败后，
 * 除了「下次启动再试」没有任何痕迹。运维看到的是一份「启动成功」的日志，
 * 而某个唯一索引/列可能从未建上。
 *
 * 这张表只记**失败**（成功的幂等 DDL 不记，避免每次启动写几十行噪音）：
 *   - step：语句哈希（同一句反复失败只更新 last_at，不堆行）
 *   - error：最后一次错误原文
 */
const MIGRATION_FAILURES_DDL =
  "CREATE TABLE IF NOT EXISTS migration_failures (" +
  "id TEXT PRIMARY KEY, step TEXT NOT NULL, error TEXT NOT NULL, created_at BIGINT NOT NULL)";

async function execSql(db: { dialect: string; sqlite?: any; pg?: any }, sqlText: string): Promise<void> {
  if (db.dialect !== "pg" && db.sqlite) {
    db.sqlite.exec(sqlText);
  } else if (db.pg) {
    await db.pg.query(sqlText);
  }
}

async function ensureMigrationFailures(db: { dialect: string; sqlite?: any; pg?: any }): Promise<void> {
  try {
    await execSql(db, MIGRATION_FAILURES_DDL);
  } catch {
    // 只读副本/权限受限时连台账都建不了：不能因此阻断启动，退回 console
  }
}

/** 记录一条迁移失败；永不抛错（迁移失败本身已经够糟，不该再引发启动失败） */
export async function recordMigrationFailure(
  db: { dialect: string; sqlite?: any; pg?: any },
  step: string,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const id = createHash("sha256").update(step).digest("hex").slice(0, 24);
  try {
    await execSql(db, MIGRATION_FAILURES_DDL);
    if (db.dialect !== "pg" && db.sqlite) {
      db.sqlite
        .prepare(
          "INSERT INTO migration_failures (id, step, error, created_at) VALUES (?,?,?,?) " +
            "ON CONFLICT(id) DO UPDATE SET error = excluded.error, created_at = excluded.created_at",
        )
        .run(id, step.slice(0, 300), message.slice(0, 1000), Date.now());
    } else if (db.pg) {
      await db.pg.query(
        "INSERT INTO migration_failures (id, step, error, created_at) VALUES ($1,$2,$3,$4) " +
          "ON CONFLICT(id) DO UPDATE SET error = EXCLUDED.error, created_at = EXCLUDED.created_at",
        [id, step.slice(0, 300), message.slice(0, 1000), Date.now()],
      );
    }
  } catch {
    // 台账写不进去时至少留一行进程日志
  }
  console.warn("[migrate] 迁移步骤失败（已记录，下次启动重试）:", step.slice(0, 120), message);
}

/**
 * 工作区明文从 `user_vault_sync` 搬到 `user_workspace_blobs`。
 *
 * 旧实现是「INSERT 一句 + DELETE 一句」并列在通用语句表里，各自 try/catch：
 * INSERT 失败（目标表缺失/权限/类型不匹配）时 DELETE 照跑，明文工作区永久丢失。
 *
 * 现在 DELETE 带 `EXISTS` 守卫：**只删已经在目标表里存在的键**。
 * 即使 INSERT 完全失败，DELETE 也一行都删不掉；INSERT 成功时两条语句天然幂等，
 * 不需要跨方言的长事务。
 */
export async function migrateWorkspaceBlobs(db: {
  dialect: string;
  sqlite?: any;
  pg?: any;
}): Promise<{ copied: number; skipped: boolean }> {
  const insertSql = `INSERT INTO user_workspace_blobs (user_id, payload, updated_at)
       SELECT user_id, payload, updated_at FROM user_vault_sync
       WHERE (user_id LIKE 'workspaces:%' OR user_id LIKE 'ws\\_members:%' ESCAPE '\\')
         AND payload IS NOT NULL
       ON CONFLICT(user_id) DO NOTHING`;
  const deleteSql = `DELETE FROM user_vault_sync
       WHERE (user_id LIKE 'workspaces:%' OR user_id LIKE 'ws\\_members:%' ESCAPE '\\')
         AND EXISTS (SELECT 1 FROM user_workspace_blobs b WHERE b.user_id = user_vault_sync.user_id)`;
  const countSql = `SELECT COUNT(*) AS c FROM user_vault_sync
       WHERE (user_id LIKE 'workspaces:%' OR user_id LIKE 'ws\\_members:%' ESCAPE '\\')`;

  const countSource = async (): Promise<number> => {
    if (db.dialect !== "pg" && db.sqlite) {
      const row = db.sqlite.prepare(countSql).get() as { c?: number } | undefined;
      return Number(row?.c ?? 0);
    }
    if (db.pg) {
      const res = await db.pg.query(countSql);
      return Number((res as { rows?: Array<{ c?: number }> }).rows?.[0]?.c ?? 0);
    }
    return 0;
  };

  try {
    const before = await countSource();
    await execSql(db, insertSql);
    await execSql(db, deleteSql);
    const remaining = await countSource();
    return { copied: Math.max(0, before - remaining), skipped: false };
  } catch (err) {
    // 关键：失败时**不执行** DELETE。旧行全部保留，下次启动重试。
    await recordMigrationFailure(db, "workspace_blobs_v1", err);
    return { copied: 0, skipped: true };
  }
}

/**
 * 软删除（回收站）需要的索引演进。必须在 migrateColumns 之后调用
 * （依赖 deleted_at 列存在），因此不放进 DDL。
 *
 * 1. `sites_url_uniq_v2` 从「全表唯一」改为「仅未删除行唯一」（部分唯一索引）。
 *    **先建新索引、再删旧索引**：旧实现是 DROP 后 CREATE，CREATE 因存量重复 URL
 *    失败时，唯一性从那一刻起静默失效（下一次启动再试、再失败）。
 * 2. `sites_deleted_at_idx`：回收站探针的部分索引，体积只随删除量增长。
 * 3. `users_email_unique_idx`：users.email 部分唯一。调用顺序要求
 *    **dedupeUserEmails 在前**（见 driver.ts 的 openDb 序列），否则存量重复会让
 *    建索引失败并被逐语句 try/catch 静默跳过。
 */
export async function migrateSiteIndexes(db: { dialect: string; sqlite?: any; pg?: any }): Promise<void> {
  await ensureMigrationFailures(db);
  /**
   * sites.url 的唯一索引换名：**先建后删，且只有建成功才删旧索引**。
   *
   * 索引名改为 v2 是刻意的——旧名可能被部署脚本引用，直接复用会让「是否已建」
   * 无法判断；新名 + IF NOT EXISTS 天然幂等。
   *
   * 这两句不能放进下面的语句表：那张表逐条 try/catch 且失败后继续执行，
   * CREATE 失败时 DROP 仍会跑，唯一性会在「旧索引已删、新索引没建上」的
   * 状态下静默消失——正是本次要修的空窗。
   */
  const createSitesUrlUnique =
    "CREATE UNIQUE INDEX IF NOT EXISTS sites_url_uniq_v2 ON sites(url) WHERE deleted_at IS NULL";
  let uniqueIndexReady = false;
  try {
    await execSql(db, createSitesUrlUnique);
    uniqueIndexReady = true;
  } catch (err) {
    // 建不上就保留旧索引（若有），留痕后下一轮启动再试
    await recordMigrationFailure(db, createSitesUrlUnique, err);
  }
  if (uniqueIndexReady) {
    try {
      await execSql(db, "DROP INDEX IF EXISTS sites_url_idx");
    } catch (err) {
      // 新索引已经在位，旧索引删不掉只是冗余，不影响唯一性
      await recordMigrationFailure(db, "DROP INDEX IF EXISTS sites_url_idx", err);
    }
  }
  const statements = [
    "CREATE INDEX IF NOT EXISTS sites_deleted_at_idx ON sites(deleted_at) WHERE deleted_at IS NOT NULL",
    // 存储层补索引（旧库补齐；幂等 IF NOT EXISTS；与 driver.ts DDL 保持一致）
    "CREATE INDEX IF NOT EXISTS sites_source_status_idx ON sites(source, status)",
    "CREATE INDEX IF NOT EXISTS sites_hot_idx ON sites(enabled, trend_score DESC)",
    // 邮箱唯一（部分索引：NULL 与空串都不进索引，等于「没有邮箱」不互斥）。
    // 必须晚于 dedupeUserEmails —— 存量重复会让 CREATE UNIQUE INDEX 直接失败，
    // 而这里逐语句 try/catch，失败只会静默跳过（下次启动再试）。
    "CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users(email) WHERE email IS NOT NULL AND email <> ''",
    "CREATE INDEX IF NOT EXISTS events_search_idx ON events(kind, created_at, query)",
    "CREATE INDEX IF NOT EXISTS search_history_user_created_idx ON search_history(user_id, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS favorites_user_created_idx ON favorites(user_id, created_at DESC)",
    // 增量同步游标：WHERE user_id = ? AND updated_at > ? 的主路径
    "CREATE INDEX IF NOT EXISTS favorites_user_updated_idx ON favorites(user_id, updated_at)",
    "CREATE INDEX IF NOT EXISTS events_identity_created_idx ON events(identity, created_at)",
    "CREATE INDEX IF NOT EXISTS plugins_owner_identity_idx ON plugins(owner_identity)",
    "CREATE INDEX IF NOT EXISTS health_checks_checked_idx ON health_checks(checked_at)",
    "CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action, id DESC)",
    "CREATE INDEX IF NOT EXISTS collection_items_site_idx ON collection_items(site_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS site_tags_unique_idx ON site_tags(site_id, tag_id)",
    // 用户中心设置（画像开关 / 收藏信号清理水位）：旧库补齐，新库由 driver.ts DDL 建
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS user_settings (identity TEXT PRIMARY KEY, personalization_enabled INTEGER NOT NULL DEFAULT 1, favorite_signal_cutoff BIGINT NOT NULL DEFAULT 0, preferences_json TEXT NOT NULL DEFAULT '{}', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)"
      : "CREATE TABLE IF NOT EXISTS user_settings (identity TEXT PRIMARY KEY, personalization_enabled INTEGER NOT NULL DEFAULT 1, favorite_signal_cutoff INTEGER NOT NULL DEFAULT 0, preferences_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    // 类目 slug 全局唯一（URL 是 /category/{slug}，不带父级路径）。
    // 部分索引：NULL 不进索引，所以回填窗口里多行 NULL 不冲突。
    // 标题的「每父唯一」索引在 P3 收敛重名后登记（两条部分索引分别覆盖子树与根层：
    // SQLite 把 NULL 视为互不相同，单条 (parent_id,title) 唯一索引拦不住根重名；
    // 部分索引在 PG 上同样可建，不依赖 NULLS NOT DISTINCT）。
    // P3 迁移窗口里 taxonomy-migrate.mjs 会在投影 registry 之前临时 DROP 掉它们，
    // 否则旧根「AI 工具」会与 registry 根同名冲突。
    "CREATE UNIQUE INDEX IF NOT EXISTS categories_slug_idx ON categories(slug) WHERE slug IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS categories_child_title_uniq ON categories(parent_id, title) WHERE parent_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS categories_root_title_uniq ON categories(title) WHERE parent_id IS NULL",
    // 行为事件身份等值过滤（behaviorEvents/deleteBehaviorEvents 从 meta LIKE 迁到 identity =）
    "CREATE INDEX IF NOT EXISTS events_identity_idx ON events(identity)",
    // 工作区明文专用表（M3）：原先 workspaces:<id> / ws_members:<id>:* 明文写在
    // user_vault_sync（E2EE 密文表），造成「隐私表述 vs 实现」冲突。迁出后
    // vault 表回归纯密文；本表命名明确不含 vault/e2ee 字样。
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS user_workspace_blobs (user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at BIGINT NOT NULL)"
      : "CREATE TABLE IF NOT EXISTS user_workspace_blobs (user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    // 注意：存量搬迁不在这张语句表里——它由 migrateWorkspaceBlobs 单独执行，
    // 因为 DELETE 必须带「已复制」守卫（见该函数注释）。
    // 站内通知（T13）：轻量用户消息表
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, identity TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, read_at BIGINT, created_at BIGINT NOT NULL)"
      : "CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, identity TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, read_at INTEGER, created_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS notifications_identity_created_idx ON notifications(identity, created_at)",
    // Outbox 由幂等启动迁移补齐；BIGINT 在 SQLite 中同样为整数亲和性。
    `CREATE TABLE IF NOT EXISTS notification_outbox (
      id TEXT PRIMARY KEY, identity TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('inapp', 'email', 'push')),
      kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'deferred', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
      next_attempt_at BIGINT, last_error TEXT, created_at BIGINT NOT NULL, delivered_at BIGINT
    )`,
    "CREATE INDEX IF NOT EXISTS notification_outbox_due_idx ON notification_outbox(next_attempt_at, created_at, id) WHERE status = 'pending' AND channel = 'inapp'",
    "CREATE INDEX IF NOT EXISTS notification_outbox_created_idx ON notification_outbox(created_at DESC, id DESC)",
    "CREATE TABLE IF NOT EXISTS submission_owners (site_id TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE, identity TEXT NOT NULL, created_at BIGINT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS submission_owners_identity_idx ON submission_owners(identity)",
    "CREATE INDEX IF NOT EXISTS api_tokens_owner_idx ON api_tokens(owner_identity)",
    // 收藏域补索引：`WHERE site_id = ?`（站点详情/清理）与 `WHERE user_id=? AND folder_id=?`
    // （收藏夹视图）此前只能走 user_id 单列索引或全表扫。
    "CREATE INDEX IF NOT EXISTS favorites_site_idx ON favorites(site_id)",
    "CREATE INDEX IF NOT EXISTS favorites_user_folder_idx ON favorites(user_id, folder_id)",
    // 标签概念别名索引
    "CREATE INDEX IF NOT EXISTS tag_aliases_tag_idx ON tag_aliases(tag_id)",
    // 分面属性表与索引 (Taxonomy Phase 2)
    "CREATE TABLE IF NOT EXISTS site_facets (site_id TEXT NOT NULL, facet_key TEXT NOT NULL, facet_value TEXT NOT NULL, PRIMARY KEY (site_id, facet_key, facet_value))",
    "CREATE INDEX IF NOT EXISTS site_facets_key_val_idx ON site_facets(facet_key, facet_value)",
    "CREATE INDEX IF NOT EXISTS site_facets_site_idx ON site_facets(site_id)",
    // 实体关系表与索引 (Taxonomy Phase 3)
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS site_relations (id TEXT PRIMARY KEY, source_site_id TEXT NOT NULL, target_site_id TEXT, target_title TEXT NOT NULL, target_url TEXT NOT NULL, relation_type TEXT NOT NULL DEFAULT 'related', is_free_or_open_source BOOLEAN NOT NULL DEFAULT FALSE, note TEXT, confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)"
      : "CREATE TABLE IF NOT EXISTS site_relations (id TEXT PRIMARY KEY, source_site_id TEXT NOT NULL, target_site_id TEXT, target_title TEXT NOT NULL, target_url TEXT NOT NULL, relation_type TEXT NOT NULL DEFAULT 'related', is_free_or_open_source INTEGER NOT NULL DEFAULT 0, note TEXT, confidence REAL NOT NULL DEFAULT 1.0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS site_relations_source_idx ON site_relations(source_site_id)",
    "CREATE INDEX IF NOT EXISTS site_relations_target_idx ON site_relations(target_site_id)",
    "CREATE INDEX IF NOT EXISTS site_relations_type_idx ON site_relations(relation_type)",
    // 治理提案表与索引 (Taxonomy Phase 4)
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS taxonomy_proposals (id TEXT PRIMARY KEY, kind TEXT NOT NULL, target_id TEXT NOT NULL, target_title TEXT, current_value TEXT, suggested_value TEXT NOT NULL, confidence DOUBLE PRECISION NOT NULL DEFAULT 0.8, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', meta TEXT, created_at BIGINT NOT NULL, applied_at BIGINT)"
      : "CREATE TABLE IF NOT EXISTS taxonomy_proposals (id TEXT PRIMARY KEY, kind TEXT NOT NULL, target_id TEXT NOT NULL, target_title TEXT, current_value TEXT, suggested_value TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.8, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', meta TEXT, created_at INTEGER NOT NULL, applied_at INTEGER)",
    "CREATE INDEX IF NOT EXISTS taxonomy_proposals_status_idx ON taxonomy_proposals(status)",
    "CREATE INDEX IF NOT EXISTS taxonomy_proposals_kind_idx ON taxonomy_proposals(kind)",
    "CREATE INDEX IF NOT EXISTS taxonomy_proposals_target_idx ON taxonomy_proposals(target_id)",
    // 插件市场三表（2026-10 新增；与 driver.ts DDL 保持一致，幂等）
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS plugins (id TEXT PRIMARY KEY, slug TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', icon TEXT, tags TEXT NOT NULL DEFAULT '[]', author TEXT, author_kind TEXT, owner_identity TEXT, owner_key TEXT, license TEXT, homepage TEXT, version TEXT NOT NULL, manifest TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', review_note TEXT, reviewed_at BIGINT, pending_changelog TEXT, source TEXT NOT NULL DEFAULT 'user', install_count INTEGER NOT NULL DEFAULT 0, star_count INTEGER NOT NULL DEFAULT 0, report_count INTEGER NOT NULL DEFAULT 0, featured BOOLEAN NOT NULL DEFAULT FALSE, featured_rank INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, published_at BIGINT)"
      : "CREATE TABLE IF NOT EXISTS plugins (id TEXT PRIMARY KEY, slug TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', icon TEXT, tags TEXT NOT NULL DEFAULT '[]', author TEXT, author_kind TEXT, owner_identity TEXT, owner_key TEXT, license TEXT, homepage TEXT, version TEXT NOT NULL, manifest TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', review_note TEXT, reviewed_at INTEGER, pending_changelog TEXT, source TEXT NOT NULL DEFAULT 'user', install_count INTEGER NOT NULL DEFAULT 0, star_count INTEGER NOT NULL DEFAULT 0, report_count INTEGER NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0, featured_rank INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, published_at INTEGER)",
    "CREATE UNIQUE INDEX IF NOT EXISTS plugins_slug_idx ON plugins(slug)",
    "CREATE INDEX IF NOT EXISTS plugins_status_idx ON plugins(status)",
    "CREATE INDEX IF NOT EXISTS plugins_kind_idx ON plugins(kind)",
    "CREATE INDEX IF NOT EXISTS plugins_owner_key_idx ON plugins(owner_key)",
    "CREATE INDEX IF NOT EXISTS plugins_featured_idx ON plugins(featured)",
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS plugin_installs (plugin_id TEXT NOT NULL, identity TEXT NOT NULL, version TEXT NOT NULL, meta TEXT, installed_at BIGINT NOT NULL, removed_at BIGINT, PRIMARY KEY (plugin_id, identity))"
      : "CREATE TABLE IF NOT EXISTS plugin_installs (plugin_id TEXT NOT NULL, identity TEXT NOT NULL, version TEXT NOT NULL, meta TEXT, installed_at INTEGER NOT NULL, removed_at INTEGER, PRIMARY KEY (plugin_id, identity))",
    "CREATE INDEX IF NOT EXISTS plugin_installs_plugin_idx ON plugin_installs(plugin_id)",
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS plugin_stars (plugin_id TEXT NOT NULL, identity TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY (plugin_id, identity))"
      : "CREATE TABLE IF NOT EXISTS plugin_stars (plugin_id TEXT NOT NULL, identity TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (plugin_id, identity))",
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS plugin_reports (plugin_id TEXT NOT NULL, identity TEXT NOT NULL, ip TEXT, reason TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL, PRIMARY KEY (plugin_id, identity))"
      : "CREATE TABLE IF NOT EXISTS plugin_reports (plugin_id TEXT NOT NULL, identity TEXT NOT NULL, ip TEXT, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY (plugin_id, identity))",
    "CREATE INDEX IF NOT EXISTS plugin_reports_plugin_idx ON plugin_reports(plugin_id)",
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS plugin_versions (id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL, changelog TEXT, checksum TEXT NOT NULL, published_at BIGINT NOT NULL, created_at BIGINT NOT NULL, UNIQUE(plugin_id, version))"
      : "CREATE TABLE IF NOT EXISTS plugin_versions (id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL, changelog TEXT, checksum TEXT NOT NULL, published_at INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(plugin_id, version))",
    "CREATE INDEX IF NOT EXISTS plugin_versions_plugin_idx ON plugin_versions(plugin_id)",
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS plugin_reviews (id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, identity TEXT NOT NULL, rating INTEGER NOT NULL, title TEXT, content TEXT, installed_version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'visible', report_count INTEGER NOT NULL DEFAULT 0, moderation_note TEXT, moderated_at BIGINT, moderated_by TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, UNIQUE(plugin_id, identity))"
      : "CREATE TABLE IF NOT EXISTS plugin_reviews (id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, identity TEXT NOT NULL, rating INTEGER NOT NULL, title TEXT, content TEXT, installed_version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'visible', report_count INTEGER NOT NULL DEFAULT 0, moderation_note TEXT, moderated_at INTEGER, moderated_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(plugin_id, identity))",
    "CREATE INDEX IF NOT EXISTS plugin_reviews_plugin_idx ON plugin_reviews(plugin_id)",
    "CREATE INDEX IF NOT EXISTS plugin_reviews_status_idx ON plugin_reviews(status)",
    // LLM 用量明细（2026-10-19）：观测面板的唯一真实数据源。
    // 为什么不塞进 events：events 承载 click/favorite/vitals/client_error 等语义事件，
    // AI 调用是高频 + 固定列的结构化数据，混在一起既膨胀又难聚合；
    // 独立表可按 retention 单独设 TTL（默认 90 天）。
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS llm_usage (id TEXT PRIMARY KEY, scenario TEXT NOT NULL, source TEXT NOT NULL, model TEXT NOT NULL, identity TEXT, prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0, ok BOOLEAN NOT NULL, error_code TEXT, thinking BOOLEAN NOT NULL DEFAULT FALSE, created_at BIGINT NOT NULL)"
      : "CREATE TABLE IF NOT EXISTS llm_usage (id TEXT PRIMARY KEY, scenario TEXT NOT NULL, source TEXT NOT NULL, model TEXT NOT NULL, identity TEXT, prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL, error_code TEXT, thinking INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS llm_usage_time_idx ON llm_usage(created_at)",
    "CREATE INDEX IF NOT EXISTS llm_usage_scenario_idx ON llm_usage(scenario, created_at)",
    "CREATE INDEX IF NOT EXISTS llm_usage_source_idx ON llm_usage(source, created_at)",
    // 配额判定与注销匿名化都按 identity 过滤：没有索引时每次 LLM 调用前都要全表扫。
    "CREATE INDEX IF NOT EXISTS llm_usage_identity_idx ON llm_usage(identity, created_at)",
    // 分享短链：只存内部 /marketplace/ 目标（防开放重定向）
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS short_links (code TEXT PRIMARY KEY, target TEXT NOT NULL, plugin_slug TEXT, clicks INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL)"
      : "CREATE TABLE IF NOT EXISTS short_links (code TEXT PRIMARY KEY, target TEXT NOT NULL, plugin_slug TEXT, clicks INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)",
  ];
  for (const sqlText of statements) {
    try {
      // 判据必须写「非 pg」：libsql 与 sqlite 共用同一个同步 runner 接口
      // （见 driver.ts 的 libsql 分支），而它根本没有 db.pg。
      // 旧代码写 `=== "sqlite"` 会让 libsql 落进 pg 分支抛错，随后被下面的
      // catch 静默吞掉 —— 等于 libsql 部署的索引迁移从未执行过一次。
      if (db.dialect !== "pg" && db.sqlite) {
        db.sqlite.exec(sqlText);
      } else if (db.pg) {
        await db.pg.query(sqlText);
      }
    } catch (err) {
      // 并发启动 / 只读副本等场景下允许跳过，但**必须留下痕迹**：
      // 空 catch 会让「唯一索引没建上」和「建上了」在日志里长得一样。
      await recordMigrationFailure(db, sqlText, err);
    }
  }

  // 存量搬迁单独执行：DELETE 带 EXISTS 守卫，INSERT 失败时不会误删源数据。
  await migrateWorkspaceBlobs(db);
}

async function tableColumns(db: { dialect: string; sqlite?: any; pg?: any }, table: string): Promise<Set<string>> {
  if (db.dialect !== "pg" && db.sqlite) {
    const prepared = db.sqlite.prepare("PRAGMA table_info(" + table + ")").all() as
      | Array<{ name: string }>
      | Promise<{ rows?: Array<{ name: string }> }>;
    // libsql 的 runner 是异步驱动（prepare().all() 返回 Promise 而非数组），
    // better-sqlite3 是同步数组。两种形态在这里归一化：
    // 否则 libsql 上 rows.map 直接抛错 → 被外层 catch 吞掉 → 列迁移永远空转。
    const rows = typeof (prepared as Promise<unknown>)?.then === "function"
      ? ((await prepared) as { rows?: Array<{ name: string }> }).rows ?? []
      : (prepared as Array<{ name: string }>);
    return new Set(rows.map((r) => r.name));
  }
  if (!db.pg) return new Set();
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
        const ddl = db.dialect === "pg" ? a.pg : a.sqlite;
        const statement = "ALTER TABLE " + table + " ADD COLUMN " + a.column + " " + ddl;
        if (db.dialect !== "pg" && db.sqlite) {
          const maybe = db.sqlite.exec(statement);
          // libsql 的 exec 返回 Promise：必须 await，否则并发启动时下一次
          // PRAGMA 可能先于 ALTER 落地，读到旧列集合重复补列（duplicate column）。
          if (maybe && typeof (maybe as Promise<unknown>).then === "function") await maybe;
        } else if (db.pg) {
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
    if (db.dialect !== "pg" && db.sqlite) {
      const maybe = db.sqlite.prepare(
        `UPDATE events SET identity = json_extract(meta, '$.identity')
          WHERE identity IS NULL AND meta IS NOT NULL AND meta LIKE '%"identity"%' AND json_valid(meta)`,
      ).run() as { changes?: number } | Promise<{ rowsAffected?: number; changes?: number }>;
      // libsql 返回 Promise（行数在 rowsAffected），better-sqlite3 同步返回 { changes }
      const res: { changes?: number; rowsAffected?: number } =
        maybe && typeof (maybe as Promise<unknown>).then === "function"
          ? await (maybe as Promise<{ changes?: number; rowsAffected?: number }>)
          : (maybe as { changes?: number });
      return Number(res.changes ?? res.rowsAffected ?? 0);
    }
    if (!db.pg) return 0;
    const res = await db.pg.query(
      `UPDATE events SET identity = substring(meta from '"identity":"([^"]*)"')
        WHERE identity IS NULL AND meta LIKE '%"identity"%'`,
    );
    return res.rowCount ?? 0;
  } catch {
    return 0;
  }
}

/**
 * 回填 categories.slug —— 类目 URL 从 UUID 换成可读 slug 的前置条件。
 *
 * 口径：
 * - **只填 slug IS NULL 的行**。slug 一旦发布就是 URL 资产，启动期重写已有值
 *   等于把已收录的 /category/{slug} 全部打成 404。
 * - **全局唯一**：URL 形如 /category/{slug}，不带父级路径，所以冲突判定看全表。
 *   「每父唯一」是标题的规矩（P2 数据干净后才建那个索引），不是 slug 的。
 * - best-effort：失败不阻断启动，下次启动兜底。因此读路径必须容忍 NULL slug
 *   （/category/{id} 的 UUID 形态在过渡期继续可用，并由路由 301 到新形态）。
 */
export async function migrateCategorySlugs(db: { dialect: string; sqlite?: any; pg?: any }): Promise<number> {
  try {
    const isSqlite = db.dialect !== "pg" && !!db.sqlite;
    const read = async (sql: string, params: unknown[] = []): Promise<Array<Record<string, any>>> => {
      if (isSqlite) {
        const maybe = db.sqlite.prepare(sql).all(...params);
        // libsql 的 runner 返回 Promise，better-sqlite3 返回数组
        return maybe && typeof maybe.then === "function" ? await maybe : maybe;
      }
      return (await db.pg.query(toPgSql(sql), params)).rows;
    };
    const write = async (sql: string, params: unknown[]): Promise<void> => {
      if (isSqlite) {
        const maybe = db.sqlite.prepare(sql).run(...params);
        if (maybe && typeof maybe.then === "function") await maybe;
        return;
      }
      await db.pg.query(toPgSql(sql), params);
    };

    const pending = await read(
      "SELECT id, title, title_en FROM categories WHERE slug IS NULL ORDER BY sort ASC, title ASC",
    );
    if (pending.length === 0) return 0;
    const used = new Set<string>(
      (await read("SELECT slug FROM categories WHERE slug IS NOT NULL")).map((r) => String(r.slug)),
    );
    let written = 0;
    for (const row of pending) {
      const base = categorySlug(row.title_en ?? null, String(row.title ?? ""));
      let candidate = base;
      for (let i = 2; used.has(candidate); i += 1) candidate = `${base}-${i}`;
      used.add(candidate);
      await write("UPDATE categories SET slug = ? WHERE id = ?", [candidate, String(row.id)]);
      written += 1;
    }
    return written;
  } catch {
    return 0;
  }
}

/**
 * 清理历史卸载遗留的无主插件类目 (Orphan Plugin Categories Cleanup)
 *
 * 历史原因：此前卸载 site-pack 时只软删了 sites 表中的站点，未同步清理 categories 表中 source='plugin:xxx' 的分类，
 * 导致卸载插件后类目残留（如幽灵分类）。
 * 
 * 清理条件：
 * 1. 分类 source 以 'plugin:' 开头；
 * 2. 对应的插件在当前系统并无活跃安装（plugin_installs.removed_at IS NULL 不存在）；
 * 3. 该分类下没有任何站点引用——回收站里的站点也算引用。它们在回收站期间可被恢复，
 *    提前删掉分类会让恢复后的站点掉进「未分类」；等保留期结束、站点被物理清理后，
 *    下一次启动清扫才会移除该分类。
 *
 * `options.skip`（环境变量 NAVHUB_SKIP_ORPHAN_CLEANUP=1）整体停用本函数。
 * 类目树迁移（taxonomy-migrate）期间必须停用：新树的叶子在回填站点之前
 * 短暂地没有存活引用，正是这条清扫的删除条件；不停用会让清扫在迁移窗口里
 * 把刚建好的叶子再吃一遍 —— 2026-10-21 那批「回收站站点分类全部悬空」
 * （962 行 / 100 个不存在的 category_id）就是这么来的。
 */
export async function cleanupOrphanPluginCategories(
  db: { dialect: string; sqlite?: any; pg?: any },
  options: { skip?: boolean } = {},
): Promise<number> {
  if (options.skip) return 0;
  try {
    if (db.dialect !== "pg" && db.sqlite) {
      const selectSql = `
        SELECT c.id, c.parent_id FROM categories c
        WHERE c.source LIKE 'plugin:%'
          AND NOT EXISTS (
            SELECT 1 FROM sites s
            WHERE s.category_id = c.id OR s.sub_category_id = c.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM plugins p
            JOIN plugin_installs pi ON pi.plugin_id = p.id
            WHERE ('plugin:' || p.slug) = c.source
              AND pi.removed_at IS NULL
          )
      `;
      const rows = (db.sqlite.prepare(selectSql).all() ?? []) as Array<{ id: string; parent_id: string | null }>;
      if (!rows.length) return 0;

      // 子分类排在前面优先清理，避免外键或 anchor 约束问题
      rows.sort((a, b) => {
        const aIsChild = a.parent_id ? 1 : 0;
        const bIsChild = b.parent_id ? 1 : 0;
        return bIsChild - aIsChild;
      });

      const delStmt = db.sqlite.prepare("DELETE FROM categories WHERE id = ?");
      let count = 0;
      for (const row of rows) {
        delStmt.run(row.id);
        count++;
      }
      return count;
    }

    if (db.pg) {
      const selectSql = `
        SELECT c.id, c.parent_id FROM categories c
        WHERE c.source LIKE 'plugin:%'
          AND NOT EXISTS (
            SELECT 1 FROM sites s
            WHERE s.category_id = c.id OR s.sub_category_id = c.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM plugins p
            JOIN plugin_installs pi ON pi.plugin_id = p.id
            WHERE ('plugin:' || p.slug) = c.source
              AND pi.removed_at IS NULL
          )
      `;
      const res = await db.pg.query(selectSql);
      const rows = res.rows as Array<{ id: string; parent_id: string | null }>;
      if (!rows.length) return 0;
      rows.sort((a, b) => {
        const aIsChild = a.parent_id ? 1 : 0;
        const bIsChild = b.parent_id ? 1 : 0;
        return bIsChild - aIsChild;
      });
      for (const row of rows) {
        await db.pg.query("DELETE FROM categories WHERE id = $1", [row.id]);
      }
      return rows.length;
    }
    return 0;
  } catch (err) {
    console.error("[migrate] cleanupOrphanPluginCategories 异常:", err);
    return 0;
  }
}
