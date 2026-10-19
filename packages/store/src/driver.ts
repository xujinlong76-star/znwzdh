import { sql } from "drizzle-orm";
import { migrateColumns, migrateSiteIndexes, migrateEventIdentity } from "./migrate.ts";

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

export type Dialect = "sqlite" | "pg" | "libsql";

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
  /** 可选：从池中拿独占连接（用于事务；pool.connect） */
  connect?(): Promise<{
    query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
    release(): void;
  }>;
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
  alt_labels TEXT NOT NULL DEFAULT '[]',
  related_categories TEXT NOT NULL DEFAULT '[]',
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
  deleted_at INTEGER,
  metadata TEXT,
  visit_count INTEGER NOT NULL DEFAULT 0,
  last_visited_at INTEGER,
  trend_score REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- 注意：sites 的 url 唯一索引（部分索引 WHERE deleted_at IS NULL）不在此处创建——
-- 旧库还没有 deleted_at 列，DDL 会失败。由 migrateSiteIndexes 在列迁移后创建。
CREATE INDEX IF NOT EXISTS sites_category_idx ON sites(category_id);
CREATE INDEX IF NOT EXISTS sites_status_idx ON sites(status);
CREATE INDEX IF NOT EXISTS sites_pinyin_full_idx ON sites(pinyin_full);
CREATE INDEX IF NOT EXISTS sites_pinyin_initials_idx ON sites(pinyin_initials);
CREATE INDEX IF NOT EXISTS sites_source_status_idx ON sites(source, status);
-- 注意：sites_hot_idx（含 trend_score）不在此处创建——旧库还没有 trend_score 列，
-- DDL 先于 migrateColumns 执行会 "no such column" 导致整个 exec 失败。
-- 由 migrateSiteIndexes 在列迁移后创建（与 url 部分索引同理）。

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT 'topic', color TEXT, description TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_slug_idx ON tags(slug);

CREATE TABLE IF NOT EXISTS tag_aliases (
  alias TEXT PRIMARY KEY, tag_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tag_aliases_tag_idx ON tag_aliases(tag_id);

CREATE TABLE IF NOT EXISTS site_tags (
  site_id TEXT NOT NULL, tag_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS site_tags_site_idx ON site_tags(site_id);
CREATE INDEX IF NOT EXISTS site_tags_tag_idx ON site_tags(tag_id);
CREATE UNIQUE INDEX IF NOT EXISTS site_tags_unique_idx ON site_tags(site_id, tag_id);

CREATE TABLE IF NOT EXISTS site_facets (
  site_id TEXT NOT NULL, facet_key TEXT NOT NULL, facet_value TEXT NOT NULL,
  PRIMARY KEY (site_id, facet_key, facet_value)
);
CREATE INDEX IF NOT EXISTS site_facets_key_val_idx ON site_facets(facet_key, facet_value);
CREATE INDEX IF NOT EXISTS site_facets_site_idx ON site_facets(site_id);

CREATE TABLE IF NOT EXISTS site_relations (
  id TEXT PRIMARY KEY,
  source_site_id TEXT NOT NULL,
  target_site_id TEXT,
  target_title TEXT NOT NULL,
  target_url TEXT NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'related',
  is_free_or_open_source INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS site_relations_source_idx ON site_relations(source_site_id);
CREATE INDEX IF NOT EXISTS site_relations_target_idx ON site_relations(target_site_id);
CREATE INDEX IF NOT EXISTS site_relations_type_idx ON site_relations(relation_type);

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
CREATE INDEX IF NOT EXISTS collection_items_site_idx ON collection_items(site_id);

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
  scopes TEXT NOT NULL DEFAULT 'read', last_used_at INTEGER, expires_at INTEGER, created_at INTEGER NOT NULL,
  revoked_at INTEGER, rotated_at INTEGER, token_prefix TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_hash_idx ON api_tokens(token_hash);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, site_id TEXT, query TEXT,
  category_id TEXT, meta TEXT, identity TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_kind_idx ON events(kind);
CREATE INDEX IF NOT EXISTS events_site_idx ON events(site_id);
CREATE INDEX IF NOT EXISTS events_created_idx ON events(created_at);
CREATE INDEX IF NOT EXISTS events_search_idx ON events(kind, created_at, query);
-- 注意：events_identity_idx 不在此处创建——旧库还没有 identity 列（由 migrateColumns 补齐），
-- DDL 先于列迁移执行会 "no such column" 导致整个 exec 失败。由 migrateSiteIndexes 在列迁移后创建。

CREATE TABLE IF NOT EXISTS health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL, checked_at INTEGER NOT NULL,
  ok INTEGER NOT NULL, http_status INTEGER, latency_ms INTEGER, redirect_to TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS health_checks_site_idx ON health_checks(site_id);
CREATE INDEX IF NOT EXISTS health_checks_checked_idx ON health_checks(checked_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, actor_kind TEXT NOT NULL DEFAULT 'user',
  action TEXT NOT NULL, target TEXT, diff TEXT, ip TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action, id DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT, status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  next_run_at INTEGER
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_next_run_idx ON jobs(status, next_run_at);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY, response TEXT, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS embeddings (
  site_id TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL,
  vector BLOB, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_embeddings (
  slug TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  query TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS search_history_user_idx ON search_history(user_id);
CREATE INDEX IF NOT EXISTS search_history_created_idx ON search_history(created_at);
CREATE INDEX IF NOT EXISTS search_history_user_created_idx ON search_history(user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS user_vault_sync (
  user_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS system_states (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS taxonomy_proposals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_title TEXT,
  current_value TEXT,
  suggested_value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  meta TEXT,
  created_at INTEGER NOT NULL,
  applied_at INTEGER
);
CREATE INDEX IF NOT EXISTS taxonomy_proposals_status_idx ON taxonomy_proposals(status);
CREATE INDEX IF NOT EXISTS taxonomy_proposals_kind_idx ON taxonomy_proposals(kind);
CREATE INDEX IF NOT EXISTS taxonomy_proposals_target_idx ON taxonomy_proposals(target_id);

-- 插件市场三表（2026-10）：注册表 / 安装记录 / 星标
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  author TEXT,
  author_kind TEXT,
  license TEXT,
  homepage TEXT,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT,
  reviewed_at INTEGER,
  source TEXT NOT NULL DEFAULT 'user',
  install_count INTEGER NOT NULL DEFAULT 0,
  star_count INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS plugins_slug_idx ON plugins(slug);
CREATE INDEX IF NOT EXISTS plugins_status_idx ON plugins(status);
CREATE INDEX IF NOT EXISTS plugins_kind_idx ON plugins(kind);

CREATE TABLE IF NOT EXISTS plugin_installs (
  plugin_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  version TEXT NOT NULL,
  meta TEXT,
  installed_at INTEGER NOT NULL,
  removed_at INTEGER,
  PRIMARY KEY (plugin_id, identity)
);
CREATE INDEX IF NOT EXISTS plugin_installs_plugin_idx ON plugin_installs(plugin_id);

CREATE TABLE IF NOT EXISTS plugin_stars (
  plugin_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, identity)
);

CREATE TABLE IF NOT EXISTS plugin_versions (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,
  changelog TEXT,
  checksum TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(plugin_id, version)
);
CREATE INDEX IF NOT EXISTS plugin_versions_plugin_idx ON plugin_versions(plugin_id);

CREATE TABLE IF NOT EXISTS plugin_reviews (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  rating INTEGER NOT NULL,
  title TEXT,
  content TEXT,
  installed_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(plugin_id, identity)
);
CREATE INDEX IF NOT EXISTS plugin_reviews_plugin_idx ON plugin_reviews(plugin_id);
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
  alt_labels TEXT NOT NULL DEFAULT '[]',
  related_categories TEXT NOT NULL DEFAULT '[]',
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
  deleted_at BIGINT,
  metadata TEXT,
  visit_count INTEGER NOT NULL DEFAULT 0,
  last_visited_at BIGINT,
  trend_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
-- 注意：sites 的 url 唯一索引（部分索引 WHERE deleted_at IS NULL）不在此处创建——
-- 旧库还没有 deleted_at 列，DDL 会失败。由 migrateSiteIndexes 在列迁移后创建。
CREATE INDEX IF NOT EXISTS sites_category_idx ON sites(category_id);
CREATE INDEX IF NOT EXISTS sites_status_idx ON sites(status);
CREATE INDEX IF NOT EXISTS sites_pinyin_full_idx ON sites(pinyin_full);
CREATE INDEX IF NOT EXISTS sites_pinyin_initials_idx ON sites(pinyin_initials);
CREATE INDEX IF NOT EXISTS sites_source_status_idx ON sites(source, status);
-- 注意：sites_hot_idx（含 trend_score）不在此处创建——旧库还没有 trend_score 列，
-- DDL 先于 migrateColumns 执行会 "no such column" 导致整个 exec 失败。
-- 由 migrateSiteIndexes 在列迁移后创建（与 url 部分索引同理）。

-- pg_trgm 让 LIKE '%关键词%' 也能走索引（中文子串检索的关键）
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS sites_title_trgm_idx ON sites USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS sites_desc_trgm_idx ON sites USING gin (description gin_trgm_ops);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT 'topic', color TEXT, description TEXT,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_slug_idx ON tags(slug);

CREATE TABLE IF NOT EXISTS tag_aliases (
  alias TEXT PRIMARY KEY, tag_id TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS tag_aliases_tag_idx ON tag_aliases(tag_id);

CREATE TABLE IF NOT EXISTS site_tags (site_id TEXT NOT NULL, tag_id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS site_tags_site_idx ON site_tags(site_id);
CREATE INDEX IF NOT EXISTS site_tags_tag_idx ON site_tags(tag_id);
CREATE UNIQUE INDEX IF NOT EXISTS site_tags_unique_idx ON site_tags(site_id, tag_id);

CREATE TABLE IF NOT EXISTS site_facets (
  site_id TEXT NOT NULL, facet_key TEXT NOT NULL, facet_value TEXT NOT NULL,
  PRIMARY KEY (site_id, facet_key, facet_value)
);
CREATE INDEX IF NOT EXISTS site_facets_key_val_idx ON site_facets(facet_key, facet_value);
CREATE INDEX IF NOT EXISTS site_facets_site_idx ON site_facets(site_id);

CREATE TABLE IF NOT EXISTS site_relations (
  id TEXT PRIMARY KEY,
  source_site_id TEXT NOT NULL,
  target_site_id TEXT,
  target_title TEXT NOT NULL,
  target_url TEXT NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'related',
  is_free_or_open_source BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS site_relations_source_idx ON site_relations(source_site_id);
CREATE INDEX IF NOT EXISTS site_relations_target_idx ON site_relations(target_site_id);
CREATE INDEX IF NOT EXISTS site_relations_type_idx ON site_relations(relation_type);

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
CREATE INDEX IF NOT EXISTS collection_items_site_idx ON collection_items(site_id);

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
  scopes TEXT NOT NULL DEFAULT 'read', last_used_at BIGINT, expires_at BIGINT, created_at BIGINT NOT NULL,
  revoked_at BIGINT, rotated_at BIGINT, token_prefix TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_hash_idx ON api_tokens(token_hash);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, site_id TEXT, query TEXT,
  category_id TEXT, meta TEXT, identity TEXT, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_kind_idx ON events(kind);
CREATE INDEX IF NOT EXISTS events_site_idx ON events(site_id);
CREATE INDEX IF NOT EXISTS events_created_idx ON events(created_at);
CREATE INDEX IF NOT EXISTS events_search_idx ON events(kind, created_at, query);
-- events_identity_idx 同 SQLite：列由 migrateColumns 补齐后，migrateSiteIndexes 建索引

CREATE TABLE IF NOT EXISTS health_checks (
  id BIGSERIAL PRIMARY KEY, site_id TEXT NOT NULL, checked_at BIGINT NOT NULL,
  ok BOOLEAN NOT NULL, http_status INTEGER, latency_ms INTEGER, redirect_to TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS health_checks_site_idx ON health_checks(site_id);
CREATE INDEX IF NOT EXISTS health_checks_checked_idx ON health_checks(checked_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY, actor TEXT NOT NULL, actor_kind TEXT NOT NULL DEFAULT 'user',
  action TEXT NOT NULL, target TEXT, diff TEXT, ip TEXT, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action, id DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT, status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  next_run_at BIGINT
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_next_run_idx ON jobs(status, next_run_at);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY, response TEXT, created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS embeddings (
  site_id TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL,
  vector BYTEA, updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_embeddings (
  slug TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL,
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
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  query TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS search_history_user_idx ON search_history(user_id);
CREATE INDEX IF NOT EXISTS search_history_created_idx ON search_history(created_at);
CREATE INDEX IF NOT EXISTS search_history_user_created_idx ON search_history(user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS user_vault_sync (
  user_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_states (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS taxonomy_proposals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_title TEXT,
  current_value TEXT,
  suggested_value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  meta TEXT,
  created_at BIGINT NOT NULL,
  applied_at BIGINT
);
CREATE INDEX IF NOT EXISTS taxonomy_proposals_status_idx ON taxonomy_proposals(status);
CREATE INDEX IF NOT EXISTS taxonomy_proposals_kind_idx ON taxonomy_proposals(kind);
CREATE INDEX IF NOT EXISTS taxonomy_proposals_target_idx ON taxonomy_proposals(target_id);

-- 插件市场三表（2026-10）：注册表 / 安装记录 / 星标
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  author TEXT,
  author_kind TEXT,
  license TEXT,
  homepage TEXT,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT,
  reviewed_at BIGINT,
  source TEXT NOT NULL DEFAULT 'user',
  install_count INTEGER NOT NULL DEFAULT 0,
  star_count INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  published_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS plugins_slug_idx ON plugins(slug);
CREATE INDEX IF NOT EXISTS plugins_status_idx ON plugins(status);
CREATE INDEX IF NOT EXISTS plugins_kind_idx ON plugins(kind);

CREATE TABLE IF NOT EXISTS plugin_installs (
  plugin_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  version TEXT NOT NULL,
  meta TEXT,
  installed_at BIGINT NOT NULL,
  removed_at BIGINT,
  PRIMARY KEY (plugin_id, identity)
);
CREATE INDEX IF NOT EXISTS plugin_installs_plugin_idx ON plugin_installs(plugin_id);

CREATE TABLE IF NOT EXISTS plugin_stars (
  plugin_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (plugin_id, identity)
);

CREATE TABLE IF NOT EXISTS plugin_versions (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,
  changelog TEXT,
  checksum TEXT NOT NULL,
  published_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(plugin_id, version)
);
CREATE INDEX IF NOT EXISTS plugin_versions_plugin_idx ON plugin_versions(plugin_id);

CREATE TABLE IF NOT EXISTS plugin_reviews (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  rating INTEGER NOT NULL,
  title TEXT,
  content TEXT,
  installed_version TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(plugin_id, identity)
);
CREATE INDEX IF NOT EXISTS plugin_reviews_plugin_idx ON plugin_reviews(plugin_id);
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
    raw.pragma("synchronous = NORMAL");
    raw.pragma("journal_size_limit = 67108864");
    raw.pragma("foreign_keys = ON");
    // 并发防争用：设置 10 秒繁忙等待重试，配合 1000 页自动 checkpoint 避免 WAL 无界膨胀
    raw.pragma("busy_timeout = 10000");
    raw.pragma("wal_autocheckpoint = 1000");
    // 临时 b-tree 进内存：FTS5 的 bm25 排序与向量 KNN 都会产生临时表，
    // 落盘临时文件在并发检索时是纯浪费（页缓存直读即可）
    raw.pragma("temp_store = MEMORY");
    // mmap 读扫描：向量 float[512] 顺序扫描与 FTS 索引走页缓存直读，
    // 省掉 read 系统调用的用户态拷贝。这是上限不是预分配 ——
    // SQLite 只映射实际访问到的页，小内存部署同样安全。
    raw.pragma("mmap_size = 268435456"); // 256MB
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const db: Db = {
      dialect: "sqlite",
      orm: drizzle(raw),
      sqlite: raw,
      async close() { raw.close(); },
    };
    try {
      raw.exec(DDL_SQLITE);
    } catch {
      // 旧库启动保护：表存在但缺新列时（如 jobs 缺 next_run_at），
      // DDL 里的 CREATE INDEX 先崩（IF NOT EXISTS 只 guard 索引名，不 guard 列），
      // migrateColumns 还没机会补列——曾导致老部署升级即无法启动。
      // 先补列再重放 DDL（全是 IF NOT EXISTS，重放安全）；仍失败则原样抛出。
      await migrateColumns(db);
      raw.exec(DDL_SQLITE);
    }
    await migrateColumns(db);
    await migrateSiteIndexes(db);
    await migrateEventIdentity(db);
    return db;
  }

  if (config.dialect === "libsql") {
    let libsql: any;
    try {
      const moduleName = "@libsql/client";
      libsql = await (Function("m", "return import(m)")(moduleName) as Promise<any>);
    } catch {
      throw new Error("使用 libsql 方言前请先安装 @libsql/client: pnpm add @libsql/client");
    }
    const createClient = libsql.createClient || libsql.default?.createClient;
    const client = createClient({
      url: config.databaseUrl || "file:" + (config.sqlitePath ?? "./data/navhub.db"),
    });
    const runner: SqliteRunner = {
      exec(sqlStr: string) {
        return client.executeMultiple(sqlStr);
      },
      prepare(sqlStr: string) {
        return {
          run(...params: unknown[]) {
            return client.execute({ sql: sqlStr, args: params });
          },
          all(...params: unknown[]) {
            return client.execute({ sql: sqlStr, args: params });
          },
          get(...params: unknown[]) {
            return client.execute({ sql: sqlStr, args: params });
          },
        };
      },
      close() {
        client.close();
      },
    };
    const db: Db = {
      dialect: "libsql",
      orm: null,
      sqlite: runner,
      async close() { runner.close(); },
    };
    try {
      await client.executeMultiple(DDL_SQLITE);
    } catch {
      // 容错重试
      await migrateColumns(db);
      await client.executeMultiple(DDL_SQLITE);
    }
    await migrateColumns(db);
    await migrateSiteIndexes(db);
    await migrateEventIdentity(db);
    return db;
  }

  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const db: Db = {
    dialect: "pg",
    orm: drizzle(pool),
    pg: pool,
    async close() { await pool.end(); },
  };
  try {
    await pool.query(DDL_PG);
  } catch {
    // 同上：旧 PG 库缺列时索引先崩，先补列再重放（幂等语句，重放安全）。
    await migrateColumns(db);
    await pool.query(DDL_PG);
  }
  await migrateColumns(db);
  await migrateSiteIndexes(db);
  await migrateEventIdentity(db);
  return db;
}

/** 供 drizzle 查询使用的原始 SQL 助手 */
export { sql };
