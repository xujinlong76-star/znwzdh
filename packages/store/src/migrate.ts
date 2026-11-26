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

import { canonicalizeUrl, categorySlug } from "@navhub/core";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
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
  // 执行代次 fencing：回收后重新认领会换 token，旧执行体不能再心跳或覆盖终态。
  { table: "jobs", column: "run_token", sqlite: "TEXT", pg: "TEXT" },
  { table: "categories", column: "source", sqlite: "TEXT", pg: "TEXT" },
  // 类目 URL 标识（/category/{slug}）。可空：历史行由 migrateCategorySlugs 回填，
  // 回填失败时读路径退回 id，不影响可用性。
  { table: "categories", column: "slug", sqlite: "TEXT", pg: "TEXT" },
  { table: "sites", column: "visit_count", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "INTEGER NOT NULL DEFAULT 0" },
  { table: "sites", column: "last_visited_at", sqlite: "INTEGER", pg: "BIGINT" },
  { table: "sites", column: "trend_score", sqlite: "REAL NOT NULL DEFAULT 0", pg: "DOUBLE PRECISION NOT NULL DEFAULT 0" },
  { table: "sites", column: "last_checked_at", sqlite: "INTEGER", pg: "BIGINT" },
  // 连续失败计数（03 §3.3，W1 §13 第 2 条 verdict ①）：sites 表内嵌列，
  // 由 updateSiteHealth 与 health 写回 + lastCheckedAt 同事务写。
  // 只改 CREATE TABLE / schema.ts 的话存量库永远缺列，所以 ALTER 必须同步登记。
  { table: "sites", column: "consecutive_failures", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "INTEGER NOT NULL DEFAULT 0" },
  { table: "sites", column: "deleted_at", sqlite: "INTEGER", pg: "BIGINT" },
  // 站点子类目指针：早期库没有这一列，而读路径（categorySiteCounts、
  // cleanupOrphanPluginCategories、dashboard 分布）都按双指针写 SQL ——
  // 缺列时这些语句直接抛 "no such column" 并被 catch 吞掉，
  // 等于旧部署的类目清扫从未生效。
  { table: "sites", column: "sub_category_id", sqlite: "TEXT", pg: "TEXT" },
  { table: "sites", column: "metadata", sqlite: "TEXT", pg: "TEXT" },
  { table: "users", column: "email", sqlite: "TEXT", pg: "TEXT" },
  { table: "users", column: "avatar", sqlite: "TEXT", pg: "TEXT" },
  // 通知链接（C-4）：通知体改成人话后，作者要点开能看到结果——outbox 与
  // notifications 各补一列 link（站内相对路径，如 /marketplace/<slug>）。
  // 只改 CREATE TABLE 的话存量库永远缺列，所以 ALTER 必须同步登记。
  { table: "notifications", column: "link", sqlite: "TEXT", pg: "TEXT" },
  { table: "notification_outbox", column: "link", sqlite: "TEXT", pg: "TEXT" },
  // 会话治理（T8）：sessions 激活为可吊销设备记录（列补齐走 ALTER，存量库平滑升级）
  { table: "sessions", column: "user_agent", sqlite: "TEXT", pg: "TEXT" },
  { table: "sessions", column: "revoked_at", sqlite: "INTEGER", pg: "BIGINT" },
  { table: "sessions", column: "last_seen_at", sqlite: "INTEGER", pg: "BIGINT" },
  // 用户级 API 令牌（T20）：owner_identity 非空 = 用户自建个人令牌
  { table: "api_tokens", column: "owner_identity", sqlite: "TEXT", pg: "TEXT" },
  // 收藏标签（T22）：JSON 字符串数组；契约与上限见 normalizeFavoriteTags
  { table: "favorites", column: "tags", sqlite: "TEXT", pg: "TEXT" },
  { table: "users", column: "source", sqlite: "TEXT NOT NULL DEFAULT 'local'", pg: "TEXT NOT NULL DEFAULT 'local'" },
  // 邮箱验证状态（注册/找回密码流程用）：0=未验证/待验证，1=已验证。
  // 老库补列默认 0：既有 OAuth/管理员行不会因为新流程被误判成「未验证」而无法登录。
  { table: "users", column: "email_verified", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "INTEGER NOT NULL DEFAULT 0" },
  // 口令版本：改密/重置时原子自增。登录 API 返回快照版本，NextAuth JWT 与
  // sessions/check 再消费它，关闭“旧密码已验证、重置后仍签发 30 天 JWT”的竞态。
  { table: "users", column: "password_version", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "INTEGER NOT NULL DEFAULT 0" },
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
  // 搜索历史作用域（U-374）：一次搜索当时生效的分类/标签/分面（JSON 串，
  // 编解码见 @navhub/core 的 search-scope.ts）。列 NOT NULL DEFAULT ''：
  // 旧行由本条 ALTER 补 ''（= 无作用域），读路径永远拿到字符串；
  // 只改 CREATE TABLE 的话存量库永远缺列，所以 ALTER 必须同步登记。
  { table: "search_history", column: "scope", sqlite: "TEXT NOT NULL DEFAULT ''", pg: "TEXT NOT NULL DEFAULT ''" },
  // 行为事件身份独立列（原藏在 meta JSON 里，LIKE 过滤走不了索引）。
  // 补齐后由 migrateEventIdentity 从 meta 回填历史行。
  { table: "events", column: "identity", sqlite: "TEXT", pg: "TEXT" },
  // 幂等键物化列（原只在 meta JSON 里，去重只能 LIKE 预筛 + 应用层解析）。
  // event_day 是 created_at 的日桶（created_at - created_at % 86400000 的商），
  // 与 event_id 一起进唯一索引：同一天同键只许一行，跨天复用视为新动作。
  // 历史行为 NULL，部分索引把它们排除在外（回填没有意义：老行本来就没有键）。
  { table: "events", column: "event_id", sqlite: "TEXT", pg: "TEXT" },
  { table: "events", column: "event_day", sqlite: "INTEGER", pg: "BIGINT" },
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
  // 评价「有用」投票计数（P2-3）：与 plugin_review_helpful_votes 行数同步维护
  { table: "plugin_reviews", column: "helpful_count", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "INTEGER NOT NULL DEFAULT 0" },
  // 禁用开关（D 批）：安装记录禁用时刻；NULL = 启用中（旧库启动时补列）
  { table: "plugin_installs", column: "disabled_at", sqlite: "INTEGER", pg: "BIGINT" },
  // 收藏同步换代（M1）：软删墓碑。硬删会让「删除」事件在增量同步里
  // 无处表达——客户端按 updated_at 拉增量时看不见任何痕迹，于是删除永不传播。
  { table: "favorites", column: "deleted_at", sqlite: "INTEGER", pg: "BIGINT" },
  { table: "user_settings", column: "preferences_json", sqlite: "TEXT NOT NULL DEFAULT '{}'", pg: "TEXT NOT NULL DEFAULT '{}'" },
  // 成本核算（2026-10-30）：调用时的按模型单价快照。
  // 可空是语义的一部分：老行 / 未配置单价的调用 = 成本未知，禁止回填成 0
  // （0 会被大盘当成「这次免费」，合计从此不可信）。
  { table: "llm_usage", column: "cost_rmb", sqlite: "REAL", pg: "DOUBLE PRECISION" },
  { table: "llm_usage", column: "prompt_price_per_1k", sqlite: "REAL", pg: "DOUBLE PRECISION" },
  { table: "llm_usage", column: "completion_price_per_1k", sqlite: "REAL", pg: "DOUBLE PRECISION" },
  { table: "llm_usage", column: "price_source", sqlite: "TEXT", pg: "TEXT" },
  // 热榜摘要（P0-1 步骤 A）：只存来源侧官方接口给的摘要原文（现阶段仅知乎
  // 返回 Summary）；其余五源不产摘要、旧行无摘要，一律 NULL，不回填。
  { table: "hotlist_entries", column: "summary", sqlite: "TEXT", pg: "TEXT" },
];

/**
 * 收敛 users.email 的重复值，为部分唯一索引 `users_email_unique_idx` 铺路。
 *
 * 背景：`users.email` 长期可重复（OAuth sync 曾按 email 绑定、也没有唯一约束），
 * 于是同一邮箱可能挂在多行上。一旦建唯一索引就会因为存量重复而**每次都失败**
 * （旧实现逐语句 try/catch 把失败吞掉 → 规则写在文档里、
 * 数据库不认的假绿灯）。所以先 dedupe，再建索引。
 *
 * 口径：
 * - 每个重复组保留 `created_at` 最早的一行（并列取 id 字典序最小）——那是账号的
 *   原始主人；其余行把 email 置 NULL，而不是删行（行上挂着收藏/画像/凭据，
 *   删行等于连带销毁数据）。
 * - `email = ''` 与 NULL 都属于「没有邮箱」，不参与去重（与部分索引条件一致）。
 * - 关键迁移：任何 SQL 错误都向外传播，由版本化事务整体回滚，不能返回 0 后写 applied。
 *
 * @returns 被清空 email 的行数
 */
export async function dedupeUserEmails(db: { dialect: string; sqlite?: any; pg?: any }): Promise<number> {
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

/**
 * 数据迁移专用事务：SQLite 复用同一连接，PostgreSQL 必须独占一个连接。
 *
 * 不能把 PostgreSQL 的 BEGIN / COMMIT 直接发给 pool：池可能把下一条语句分配到
 * 另一条连接，看起来“有事务”实际没有原子性。没有 connect() 的 pg 对象无法证明
 * 是独占客户端，因此失败关闭，而不是退化成半完成迁移。
 */
const MIGRATION_LOCK_KEY = "navhub:schema-migrations:v1";
const activeMigrationClients = new WeakSet<object>();
const activeMigrationSqlite = new AsyncLocalStorage<object>();

/**
 * 数据迁移专用事务 + 跨进程迁移锁。
 *
 * SQLite 用 BEGIN IMMEDIATE 在读取版本台账前取得写锁；PostgreSQL 用会话级
 * advisory lock（按 database + 固定 key 隔离），必须在独占连接上获取。锁必须先于
 * applied 台账查询，且与迁移、写台账处于同一事务；失败回滚后不会留下 applied。
 * PostgreSQL 的会话锁不随 ROLLBACK 释放，因此 finally 必须显式 unlock 再 release，
 * 否则带锁连接回到池里会拖死后续所有迁移。
 */
export async function withMigrationTransaction<T>(
  db: { dialect: string; sqlite?: any; pg?: any },
  action: (txDb: { dialect: string; sqlite?: any; pg?: any }) => Promise<T>,
): Promise<T> {
  if (db.dialect !== "pg" && db.sqlite) {
    const exec = async (sql: string): Promise<void> => {
      const maybe = db.sqlite.exec(sql);
      if (maybe && typeof maybe.then === "function") await maybe;
    };
    // 仅复用本 helper 在同一异步调用链中开启的事务；调用方自行 BEGIN 的 deferred
    // 事务可能尚未取得写锁，不能冒充已加锁迁移。并发顶层调用也会 fail-closed，
    // 而不是两个协程共用同一条 SQLite 连接的事务。
    if (db.sqlite.inTransaction === true) {
      if (activeMigrationSqlite.getStore() !== db.sqlite) {
        throw new Error("SQLite 数据迁移需要独立连接，不能复用调用方未加迁移锁的事务");
      }
      return action(db);
    }
    await exec("BEGIN IMMEDIATE");
    try {
      const result = await activeMigrationSqlite.run(db.sqlite, () => action(db));
      await exec("COMMIT");
      return result;
    } catch (err) {
      try { await exec("ROLLBACK"); } catch { /* preserve original error */ }
      throw err;
    }
  }

  if (db.pg) {
    // 版本化迁移器会把独占 client 传进来；嵌套迁移必须复用，不能再向 pool 取连接。
    if (activeMigrationClients.has(db.pg)) return action(db);
    if (typeof db.pg.connect !== "function") {
      throw new Error("PostgreSQL 数据迁移需要可获取独占连接的 pg.connect()");
    }
    const client = await db.pg.connect();
    activeMigrationClients.add(client);
    let locked = false;
    let unlocked = false;
    let discardClient = false;
    const unlockSql = "SELECT pg_advisory_unlock(hashtext(current_database()::text), hashtext($1))";
    const lockSql = "SELECT pg_advisory_lock(hashtext(current_database()::text), hashtext($1))";
    try {
      // 会话锁先于 BEGIN：即使数据库默认隔离级别是 REPEATABLE READ，也不会在
      // 等待锁期间固定事务快照，导致拿锁后仍看不到竞争进程刚提交的 applied 台账。
      await client.query(lockSql, [MIGRATION_LOCK_KEY]);
      locked = true;
      await client.query("BEGIN");
      const result = await action({ dialect: "pg", pg: client });
      // 必须先提交再解锁：若先 unlock，等待中的进程会拿到锁并读到旧事务提交前的
      // applied 台账，仍可能重复执行迁移。会话级 advisory lock 在 COMMIT 后仍持有。
      await client.query("COMMIT");
      await client.query(unlockSql, [MIGRATION_LOCK_KEY]);
      unlocked = true;
      return result;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
      throw err;
    } finally {
      if (locked && !unlocked) {
        try {
          await client.query(unlockSql, [MIGRATION_LOCK_KEY]);
          unlocked = true;
        } catch (unlockErr) {
          // 解锁失败时锁状态未知，绝不能把连接还给池子。PoolClient.release(error)
          // 在真实 pg 驱动中会销毁连接；支持 destroy() 的客户端则显式销毁。
          discardClient = true;
          try {
            const destroy = (client as unknown as { destroy?: () => void | Promise<void> }).destroy;
            if (typeof destroy === "function") {
              await destroy.call(client);
            } else {
              (client.release as unknown as (err: Error) => void)(
                unlockErr instanceof Error ? unlockErr : new Error(String(unlockErr)),
              );
            }
          } catch {
            // 销毁也失败时仍不回池；连接已不可安全复用，保留原始迁移/解锁错误。
          }
        }
      }
      activeMigrationClients.delete(client);
      if (!discardClient) client.release();
    }
  }

  throw new Error("数据迁移需要可用的 SQLite 或 PostgreSQL 连接");
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
 * 冲突键不能简单 DO NOTHING：目标行可能是迁移中断留下的旧快照，源行随后写入过
 * 更新内容。这里仅在源 `updated_at` 更大时覆盖目标；DELETE 还必须同时核对
 * payload 与时间戳，确保删除的确实是已经完整复制的那一份数据。
 *
 * 两条语句各自幂等：INSERT 后崩溃会留下源行，重跑补齐；DELETE 后崩溃源行已消失，
 * 重跑无操作。若目标与源内容不同且目标并不更旧，则保留源行并返回 skipped，
 * 等待人工合并，绝不静默丢弃任一版本。
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
       ON CONFLICT(user_id) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at
       WHERE user_workspace_blobs.updated_at < excluded.updated_at`;
  const deleteSql = `DELETE FROM user_vault_sync
       WHERE (user_id LIKE 'workspaces:%' OR user_id LIKE 'ws\\_members:%' ESCAPE '\\')
         AND payload IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM user_workspace_blobs b
           WHERE b.user_id = user_vault_sync.user_id
             AND b.payload = user_vault_sync.payload
             AND b.updated_at >= user_vault_sync.updated_at
         )`;
  const countSql = `SELECT COUNT(*) AS c FROM user_vault_sync
       WHERE (user_id LIKE 'workspaces:%' OR user_id LIKE 'ws\\_members:%' ESCAPE '\\')
         AND payload IS NOT NULL`;

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
    const copied = Math.max(0, before - remaining);
    if (remaining > 0) {
      // 内容冲突且无法证明目标至少一样新：保留源行，留下可查询的失败台账。
      // driver 每次启动都会无条件重跑本迁移，因此修复冲突后无需改台账版本。
      await recordMigrationFailure(
        db,
        "workspace_blobs_v1_conflict",
        new Error(`仍有 ${remaining} 条工作区源行与目标内容冲突，已保留源行`),
      );
      return { copied, skipped: true };
    }
    return { copied, skipped: false };
  } catch (err) {
    // INSERT 失败时不会执行 DELETE；错误必须传播，版本化事务才能回滚并拒绝写 applied。
    await recordMigrationFailure(db, "workspace_blobs_v1", err);
    throw err;
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
 *    建索引失败却仍把版本写成 applied。
 */
/**
 * 待找表（搜索容错纠错 · 出口一）：版本化迁移的执行体。
 * 与 migrateSiteIndexes 语句表里的同款 DDL 等价（新库由 driver.ts 建、
 * 旧库由语句表补，这里是台账可审计的版本化入口，三处幂等）。
 */
export async function migrateWantedSearches(db: { dialect: string; sqlite?: any; pg?: any }): Promise<void> {
  const stmts = [
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS wanted_searches (id TEXT PRIMARY KEY, identity TEXT NOT NULL, query TEXT NOT NULL, corrected_query TEXT, status TEXT NOT NULL DEFAULT 'open', notified_site_id TEXT, notified_at BIGINT, created_at BIGINT NOT NULL)"
      : "CREATE TABLE IF NOT EXISTS wanted_searches (id TEXT PRIMARY KEY, identity TEXT NOT NULL, query TEXT NOT NULL, corrected_query TEXT, status TEXT NOT NULL DEFAULT 'open', notified_site_id TEXT, notified_at INTEGER, created_at INTEGER NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS wanted_searches_identity_query_idx ON wanted_searches(identity, query)",
    "CREATE INDEX IF NOT EXISTS wanted_searches_identity_status_idx ON wanted_searches(identity, status, created_at)",
  ];
  for (const sql of stmts) await execSql(db, sql);
}

/**
 * 同步水位表（第 15 项：数据安全可见补完）。
 * 与 migrateWantedSearches 同款三处幂等：新库由 driver.ts 建、
 * 旧库由语句表补，这里是台账可审计的版本化入口。
 * 只记时间戳与有限枚举错误码，不记用户内容。
 */
export async function migrateUserSyncState(db: { dialect: string; sqlite?: any; pg?: any }): Promise<void> {
  const stmts = [
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS user_sync_state (identity TEXT NOT NULL, domain TEXT NOT NULL, last_success_at BIGINT, last_failure_at BIGINT, last_error_code TEXT, updated_at BIGINT NOT NULL, PRIMARY KEY (identity, domain))"
      : "CREATE TABLE IF NOT EXISTS user_sync_state (identity TEXT NOT NULL, domain TEXT NOT NULL, last_success_at INTEGER, last_failure_at INTEGER, last_error_code TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (identity, domain))",
  ];
  for (const sql of stmts) await execSql(db, sql);
}

/**
 * 采集来源注册表（采集运营页的来源管理）：新库由 driver.ts 建，
 * 旧库由此版本化迁移补，与 driver 的 SQLite/PG DDL 同构且全部幂等。
 * 字段与前端 Source 类型逐项对应（snake_case 存、camelCase 出）。
 */
export async function migrateCrawlSources(db: { dialect: string; sqlite?: any; pg?: any }): Promise<void> {
  const time = db.dialect === "pg" ? "BIGINT" : "INTEGER";
  const stmts = [
    `CREATE TABLE IF NOT EXISTS crawl_sources (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'sitemap',
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      interval_ms ${time} NOT NULL DEFAULT 3600000,
      next_run_at ${time} NOT NULL,
      last_run_at ${time},
      last_status TEXT,
      last_error TEXT,
      created_at ${time} NOT NULL,
      updated_at ${time} NOT NULL
    )`,
    "CREATE UNIQUE INDEX IF NOT EXISTS crawl_sources_url_idx ON crawl_sources(url)",
    "CREATE INDEX IF NOT EXISTS crawl_sources_enabled_next_idx ON crawl_sources(enabled, next_run_at)",
  ];
  for (const sql of stmts) await execSql(db, sql);
}

/**
 * 采集治理（候选队列 / AI 审核账本 / 双人金标）建表。
 * 对应历史版本 bc9bf4bf / 8bf7b5a2 的 DDL，因仓储模块回归而重新接入；
 * crawl_sources 已由 migrateCrawlSources 单独建表，此处不重复。
 * 全部 IF NOT EXISTS + 版本台账，重复启动安全。
 */
export async function migrateCrawlGovernanceTables(db: { dialect: string; sqlite?: any; pg?: any }): Promise<void> {
  const stmts = [
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
    `CREATE TABLE IF NOT EXISTS site_discovery_candidates (
      id TEXT PRIMARY KEY, url TEXT NOT NULL, canonical_url TEXT NOT NULL UNIQUE,
      title TEXT, description TEXT, category_id TEXT, tags_json TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL, confidence DOUBLE PRECISION, evidence_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      site_id TEXT, discovered_at BIGINT NOT NULL, last_seen_at BIGINT NOT NULL,
      reviewed_at BIGINT, reviewed_by TEXT, rejection_reason TEXT, updated_at BIGINT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS site_discovery_candidates_status_idx ON site_discovery_candidates(status, discovered_at)",
    "CREATE INDEX IF NOT EXISTS site_discovery_candidates_site_idx ON site_discovery_candidates(site_id)",
    `CREATE TABLE IF NOT EXISTS crawl_ai_moderation_decisions (
      id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL,
      decision_source TEXT NOT NULL CHECK (decision_source IN ('ai','human')),
      mode TEXT NOT NULL, status TEXT NOT NULL, verdict TEXT,
      confidence DOUBLE PRECISION, quality_score INTEGER,
      risks_json TEXT NOT NULL DEFAULT '[]', reasons_json TEXT NOT NULL DEFAULT '[]',
      model TEXT, policy_version TEXT, actor TEXT, created_at BIGINT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS crawl_ai_decisions_candidate_idx ON crawl_ai_moderation_decisions(candidate_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS crawl_ai_decisions_time_idx ON crawl_ai_moderation_decisions(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS crawl_ai_decisions_source_idx ON crawl_ai_moderation_decisions(decision_source, created_at DESC)",
    `CREATE TABLE IF NOT EXISTS crawl_moderation_gold_cases (
      id TEXT PRIMARY KEY, source_fingerprint TEXT NOT NULL,
      title TEXT, description TEXT, category TEXT, sanitized_excerpt TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','annotating','needs_adjudication','gold_ready')),
      final_label TEXT CHECK (final_label IS NULL OR final_label IN ('approve','reject','review')),
      final_risk BOOLEAN, adjudicator_id TEXT, adjudication_reason TEXT,
      created_by TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, adjudicated_at BIGINT
    )`,
    `CREATE TABLE IF NOT EXISTS crawl_moderation_gold_annotations (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES crawl_moderation_gold_cases(id) ON DELETE CASCADE,
      annotator_id TEXT NOT NULL, label TEXT NOT NULL CHECK (label IN ('approve','reject','review')),
      risk BOOLEAN NOT NULL, evidence TEXT NOT NULL, created_at BIGINT NOT NULL,
      UNIQUE(case_id, annotator_id)
    )`,
    "CREATE INDEX IF NOT EXISTS crawl_gold_cases_status_idx ON crawl_moderation_gold_cases(status, created_at)",
    "CREATE INDEX IF NOT EXISTS crawl_gold_annotations_case_idx ON crawl_moderation_gold_annotations(case_id, created_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS crawl_gold_candidate_source_unique_idx ON crawl_moderation_gold_cases(source_fingerprint) WHERE source_fingerprint LIKE 'candidate:%'",
    `CREATE TABLE IF NOT EXISTS crawl_moderation_gold_assignments (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES crawl_moderation_gold_cases(id) ON DELETE CASCADE,
      annotator_id TEXT NOT NULL, slot INTEGER NOT NULL CHECK (slot IN (1,2)),
      status TEXT NOT NULL CHECK (status IN ('claimed','completed','expired')),
      lease_expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL, claimed_at BIGINT NOT NULL, completed_at BIGINT
    )`,
    "CREATE INDEX IF NOT EXISTS crawl_gold_assignments_annotator_idx ON crawl_moderation_gold_assignments(annotator_id,status,lease_expires_at)",
    "CREATE INDEX IF NOT EXISTS crawl_gold_assignments_case_idx ON crawl_moderation_gold_assignments(case_id,status,slot)",
    "CREATE UNIQUE INDEX IF NOT EXISTS crawl_gold_assignments_active_slot_idx ON crawl_moderation_gold_assignments(case_id,slot) WHERE status='claimed'",
    "CREATE UNIQUE INDEX IF NOT EXISTS crawl_gold_assignments_active_annotator_idx ON crawl_moderation_gold_assignments(case_id,annotator_id) WHERE status='claimed'",
    `CREATE TABLE IF NOT EXISTS crawl_moderation_model_evaluations (
      id TEXT PRIMARY KEY, model TEXT NOT NULL, dataset_version TEXT NOT NULL,
      sample_size INTEGER NOT NULL, metrics_json TEXT NOT NULL,
      created_by TEXT NOT NULL, created_at BIGINT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS crawl_moderation_model_eval_model_idx ON crawl_moderation_model_evaluations(model,created_at DESC)",
    "CREATE INDEX IF NOT EXISTS crawl_moderation_model_eval_dataset_idx ON crawl_moderation_model_evaluations(dataset_version,created_at DESC)",
  ];
  for (const sql of stmts) await execSql(db, sql);
}

/**
 * 站点纠错上报（site_reports）与投稿收录汇报（submission_reviews）建表 DDL。
 *
 * 为什么抽出来单独版本化（2026-11-24）：这两张表的 DDL 曾被**追加**进
 * 20261015_site_indexes 的语句表——该版本在存量库上早已记账完成，追加的语句
 * 永远不会执行。实测 data/navhub.db 缺这两张表，/api/admin/site-reports 直接 500、
 * 投稿汇报读写全挂。版本化迁移只认「新版本号」，所以这里一表一码：
 * 语句表里只留展开引用，真相在本常量，由 20261124_site_reports_and_reviews 执行。
 */
export const SITE_REPORTS_AND_REVIEWS_DDL: string[] = [
  // 投稿收录汇报（提交后网址收录情况）：审核通过/未通过都留一条「状态 + AI 原因
  // 说明」，用户在反馈目录看自己的投稿结果。reason 是 AI 生成的面向投稿人的说明
  // （通过=亮点与收录理由，未通过=具体改进建议），reviewer_note 是管理员原始备注。
  // 审核可复审（先拒后过），本表按 site_id 一行、每次审核覆盖写（最新结果即汇报）。
  "CREATE TABLE IF NOT EXISTS submission_reviews (site_id TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE, review_status TEXT NOT NULL CHECK (review_status IN ('approved', 'rejected')), reason TEXT NOT NULL DEFAULT '', reviewer_note TEXT, reviewed_at BIGINT NOT NULL, created_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS submission_reviews_reviewed_at_idx ON submission_reviews(reviewed_at DESC)",
  // 站点纠错上报（升级第 10 条）：匿名可报，不设登录门槛；上报只进复核队列，
  // 绝不直接改数据。kinds 存 JSON 字符串（与 jobs.payload 同口径，TEXT 双库通用）；
  // status 流转 open → in_progress → resolved / rejected，只走管理员 PATCH。
  `CREATE TABLE IF NOT EXISTS site_reports (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    kinds TEXT NOT NULL,
    detail TEXT NOT NULL,
    contact TEXT,
    source TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'rejected')),
    created_at BIGINT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS site_reports_site_idx ON site_reports(site_id)",
  "CREATE INDEX IF NOT EXISTS site_reports_status_created_idx ON site_reports(status, created_at DESC, id DESC)",
];

/**
 * 巡检三条热查询的专用索引（未探测队列 / 复核队列 / 覆盖聚合）：
 *   WHERE deleted_at IS NULL AND enabled = <lit> AND last_checked_at IS [NOT] NULL
 *   ORDER BY created_at ASC / last_checked_at ASC
 *
 * 2026-11-26：这条 DDL 原先只写在 migrateSiteIndexes 的语句表里，而那个函数挂在
 * 已记账的 20261015_site_indexes 下 —— 存量库永远不会再跑，索引实际缺失
 * （daily health_check 全表扫 + 临时 B-tree）。现由版本 20261126_sites_patrol_idx
 * 单独补建；本常量是唯一真相，两处共用。
 */
export const SITES_PATROL_INDEX_DDL =
  "CREATE INDEX IF NOT EXISTS sites_patrol_idx ON sites(deleted_at, enabled, last_checked_at, created_at)";

/** 补建 sites_patrol_idx（存量库追加过 DDL 的救场迁移）。 */
export async function migrateSitesPatrolIndex(db: { dialect: string; sqlite?: any; pg?: any }): Promise<void> {
  await execSql(db, SITES_PATROL_INDEX_DDL);
}

/**
 * sub_category_id 索引（2026-11-27 性能审计 P0-3）。
 * dashboard 分类分布与插件占用检查的 OR 谓词 (category_id=? OR sub_category_id=?)
 * 因 sub_category_id 无索引而全表扫；新库由 schema.ts 建，存量库由本版本补建。
 */
export const SITES_SUB_CATEGORY_INDEX_DDL =
  "CREATE INDEX IF NOT EXISTS sites_sub_category_idx ON sites(sub_category_id)";

export async function migrateSitesSubCategoryIndex(db: { dialect: string; sqlite?: any; pg?: any }): Promise<void> {
  await execSql(db, SITES_SUB_CATEGORY_INDEX_DDL);
}

/** 补建 site_reports / submission_reviews（存量库追加过 DDL 的救场迁移）。 */
export async function migrateSiteReportsAndReviews(db: { dialect: string; sqlite?: any; pg?: any }): Promise<void> {
  for (const sqlText of SITE_REPORTS_AND_REVIEWS_DDL) await execSql(db, sqlText);
}

export async function migrateSiteIndexes(db: { dialect: string; sqlite?: any; pg?: any }): Promise<void> {
  await ensureMigrationFailures(db);
  /**
   * sites.url 的唯一索引换名：**先建后删，且只有建成功才删旧索引**。
   *
   * 索引名改为 v2 是刻意的——旧名可能被部署脚本引用，直接复用会让「是否已建」
   * 无法判断；新名 + IF NOT EXISTS 天然幂等。
   *
   * 这两句必须保持严格的先建后删顺序：CREATE 失败时直接抛出，DROP 不会执行，
   * 外层事务回滚，旧索引与 applied 台账都不会被破坏。
   */
  const createSitesUrlUnique =
    "CREATE UNIQUE INDEX IF NOT EXISTS sites_url_uniq_v2 ON sites(url) WHERE deleted_at IS NULL";
  // 先建后删：CREATE 失败时直接抛出，旧索引仍在，DROP 也不会执行。
  await execSql(db, createSitesUrlUnique);
  await execSql(db, "DROP INDEX IF EXISTS sites_url_idx");
  const statements = [
    "CREATE INDEX IF NOT EXISTS sites_deleted_at_idx ON sites(deleted_at) WHERE deleted_at IS NOT NULL",
    // 存储层补索引（旧库补齐；幂等 IF NOT EXISTS；与 driver.ts DDL 保持一致）
    "CREATE INDEX IF NOT EXISTS sites_source_status_idx ON sites(source, status)",
    "CREATE INDEX IF NOT EXISTS sites_hot_idx ON sites(enabled, trend_score DESC)",
    // 检索主路径复合索引（browse / 类目页 / 标签页）。
    // 为什么必须有：所有检索都先过 `enabled = ? AND deleted_at IS NULL`，而老的
    // sites_hot_idx 只有 (enabled, trend_score)，既缺 deleted_at 也让 browse 的
    // ORDER BY featured DESC, trend_score DESC 无法用它排序 —— 类目页/标签页实际
    // 走的是全表扫 + 临时 B-tree 排序，库一大就体现在首字节时间上。
    // 列序按「等值过滤 → 排序」排：deleted_at / enabled 是等值，featured 与
    // trend_score 是排序键，因此放在后面并带 DESC，与 browse 的 ORDER BY 同向，
    //  planner 可以直接顺序读索引、省掉排序步骤。
    "CREATE INDEX IF NOT EXISTS sites_browse_idx ON sites(deleted_at, enabled, featured DESC, trend_score DESC)",
    // 同上，但覆盖「按状态过滤」的分支（browse 带 statuses 参数、以及只按
    // enabled/deleted_at/status 计数/列举的仓储方法）。status 是等值过滤，
    // 放在两个等值键之后即可；不带排序键，因为它在这条路径上不参与排序。
    "CREATE INDEX IF NOT EXISTS sites_enabled_status_idx ON sites(deleted_at, enabled, status)",
    // 巡检三条热查询的专用索引（未探测队列 / 复核队列 / 覆盖聚合）：
    //   WHERE deleted_at IS NULL AND enabled = <lit> AND last_checked_at IS [NOT] NULL
    //   ORDER BY created_at ASC / last_checked_at ASC
    // 此前没有匹配索引 → daily health_check 每次对全库全表扫 + 临时 B-tree 排序。
    // 列序＝「等值过滤(deleted_at, enabled) → 巡检键(last_checked_at) → 排序键(created_at)」：
    // 未探测分支（last_checked_at IS NULL）与复核分支（IS NOT NULL）都能吃到该索引，
    // 覆盖聚合只读前缀列即可。last_checked_at 属较新列，不能进 driver.ts DDL
    //（老库整个 exec 会因 "no such column" 失败），所以只走迁移：
    // 新库由本函数建，存量库由版本 20261126_sites_patrol_idx 补建
    //（这条追加在已记账的 20261015 版本里，老库不会再跑）。
    SITES_PATROL_INDEX_DDL,
    // 邮箱唯一（部分索引：NULL 与空串都不进索引，等于「没有邮箱」不互斥）。
    // 必须晚于 dedupeUserEmails —— 存量重复会让 CREATE UNIQUE INDEX 直接失败，
    // 失败会中止迁移并回滚，不会把未建约束的版本写成 applied。
    "CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users(email) WHERE email IS NOT NULL AND email <> ''",
    "CREATE INDEX IF NOT EXISTS events_search_idx ON events(kind, created_at, query)",
    "CREATE INDEX IF NOT EXISTS search_history_user_created_idx ON search_history(user_id, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS favorites_user_created_idx ON favorites(user_id, created_at DESC)",
    // 增量同步游标：WHERE user_id = ? AND updated_at > ? 的主路径
    "CREATE INDEX IF NOT EXISTS favorites_user_updated_idx ON favorites(user_id, updated_at)",
    "CREATE INDEX IF NOT EXISTS events_identity_created_idx ON events(identity, created_at)",
    // 幂等键的硬约束：LIKE 预筛是快速路径，并发重放/预筛异常时由这条部分唯一索引兜底。
    // 参与键的 site_id 为 NULL 时（非站点类事件）各方言的唯一索引都不互斥——这是刻意的：
    // 没有 siteId 就没有「同一站点的重复点击」语义，交给应用层判断。
    "CREATE UNIQUE INDEX IF NOT EXISTS events_event_id_uniq ON events(kind, site_id, event_id, event_day) WHERE event_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS plugins_owner_identity_idx ON plugins(owner_identity)",
    "CREATE INDEX IF NOT EXISTS health_checks_checked_idx ON health_checks(checked_at)",
    "CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action, id DESC)",
    // 任务历史翻页（P1-7）：GET /api/jobs 的 ORDER BY created_at DESC, id DESC
    // 此前没有匹配索引，全表读 + 临时排序；两个键与排序逐列同向，可顺序扫描到
    // LIMIT/OFFSET 即停。带 status 的查询走复合索引，避免先按时间扫再丢弃非目标状态。
    "CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs(created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS jobs_status_created_idx ON jobs(status, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS collection_items_site_idx ON collection_items(site_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS site_tags_unique_idx ON site_tags(site_id, tag_id)",
    // 用户中心设置（画像开关 / 收藏信号清理水位）：旧库补齐，新库由 driver.ts DDL 建
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS user_settings (identity TEXT PRIMARY KEY, personalization_enabled INTEGER NOT NULL DEFAULT 1, favorite_signal_cutoff BIGINT NOT NULL DEFAULT 0, preferences_json TEXT NOT NULL DEFAULT '{}', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)"
      : "CREATE TABLE IF NOT EXISTS user_settings (identity TEXT PRIMARY KEY, personalization_enabled INTEGER NOT NULL DEFAULT 1, favorite_signal_cutoff INTEGER NOT NULL DEFAULT 0, preferences_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    // 用户自定义站点（用户中心「我的站点」）：旧库补齐，新库由 driver.ts DDL 建
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS user_custom_sites (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, note TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)"
      : "CREATE TABLE IF NOT EXISTS user_custom_sites (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, note TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS user_custom_sites_user_idx ON user_custom_sites(user_id, sort_order, created_at)",
    // 待找（搜索容错纠错 · 出口一）：旧库补齐，新库由 driver.ts DDL 建
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS wanted_searches (id TEXT PRIMARY KEY, identity TEXT NOT NULL, query TEXT NOT NULL, corrected_query TEXT, status TEXT NOT NULL DEFAULT 'open', notified_site_id TEXT, notified_at BIGINT, created_at BIGINT NOT NULL)"
      : "CREATE TABLE IF NOT EXISTS wanted_searches (id TEXT PRIMARY KEY, identity TEXT NOT NULL, query TEXT NOT NULL, corrected_query TEXT, status TEXT NOT NULL DEFAULT 'open', notified_site_id TEXT, notified_at INTEGER, created_at INTEGER NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS wanted_searches_identity_query_idx ON wanted_searches(identity, query)",
    "CREATE INDEX IF NOT EXISTS wanted_searches_identity_status_idx ON wanted_searches(identity, status, created_at)",
    // 同步水位（第 15 项）：旧库补齐，新库由 driver.ts DDL 建
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS user_sync_state (identity TEXT NOT NULL, domain TEXT NOT NULL, last_success_at BIGINT, last_failure_at BIGINT, last_error_code TEXT, updated_at BIGINT NOT NULL, PRIMARY KEY (identity, domain))"
      : "CREATE TABLE IF NOT EXISTS user_sync_state (identity TEXT NOT NULL, domain TEXT NOT NULL, last_success_at INTEGER, last_failure_at INTEGER, last_error_code TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (identity, domain))",
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
      ? "CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, identity TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, read_at BIGINT, created_at BIGINT NOT NULL)"
      : "CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, identity TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, read_at INTEGER, created_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS notifications_identity_created_idx ON notifications(identity, created_at)",
    // Outbox 由幂等启动迁移补齐；BIGINT 在 SQLite 中同样为整数亲和性。
    `CREATE TABLE IF NOT EXISTS notification_outbox (
      id TEXT PRIMARY KEY, identity TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('inapp', 'email', 'push')),
      kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'deferred', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
      next_attempt_at BIGINT, last_error TEXT, created_at BIGINT NOT NULL, delivered_at BIGINT
    )`,
    "CREATE INDEX IF NOT EXISTS notification_outbox_due_idx ON notification_outbox(next_attempt_at, created_at, id) WHERE status = 'pending' AND channel = 'inapp'",
    "CREATE INDEX IF NOT EXISTS notification_outbox_created_idx ON notification_outbox(created_at DESC, id DESC)",
    // 认证令牌表：邮箱验证 + 密码重置共用一张表，purpose 区分。
    // 只存 token_hash（sha256），明文令牌仅在生成时返回一次；单用途、可消费、带过期。
    `CREATE TABLE IF NOT EXISTS auth_tokens (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
      token_hash TEXT NOT NULL,
      expires_at BIGINT NOT NULL, consumed_at BIGINT, created_at BIGINT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose_idx ON auth_tokens(user_id, purpose, created_at)",
    "CREATE INDEX IF NOT EXISTS auth_tokens_hash_idx ON auth_tokens(token_hash)",
    "CREATE TABLE IF NOT EXISTS submission_owners (site_id TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE, identity TEXT NOT NULL, created_at BIGINT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS submission_owners_identity_idx ON submission_owners(identity)",
    ...SITE_REPORTS_AND_REVIEWS_DDL,
    "CREATE INDEX IF NOT EXISTS api_tokens_owner_idx ON api_tokens(owner_identity)",
    // 收藏域补索引：`WHERE site_id = ?`（站点详情/清理）与 `WHERE user_id=? AND folder_id=?`
    // （收藏夹视图）此前只能走 user_id 单列索引或全表扫。
    "CREATE INDEX IF NOT EXISTS favorites_site_idx ON favorites(site_id)",
    "CREATE INDEX IF NOT EXISTS favorites_user_folder_idx ON favorites(user_id, folder_id)",
    // 标签概念别名索引
    "CREATE INDEX IF NOT EXISTS tag_aliases_tag_idx ON tag_aliases(tag_id)",
    // tags.name 索引 + 唯一。
    // 为什么需要：整仓只有 tags_slug_idx(slug) 唯一索引，而 `WHERE name = ?` 是
    //  查询扩展（resolveTag）、listTags 的 GROUP BY、addTagAlias 的冲突检查、
    //  browse 的标签过滤子查询的高频路径 —— 没有索引时每一条都是 tags 全表扫。
    // 为什么唯一：name 与 slug 同为「标签的身份」，两个不一致的约束会出现
    //  「slug 唯一但 name 重复」的脏结果（同一个名字解析到两个 id）。
    // 建不上（存量重复）时按本表的既定口径处理：留痕到 migration_failures，
    //  不阻断启动，下次启动再试 —— 所以**必须先建非唯一索引再建唯一索引**：
    //  唯一索引失败时，非唯一那条仍然把这几条查询从全表扫变成索引查找。
    "CREATE INDEX IF NOT EXISTS tags_name_idx ON tags(name)",
    "CREATE UNIQUE INDEX IF NOT EXISTS tags_name_uniq ON tags(name)",
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
      ? "CREATE TABLE IF NOT EXISTS plugin_installs (plugin_id TEXT NOT NULL, identity TEXT NOT NULL, version TEXT NOT NULL, meta TEXT, installed_at BIGINT NOT NULL, removed_at BIGINT, disabled_at BIGINT, PRIMARY KEY (plugin_id, identity))"
      : "CREATE TABLE IF NOT EXISTS plugin_installs (plugin_id TEXT NOT NULL, identity TEXT NOT NULL, version TEXT NOT NULL, meta TEXT, installed_at INTEGER NOT NULL, removed_at INTEGER, disabled_at INTEGER, PRIMARY KEY (plugin_id, identity))",
    "CREATE INDEX IF NOT EXISTS plugin_installs_plugin_idx ON plugin_installs(plugin_id)",
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS plugin_stars (plugin_id TEXT NOT NULL, identity TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY (plugin_id, identity))"
      : "CREATE TABLE IF NOT EXISTS plugin_stars (plugin_id TEXT NOT NULL, identity TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (plugin_id, identity))",
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS plugin_reports (plugin_id TEXT NOT NULL, identity TEXT NOT NULL, ip TEXT, reason TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL, PRIMARY KEY (plugin_id, identity))"
      : "CREATE TABLE IF NOT EXISTS plugin_reports (plugin_id TEXT NOT NULL, identity TEXT NOT NULL, ip TEXT, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY (plugin_id, identity))",
    "CREATE INDEX IF NOT EXISTS plugin_reports_plugin_idx ON plugin_reports(plugin_id)",
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS plugin_review_reports (review_id TEXT NOT NULL, identity TEXT NOT NULL, ip TEXT, reason TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL, PRIMARY KEY (review_id, identity))"
      : "CREATE TABLE IF NOT EXISTS plugin_review_reports (review_id TEXT NOT NULL, identity TEXT NOT NULL, ip TEXT, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY (review_id, identity))",
    "CREATE INDEX IF NOT EXISTS plugin_review_reports_review_idx ON plugin_review_reports(review_id)",
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS plugin_review_helpful_votes (review_id TEXT NOT NULL, identity TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY (review_id, identity))"
      : "CREATE TABLE IF NOT EXISTS plugin_review_helpful_votes (review_id TEXT NOT NULL, identity TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (review_id, identity))",
    "CREATE INDEX IF NOT EXISTS plugin_review_helpful_votes_review_idx ON plugin_review_helpful_votes(review_id)",
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS plugin_versions (id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL, changelog TEXT, checksum TEXT NOT NULL, published_at BIGINT NOT NULL, created_at BIGINT NOT NULL, UNIQUE(plugin_id, version))"
      : "CREATE TABLE IF NOT EXISTS plugin_versions (id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL, changelog TEXT, checksum TEXT NOT NULL, published_at INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(plugin_id, version))",
    "CREATE INDEX IF NOT EXISTS plugin_versions_plugin_idx ON plugin_versions(plugin_id)",
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS plugin_reviews (id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, identity TEXT NOT NULL, rating INTEGER NOT NULL, title TEXT, content TEXT, installed_version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'visible', report_count INTEGER NOT NULL DEFAULT 0, moderation_note TEXT, moderated_at BIGINT, moderated_by TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, UNIQUE(plugin_id, identity))"
      : "CREATE TABLE IF NOT EXISTS plugin_reviews (id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, identity TEXT NOT NULL, rating INTEGER NOT NULL, title TEXT, content TEXT, installed_version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'visible', report_count INTEGER NOT NULL DEFAULT 0, moderation_note TEXT, moderated_at INTEGER, moderated_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(plugin_id, identity))",
    "CREATE INDEX IF NOT EXISTS plugin_reviews_plugin_idx ON plugin_reviews(plugin_id)",
    "CREATE INDEX IF NOT EXISTS plugin_reviews_status_idx ON plugin_reviews(status)",
    // 作者档案（D 批）：owner_key 主键；作者本人维护，注销时随账号删除（见 data-inventory 登记）
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS plugin_author_profiles (owner_key TEXT PRIMARY KEY, display_name TEXT, bio TEXT, avatar TEXT, links TEXT NOT NULL DEFAULT '{}', donate_url TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)"
      : "CREATE TABLE IF NOT EXISTS plugin_author_profiles (owner_key TEXT PRIMARY KEY, display_name TEXT, bio TEXT, avatar TEXT, links TEXT NOT NULL DEFAULT '{}', donate_url TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
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
    // 分模型单价簿（2026-10-30）：按模型 + 输入/输出分开报价，写入时快照进 llm_usage。
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS llm_model_prices (model TEXT PRIMARY KEY, prompt_per_1k_rmb DOUBLE PRECISION NOT NULL, completion_per_1k_rmb DOUBLE PRECISION NOT NULL, updated_at BIGINT NOT NULL)"
      : "CREATE TABLE IF NOT EXISTS llm_model_prices (model TEXT PRIMARY KEY, prompt_per_1k_rmb REAL NOT NULL, completion_per_1k_rmb REAL NOT NULL, updated_at INTEGER NOT NULL)",
    // LLM 配额预留（P0-3，2026-10-30）：额度闸门从「先查后写」改成「事务内查+占位」。
    // 老库必须有这张表，否则 reserveLlmQuota 的 INSERT 直接抛 no such table——
    // 而它落在闸门里，等于全站 AI 入口同时挂掉。
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS llm_quota_reservations (id TEXT PRIMARY KEY, identity TEXT, source TEXT NOT NULL DEFAULT 'system', reserved_calls INTEGER NOT NULL DEFAULT 1, reserved_tokens INTEGER NOT NULL DEFAULT 0, expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL)"
      : "CREATE TABLE IF NOT EXISTS llm_quota_reservations (id TEXT PRIMARY KEY, identity TEXT, source TEXT NOT NULL DEFAULT 'system', reserved_calls INTEGER NOT NULL DEFAULT 1, reserved_tokens INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS llm_quota_res_expiry_idx ON llm_quota_reservations(expires_at)",
    "CREATE INDEX IF NOT EXISTS llm_quota_res_identity_idx ON llm_quota_reservations(identity, expires_at)",
    "CREATE INDEX IF NOT EXISTS llm_quota_res_source_idx ON llm_quota_reservations(source, expires_at)",
    // 分享短链：只存内部 /marketplace/ 目标（防开放重定向）
    db.dialect === "pg"
      ? "CREATE TABLE IF NOT EXISTS short_links (code TEXT PRIMARY KEY, target TEXT NOT NULL, plugin_slug TEXT, clicks INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL)"
      : "CREATE TABLE IF NOT EXISTS short_links (code TEXT PRIMARY KEY, target TEXT NOT NULL, plugin_slug TEXT, clicks INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)",
  ];
  for (const sqlText of statements) {
    // 所有 schema 语句都是关键迁移；失败必须中止并由外层事务整体回滚，
    // 不能留痕后继续，否则外层仍会把失败版本写成 applied。
    await execSql(db, sqlText);
  }

  // 存量搬迁单独执行：DELETE 带 EXISTS 守卫，INSERT 失败时不会误删源数据。
  await migrateWorkspaceBlobs(db);

  // 导航版本号触发器（P1-1）：与索引同属关键 schema，失败由外层整体回滚。
  await migrateNavVersionTriggers(db);
}

/**
 * 快照版本号触发器覆盖的表（= 导航快照的全部数据来源）。
 *
 * 加表要同时改这里：读侧的探针按名字逐个核对，缺一个就在 /api/health 里点名，
 * 不会出现「新增了数据来源却静默不失效」。
 */
export const NAV_VERSION_TRIGGER_TABLES = ["sites", "categories", "tags", "site_tags", "site_facets"] as const;
/** 每张表三个单事件触发器（见下方「为什么不是一条 INSERT OR UPDATE OR DELETE」） */
export const NAV_VERSION_TRIGGER_EVENTS = ["insert", "update", "delete"] as const;

/** 触发器命名约定：`nav_version_<表名>_<事件>`（探针与测试都按 `nav_version_%` 匹配） */
export function navVersionTriggerName(table: string, event: string): string {
  return "nav_version_" + table + "_" + event;
}

/** 探针要核对的全部触发器名（读侧与测试共用同一份清单，不在两边各数一遍） */
export function navVersionTriggerNames(): string[] {
  const out: string[] = [];
  for (const table of NAV_VERSION_TRIGGER_TABLES) {
    for (const event of NAV_VERSION_TRIGGER_EVENTS) out.push(navVersionTriggerName(table, event));
  }
  return out;
}

/**
 * 为什么用触发器，而不是「写侧记得把 version +1」：
 *
 * 版本号的唯一用途是让快照缓存失效**不可能被漏掉**。站点/类目/标签的写入口有 40+ 处
 * （仓储方法、后台健康检查与热度重算、快照写回、运维脚本、测试直写数据库），
 * 漏掉一处不是「变慢」，而是「旧快照继续喂给读-改-写的写侧」——快照里没有 = 用户删了，
 * 后果是数据丢失。把递增交给数据库，绕过仓储的直接写一样会被记到。
 *
 * 方言差异与形态选择：
 *   - 一张表**三个单事件触发器**，而不是一条 `AFTER INSERT OR UPDATE OR DELETE`：
 *     本机 better-sqlite3（SQLite 3.53）对触发器的多事件列表直接报
 *     `near "OR": syntax error`（`fts.ts` 的既有触发器同样一事件一个），PG 才支持。
 *     两侧统一成单事件形态，探针与测试才能共用同一份名字清单，不必按方言分叉。
 *   - SQLite 只有行级触发器（没有 FOR EACH STATEMENT），批量写逐行 +1。语义仍然正确
 *     （变大就算变过）。实测 8000 站批量写 92ms → 137ms（约 2.8µs/次），
 *     相对 P1-2 的 5s 保存预算可忽略，换来的是「写侧不可能漏」。
 *   - PostgreSQL 用语句级触发器 + plpgsql 函数：一条语句只 +1，
 *     既省掉大事务里的逐行开销，也让 data_version 那一行的行锁只获取一次。
 *
 * 试过「按秒去重」（`WHERE <本秒> <> updated_at`）来省掉逐行开销： unsafe ——
 * 同一秒内的第二次写不会 bump，缓存就带着上一份数据继续命中，正是要防的丢数据。
 *
 * 触发器是缓存失效正确性的关键迁移：建失败必须向外传播并整体回滚，不能写 applied。
 * 未升级完成的库不会带着缺失触发器的半状态启动；读侧探针仍用于诊断外部改库。
 */
export async function migrateNavVersionTriggers(db: { dialect: string; sqlite?: any; pg?: any }): Promise<void> {
  const isPg = db.dialect === "pg";
  const statements: string[] = [];

  if (isPg) {
    // 函数体每次启动覆盖（CREATE OR REPLACE）：bump 语句改了不需要重命名触发器。
    statements.push(
      "CREATE OR REPLACE FUNCTION navhub_bump_data_version() RETURNS trigger LANGUAGE plpgsql AS $$\n" +
        "BEGIN\n  UPDATE data_version SET version = version + 1 WHERE id = 1;\n  RETURN NULL;\nEND\n$$",
    );
  }

  for (const table of NAV_VERSION_TRIGGER_TABLES) {
    for (const event of NAV_VERSION_TRIGGER_EVENTS) {
      const name = navVersionTriggerName(table, event);
      const keyword = event.toUpperCase();
      if (isPg) {
        // 只在「名字不存在」时创建：不用 DROP + CREATE，因为两条 autocommit 语句之间
        // 会留下「触发器不在」的空窗，而另一个实例正在写库——空窗里的那次写永远不会被记到。
        // 改了触发器的**定义**时按索引 v2 的惯例换名，让新名重建。
        statements.push(
          "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid " +
            "WHERE t.tgname = '" +
            name +
            "' AND c.relname = '" +
            table +
            "') THEN CREATE TRIGGER " +
            name +
            " AFTER " +
            keyword +
            " ON " +
            table +
            " FOR EACH STATEMENT EXECUTE FUNCTION navhub_bump_data_version(); END IF; END $$",
        );
      } else {
        statements.push(
          "CREATE TRIGGER IF NOT EXISTS " +
            name +
            " AFTER " +
            keyword +
            " ON " +
            table +
            " FOR EACH ROW BEGIN UPDATE data_version SET version = version + 1 WHERE id = 1; END;",
        );
      }
    }
  }

  for (const sqlText of statements) await execSql(db, sqlText);
}

async function tableColumns(db: { dialect: string; sqlite?: any; pg?: any }, table: string): Promise<Set<string> | null> {
  if (db.dialect !== "pg" && db.sqlite) {
    const prepared = db.sqlite.prepare("PRAGMA table_info(" + table + ")").all() as
      | Array<{ name: string }>
      | Promise<{ rows?: Array<{ name: string }> }>;
    // libsql 的 runner 是异步驱动（prepare().all() 返回 Promise 而非数组），
    // better-sqlite3 是同步数组。两种形态在这里归一化。
    const rows = typeof (prepared as Promise<unknown>)?.then === "function"
      ? ((await prepared) as { rows?: Array<{ name: string }> }).rows ?? []
      : (prepared as Array<{ name: string }>);
    // SQLite 表不可能没有列；空集合表示表尚不存在（例如 notification_outbox
    // 由后续 migrateSiteIndexes 建表），不是 ALTER 失败，留到对应建表迁移处理。
    return rows.length === 0 ? null : new Set(rows.map((r) => r.name));
  }
  if (!db.pg) return null;
  const res = await db.pg.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = $1",
    [table],
  );
  const rows = res.rows as Array<{ column_name: string }>;
  return rows.length === 0 ? null : new Set(rows.map((r) => r.column_name));
}

/**
 * 执行列迁移，返回实际补齐的列名（空数组 = 已是最新）。
 * 真实 ALTER 失败必须向外传播；仅当重查确认竞争进程已成功补列时才容忍竞态。
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
        if (!existing) break;
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
      } catch (err) {
        // 并发冷启动唯一可容忍的错误是：另一路已经把列建好。其它错误原样抛出，
        // 让版本化事务回滚并拒绝写 applied，而不是把缺列库永久标记为已迁移。
        existing = await tableColumns(db, table);
        if (!existing?.has(a.column)) throw err;
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
 * - 关键数据回填：失败向外传播，不能返回 0 后把失败版本写成 applied。
 */
export async function migrateEventIdentity(db: { dialect: string; sqlite?: any; pg?: any }): Promise<number> {
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
}

/**
 * 回填 categories.slug —— 类目 URL 从 UUID 换成可读 slug 的前置条件。
 *
 * 口径：
 * - **只填 slug IS NULL 的行**。slug 一旦发布就是 URL 资产，启动期重写已有值
 *   等于把已收录的 /category/{slug} 全部打成 404。
 * - **全局唯一**：URL 形如 /category/{slug}，不带父级路径，所以冲突判定看全表。
 *   「每父唯一」是标题的规矩（P2 数据干净后才建那个索引），不是 slug 的。
 * - 关键 URL 资产回填：失败向外传播，由版本化事务回滚，不能返回 0 后写 applied。
 */
export async function migrateCategorySlugs(db: { dialect: string; sqlite?: any; pg?: any }): Promise<number> {
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


export interface TaxonomyDuplicateConflict {
  keepSiteId: string;
  duplicateSiteIds: string[];
  canonicalUrl: string;
  reason: string;
  detail: string;
}

export interface TaxonomyMigrationResult {
  categoriesCreated: number;
  sitesReclassified: number;
  sitesDeduplicated: number;
  dryRun: boolean;
  mergeCandidates: number;
  conflicts: TaxonomyDuplicateConflict[];
}

export interface TaxonomyMigrationOptions {
  /** 默认 true：只生成合并计划与冲突报告，不写类别、不移动引用、不删除站点。 */
  dryRun?: boolean;
}

/** canonical key 故意保留 www、scheme、有效 query 和非默认端口。 */
export function taxonomyCanonicalUrlKey(rawUrl: string): string {
  const raw = String(rawUrl ?? "").trim();
  if (!raw) return "";
  try {
    const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(canonicalizeUrl(withScheme));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (parsed.username || parsed.password) return "";
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
  } catch {
    return "";
  }
}

function normalizedSiteTitle(title: unknown): string {
  return String(title ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function parseJsonObject(raw: unknown): Record<string, any> | null {
  if (raw == null || raw === "") return {};
  if (typeof raw !== "string") return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, any> : null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseStringArray(raw: unknown): string[] | null {
  if (raw == null || raw === "") return [];
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function mergeNotes(...values: unknown[]): string | null {
  const notes = [...new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))];
  return notes.length > 0 ? notes.join("\n") : null;
}

/**
 * 20261107: 类目重构、错位纠偏与存量重复站点数据清洗。
 *
 * 重复站点合并是显式、可审计的破坏性操作，因此默认 dry-run。自动合并必须同时满足：
 * canonical URL 完全相同（保留 www / scheme / query / 非默认端口）、非空标题归一后相同、
 * 且附属数据没有无法无损合并的冲突。旧 UUID 白名单不再拥有绕过证明的特权。
 */
export async function cleanTaxonomyAndDuplicates(
  db: { dialect: string; sqlite?: any; pg?: any },
  options: TaxonomyMigrationOptions = {},
): Promise<TaxonomyMigrationResult> {
  const dryRun = options.dryRun ?? true;
  try {
    const result = await withMigrationTransaction(db, (txDb) =>
      cleanTaxonomyAndDuplicatesInTransaction(txDb, dryRun),
    );
    if (result.conflicts.length > 0) {
      console.warn(
        `[migrate] taxonomy 重复站点冲突 ${result.conflicts.length} 组，已保留重复；` +
          `${dryRun ? "dry-run 未写库" : "冲突项未合并"}：${result.conflicts
            .map((c) => `${c.duplicateSiteIds.join(",")} -> ${c.keepSiteId} (${c.reason})`)
            .join("; ")}`,
      );
    }
    console.info(
      `[migrate] cleanTaxonomyAndDuplicates 完成：dry-run=${dryRun}，新增类目 ${result.categoriesCreated} 个，` +
        `重分类站点 ${result.sitesReclassified} 个，消除重复站点 ${result.sitesDeduplicated} 个，` +
        `可证明合并候选 ${result.mergeCandidates} 个`,
    );
    return result;
  } catch (err) {
    await recordMigrationFailure(db, "clean_taxonomy_and_duplicates_v3", err);
    throw err;
  }
}

async function cleanTaxonomyAndDuplicatesInTransaction(
  db: { dialect: string; sqlite?: any; pg?: any },
  dryRun: boolean,
): Promise<TaxonomyMigrationResult> {
  const isSqlite = db.dialect !== "pg" && !!db.sqlite;
  const read = async (sql: string, params: unknown[] = []): Promise<Array<Record<string, any>>> => {
    if (isSqlite) {
      const maybe = db.sqlite.prepare(sql).all(...params);
      return maybe && typeof maybe.then === "function" ? await maybe : maybe;
    }
    if (!db.pg) return [];
    return (await db.pg.query(toPgSql(sql), params)).rows;
  };
  const write = async (sql: string, params: unknown[] = []): Promise<void> => {
    if (dryRun) return;
    if (isSqlite) {
      const maybe = db.sqlite.prepare(sql).run(...params);
      if (maybe && typeof maybe.then === "function") await maybe;
      return;
    }
    if (db.pg) {
      await db.pg.query(toPgSql(sql), params);
    }
  };

  let categoriesCreated = 0;
  let sitesReclassified = 0;
  let sitesDeduplicated = 0;

    const now = Date.now();
    // 1. 确保新类目在 categories 表中落地
    const newCats = [
      {
        id: "reg-prompt-engineering",
        anchor: "ai-tools/prompt-engineering",
        parentId: "reg-ai-tools",
        title: "提示词工程",
        slug: "prompt-engineering",
        description: "提示词模板库、Prompt 优化技巧、系统提示与上下文工程指南",
        sort: 9,
      },
      {
        id: "reg-inference-and-deployment",
        anchor: "backend-and-cloud/inference-and-deployment",
        parentId: "reg-backend-and-cloud",
        title: "推理与端侧",
        slug: "inference-and-deployment",
        description: "高并发推理服务引擎、端侧模型量化、模型编译与本地执行运行时",
        sort: 13,
      },
      {
        id: "reg-ai-hardware-and-embodied",
        anchor: "ai-tools/ai-hardware-and-embodied",
        parentId: "reg-ai-tools",
        title: "AI 硬件与具身",
        slug: "ai-hardware-and-embodied",
        description: "机器人具身算法、机器人仿真环境、空间智能与物理世界交互系统",
        sort: 12,
      },
    ];

    for (const cat of newCats) {
      const existing = await read("SELECT id FROM categories WHERE id = ? OR slug = ?", [cat.id, cat.slug]);
      if (existing.length === 0) {
        await write(
          "INSERT INTO categories (id, anchor, parent_id, title, slug, description, sort, enabled, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'registry', ?, ?)",
          [cat.id, cat.anchor, cat.parentId, cat.title, cat.slug, cat.description, cat.sort, now, now]
        );
        if (!dryRun) categoriesCreated++;
      }
    }

    // 2. 错位纠偏：稿定设计与创客贴迁至 设计与创意 (reg-inspiration-and-showcase)
    const designTarget = await read("SELECT id FROM categories WHERE id = 'reg-inspiration-and-showcase' OR slug = 'inspiration-and-showcase'");
    const firstDesignTarget = designTarget[0];
    if (firstDesignTarget) {
      const targetCatId = firstDesignTarget.id;
      const misclassifiedDesign = await read(
        "SELECT id, title FROM sites WHERE (url LIKE '%gaoding.com%' OR title LIKE '%稿定设计%' OR url LIKE '%chuangkit.com%' OR title LIKE '%创客贴%') AND category_id <> ?",
        [targetCatId]
      );
      for (const row of misclassifiedDesign) {
        await write("UPDATE sites SET category_id = ?, updated_at = ? WHERE id = ?", [targetCatId, now, row.id]);
        if (!dryRun) sitesReclassified++;
      }
    }

    // 3. 错位纠偏：端侧推理引擎迁至 推理与端侧 (reg-inference-and-deployment)
    const inferenceTarget = await read("SELECT id FROM categories WHERE id = 'reg-inference-and-deployment' OR slug = 'inference-and-deployment'");
    const firstInferenceTarget = inferenceTarget[0];
    if (firstInferenceTarget) {
      const targetCatId = firstInferenceTarget.id;
      const inferenceSites = await read(
        "SELECT id, title FROM sites WHERE (url LIKE '%llama.cpp%' OR url LIKE '%vllm%' OR url LIKE '%text-generation-inference%' OR url LIKE '%openvino%' OR url LIKE '%tvm.apache.org%' OR url LIKE '%triton%' OR url LIKE '%mlc-ai%' OR url LIKE '%whisper.cpp%' OR title LIKE '%llama.cpp%' OR title LIKE '%OpenVINO%' OR title LIKE '%Apache TVM%') AND category_id <> ?",
        [targetCatId]
      );
      for (const row of inferenceSites) {
        await write("UPDATE sites SET category_id = ?, updated_at = ? WHERE id = ?", [targetCatId, now, row.id]);
        if (!dryRun) sitesReclassified++;
      }
    }

    // 4. 错位纠偏：提示词工程迁至 提示词工程 (reg-prompt-engineering)
    const promptTarget = await read("SELECT id FROM categories WHERE id = 'reg-prompt-engineering' OR slug = 'prompt-engineering'");
    const firstPromptTarget = promptTarget[0];
    if (firstPromptTarget) {
      const targetCatId = firstPromptTarget.id;
      const promptSites = await read(
        "SELECT id, title FROM sites WHERE (url LIKE '%promptingguide.ai%' OR url LIKE '%docs.anthropic.com%prompt%' OR url LIKE '%cookbook.openai.com%' OR url LIKE '%flowgpt.com%' OR url LIKE '%prompthero.com%' OR title LIKE '%提示词%' OR title LIKE '%提示工程%') AND category_id <> ?",
        [targetCatId]
      );
      for (const row of promptSites) {
        await write("UPDATE sites SET category_id = ?, updated_at = ? WHERE id = ?", [targetCatId, now, row.id]);
        if (!dryRun) sitesReclassified++;
      }
    }

    // 4.1 合并具身智能与硬件 -> AI 硬件与具身，并迁移 Filesystem MCP Server 至 智能体与自动化
    const hwTarget = await read("SELECT id FROM categories WHERE id = 'reg-ai-hardware-and-embodied' OR slug = 'ai-hardware-and-embodied'");
    if (hwTarget[0]) {
      const hwCatId = hwTarget[0].id;
      const embodiedSites = await read("SELECT id, title FROM sites WHERE category_id = 'reg-embodied-ai-and-robotics'");
      for (const row of embodiedSites) {
        await write("UPDATE sites SET category_id = ?, updated_at = ? WHERE id = ?", [hwCatId, now, row.id]);
        if (!dryRun) sitesReclassified++;
      }
      await write("DELETE FROM categories WHERE id = 'reg-embodied-ai-and-robotics'");
      await write("UPDATE categories SET title = 'AI 硬件与具身' WHERE id = ?", [hwCatId]);
    }

    const agentTarget = await read("SELECT id FROM categories WHERE id = 'reg-agents-and-automation' OR slug = 'agents-and-automation'");
    if (agentTarget[0]) {
      const agentCatId = agentTarget[0].id;
      const fsSites = await read("SELECT id, title FROM sites WHERE title = 'Filesystem MCP Server' AND category_id != ?", [agentCatId]);
      for (const row of fsSites) {
        await write("UPDATE sites SET category_id = ?, updated_at = ? WHERE id = ?", [agentCatId, now, row.id]);
        if (!dryRun) sitesReclassified++;
      }
    }

    // 5. 先规划、证明、报告，再决定是否应用。没有任何 UUID 白名单旁路。
    const allSites = await read("SELECT * FROM sites WHERE deleted_at IS NULL ORDER BY created_at ASC, id ASC");
    const conflicts: TaxonomyDuplicateConflict[] = [];
    const candidates: Array<{ keep: Record<string, any>; dup: Record<string, any>; canonicalUrl: string }> = [];
    const candidateKeys = new Set<string>();
    const conflictKeys = new Set<string>();
    const addConflict = (
      keep: Record<string, any>,
      dups: Array<Record<string, any>>,
      canonicalUrl: string,
      reason: string,
      detail: string,
    ) => {
      const key = `${keep.id}\u0000${dups.map((d) => d.id).sort().join(",")}`;
      if (conflictKeys.has(key)) return;
      conflictKeys.add(key);
      conflicts.push({ keepSiteId: String(keep.id), duplicateSiteIds: dups.map((d) => String(d.id)), canonicalUrl, reason, detail });
    };

    const groups = new Map<string, Array<Record<string, any>>>();
    for (const site of allSites) {
      const key = taxonomyCanonicalUrlKey(String(site.url ?? ""));
      if (!key) continue;
      const group = groups.get(key) ?? [];
      group.push(site);
      groups.set(key, group);
    }
    for (const [canonicalUrl, group] of groups) {
      if (group.length < 2) continue;
      const keep = group[0]!;
      const dups = group.slice(1);
      const keepTitle = normalizedSiteTitle(keep.title);
      if (!keepTitle || dups.some((d) => normalizedSiteTitle(d.title) !== keepTitle)) {
        addConflict(keep, dups, canonicalUrl, "title_mismatch", "规范化 URL 相同，但标题缺失或不一致；整组保留");
        continue;
      }
      for (const dup of dups) {
        const key = `${keep.id}\u0000${dup.id}`;
        if (!candidateKeys.has(key)) {
          candidateKeys.add(key);
          candidates.push({ keep, dup, canonicalUrl });
        }
      }
    }

    const comparable = (row: Record<string, any>, omitId = false): string => stableJson(
      Object.fromEntries(Object.entries(row).filter(([k]) => k !== "site_id" && (!omitId || k !== "id"))),
    );
    const groupBy = (rows: Array<Record<string, any>>, columns: string[]): Map<string, Array<Record<string, any>>> => {
      const out = new Map<string, Array<Record<string, any>>>();
      for (const row of rows) {
        const key = columns.map((c) => String(row[c] ?? "")).join("\u0000");
        const list = out.get(key) ?? [];
        list.push(row);
        out.set(key, list);
      }
      return out;
    };

    /** 返回空数组才证明该 pair 的附属数据可无损合并。 */
    const attachmentConflicts = async (keepId: string, dupId: string): Promise<string[]> => {
      const reasons: string[] = [];
      const aliases = await read("SELECT * FROM site_id_aliases WHERE old_site_id IN (?,?)", [keepId, dupId]);
      for (const alias of aliases) {
        const oldId = String(alias.old_site_id);
        const canonical = String(alias.canonical_site_id);
        if (oldId === dupId && canonical === keepId) continue;
        reasons.push(`site_id_aliases 已有冲突映射 ${oldId} -> ${canonical}`);
      }

      const favorites = await read("SELECT * FROM favorites WHERE site_id IN (?,?)", [keepId, dupId]);
      for (const rows of groupBy(favorites, ["user_id"]).values()) {
        if (rows.length < 2) continue;
        const a = rows[0]!;
        const b = rows[1]!;
        if (
          a.folder_id !== b.folder_id || a.deleted_at !== b.deleted_at ||
          parseStringArray(a.tags) === null || parseStringArray(b.tags) === null
        ) {
          reasons.push(`favorites 用户 ${a.user_id} 的文件夹/墓碑状态冲突或 tags 非字符串数组`);
        }
        if (![a.created_at, a.updated_at, b.created_at, b.updated_at].every((v) => Number.isFinite(Number(v)))) {
          reasons.push(`favorites 用户 ${a.user_id} 的时间戳不是有限数值，无法证明合并顺序`);
        }
      }

      const collectionItems = await read("SELECT * FROM collection_items WHERE site_id IN (?,?)", [keepId, dupId]);
      if (collectionItems.some((row) => !Number.isFinite(Number(row.sort)))) {
        reasons.push("collection_items.sort 不是有限数值，无法无损合并排序");
      }

      // 这些表在 site_id 或 (owner_identity, site_id) 上有唯一约束；内容不同则拒绝合并。
      for (const table of ["embeddings", "site_radar", "site_prices", "submission_reviews", "submission_owners"]) {
        const rows = await read(`SELECT * FROM ${table} WHERE site_id IN (?,?)`, [keepId, dupId]);
        for (const pair of groupBy(rows, table === "site_prices" ? ["owner_identity"] : []).values()) {
          if (pair.length > 1 && comparable(pair[0]!, table === "site_prices") !== comparable(pair[1]!, table === "site_prices")) {
            reasons.push(`${table} 唯一键冲突且内容不同`);
          }
        }
      }

      const eventCollision = await read(
        `SELECT d.id AS id FROM events d JOIN events k
           ON k.kind = d.kind AND k.site_id = ? AND k.event_id = d.event_id AND k.event_day = d.event_day
         WHERE d.site_id = ? AND d.event_id IS NOT NULL LIMIT 1`,
        [keepId, dupId],
      );
      if (eventCollision.length > 0) reasons.push("events 幂等键在合并后冲突");

      const keepRow = await read("SELECT metadata FROM sites WHERE id = ?", [keepId]);
      if (keepRow[0]) {
        const metadata = parseJsonObject(keepRow[0].metadata);
        if (metadata === null) {
          reasons.push("保留站点 metadata 不是合法 JSON 对象，无法追加合并审计快照");
        } else if (
          (metadata._navhubMigration != null && (typeof metadata._navhubMigration !== "object" || Array.isArray(metadata._navhubMigration))) ||
          (metadata._navhubMigration?.mergedSites != null && (typeof metadata._navhubMigration.mergedSites !== "object" || Array.isArray(metadata._navhubMigration.mergedSites)))
        ) {
          reasons.push("保留站点 metadata._navhubMigration 结构冲突，拒绝覆盖");
        }
      }

      const profiles = await read(
        "SELECT user_id, visited_site_ids, favorite_site_ids FROM user_profiles WHERE visited_site_ids LIKE ? OR favorite_site_ids LIKE ?",
        [`%${dupId}%`, `%${dupId}%`],
      );
      for (const profile of profiles) {
        if (parseStringArray(profile.visited_site_ids) === null || parseStringArray(profile.favorite_site_ids) === null) {
          reasons.push(`user_profiles ${profile.user_id} 的站点 ID 列表不是合法字符串数组`);
          break;
        }
      }

      const proposals = await read("SELECT id, target_id, meta FROM taxonomy_proposals WHERE target_id = ? OR meta LIKE ?", [dupId, `%${dupId}%`]);
      for (const proposal of proposals) {
        if (proposal.meta != null && parseJsonObject(proposal.meta) === null) {
          reasons.push(`taxonomy_proposals ${proposal.id} 的 meta 不是合法 JSON 对象`);
          break;
        }
      }
      return [...new Set(reasons)];
    };

    const safeCandidates: typeof candidates = [];
    for (const candidate of candidates) {
      const reasons = await attachmentConflicts(String(candidate.keep.id), String(candidate.dup.id));
      if (reasons.length > 0) {
        addConflict(candidate.keep, [candidate.dup], candidate.canonicalUrl, "attachment_conflict", reasons.join("；"));
      } else {
        safeCandidates.push(candidate);
      }
    }

    if (!dryRun) {
      for (const candidate of safeCandidates) {
        const keepId = String(candidate.keep.id);
        const dupId = String(candidate.dup.id);
        // 写前重新证明：前面的合并可能移动了附属数据，不能依赖规划时的快照。
        const currentKeep = (await read("SELECT * FROM sites WHERE id = ? AND deleted_at IS NULL", [keepId]))[0];
        const currentDup = (await read("SELECT * FROM sites WHERE id = ? AND deleted_at IS NULL", [dupId]))[0];
        if (!currentKeep || !currentDup) continue;
        const currentKey = taxonomyCanonicalUrlKey(String(currentKeep.url ?? ""));
        if (
          !currentKey || currentKey !== taxonomyCanonicalUrlKey(String(currentDup.url ?? "")) ||
          !normalizedSiteTitle(currentKeep.title) ||
          normalizedSiteTitle(currentKeep.title) !== normalizedSiteTitle(currentDup.title)
        ) {
          addConflict(currentKeep, [currentDup], currentKey, "proof_changed_before_merge", "写前 URL/标题证明已失效");
          continue;
        }
        const reasons = await attachmentConflicts(keepId, dupId);
        if (reasons.length > 0) {
          addConflict(currentKeep, [currentDup], currentKey, "attachment_conflict", reasons.join("；"));
          continue;
        }

        // 完整保留被删站点行（含未合并的 description/metadata）与撞 collection 的源行快照。
        const keepMetadata = parseJsonObject(currentKeep.metadata)!;
        const migrationMeta = keepMetadata._navhubMigration && typeof keepMetadata._navhubMigration === "object" && !Array.isArray(keepMetadata._navhubMigration)
          ? keepMetadata._navhubMigration : {};
        const mergedSites = migrationMeta.mergedSites && typeof migrationMeta.mergedSites === "object" && !Array.isArray(migrationMeta.mergedSites)
          ? migrationMeta.mergedSites : {};
        const dupCollections = await read("SELECT * FROM collection_items WHERE site_id = ?", [dupId]);
        const keepCollectionIds = new Set(
          (await read("SELECT collection_id FROM collection_items WHERE site_id = ?", [keepId])).map((r) => String(r.collection_id)),
        );
        mergedSites[dupId] = {
          mergedAt: now,
          reason: "canonical_url_and_normalized_title_equal",
          site: currentDup,
          collectionItems: dupCollections.filter((row) => keepCollectionIds.has(String(row.collection_id))),
        };
        migrationMeta.mergedSites = mergedSites;
        keepMetadata._navhubMigration = migrationMeta;
        const keepVisits = Number(currentKeep.visit_count ?? 0);
        const dupVisits = Number(currentDup.visit_count ?? 0);
        const lastVisitedValues = [currentKeep.last_visited_at, currentDup.last_visited_at]
          .map((v) => Number(v ?? 0)).filter((v) => Number.isFinite(v) && v > 0);
        const updatedAtValues = [currentKeep.updated_at, currentDup.updated_at, now]
          .map((v) => Number(v ?? 0)).filter((v) => Number.isFinite(v));
        await write(
          "UPDATE sites SET metadata = ?, description = CASE WHEN description IS NULL OR description = '' THEN ? ELSE description END, visit_count = ?, last_visited_at = ?, updated_at = ? WHERE id = ?",
          [
            JSON.stringify(keepMetadata), currentDup.description ?? null,
            (Number.isFinite(keepVisits) ? keepVisits : 0) + (Number.isFinite(dupVisits) ? dupVisits : 0),
            lastVisitedValues.length > 0 ? Math.max(...lastVisitedValues) : null,
            Math.max(...updatedAtValues), keepId,
          ],
        );

        // favorites：同用户同文件夹且墓碑状态一致才合并；notes/tags 求并。
        const dupFavorites = await read("SELECT * FROM favorites WHERE site_id = ?", [dupId]);
        for (const fav of dupFavorites) {
          const keepFav = (await read("SELECT * FROM favorites WHERE user_id = ? AND site_id = ?", [fav.user_id, keepId]))[0];
          if (!keepFav) {
            await write("UPDATE favorites SET site_id = ? WHERE id = ?", [keepId, fav.id]);
            continue;
          }
          const tags = [...new Set([...(parseStringArray(keepFav.tags) ?? []), ...(parseStringArray(fav.tags) ?? [])])];
          await write(
            "UPDATE favorites SET note = ?, tags = ?, created_at = ?, updated_at = ?, deleted_at = ? WHERE id = ?",
            [
              mergeNotes(keepFav.note, fav.note), tags.length > 0 ? JSON.stringify(tags) : null,
              Math.min(Number(keepFav.created_at), Number(fav.created_at)),
              Math.max(Number(keepFav.updated_at), Number(fav.updated_at)), keepFav.deleted_at, keepFav.id,
            ],
          );
          await write("DELETE FROM favorites WHERE id = ?", [fav.id]);
        }

        // tags / facets：唯一键相同仅代表同一事实。
        await write("INSERT INTO site_tags (site_id, tag_id) SELECT ?, tag_id FROM site_tags WHERE site_id = ? ON CONFLICT DO NOTHING", [keepId, dupId]);
        await write("DELETE FROM site_tags WHERE site_id = ?", [dupId]);
        await write("INSERT INTO site_facets (site_id, facet_key, facet_value) SELECT ?, facet_key, facet_value FROM site_facets WHERE site_id = ? ON CONFLICT DO NOTHING", [keepId, dupId]);
        await write("DELETE FROM site_facets WHERE site_id = ?", [dupId]);

        // relations 两个方向都重定向；self relation 也保留。
        await write("UPDATE site_relations SET source_site_id = ?, updated_at = ? WHERE source_site_id = ?", [keepId, now, dupId]);
        await write("UPDATE site_relations SET target_site_id = ?, updated_at = ? WHERE target_site_id = ?", [keepId, now, dupId]);

        for (const table of ["events", "health_checks", "site_archives", "site_reports", "site_discovery_candidates"]) {
          await write(`UPDATE ${table} SET site_id = ? WHERE site_id = ?`, [keepId, dupId]);
        }
        await write("UPDATE wanted_searches SET notified_site_id = ? WHERE notified_site_id = ?", [keepId, dupId]);
        await write("UPDATE watch_entries SET platform_site_id = ?, updated_at = ? WHERE platform_site_id = ?", [keepId, now, dupId]);

        // 唯一附属表：完全相同的事实去重，其余行改指保留站点。
        for (const table of ["embeddings", "site_radar", "site_prices", "submission_reviews", "submission_owners"]) {
          const dupRows = await read(`SELECT * FROM ${table} WHERE site_id = ?`, [dupId]);
          const keepRows = await read(`SELECT * FROM ${table} WHERE site_id = ?`, [keepId]);
          const keyColumns = table === "site_prices" ? ["owner_identity"] : [];
          const keepByKey = new Map([...groupBy(keepRows, keyColumns)].map(([key, rows]) => [key, rows[0]]));
          for (const row of dupRows) {
            const key = keyColumns.map((c) => String(row[c] ?? "")).join("\u0000");
            const same = keepByKey.get(key);
            if (same && comparable(same, table === "site_prices") === comparable(row, table === "site_prices")) {
              await write(`DELETE FROM ${table} WHERE ${table === "site_prices" ? "id" : "site_id"} = ?`, [table === "site_prices" ? row.id : dupId]);
            } else {
              await write(`UPDATE ${table} SET site_id = ? WHERE ${table === "site_prices" ? "id" : "site_id"} = ?`, [keepId, table === "site_prices" ? row.id : dupId]);
            }
          }
        }

        // collection_items：撞同一 collection 时合并 note、取最早排序，并归档源行。
        for (const collectionId of [...new Set(dupCollections.map((r) => String(r.collection_id)))]) {
          const dupRows = dupCollections.filter((r) => String(r.collection_id) === collectionId);
          const keepRows = await read("SELECT * FROM collection_items WHERE collection_id = ? AND site_id = ?", [collectionId, keepId]);
          if (keepRows.length === 0) {
            await write("UPDATE collection_items SET site_id = ? WHERE site_id = ? AND collection_id = ?", [keepId, dupId, collectionId]);
          } else {
            await write("UPDATE collection_items SET note = ?, sort = ? WHERE collection_id = ? AND site_id = ?", [
              mergeNotes(...keepRows.map((r) => r.note), ...dupRows.map((r) => r.note)),
              Math.min(...keepRows.map((r) => Number(r.sort ?? 0)), ...dupRows.map((r) => Number(r.sort ?? 0))),
              collectionId, keepId,
            ]);
            await write("DELETE FROM collection_items WHERE site_id = ? AND collection_id = ?", [dupId, collectionId]);
          }
        }

        // 用户画像里的站点 ID 数组也重定向并去重。
        const profiles = await read(
          "SELECT user_id, visited_site_ids, favorite_site_ids FROM user_profiles WHERE visited_site_ids LIKE ? OR favorite_site_ids LIKE ?",
          [`%${dupId}%`, `%${dupId}%`],
        );
        for (const profile of profiles) {
          const redirect = (raw: unknown): string => JSON.stringify([...new Set(
            (parseStringArray(raw) ?? []).map((id) => id === dupId ? keepId : id),
          )]);
          await write("UPDATE user_profiles SET visited_site_ids = ?, favorite_site_ids = ?, updated_at = ? WHERE user_id = ?", [
            redirect(profile.visited_site_ids), redirect(profile.favorite_site_ids), now, profile.user_id,
          ]);
        }

        // 治理提案的 category_change target 与 meta.siteIds 指向同一站点。
        const proposals = await read("SELECT * FROM taxonomy_proposals WHERE target_id = ? OR meta LIKE ?", [dupId, `%${dupId}%`]);
        for (const proposal of proposals) {
          const meta = parseJsonObject(proposal.meta) ?? {};
          if (Array.isArray(meta.siteIds)) {
            meta.siteIds = [...new Set(meta.siteIds.map((id: unknown) => String(id) === dupId ? keepId : id))];
          }
          await write("UPDATE taxonomy_proposals SET target_id = ?, meta = ? WHERE id = ?", [
            proposal.kind === "category_change" && String(proposal.target_id) === dupId ? keepId : proposal.target_id,
            proposal.meta == null ? proposal.meta : JSON.stringify(meta), proposal.id,
          ]);
        }

        // 完整 alias：保留旧标题/旧 URL/原因，并压平所有指向 dup 的旧 alias 链。
        await write("UPDATE site_id_aliases SET canonical_site_id = ? WHERE canonical_site_id = ?", [keepId, dupId]);
        const existingAlias = (await read("SELECT * FROM site_id_aliases WHERE old_site_id = ?", [dupId]))[0];
        const aliasReason = "taxonomy dedup: canonical URL and normalized title equal; full row archived in sites.metadata._navhubMigration.mergedSites";
        if (existingAlias) {
          await write("UPDATE site_id_aliases SET canonical_site_id = ?, old_title = ?, old_url = ?, reason = ?, merged_at = ? WHERE old_site_id = ?", [
            keepId, currentDup.title, currentDup.url, aliasReason, now, dupId,
          ]);
        } else {
          await write("INSERT INTO site_id_aliases (old_site_id, canonical_site_id, old_title, old_url, reason, merged_at) VALUES (?,?,?,?,?,?)", [
            dupId, keepId, currentDup.title, currentDup.url, aliasReason, now,
          ]);
        }

        await write("DELETE FROM sites WHERE id = ?", [dupId]);
        sitesDeduplicated++;
      }

      if (conflicts.length > 0) {
        await recordMigrationFailure(db, "taxonomy_dedup_v3_conflicts", new Error(JSON.stringify(conflicts)));
      }
    }

  return { categoriesCreated, sitesReclassified, sitesDeduplicated, dryRun, mergeCandidates: safeCandidates.length, conflicts };
}

/**
 * 把 `sites.created_at` 里的非数值存量值归一成 epoch 毫秒。
 *
 * ## 为什么需要
 *
 * schema 与两个驱动都把该列声明成 `INTEGER/BIGINT NOT NULL`，但实测库里
 * 有 3 行是 **TEXT 日期串**（`"2026-11-07 06:47:11"`，来自早期导入路径）。
 * 这条脏数据不会自己报错，而是往下游炸：
 *   `Number("2026-11-07 06:47:11")` → NaN → ageInDays NaN → trendScore NaN
 *   → SQL 绑定参数变 NULL → 撞 `sites.weight NOT NULL`
 *   → **整个 recompute_rank 任务每小时失败一次**（jobs 表实测 25 条 failed），
 *      全站 trend_score 长期停在 0，热度榜等于没有排序。
 *
 * 代码侧已经在 `core/ranking.ts` 加了 NaN 闸门、在任务里加了日期串兜底解析，
 * 那是「不再因此崩」；这里负责「把脏数据本身修掉」，两者缺一不可：
 * 只加闸门则脏值永远留在库里，只修数据则下次再进来又会炸。
 *
 * 幂等：已经是整数（或可解析为整数）的行不会被触碰。
 */
export async function normalizeSiteCreatedAt(db: { dialect: string; sqlite?: any; pg?: any }): Promise<number> {
  let fixed = 0;
  const isSqlite = db.dialect !== "pg" && !!db.sqlite;
  const read = async (sql: string): Promise<Array<Record<string, any>>> => {
    if (isSqlite) {
      const maybe = db.sqlite.prepare(sql).all();
      return maybe && typeof maybe.then === "function" ? await maybe : maybe;
    }
    return (await db.pg.query(sql)).rows;
  };
  const write = async (sql: string, params: unknown[]): Promise<void> => {
    if (isSqlite) {
      const maybe = db.sqlite.prepare(sql).run(...params);
      if (maybe && typeof maybe.then === "function") await maybe;
      return;
    }
    // PG 的 BIGINT 不接受日期串，能进来本函数的基本只有 SQLite；这里仍保持一致口径
    const pgSql = sql.replace(/\?/g, (_m, i) => "$" + (params.indexOf(params[i]) + 1));
    await db.pg.query(pgSql, params);
  };

  // SQLite 用 typeof 精确挑出非整数行；PG 走 NULL 分支（类型系统本身就挡住了脏串）
  const where = isSqlite
    ? "WHERE created_at IS NULL OR typeof(created_at) <> 'integer'"
    : "WHERE created_at IS NULL";
  const rows = await read(`SELECT id, created_at FROM sites ${where}`);
  if (rows.length === 0) return 0;

  for (const row of rows) {
    const raw = row.created_at;
    const asNumber = Number(raw);
    let epoch: number | null = null;
    if (Number.isFinite(asNumber) && asNumber > 0) {
      epoch = asNumber;
    } else {
      // 兼容 "YYYY-MM-DD HH:mm:ss"（SQLite datetime() 的默认格式）与 ISO 串
      const parsed = Date.parse(String(raw ?? "").replace(" ", "T"));
      if (Number.isFinite(parsed)) epoch = parsed;
    }
    // 解析不出来就按「建站时间未知」处理成当前时间：NOT NULL 列必须有值，
    // 且用 now 等价于「新站」，不会因为脏数据把它排到热度榜底部。
    if (epoch === null) epoch = Date.now();
    if (Number(raw) === epoch) continue; // 幂等：无需改动
    await write("UPDATE sites SET created_at = ? WHERE id = ?", [epoch, row.id]);
    fixed += 1;
  }

  if (fixed > 0) {
    console.info(`[migrate] normalizeSiteCreatedAt 完成：修正 ${fixed} 行非数值 created_at`);
  }
  return fixed;
}
