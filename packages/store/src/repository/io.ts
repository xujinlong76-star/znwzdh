import type { Repository } from "../repository.ts";
import {
  bindSqlite,
  toPgSql,
} from "./dialect.ts";

export function getEnabledLiteral(repo: Repository): string {
  return repo.db.dialect === "sqlite" ? "1" : "TRUE";
}

/**
 * SQLite prepared statement 缓存。
 *
 * better-sqlite3 的 `prepare()` 每次都会编译 SQL：仓储层一次请求可能走到
 * 十几个 `raw/run`，热路径上重复编译同一句 SQL 是纯开销。这里按「数据库实例 +
 * SQL 文本」缓存已编译语句，LRU 上限 200 条（超过就丢最久未用的，靠 GC 回收）。
 *
 * 为什么用 WeakMap 而不是全局 Map：测试与多租户场景会同时存在多个数据库实例，
 * 用 db 对象做键可以避免 A 库的语句被 B 库复用；db 被回收时整张缓存随之消失。
 *
 * 为什么 PG 不做同样的缓存：node-postgres 的命名预处理语句会绑定在连接上，
 * 迁移/重启后容易出现 "prepared statement already exists"，而收益远小于风险。
 * PG 侧交给服务端自身的 plan cache。
 */
interface SqliteStatementLike {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes?: number };
}

const STATEMENT_CACHE_LIMIT = 200;
const statementCaches = new WeakMap<object, Map<string, SqliteStatementLike>>();

function prepareCached(db: object, sqlText: string): SqliteStatementLike {
  let cache = statementCaches.get(db);
  if (!cache) {
    cache = new Map();
    statementCaches.set(db, cache);
  }
  const cached = cache.get(sqlText);
  if (cached) {
    // LRU：命中后移到队尾（Map 保持插入顺序）
    cache.delete(sqlText);
    cache.set(sqlText, cached);
    return cached;
  }
  const stmt = (db as { prepare(sql: string): SqliteStatementLike }).prepare(sqlText);
  cache.set(sqlText, stmt);
  if (cache.size > STATEMENT_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return stmt;
}

export async function runCount(repo: Repository, sqlText: string, params: unknown[]): Promise<number> {
  if (repo.db.dialect === "sqlite") {
    const info = prepareCached(repo.db.sqlite!, sqlText).run(...bindSqlite(params)) as { changes?: number };
    return Number(info?.changes ?? 0);
  }
  const res = await repo.db.pg!.query(toPgSql(sqlText), params);
  return Number(res.rowCount ?? 0);
}

export async function raw(repo: Repository, sqlText: string, params: unknown[] = []): Promise<Record<string, any>[]> {
  if (repo.db.dialect === "sqlite") {
    return prepareCached(repo.db.sqlite!, sqlText).all(...bindSqlite(params)) as Record<string, any>[];
  }
  const res = await repo.db.pg!.query(toPgSql(sqlText), params);
  // PostgreSQL 折叠未加引号的别名为小写，这里统一归一化，读取侧用小写键
  return (res.rows as Record<string, unknown>[]).map((r) => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(r)) out[k.toLowerCase()] = r[k];
    return out as Record<string, any>;
  });
}

export async function run(repo: Repository, sqlText: string, params: unknown[] = []): Promise<void> {
  if (repo.db.dialect === "sqlite") {
    prepareCached(repo.db.sqlite!, sqlText).run(...bindSqlite(params));
    return;
  }
  await repo.db.pg!.query(toPgSql(sqlText), params);
}
