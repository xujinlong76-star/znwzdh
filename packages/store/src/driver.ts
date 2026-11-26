import { sql } from "drizzle-orm";
import { migrateColumns, migrateWorkspaceBlobs, cleanupOrphanPluginCategories } from "./migrate.ts";
import { runVersionedMigrations } from "./migrations/schema-migrations.ts";

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
  slug TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS categories_slug_idx ON categories(slug) WHERE slug IS NOT NULL;

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
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS site_id_aliases (
  old_site_id TEXT PRIMARY KEY,
  canonical_site_id TEXT NOT NULL,
  old_title TEXT,
  old_url TEXT,
  reason TEXT,
  merged_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS site_id_aliases_canonical_idx ON site_id_aliases(canonical_site_id);

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

/**
 * 公开导航页（Batch 3 第 6 项）。
 *
 * 用户把一个收藏文件夹发布成的公开只读页。live 引用：只存「哪个文件夹」，
 * 不存条目快照——读时按 owner + folder_id 现算收藏，发布后收藏增删自动跟随
 * （与 /pack 快照的区分点）。status='unpublished' 即下线，读端按不存在处理。
 * owner_identity 存 canonical 身份；公开读绝不返回它。
 */
CREATE TABLE IF NOT EXISTS public_pages (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, owner_identity TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT, folder_id TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS public_pages_slug_idx ON public_pages(slug);
CREATE INDEX IF NOT EXISTS public_pages_owner_idx ON public_pages(owner_identity);

/**
 * 对照快照（Batch 4 Phase 2 P2-3）：冻结的对照表，只 INSERT 不 UPDATE。
 * site_ids / snapshot_json 存 JSON 字符串；owner_identity 存 canonical 身份，
 * 注销随删（data-inventory.ts 登记 disposition=delete）。
 */
CREATE TABLE IF NOT EXISTS comparison_snapshots (
  id TEXT PRIMARY KEY, owner_identity TEXT NOT NULL,
  site_ids TEXT NOT NULL, snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comparison_snapshots_owner_idx ON comparison_snapshots(owner_identity, created_at);

/**
 * 对照分享（Batch 4 Phase 2 P2-4）：P2-3 快照的冻结公开副本。
 * 发布时把白名单字段的格子复制进 published_json（只含展示字段），公开读
 * 只 serving 这份副本；snapshot_id UNIQUE（每快照最多一个有效分享行，
 * 下线后重发删旧行建新行，旧 slug 永不复活）；注销随删（data-inventory.ts
 * 登记 disposition=delete，不进导出包）。
 */
CREATE TABLE IF NOT EXISTS comparison_snapshot_shares (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL UNIQUE,
  owner_identity TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  published_fields TEXT NOT NULL,
  published_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS snapshot_shares_slug_idx ON comparison_snapshot_shares(slug);
CREATE INDEX IF NOT EXISTS snapshot_shares_owner_idx ON comparison_snapshot_shares(owner_identity);

/**
 * 对照价格数值（Batch 4 Phase 2 P2-2）：每用户每站只留最新一条
 * （UNIQUE (owner_identity, site_id)，upsert 覆盖写；价格历史由快照承担）。
 * 金额存最小货币单位整数，杜绝浮点；verified_at 一律服务端写入。
 */
CREATE TABLE IF NOT EXISTS site_prices (
  id TEXT PRIMARY KEY,
  owner_identity TEXT NOT NULL,
  site_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  period TEXT NOT NULL,
  free_tier_limit TEXT,
  source_type TEXT NOT NULL,
  source_url TEXT,
  verified_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (owner_identity, site_id)
);
CREATE INDEX IF NOT EXISTS site_prices_owner_site_idx ON site_prices(owner_identity, site_id);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL, site_id TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, note TEXT
);
CREATE INDEX IF NOT EXISTS collection_items_col_idx ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS collection_items_site_idx ON collection_items(site_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin', email TEXT, avatar TEXT,
  source TEXT NOT NULL DEFAULT 'local', created_at INTEGER NOT NULL,
  password_version INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users(username);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
  user_agent TEXT, revoked_at INTEGER, last_seen_at INTEGER
);
CREATE TABLE IF NOT EXISTS revoked_users ( user_id TEXT PRIMARY KEY, revoked_before INTEGER NOT NULL );

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, identity TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
  body TEXT, link TEXT, read_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_identity_created_idx ON notifications(identity, created_at);

-- 匿名身份 -> 登录身份的别名（合并后旧 anonId 仍可解析到 canonical userId，
-- 避免旧标签页/其它设备带着旧 id 继续读写孤儿数据）
CREATE TABLE IF NOT EXISTS identity_aliases (
  alias TEXT PRIMARY KEY,
  canonical TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS identity_aliases_canonical_idx ON identity_aliases(canonical);

-- 合并记录：幂等与审计的唯一凭据（同一 source/target 只允许一条）
CREATE TABLE IF NOT EXISTS identity_merges (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  stats TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS identity_merges_pair_idx ON identity_merges(source, target);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'read', owner_identity TEXT, last_used_at INTEGER, expires_at INTEGER, created_at INTEGER NOT NULL,
  revoked_at INTEGER, rotated_at INTEGER, token_prefix TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_hash_idx ON api_tokens(token_hash);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, site_id TEXT, query TEXT,
  category_id TEXT, meta TEXT, identity TEXT, created_at INTEGER NOT NULL,
  event_id TEXT, event_day INTEGER
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
  next_run_at INTEGER, progress_done INTEGER NOT NULL DEFAULT 0, progress_total INTEGER NOT NULL DEFAULT 0,
  -- 本次执行的耗时（毫秒）。created_at→updated_at 含排队等待，用它算「跑了多久」会把
  -- 「在队列里等了 3 分钟」也算进执行时间；这一列只记 handler 本身的耗时。
  duration_ms INTEGER NOT NULL DEFAULT 0,
  -- 每次认领生成；心跳、进度与终态回写必须匹配，隔离被回收后重新认领的执行代次。
  run_token TEXT
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_next_run_idx ON jobs(status, next_run_at);
-- 任务历史翻页（P1-7）：与 GET /api/jobs 的 ORDER BY created_at DESC, id DESC 同向
CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS jobs_status_created_idx ON jobs(status, created_at DESC, id DESC);

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

CREATE TABLE IF NOT EXISTS site_radar (
  site_id TEXT PRIMARY KEY, payload TEXT NOT NULL, model TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  folder_id TEXT,
  note TEXT,
  tags TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_site_idx ON favorites(user_id, site_id);
CREATE INDEX IF NOT EXISTS favorites_user_idx ON favorites(user_id);

CREATE TABLE IF NOT EXISTS user_custom_sites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS user_custom_sites_user_idx ON user_custom_sites(user_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS wanted_searches (
  id TEXT PRIMARY KEY,
  identity TEXT NOT NULL,
  query TEXT NOT NULL,
  corrected_query TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  notified_site_id TEXT,
  notified_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS wanted_searches_identity_query_idx ON wanted_searches(identity, query);
CREATE INDEX IF NOT EXISTS wanted_searches_identity_status_idx ON wanted_searches(identity, status, created_at);

CREATE TABLE IF NOT EXISTS user_sync_state (
  identity TEXT NOT NULL,
  domain TEXT NOT NULL,
  last_success_at INTEGER,
  last_failure_at INTEGER,
  last_error_code TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (identity, domain)
);

CREATE TABLE IF NOT EXISTS crawl_sources (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'sitemap',
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  interval_ms INTEGER NOT NULL DEFAULT 3600000,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_status TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS crawl_sources_url_idx ON crawl_sources(url);
CREATE INDEX IF NOT EXISTS crawl_sources_enabled_next_idx ON crawl_sources(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS watch_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  drama_key TEXT NOT NULL,
  title TEXT NOT NULL,
  platform_site_id TEXT NOT NULL,
  platform_title TEXT NOT NULL,
  play_url TEXT NOT NULL,
  icon TEXT,
  episode INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'normal',
  cadence TEXT NOT NULL DEFAULT '{"kind":"unknown"}',
  remind INTEGER NOT NULL DEFAULT 1,
  dismissed_on TEXT,
  last_progress_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS watch_entries_user_key_idx ON watch_entries(user_id, drama_key);
CREATE INDEX IF NOT EXISTS watch_entries_user_idx ON watch_entries(user_id);
CREATE TABLE IF NOT EXISTS exam_follows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  exam_id TEXT NOT NULL,
  checked_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS exam_follows_user_exam_idx ON exam_follows(user_id, exam_id);
CREATE INDEX IF NOT EXISTS exam_follows_user_idx ON exam_follows(user_id);
CREATE TABLE IF NOT EXISTS drama_check_states (
 user_id TEXT NOT NULL,
 drama_key TEXT NOT NULL,
 latest_episode INTEGER,
 last_checked_at INTEGER NOT NULL,
 last_error TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY (user_id, drama_key)
);
CREATE INDEX IF NOT EXISTS drama_check_states_drama_idx ON drama_check_states(drama_key);

CREATE TABLE IF NOT EXISTS hotlist_entries (
  source TEXT NOT NULL,
  rank INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  hot_value INTEGER,
  hot_label TEXT,
  summary TEXT,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (source, rank)
);
CREATE INDEX IF NOT EXISTS hotlist_entries_source_idx ON hotlist_entries(source);

CREATE TABLE IF NOT EXISTS hotlist_sources (
  source TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  last_ok_at INTEGER,
  last_attempt_at INTEGER,
  last_error TEXT,
  item_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_briefs (
  date TEXT PRIMARY KEY,
  generated_at INTEGER NOT NULL,
  opening TEXT NOT NULL,
  opening_mode TEXT NOT NULL DEFAULT 'template',
  payload TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS user_llm_configs (
  identity TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  identity TEXT PRIMARY KEY,
  personalization_enabled INTEGER NOT NULL DEFAULT 1,
  favorite_signal_cutoff INTEGER NOT NULL DEFAULT 0,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
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
  owner_identity TEXT,
  owner_key TEXT,
  license TEXT,
  homepage TEXT,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT,
  reviewed_at INTEGER,
  pending_changelog TEXT,
  pending_version TEXT,
  pending_manifest TEXT,
  author_verified INTEGER NOT NULL DEFAULT 0,
  forked_from_slug TEXT,
  remix_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'user',
  install_count INTEGER NOT NULL DEFAULT 0,
  star_count INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  featured_rank INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS plugins_slug_idx ON plugins(slug);
CREATE INDEX IF NOT EXISTS plugins_status_idx ON plugins(status);
CREATE INDEX IF NOT EXISTS plugins_kind_idx ON plugins(kind);
CREATE INDEX IF NOT EXISTS plugins_owner_key_idx ON plugins(owner_key);
CREATE INDEX IF NOT EXISTS plugins_featured_idx ON plugins(featured);

CREATE TABLE IF NOT EXISTS plugin_installs (
  plugin_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  version TEXT NOT NULL,
  meta TEXT,
  installed_at INTEGER NOT NULL,
  removed_at INTEGER,
  disabled_at INTEGER,
  PRIMARY KEY (plugin_id, identity)
);
CREATE INDEX IF NOT EXISTS plugin_installs_plugin_idx ON plugin_installs(plugin_id);

CREATE TABLE IF NOT EXISTS plugin_stars (
  plugin_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, identity)
);

CREATE TABLE IF NOT EXISTS plugin_reports (
  plugin_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  ip TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, identity)
);
CREATE INDEX IF NOT EXISTS plugin_reports_plugin_idx ON plugin_reports(plugin_id);

CREATE TABLE IF NOT EXISTS plugin_review_reports (
  review_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  ip TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (review_id, identity)
);
CREATE INDEX IF NOT EXISTS plugin_review_reports_review_idx ON plugin_review_reports(review_id);

CREATE TABLE IF NOT EXISTS plugin_review_helpful_votes (
  review_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (review_id, identity)
);
CREATE INDEX IF NOT EXISTS plugin_review_helpful_votes_review_idx ON plugin_review_helpful_votes(review_id);

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
  status TEXT NOT NULL DEFAULT 'visible',
  report_count INTEGER NOT NULL DEFAULT 0,
  moderation_note TEXT,
  moderated_at INTEGER,
  moderated_by TEXT,
  author_reply TEXT,
  author_replied_at INTEGER,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(plugin_id, identity)
);
CREATE INDEX IF NOT EXISTS plugin_reviews_plugin_idx ON plugin_reviews(plugin_id);
CREATE INDEX IF NOT EXISTS plugin_reviews_status_idx ON plugin_reviews(status);

CREATE TABLE IF NOT EXISTS plugin_author_profiles (
  owner_key TEXT PRIMARY KEY,
  display_name TEXT,
  bio TEXT,
  avatar TEXT,
  links TEXT NOT NULL DEFAULT '{}',
  donate_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS short_links (
  code TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  plugin_slug TEXT,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_archives (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  excerpt TEXT,
  read_time_minutes INTEGER NOT NULL DEFAULT 1,
  html_content TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  captured_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS site_archives_site_id_idx ON site_archives(site_id);
CREATE INDEX IF NOT EXISTS site_archives_captured_at_idx ON site_archives(captured_at);

CREATE TABLE IF NOT EXISTS llm_usage (
  id TEXT PRIMARY KEY,
  scenario TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT NOT NULL,
  identity TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL,
  error_code TEXT,
  thinking INTEGER NOT NULL DEFAULT 0,
  cost_rmb REAL,
  prompt_price_per_1k REAL,
  completion_price_per_1k REAL,
  price_source TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS llm_usage_time_idx ON llm_usage(created_at);
CREATE INDEX IF NOT EXISTS llm_usage_scenario_idx ON llm_usage(scenario, created_at);
CREATE INDEX IF NOT EXISTS llm_usage_source_idx ON llm_usage(source, created_at);

/* 分模型单价簿：写入时快照进 llm_usage，改价不重算历史成本 */
CREATE TABLE IF NOT EXISTS llm_model_prices (
  model TEXT PRIMARY KEY,
  prompt_per_1k_rmb REAL NOT NULL,
  completion_per_1k_rmb REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

/* LLM 配额预留（P0-3）：额度判定与占位必须在同一事务里，见 repository/llm-quota.ts。
   短生命周期数据——结算即删，未结算的靠 expires_at 自动回收，不参与成本统计。 */
CREATE TABLE IF NOT EXISTS llm_quota_reservations (
  id TEXT PRIMARY KEY,
  identity TEXT,
  source TEXT NOT NULL DEFAULT 'system',
  reserved_calls INTEGER NOT NULL DEFAULT 1,
  reserved_tokens INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS llm_quota_res_expiry_idx ON llm_quota_reservations(expires_at);
CREATE INDEX IF NOT EXISTS llm_quota_res_identity_idx ON llm_quota_reservations(identity, expires_at);
CREATE INDEX IF NOT EXISTS llm_quota_res_source_idx ON llm_quota_reservations(source, expires_at);

/* ------------------------- 视频库（关系化） -------------------------
 * 为什么单独建表：videos.json 是「整包文档」模型，只能整体读写，
 * 无法按条查询、分页、审计单条变更，也挡不住两个写入口互相覆盖。
 * 这三张表是 C6 的基础设施：**当前仍以 JSON 为事实源**，表是可选的影子副本
 * （由 replaceVideoCatalog 全量同步），切换读写需要单独一轮灰度。
 *
 * 列只放「可查询/可排序」的字段；完整 videoConfig（章节、字幕等大字段）
 * 落在 payload 里，避免为了查一个健康状态去解析几十 KB 的章节树。
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS video_categories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  harvest_policy TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS video_items (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  title TEXT NOT NULL,
  href TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  platform TEXT,
  external_id TEXT,
  author TEXT,
  duration_sec INTEGER,
  published_at TEXT,
  quality_score INTEGER,
  freshness_score INTEGER,
  health_status TEXT,
  source_type TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS video_items_category_idx ON video_items(category_id, sort);
CREATE INDEX IF NOT EXISTS video_items_health_idx ON video_items(health_status);
-- 外部 ID 索引：**非唯一**。
-- 原先是 UNIQUE(platform, external_id)，但文档模型允许同一视频出现在多个分类/子分类
-- （实测 KV 中 74 条里有 4 个重复的 platform:externalId），唯一约束会让
-- 「文档 → 表」的全量同步直接失败（SQLITE_CONSTRAINT_UNIQUE），关系表永远对不齐事实源。
-- 「采集不得重复入库」由应用层 videoExternalKey 去重保证，不由这张镜像表的索引保证。
DROP INDEX IF EXISTS video_items_external_idx;
CREATE INDEX IF NOT EXISTS video_items_external_lookup_idx
  ON video_items(platform, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS video_replacements (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  category_title TEXT,
  old_item TEXT NOT NULL DEFAULT '{}',
  new_item TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  score_diff INTEGER,
  trend_keyword TEXT,
  rolled_back INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS video_replacements_category_idx ON video_replacements(category_id, created_at);

-- 导航数据版本号（升级方案 P1-1）：**恒为 id=1 的单行表**，用来替代快照热读路径上的
-- COUNT/MAX 指纹。
-- 为什么不用指纹：指纹在「缓存命中」时也要跑一遍，而 PG 在大表上的 COUNT(*) 是顺序扫描
-- （十万行几十毫秒）——等于命中也付一次重查询；多实例还只能靠 TTL 兜滞后，最长 30s 读到
-- 旧快照，而快照同时是后台「读-改-写」的写侧数据源，滞后不是慢而是丢数据。
-- 单行主键点查在两种方言里都是微秒级，且版本号在数据库里，跨实例天然可见。
-- 递增由触发器负责（见 migrateSiteIndexes）：写侧不必「记得 +1」，
-- 后台任务、运维脚本、测试里绕过仓储的直接写同样会被记到。
CREATE TABLE IF NOT EXISTS data_version (
  id INTEGER PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0
);
-- 触发器只做 UPDATE ... WHERE id = 1：行不在就等于静默失效，所以必须在建表时种下。
-- ON CONFLICT 让这条 DML 在每次启动重放 DDL 时都幂等。
INSERT INTO data_version (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
`;

const DDL_PG = `
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  anchor TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  title_en TEXT,
  slug TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS categories_slug_idx ON categories(slug) WHERE slug IS NOT NULL;

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
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
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
-- 裸列索引服务 ILIKE 场景（fts-pg 标题加权、收藏/插件搜索）。
CREATE INDEX IF NOT EXISTS sites_title_trgm_idx ON sites USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS sites_desc_trgm_idx ON sites USING gin (description gin_trgm_ops);
-- 检索 exact 通道谓词是 lower(title) / lower(coalesce(description,'')) LIKE，
-- 表达式必须逐字匹配才走索引；只建裸列索引时该通道会退化为全表扫描。
CREATE INDEX IF NOT EXISTS sites_title_lower_trgm_idx ON sites USING gin (lower(title) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS sites_desc_lower_trgm_idx ON sites USING gin (lower(coalesce(description, '')) gin_trgm_ops);

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

CREATE TABLE IF NOT EXISTS site_id_aliases (
  old_site_id TEXT PRIMARY KEY,
  canonical_site_id TEXT NOT NULL,
  old_title TEXT,
  old_url TEXT,
  reason TEXT,
  merged_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS site_id_aliases_canonical_idx ON site_id_aliases(canonical_site_id);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
  kind TEXT NOT NULL DEFAULT 'topic', icon TEXT, sort INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS collections_slug_idx ON collections(slug);

/** 公开导航页（Batch 3 第 6 项）：PG 侧与 SQLite 侧同形，见 SQLite 块注释。 */
CREATE TABLE IF NOT EXISTS public_pages (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, owner_identity TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT, folder_id TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS public_pages_slug_idx ON public_pages(slug);
CREATE INDEX IF NOT EXISTS public_pages_owner_idx ON public_pages(owner_identity);

/** 对照快照（Batch 4 Phase 2 P2-3）：PG 侧与 SQLite 侧同形，见 SQLite 块注释。 */
CREATE TABLE IF NOT EXISTS comparison_snapshots (
  id TEXT PRIMARY KEY, owner_identity TEXT NOT NULL,
  site_ids TEXT NOT NULL, snapshot_json TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS comparison_snapshots_owner_idx ON comparison_snapshots(owner_identity, created_at);

/** 对照分享（Batch 4 Phase 2 P2-4）：PG 侧与 SQLite 侧同形，见 SQLite 块注释。 */
CREATE TABLE IF NOT EXISTS comparison_snapshot_shares (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL UNIQUE,
  owner_identity TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  published_fields TEXT NOT NULL,
  published_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS snapshot_shares_slug_idx ON comparison_snapshot_shares(slug);
CREATE INDEX IF NOT EXISTS snapshot_shares_owner_idx ON comparison_snapshot_shares(owner_identity);

/** 对照价格数值（Batch 4 Phase 2 P2-2）：PG 侧与 SQLite 侧同形，见 SQLite 块注释。 */
CREATE TABLE IF NOT EXISTS site_prices (
  id TEXT PRIMARY KEY,
  owner_identity TEXT NOT NULL,
  site_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  period TEXT NOT NULL,
  free_tier_limit TEXT,
  source_type TEXT NOT NULL,
  source_url TEXT,
  verified_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (owner_identity, site_id)
);
CREATE INDEX IF NOT EXISTS site_prices_owner_site_idx ON site_prices(owner_identity, site_id);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL, site_id TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, note TEXT
);
CREATE INDEX IF NOT EXISTS collection_items_col_idx ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS collection_items_site_idx ON collection_items(site_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin', email TEXT, avatar TEXT,
  source TEXT NOT NULL DEFAULT 'local', created_at BIGINT NOT NULL,
  password_version INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users(username);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL,
  user_agent TEXT, revoked_at BIGINT, last_seen_at BIGINT
);
CREATE TABLE IF NOT EXISTS revoked_users ( user_id TEXT PRIMARY KEY, revoked_before BIGINT NOT NULL );

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, identity TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
  body TEXT, link TEXT, read_at BIGINT, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_identity_created_idx ON notifications(identity, created_at);

CREATE TABLE IF NOT EXISTS identity_aliases (
  alias TEXT PRIMARY KEY,
  canonical TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS identity_aliases_canonical_idx ON identity_aliases(canonical);

CREATE TABLE IF NOT EXISTS identity_merges (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  stats TEXT,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS identity_merges_pair_idx ON identity_merges(source, target);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'read', owner_identity TEXT, last_used_at BIGINT, expires_at BIGINT, created_at BIGINT NOT NULL,
  revoked_at BIGINT, rotated_at BIGINT, token_prefix TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_hash_idx ON api_tokens(token_hash);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, site_id TEXT, query TEXT,
  category_id TEXT, meta TEXT, identity TEXT, created_at BIGINT NOT NULL,
  event_id TEXT, event_day BIGINT
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
  next_run_at BIGINT, progress_done INTEGER NOT NULL DEFAULT 0, progress_total INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  run_token TEXT
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_next_run_idx ON jobs(status, next_run_at);
-- 任务历史翻页（P1-7）：与 GET /api/jobs 的 ORDER BY created_at DESC, id DESC 同向
CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS jobs_status_created_idx ON jobs(status, created_at DESC, id DESC);

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

CREATE TABLE IF NOT EXISTS site_radar (
  site_id TEXT PRIMARY KEY, payload TEXT NOT NULL, model TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  folder_id TEXT,
  note TEXT,
  tags TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_site_idx ON favorites(user_id, site_id);
CREATE INDEX IF NOT EXISTS favorites_user_idx ON favorites(user_id);

CREATE TABLE IF NOT EXISTS user_custom_sites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS user_custom_sites_user_idx ON user_custom_sites(user_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS wanted_searches (
  id TEXT PRIMARY KEY,
  identity TEXT NOT NULL,
  query TEXT NOT NULL,
  corrected_query TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  notified_site_id TEXT,
  notified_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS wanted_searches_identity_query_idx ON wanted_searches(identity, query);
CREATE INDEX IF NOT EXISTS wanted_searches_identity_status_idx ON wanted_searches(identity, status, created_at);

CREATE TABLE IF NOT EXISTS user_sync_state (
  identity TEXT NOT NULL,
  domain TEXT NOT NULL,
  last_success_at BIGINT,
  last_failure_at BIGINT,
  last_error_code TEXT,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (identity, domain)
);

CREATE TABLE IF NOT EXISTS crawl_sources (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'sitemap',
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  interval_ms BIGINT NOT NULL DEFAULT 3600000,
  next_run_at BIGINT NOT NULL,
  last_run_at BIGINT,
  last_status TEXT,
  last_error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS crawl_sources_url_idx ON crawl_sources(url);
CREATE INDEX IF NOT EXISTS crawl_sources_enabled_next_idx ON crawl_sources(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS watch_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  drama_key TEXT NOT NULL,
  title TEXT NOT NULL,
  platform_site_id TEXT NOT NULL,
  platform_title TEXT NOT NULL,
  play_url TEXT NOT NULL,
  icon TEXT,
  episode INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'normal',
  cadence TEXT NOT NULL DEFAULT '{"kind":"unknown"}',
  remind INTEGER NOT NULL DEFAULT 1,
  dismissed_on TEXT,
  last_progress_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS watch_entries_user_key_idx ON watch_entries(user_id, drama_key);
CREATE INDEX IF NOT EXISTS watch_entries_user_idx ON watch_entries(user_id);
CREATE TABLE IF NOT EXISTS exam_follows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  exam_id TEXT NOT NULL,
  checked_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS exam_follows_user_exam_idx ON exam_follows(user_id, exam_id);
CREATE INDEX IF NOT EXISTS exam_follows_user_idx ON exam_follows(user_id);
CREATE TABLE IF NOT EXISTS drama_check_states (
 user_id TEXT NOT NULL,
 drama_key TEXT NOT NULL,
 latest_episode INTEGER,
 last_checked_at INTEGER NOT NULL,
 last_error TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY (user_id, drama_key)
);
CREATE INDEX IF NOT EXISTS drama_check_states_drama_idx ON drama_check_states(drama_key);

CREATE TABLE IF NOT EXISTS hotlist_entries (
  source TEXT NOT NULL,
  rank INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  hot_value BIGINT,
  hot_label TEXT,
  summary TEXT,
  fetched_at BIGINT NOT NULL,
  PRIMARY KEY (source, rank)
);
CREATE INDEX IF NOT EXISTS hotlist_entries_source_idx ON hotlist_entries(source);

CREATE TABLE IF NOT EXISTS hotlist_sources (
  source TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  last_ok_at BIGINT,
  last_attempt_at BIGINT,
  last_error TEXT,
  item_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_briefs (
  date TEXT PRIMARY KEY,
  generated_at BIGINT NOT NULL,
  opening TEXT NOT NULL,
  opening_mode TEXT NOT NULL DEFAULT 'template',
  payload TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS user_llm_configs (
  identity TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  identity TEXT PRIMARY KEY,
  personalization_enabled INTEGER NOT NULL DEFAULT 1,
  favorite_signal_cutoff BIGINT NOT NULL DEFAULT 0,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
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
  owner_identity TEXT,
  owner_key TEXT,
  license TEXT,
  homepage TEXT,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT,
  reviewed_at BIGINT,
  pending_changelog TEXT,
  pending_version TEXT,
  pending_manifest TEXT,
  author_verified BOOLEAN NOT NULL DEFAULT FALSE,
  forked_from_slug TEXT,
  remix_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'user',
  install_count INTEGER NOT NULL DEFAULT 0,
  star_count INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  featured_rank INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  published_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS plugins_slug_idx ON plugins(slug);
CREATE INDEX IF NOT EXISTS plugins_status_idx ON plugins(status);
CREATE INDEX IF NOT EXISTS plugins_kind_idx ON plugins(kind);
CREATE INDEX IF NOT EXISTS plugins_owner_key_idx ON plugins(owner_key);
CREATE INDEX IF NOT EXISTS plugins_featured_idx ON plugins(featured);

CREATE TABLE IF NOT EXISTS plugin_installs (
  plugin_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  version TEXT NOT NULL,
  meta TEXT,
  installed_at BIGINT NOT NULL,
  removed_at BIGINT,
  disabled_at BIGINT,
  PRIMARY KEY (plugin_id, identity)
);
CREATE INDEX IF NOT EXISTS plugin_installs_plugin_idx ON plugin_installs(plugin_id);

CREATE TABLE IF NOT EXISTS plugin_stars (
  plugin_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (plugin_id, identity)
);

CREATE TABLE IF NOT EXISTS plugin_reports (
  plugin_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  ip TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  PRIMARY KEY (plugin_id, identity)
);
CREATE INDEX IF NOT EXISTS plugin_reports_plugin_idx ON plugin_reports(plugin_id);

CREATE TABLE IF NOT EXISTS plugin_review_reports (
  review_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  ip TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  PRIMARY KEY (review_id, identity)
);
CREATE INDEX IF NOT EXISTS plugin_review_reports_review_idx ON plugin_review_reports(review_id);

CREATE TABLE IF NOT EXISTS plugin_review_helpful_votes (
  review_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (review_id, identity)
);
CREATE INDEX IF NOT EXISTS plugin_review_helpful_votes_review_idx ON plugin_review_helpful_votes(review_id);

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
  status TEXT NOT NULL DEFAULT 'visible',
  report_count INTEGER NOT NULL DEFAULT 0,
  moderation_note TEXT,
  moderated_at BIGINT,
  moderated_by TEXT,
  author_reply TEXT,
  author_replied_at INTEGER,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(plugin_id, identity)
);
CREATE INDEX IF NOT EXISTS plugin_reviews_plugin_idx ON plugin_reviews(plugin_id);
CREATE INDEX IF NOT EXISTS plugin_reviews_status_idx ON plugin_reviews(status);

CREATE TABLE IF NOT EXISTS plugin_author_profiles (
  owner_key TEXT PRIMARY KEY,
  display_name TEXT,
  bio TEXT,
  avatar TEXT,
  links TEXT NOT NULL DEFAULT '{}',
  donate_url TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS short_links (
  code TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  plugin_slug TEXT,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_archives (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  excerpt TEXT,
  read_time_minutes INTEGER NOT NULL DEFAULT 1,
  html_content TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  captured_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS site_archives_site_id_idx ON site_archives(site_id);
CREATE INDEX IF NOT EXISTS site_archives_captured_at_idx ON site_archives(captured_at);

CREATE TABLE IF NOT EXISTS llm_usage (
  id TEXT PRIMARY KEY,
  scenario TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT NOT NULL,
  identity TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ok BOOLEAN NOT NULL DEFAULT TRUE,
  error_code TEXT,
  thinking BOOLEAN NOT NULL DEFAULT FALSE,
  cost_rmb DOUBLE PRECISION,
  prompt_price_per_1k DOUBLE PRECISION,
  completion_price_per_1k DOUBLE PRECISION,
  price_source TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS llm_usage_time_idx ON llm_usage(created_at);
CREATE INDEX IF NOT EXISTS llm_usage_scenario_idx ON llm_usage(scenario, created_at);
CREATE INDEX IF NOT EXISTS llm_usage_source_idx ON llm_usage(source, created_at);

/* 分模型单价簿：写入时快照进 llm_usage，改价不重算历史成本 */
CREATE TABLE IF NOT EXISTS llm_model_prices (
  model TEXT PRIMARY KEY,
  prompt_per_1k_rmb DOUBLE PRECISION NOT NULL,
  completion_per_1k_rmb DOUBLE PRECISION NOT NULL,
  updated_at BIGINT NOT NULL
);

/* LLM 配额预留（P0-3）：与 SQLite 分支同构，时间戳用 BIGINT */
CREATE TABLE IF NOT EXISTS llm_quota_reservations (
  id TEXT PRIMARY KEY,
  identity TEXT,
  source TEXT NOT NULL DEFAULT 'system',
  reserved_calls INTEGER NOT NULL DEFAULT 1,
  reserved_tokens INTEGER NOT NULL DEFAULT 0,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS llm_quota_res_expiry_idx ON llm_quota_reservations(expires_at);
CREATE INDEX IF NOT EXISTS llm_quota_res_identity_idx ON llm_quota_reservations(identity, expires_at);
CREATE INDEX IF NOT EXISTS llm_quota_res_source_idx ON llm_quota_reservations(source, expires_at);

/* ------------------------- 视频库（关系化） -------------------------
 * 为什么单独建表：videos.json 是「整包文档」模型，只能整体读写，
 * 无法按条查询、分页、审计单条变更，也挡不住两个写入口互相覆盖。
 * 这三张表是 C6 的基础设施：**当前仍以 JSON 为事实源**，表是可选的影子副本
 * （由 replaceVideoCatalog 全量同步），切换读写需要单独一轮灰度。
 *
 * 列只放「可查询/可排序」的字段；完整 videoConfig（章节、字幕等大字段）
 * 落在 payload 里，避免为了查一个健康状态去解析几十 KB 的章节树。
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS video_categories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort INTEGER NOT NULL DEFAULT 0,
  harvest_policy TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS video_items (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  title TEXT NOT NULL,
  href TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort INTEGER NOT NULL DEFAULT 0,
  platform TEXT,
  external_id TEXT,
  author TEXT,
  duration_sec INTEGER,
  published_at TEXT,
  quality_score INTEGER,
  freshness_score INTEGER,
  health_status TEXT,
  source_type TEXT,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS video_items_category_idx ON video_items(category_id, sort);
CREATE INDEX IF NOT EXISTS video_items_health_idx ON video_items(health_status);
-- 外部 ID 索引：**非唯一**。
-- 原先是 UNIQUE(platform, external_id)，但文档模型允许同一视频出现在多个分类/子分类
-- （实测 KV 中 74 条里有 4 个重复的 platform:externalId），唯一约束会让
-- 「文档 → 表」的全量同步直接失败（SQLITE_CONSTRAINT_UNIQUE），关系表永远对不齐事实源。
-- 「采集不得重复入库」由应用层 videoExternalKey 去重保证，不由这张镜像表的索引保证。
DROP INDEX IF EXISTS video_items_external_idx;
CREATE INDEX IF NOT EXISTS video_items_external_lookup_idx
  ON video_items(platform, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS video_replacements (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  category_title TEXT,
  old_item TEXT NOT NULL DEFAULT '{}',
  new_item TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  score_diff INTEGER,
  trend_keyword TEXT,
  rolled_back BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS video_replacements_category_idx ON video_replacements(category_id, created_at);

-- 导航数据版本号（见 DDL_SQLITE 同名片段的说明）。
-- 这里必须是 BIGINT：递增由触发器完成，一次 8000 站的快照保存就吃掉 8000，
-- INTEGER（int32，21 亿）在长期运行 + 批量写的环境里是会溢出的。
CREATE TABLE IF NOT EXISTS data_version (
  id INTEGER PRIMARY KEY,
  version BIGINT NOT NULL DEFAULT 0
);
INSERT INTO data_version (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
`;

export const DDL = { sqlite: DDL_SQLITE, pg: DDL_PG } as const;

export async function openDb(config: {
  dialect: Dialect;
  sqlitePath?: string;
  databaseUrl?: string;
  /** 停用「孤儿插件类目」启动清扫（NAVHUB_SKIP_ORPHAN_CLEANUP=1）。类目树迁移窗口必须停用。 */
  skipOrphanCleanup?: boolean;
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
    raw.pragma("cache_size = -65536"); // 64MB 页缓存（按需分配，确保 4,800+ 站点与 FTS5/trigram 热索引常驻内存）
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

    // 结构修复（2026-11-25）：列迁移不能只在 DDL 抛错时跑——DDL 全是 IF NOT EXISTS，
    // 表与索引都齐全时 exec 成功、migrateColumns 永不执行；而版本化迁移
    // 20261001_column_alters 早已记账只跑一次，之后新登记的列（consecutive_failures /
    // helpful_count 等）在存量库上永远补不上，读路径直接 "no such column"。
    // migrateColumns 自身按 PRAGMA 判重、幂等，每次启动无条件跑一次才符合其设计意图。
    await migrateColumns(db);

    // 先清空重复 email，再建 users_email_unique_idx（索引在 migrateSiteIndexes 里）。
    // 顺序不能反：存量重复会让 CREATE UNIQUE INDEX 失败，而那里是逐语句 try/catch，
    // 失败等于静默跳过索引 —— 看起来迁移成功，实际约束从未生效。
    await runVersionedMigrations(db);
    await migrateWorkspaceBlobs(db);

    await cleanupOrphanPluginCategories(db, { skip: config.skipOrphanCleanup });
    return db;
  }

  if (config.dialect === "libsql") {
    /**
     * 明确拒绝，而不是「看起来能跑」。
     *
     * `Db.sqlite` 是**同步**接口（better-sqlite3 语义）：调用方写完 `.all()` 就当数组用。
     * `@libsql/client` 的 execute() 返回 Promise —— 旧实现把这个 Promise 原样当成
     * `{ rows }` 返回，于是每一次查询在上层都表现为「空结果」：不抛错、不打日志，
     * 只是数据默默消失（列表永远空、计数永远 0）。这比启动失败难排查得多。
     *
     * 真要支持 libsql，得先把仓储层（116 个文件的调用点）改成异步接口，
     * 属于架构级改动；在那之前这里必须 fail fast。README / 配置项均未宣传该方言，
     * 因此不会破坏任何既有部署。
     */
    throw new Error(
      "libsql 方言尚未实现：Db 的同步查询接口与 @libsql/client 的异步驱动不兼容" +
        "（查询会静默返回空结果）。请使用 sqlite（better-sqlite3）或 pg 方言。",
    );
  }

  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    // 默认 0 = 无限等待：连不上时请求与就绪探针会一起挂死，必须显式给上限。
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    // 单语句超时：防止慢查询长期占住连接、拖垮整个池。上限放宽到 60s，
    // 避免把大库上的分析型查询误杀。
    statement_timeout: 60_000,
    query_timeout: 60_000,
  });
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

  // 同 sqlite 分支的结构修复：无条件跑幂等列迁移，兜住版本化迁移记账后新增的列。
  await migrateColumns(db);

  // 同 sqlite 分支：dedupe 必须早于 users_email_unique_idx 的创建（在 migrateSiteIndexes 内）。
  await runVersionedMigrations(db);
  await migrateWorkspaceBlobs(db);



  await cleanupOrphanPluginCategories(db, { skip: config.skipOrphanCleanup });
  return db;
}

/** 供 drizzle 查询使用的原始 SQL 助手 */
export { sql };
