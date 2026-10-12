/**
 * 数据库 schema —— 双驱动共享。
 *
 * 设计取舍：只使用 SQLite 与 PostgreSQL 都原生支持的列类型
 * （integer / real / text / blob），**不引入任何方言特定类型**。
 * 向量与全文索引由适配器层用虚拟表 / 扩展对象实现，而不是放进主 schema。
 *
 * 这样做的代价是向量列在 schema 里"看不见"，收益是同一份表定义能同时跑两种数据库，
 * 方言差异被收敛到 `driver.ts` 与 `vec.ts` 两个文件里。
 */
import { sqliteTable, text, integer, real, blob, index, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = () => Date.now();

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  /** 物化路径 "a/b/c"：避免"插入子类时父类可能不存在"的循环外键问题 */
  anchor: text("anchor").notNull(),
  parentId: text("parent_id"),
  title: text("title").notNull(),
  titleEn: text("title_en"),
  description: text("description"),
  icon: text("icon"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
}, (t) => [
  index("categories_anchor_idx").on(t.anchor),
  index("categories_parent_idx").on(t.parentId),
]);

export const sites = sqliteTable("sites", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  titleEn: text("title_en"),
  description: text("description"),
  descriptionEn: text("description_en"),
  iconKey: text("icon_key"),
  screenshotKey: text("screenshot_key"),
  categoryId: text("category_id").notNull(),
  subCategoryId: text("sub_category_id"),
  /** 逗号分隔的标签，配合 site_tags 视图/join 使用；查询走 tags 表关联 */
  status: text("status").notNull().default("active"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sort: integer("sort").notNull().default(0),
  weight: real("weight").notNull().default(0),
  featured: integer("featured", { mode: "boolean" }).notNull().default(false),
  source: text("source"),

  /* ---- 检索线索（写入期预计算，查询期零成本） ---- */
  /** CJK 二元分词后的 FTS 语料 */
  ftsTokens: text("fts_tokens").notNull().default(""),
  /** 全拼，如 qidongjiaoben */
  pinyinFull: text("pinyin_full").notNull().default(""),
  /** 首字母，如 qdjb */
  pinyinInitials: text("pinyin_initials").notNull().default(""),

  /* ---- 健康度 ---- */
  httpStatus: integer("http_status"),
  healthOk: integer("health_ok", { mode: "boolean" }),
  latencyMs: integer("latency_ms"),
  redirectTo: text("redirect_to"),
  healthError: text("health_error"),
  lastCheckedAt: integer("last_checked_at"),

  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
}, (t) => [
  uniqueIndex("sites_url_idx").on(t.url),
  index("sites_category_idx").on(t.categoryId),
  index("sites_status_idx").on(t.status),
  index("sites_pinyin_full_idx").on(t.pinyinFull),
  index("sites_pinyin_initials_idx").on(t.pinyinInitials),
]);

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [uniqueIndex("tags_slug_idx").on(t.slug)]);

export const siteTags = sqliteTable("site_tags", {
  siteId: text("site_id").notNull(),
  tagId: text("tag_id").notNull(),
}, (t) => [
  index("site_tags_site_idx").on(t.siteId),
  index("site_tags_tag_idx").on(t.tagId),
]);

export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  kind: text("kind").notNull().default("topic"),
  icon: text("icon"),
  sort: integer("sort").notNull().default(0),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
}, (t) => [uniqueIndex("collections_slug_idx").on(t.slug)]);

export const collectionItems = sqliteTable("collection_items", {
  collectionId: text("collection_id").notNull(),
  siteId: text("site_id").notNull(),
  sort: integer("sort").notNull().default(0),
  note: text("note"),
}, (t) => [index("collection_items_col_idx").on(t.collectionId)]);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [uniqueIndex("users_username_idx").on(t.username)]);

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** 只存哈希，永不落明文 */
  tokenHash: text("token_hash").notNull(),
  /** 逗号分隔的 scope：read,write,admin */
  scopes: text("scopes").notNull().default("read"),
  lastUsedAt: integer("last_used_at"),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [uniqueIndex("api_tokens_hash_idx").on(t.tokenHash)]);

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  siteId: text("site_id"),
  query: text("query"),
  categoryId: text("category_id"),
  meta: text("meta"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [
  index("events_kind_idx").on(t.kind),
  index("events_site_idx").on(t.siteId),
  index("events_created_idx").on(t.createdAt),
]);

export const healthChecks = sqliteTable("health_checks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: text("site_id").notNull(),
  checkedAt: integer("checked_at").notNull(),
  ok: integer("ok", { mode: "boolean" }).notNull(),
  httpStatus: integer("http_status"),
  latencyMs: integer("latency_ms"),
  redirectTo: text("redirect_to"),
  error: text("error"),
}, (t) => [index("health_checks_site_idx").on(t.siteId)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actor: text("actor").notNull(),
  actorKind: text("actor_kind").notNull().default("user"),
  action: text("action").notNull(),
  target: text("target"),
  diff: text("diff"),
  ip: text("ip"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [index("audit_logs_created_idx").on(t.createdAt), index("audit_logs_actor_idx").on(t.actor)]);

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  payload: text("payload"),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
}, (t) => [index("jobs_status_idx").on(t.status)]);

/** 幂等键：MCP/API 的写操作去重 */
export const idempotency = sqliteTable("idempotency", {
  key: text("key").primaryKey(),
  response: text("response"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

/** embedding 存这里而不是 sites 表：lite 模式用 vec0 虚拟表，standard 模式用 pgvector */
export const embeddings = sqliteTable("embeddings", {
  siteId: text("site_id").primaryKey(),
  model: text("model").notNull(),
  dim: integer("dim").notNull(),
  /** lite 模式的原始向量（Float32Array 的小端字节），vec0 只是它的索引 */
  vector: blob("vector", { mode: "buffer" }),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

export const schema = {
  categories, sites, tags, siteTags, collections, collectionItems,
  users, sessions, apiTokens, events, healthChecks, auditLogs, jobs, idempotency, embeddings,
};
