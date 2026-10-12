import { sql } from "drizzle-orm";
import { migrateColumns } from "./migrate.ts";

/**
 * 数据库驱动抽象。
 *
 * 双模式共用一个 schema：`lite` 用 better-sqlite3，`standard` 用 node-postgres。
 * 方言差异集中在这里和 `vector/`、`fts.ts` 三个位置，业务层只依赖 `Db` 接口。
 *
 * 为什么不用 drizzle 的迁移器生成两套 DDL：因为 schema 只用到两种数据库都支持的基础列类型
 * （见 schema.ts 的说明），DDL 本身是方言无关的，所以这里直接手写 DDL 并保持幂等，
 * 避免维护两套迁移文件的漂移风险。drizzle-kit 仅用于类型生成与离线校验。
 */

export type Dialect = "sqlite" | "pg";

export interface SqliteRunner {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
}

export interface PgRunner {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  end(): Promise<void>;
}

export interface Db {
  readonly dialect: Dialect;
  /** drizzle 实例（业务查询用；类型上按 sqlite 走，方言无关的查询两边都能跑） */
  readonly orm: any;
  readonly sqlite?: SqliteRunner;
  readonly pg?: PgRunner;
  close(): Promise<void>;
}

/**
 * 幂等 DDL。
 * 注意：没有使用任何方言特有类型；向量与 FTS 的虚拟表由适配器自行创建。
 */
const DDL_SQLITE = `
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  anchor TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  title_en TEXT,
  description TEXT,
  icon TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS categories_anchor_idx ON categories(anchor);
CREATE INDEX IF NOT EXISTS categories_parent_idx ON categories(parent_id);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  title_en TEXT,
  description TEXT,
  description_en TEXT,
  icon_key TEXT,
  screenshot_key TEXT,
  category_id TEXT NOT NULL,
  sub_category_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  fts_tokens TEXT NOT NULL DEFAULT '',
  pinyin_full TEXT NOT NULL DEFAULT '',
  pinyin_initials TEXT NOT NULL DEFAULT '',
  http_status INTEGER,
  health_ok INTEGER,
  latency_ms INTEGER,
  redirect_to TEXT,
  health_error TEXT,
  last_checked_at INTEGER,
  visit_count INTEGER NOT NULL DEFAULT 0,
  last_visited_at INTEGER,
  trend_score REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sites_url_idx ON sites(url);
CREATE INDEX IF NOT EXISTS sites_category_idx ON sites(category_id);
CREATE INDEX IF NOT EXISTS sites_status_idx ON sites(status);
CREATE INDEX IF NOT EXISTS sites_pinyin_full_idx ON sites(pinyin_full);
CREATE INDEX IF NOT EXISTS sites_pinyin_initials_idx ON sites(pinyin_initials);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_slug_idx ON tags(slug);

CREATE TABLE IF NOT EXISTS site_tags (
  site_id TEXT NOT NULL, tag_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS site_tags_site_idx ON site_tags(site_id);
CREATE INDEX IF NOT EXISTS site_tags_tag_idx ON site_tags(tag_id);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
  kind TEXT NOT NULL DEFAULT 'topic', icon TEXT, sort INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS collections_slug_idx ON collections(slug);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL, site_id TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, note TEXT
);
CREATE INDEX IF NOT EXISTS collection_items_col_idx ON collection_items(collection_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin', email TEXT, avatar TEXT,
  source TEXT NOT NULL DEFAULT 'local', created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users(username);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'read', last_used_at INTEGER, expires_at INTEGER, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_hash_idx ON api_tokens(token_hash);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, site_id TEXT, query TEXT,
  category_id TEXT, meta TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_kind_idx ON events(kind);
CREATE INDEX IF NOT EXISTS events_site_idx ON events(site_id);
CREATE INDEX IF NOT EXISTS events_created_idx ON events(created_at);

CREATE TABLE IF NOT EXISTS health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL, checked_at INTEGER NOT NULL,
  ok INTEGER NOT NULL, http_status INTEGER, latency_ms INTEGER, redirect_to TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS health_checks_site_idx ON health_checks(site_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, actor_kind TEXT NOT NULL DEFAULT 'user',
  action TEXT NOT NULL, target TEXT, diff TEXT, ip TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT, status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY, response TEXT, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS embeddings (
  site_id TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL,
  vector BLOB, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  folder_id TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_site_idx ON favorites(user_id, site_id);
CREATE INDEX IF NOT EXISTS favorites_user_idx ON favorites(user_id);

CREATE TABLE IF NOT EXISTS favorite_folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS favorite_folders_user_idx ON favorite_folders(user_id);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  top_categories TEXT NOT NULL DEFAULT '[]',
  top_tags TEXT NOT NULL DEFAULT '[]',
  visited_site_ids TEXT NOT NULL DEFAULT '[]',
  favorite_site_ids TEXT NOT NULL DEFAULT '[]',
  search_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS search_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  query TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS search_history_user_idx ON search_history(user_id);
CREATE INDEX IF NOT EXISTS search_history_created_idx ON search_history(created_at);
`;

const DDL_PG = `
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  anchor TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  title_en TEXT,
  description TEXT,
  icon TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS categories_anchor_idx ON categories(anchor);
CREATE INDEX IF NOT EXISTS categories_parent_idx ON categories(parent_id);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  title_en TEXT,
  description TEXT,
  description_en TEXT,
  icon_key TEXT,
  screenshot_key TEXT,
  category_id TEXT NOT NULL,
  sub_category_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort INTEGER NOT NULL DEFAULT 0,
  weight DOUBLE PRECISION NOT NULL DEFAULT 0,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT,
  fts_tokens TEXT NOT NULL DEFAULT '',
  pinyin_full TEXT NOT NULL DEFAULT '',
  pinyin_initials TEXT NOT NULL DEFAULT '',
  http_status INTEGER,
  health_ok BOOLEAN,
  latency_ms INTEGER,
  redirect_to TEXT,
  health_error TEXT,
  last_checked_at BIGINT,
  visit_count INTEGER NOT NULL DEFAULT 0,
  last_visited_at BIGINT,
  trend_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sites_url_idx ON sites(url);
CREATE INDEX IF NOT EXISTS sites_category_idx ON sites(category_id);
CREATE INDEX IF NOT EXISTS sites_status_idx ON sites(status);
CREATE INDEX IF NOT EXISTS sites_pinyin_full_idx ON sites(pinyin_full);
CREATE INDEX IF NOT EXISTS sites_pinyin_initials_idx ON sites(pinyin_initials);

-- pg_trgm 让 LIKE '%关键词%' 也能走索引（中文子串检索的关键）
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS sites_title_trgm_idx ON sites USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS sites_desc_trgm_idx ON sites USING gin (description gin_trgm_ops);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_slug_idx ON tags(slug);

CREATE TABLE IF NOT EXISTS site_tags (site_id TEXT NOT NULL, tag_id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS site_tags_site_idx ON site_tags(site_id);
CREATE INDEX IF NOT EXISTS site_tags_tag_idx ON site_tags(tag_id);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
  kind TEXT NOT NULL DEFAULT 'topic', icon TEXT, sort INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS collections_slug_idx ON collections(slug);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL, site_id TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, note TEXT
);
CREATE INDEX IF NOT EXISTS collection_items_col_idx ON collection_items(collection_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin', email TEXT, avatar TEXT,
  source TEXT NOT NULL DEFAULT 'local', created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users(username);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'read', last_used_at BIGINT, expires_at BIGINT, created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_hash_idx ON api_tokens(token_hash);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, site_id TEXT, query TEXT,
  category_id TEXT, meta TEXT, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_kind_idx ON events(kind);
CREATE INDEX IF NOT EXISTS events_site_idx ON events(site_id);
CREATE INDEX IF NOT EXISTS events_created_idx ON events(created_at);

CREATE TABLE IF NOT EXISTS health_checks (
  id BIGSERIAL PRIMARY KEY, site_id TEXT NOT NULL, checked_at BIGINT NOT NULL,
  ok BOOLEAN NOT NULL, http_status INTEGER, latency_ms INTEGER, redirect_to TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS health_checks_site_idx ON health_checks(site_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY, actor TEXT NOT NULL, actor_kind TEXT NOT NULL DEFAULT 'user',
  action TEXT NOT NULL, target TEXT, diff TEXT, ip TEXT, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT, status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY, response TEXT, created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS embeddings (
  site_id TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL,
  vector BYTEA, updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  folder_id TEXT,
  note TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_site_idx ON favorites(user_id, site_id);
CREATE INDEX IF NOT EXISTS favorites_user_idx ON favorites(user_id);

CREATE TABLE IF NOT EXISTS favorite_folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS favorite_folders_user_idx ON favorite_folders(user_id);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  top_categories TEXT NOT NULL DEFAULT '[]',
  top_tags TEXT NOT NULL DEFAULT '[]',
  visited_site_ids TEXT NOT NULL DEFAULT '[]',
  favorite_site_ids TEXT NOT NULL DEFAULT '[]',
  search_count INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  query TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS search_history_user_idx ON search_history(user_id);
CREATE INDEX IF NOT EXISTS search_history_created_idx ON search_history(created_at);
`;

export const DDL = { sqlite: DDL_SQLITE, pg: DDL_PG } as const;

export async function openDb(config: {
  dialect: Dialect;
  sqlitePath?: string;
  databaseUrl?: string;
}): Promise<Db> {
  if (config.dialect === "sqlite") {
    const mod = await import("better-sqlite3");
    const Database = (mod as any).default ?? mod;
    const raw = new Database(config.sqlitePath ?? "./data/navhub.db");
    // WAL 提升并发读性能；foreign_keys 打开以便后续加约束
    raw.pragma("journal_mode = WAL");
    raw.pragma("foreign_keys = ON");
    raw.exec(DDL_SQLITE);
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const db: Db = {
      dialect: "sqlite",
      orm: drizzle(raw),
      sqlite: raw,
      async close() { raw.close(); },
    };
    await migrateColumns(db);
    return db;
  }

  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  await pool.query(DDL_PG);
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const db: Db = {
    dialect: "pg",
    orm: drizzle(pool),
    pg: pool,
    async close() { await pool.end(); },
  };
  await migrateColumns(db);
  return db;
}

/** 供 drizzle 查询使用的原始 SQL 助手 */
export { sql };
