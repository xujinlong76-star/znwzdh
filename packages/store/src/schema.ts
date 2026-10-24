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
import { sqliteTable, text, integer, real, blob, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

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
  /** 来源：navsphere（前端快照托管）| api | ai | seed；null 视为前端托管（兼容旧数据） */
  source: text("source"),
  /** SKOS:altLabel - 分类同义词/备选标签 (JSON 字符串数组) */
  altLabels: text("alt_labels").notNull().default("[]"),
  /** SKOS:related - 跨分类概念关联 ID 列表 (JSON 字符串数组) */
  relatedCategories: text("related_categories").notNull().default("[]"),
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

  /* ---- 行为统计（由 events 聚合写入，供热度排序使用） ---- */
  /** 总点击次数 */
  visitCount: integer("visit_count").notNull().default(0),
  /** 最近一次点击时间 */
  lastVisitedAt: integer("last_visited_at"),
  /** 热度分（recompute_rank 任务重算；浏览排序的第二键） */
  trendScore: real("trend_score").notNull().default(0),

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

  /* ---- 软删除（回收站）：NULL=正常，非 NULL=删除时刻，可恢复 ---- */
  deletedAt: integer("deleted_at"),

  /* ---- 扩展元数据（4.0 生态微动作、平替雷达、LiveMetrics 与场景工作台 JSON） ---- */
  metadata: text("metadata"),

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
  group: text("group_name").notNull().default("topic"),
  color: text("color"),
  description: text("description"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [uniqueIndex("tags_slug_idx").on(t.slug)]);

export const tagAliases = sqliteTable("tag_aliases", {
  alias: text("alias").primaryKey(),
  tagId: text("tag_id").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [
  index("tag_aliases_tag_idx").on(t.tagId),
]);

export const siteTags = sqliteTable("site_tags", {
  siteId: text("site_id").notNull(),
  tagId: text("tag_id").notNull(),
}, (t) => [
  index("site_tags_site_idx").on(t.siteId),
  index("site_tags_tag_idx").on(t.tagId),
]);

export const siteFacets = sqliteTable("site_facets", {
  siteId: text("site_id").notNull(),
  facetKey: text("facet_key").notNull(),
  facetValue: text("facet_value").notNull(),
}, (t) => [
  primaryKey({ columns: [t.siteId, t.facetKey, t.facetValue] }),
  index("site_facets_key_val_idx").on(t.facetKey, t.facetValue),
  index("site_facets_site_idx").on(t.siteId),
]);

export const siteRelations = sqliteTable("site_relations", {
  id: text("id").primaryKey(),
  sourceSiteId: text("source_site_id").notNull(),
  targetSiteId: text("target_site_id"),
  targetTitle: text("target_title").notNull(),
  targetUrl: text("target_url").notNull(),
  relationType: text("relation_type").notNull().default("related"),
  isFreeOrOpenSource: integer("is_free_or_open_source", { mode: "boolean" }).notNull().default(false),
  note: text("note"),
  confidence: real("confidence").notNull().default(1.0),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
}, (t) => [
  index("site_relations_source_idx").on(t.sourceSiteId),
  index("site_relations_target_idx").on(t.targetSiteId),
  index("site_relations_type_idx").on(t.relationType),
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
  /** 终端用户资料（管理员账号这两列为空） */
  email: text("email"),
  avatar: text("avatar"),
  /** 身份来源：github（OAuth 登录用户）| local（内置管理员） */
  source: text("source").notNull().default("local"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [uniqueIndex("users_username_idx").on(t.username)]);

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  // 会话治理（T8）：此前 sessions 是全库零读写的死表（纯 JWT 无吊销面）。
  // 激活后：token 存 JWT sid 的 sha256（不落原始 sid），revoked_at 非空即已踢出，
  // user_agent/last_seen_at 支撑设备列表展示。
  userAgent: text("user_agent"),
  revokedAt: integer("revoked_at"),
  lastSeenAt: integer("last_seen_at"),
});

/**
 * 站内通知（T13）：面向终端用户的轻量消息（同步失败、备份超期提醒等）。
 * 只读消费走 /api/me/notifications；运营触发源写这里。read_at 非空即已读。
 */
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  identity: text("identity").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  readAt: integer("read_at"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [index("notifications_identity_created_idx").on(t.identity, t.createdAt)]);

/** 匿名身份 -> 登录身份的别名；合并后旧 anonId 仍能解析到 canonical id */
export const identityAliases = sqliteTable("identity_aliases", {
  alias: text("alias").primaryKey(),
  canonical: text("canonical").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [index("identity_aliases_canonical_idx").on(t.canonical)]);

/** 合并记录（幂等 + 审计）；同一 source/target 只允许一条 */
export const identityMerges = sqliteTable("identity_merges", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  target: text("target").notNull(),
  status: text("status").notNull().default("completed"),
  stats: text("stats"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [uniqueIndex("identity_merges_pair_idx").on(t.source, t.target)]);

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** 只存哈希，永不落明文 */
  tokenHash: text("token_hash").notNull(),
  /** 逗号分隔的 scope：read,write,admin */
  scopes: text("scopes").notNull().default("read"),
  /** 归属用户身份（T20）：非空 = 用户自建个人令牌，用户域以它为身份 */
  ownerIdentity: text("owner_identity"),
  lastUsedAt: integer("last_used_at"),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  /** 软吊销时间；非空即失效，但记录保留以便审计可追溯 */
  revokedAt: integer("revoked_at"),
  /** 上次轮换时间；轮换不重写 created_at */
  rotatedAt: integer("rotated_at"),
  /** 明文前缀（如 nh_1a2b），仅用于列表区分，不含可还原部分 */
  tokenPrefix: text("token_prefix"),
}, (t) => [uniqueIndex("api_tokens_hash_idx").on(t.tokenHash)]);

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  siteId: text("site_id"),
  query: text("query"),
  categoryId: text("category_id"),
  meta: text("meta"),
  /** 行为归属身份（userId / anonId）：独立列供等值过滤（历史行由启动回填） */
  identity: text("identity"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [
  index("events_kind_idx").on(t.kind),
  index("events_site_idx").on(t.siteId),
  index("events_created_idx").on(t.createdAt),
  index("events_identity_idx").on(t.identity),
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

/**
 * 插件语义索引的持久层（与 embeddings 同构，键是插件 slug）。
 *
 * 为什么分表而不是把 "plugin:" 前缀塞进 embeddings.site_id：站点与插件的
 * KNN 检索是两组独立结果集，混在一张 vec0 表里会互相挤占 top-N 名额；
 * 分表后两边各自的 rehydrate 计数校验也互不影响（对方多写一行不该触发
 * 本方的全量重建）。
 */
export const pluginEmbeddings = sqliteTable("plugin_embeddings", {
  slug: text("slug").primaryKey(),
  model: text("model").notNull(),
  dim: integer("dim").notNull(),
  vector: blob("vector", { mode: "buffer" }),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

/* ------------------------------------------------------------------ *
 * 终端用户：收藏夹 / 收藏夹文件夹 / 个性化画像 / 搜索历史
 * ------------------------------------------------------------------ */

/** 用户收藏。匿名用户先用 localStorage，登录后合并至此 */
export const favorites = sqliteTable("favorites", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  siteId: text("site_id").notNull(),
  folderId: text("folder_id"),
  note: text("note"),
  /** 标签（T22）：JSON 字符串数组；null = 未打标签。契约见 repository/favorites.ts normalizeFavoriteTags */
  tags: text("tags"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
}, (t) => [
  uniqueIndex("favorites_user_site_idx").on(t.userId, t.siteId),
  index("favorites_user_idx").on(t.userId),
]);

/** 收藏夹文件夹 */
export const favoriteFolders = sqliteTable("favorite_folders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [index("favorite_folders_user_idx").on(t.userId)]);

/**
 * 个性化画像：由 events 聚合而来，供 /api/search 注入 personalize 信号。
 * 刻意做成「宽表 + JSON 文本列」而不是规范化的偏好表——读取路径每次搜索都要用，
 * 聚合是批量的，读写频率极度不对称。
 */
export const userProfiles = sqliteTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  /** JSON: string[]  时间衰减加权后的 top 分类 id */
  topCategories: text("top_categories").notNull().default("[]"),
  /** JSON: string[]  top 标签 slug */
  topTags: text("top_tags").notNull().default("[]"),
  /** JSON: string[]  最近点击站点 id（保序） */
  visitedSiteIds: text("visited_site_ids").notNull().default("[]"),
  /** JSON: string[]  收藏站点 id */
  favoriteSiteIds: text("favorite_site_ids").notNull().default("[]"),
  searchCount: integer("search_count").notNull().default(0),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

/** 搜索历史：匿名存 anonId（localStorage 生成），登录后按 userId 归一。
 *  id 用自增整数而不是 uuid：这是 append-only 日志，自增主键同时解决
 *  「同毫秒多条记录的稳定排序」问题（与 events / audit_logs 一致）。 */
export const searchHistory = sqliteTable("search_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  query: text("query").notNull(),
  resultCount: integer("result_count").notNull().default(0),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [
  index("search_history_user_idx").on(t.userId),
  index("search_history_created_idx").on(t.createdAt),
]);

/**
 * 用户端侧加密金库云端同步表（E2EE 零知识持久化）。
 * 服务端仅存密文 payload，无主密钥无法解密。
 */
export const userVaultSync = sqliteTable("user_vault_sync", {
  userId: text("user_id").primaryKey(),
  payload: text("payload").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

/**
 * 工作区明文存储（独立于 E2EE 金库，见 repository/workspace-blobs.ts）。
 *
 * 键沿用旧版格式（`workspaces:<identity>` / `ws_members:<identity>:<wsId>`），
 * 表由 migrate.ts 的幂等 DDL 创建；这里补 Drizzle 声明保持 schema 单一事实源。
 */
export const userWorkspaceBlobs = sqliteTable("user_workspace_blobs", {
  userId: text("user_id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

/**
 * 系统全局状态表：用于存储模型检查点（LinUCB 等）与自动化任务调度运行水位。
 */
export const systemStates = sqliteTable("system_states", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

/**
 * 用户级 LLM 模型配置（个人设置中心）。
 *
 * 身份口径与收藏/画像一致：anon-xxx / userId / token:<id>。
 * provider 存 JSON（密钥字段为加密信封），避免为每个参数加列；
 * 单条记录可随身份注销/画像重置一并删除。
 */
export const userLlmConfigs = sqliteTable("user_llm_configs", {
  identity: text("identity").primaryKey(),
  provider: text("provider").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

/**
 * 用户中心设置（画像开关等）。
 *
 * favoriteSignalCutoff：用户清掉「收藏信号」的时间点，早于它的收藏不再参与
 * 画像的 favoriteSiteIds；收藏本身保留（那是用户数据，不是被推断的偏好）。
 */
export const userSettings = sqliteTable("user_settings", {
  identity: text("identity").primaryKey(),
  personalizationEnabled: integer("personalization_enabled", { mode: "boolean" }).notNull().default(true),
  favoriteSignalCutoff: integer("favorite_signal_cutoff").notNull().default(0),
  preferencesJson: text("preferences_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

/**
 * 分类与标签治理提案表（Taxonomy Proposals）
 * 存储 AI / 启发式规则生成的待审提案（分类契合迁移、冗余标签合并、零结果缺口等）
 */
export const taxonomyProposals = sqliteTable("taxonomy_proposals", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  targetId: text("target_id").notNull(),
  targetTitle: text("target_title"),
  currentValue: text("current_value"),
  suggestedValue: text("suggested_value").notNull(),
  confidence: real("confidence").notNull().default(0.8),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  meta: text("meta"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  appliedAt: integer("applied_at"),
}, (t) => [
  index("taxonomy_proposals_status_idx").on(t.status),
  index("taxonomy_proposals_kind_idx").on(t.kind),
  index("taxonomy_proposals_target_idx").on(t.targetId),
]);

/**
 * 插件市场：插件注册表（社区广场）。
 * manifest 存「已校验清洗后」的完整清单 JSON；计数列在写路径维护（与活跃状态挂钩，不做读时聚合）。
 */
export const plugins = sqliteTable("plugins", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  icon: text("icon"),
  tags: text("tags").notNull().default("[]"),
  author: text("author"),
  authorKind: text("author_kind"),
  /** 作者归属（内部标识；仅归属校验使用，不对外返回） */
  ownerIdentity: text("owner_identity"),
  /** 作者公开页 key（ownerIdentity 的不可逆哈希；可安全出现在 URL） */
  ownerKey: text("owner_key"),
  license: text("license"),
  homepage: text("homepage"),
  version: text("version").notNull(),
  manifest: text("manifest").notNull(),
  status: text("status").notNull().default("pending"),
  reviewNote: text("review_note"),
  reviewedAt: integer("reviewed_at"),
  /** 作者提交新版本时填写的变更说明；审核通过后写入版本历史并清空 */
  pendingChangelog: text("pending_changelog"),
  source: text("source").notNull().default("user"),
  installCount: integer("install_count").notNull().default(0),
  starCount: integer("star_count").notNull().default(0),
  reportCount: integer("report_count").notNull().default(0),
  /** 编辑精选（仅 published 生效；排序用 featuredRank 降序） */
  featured: integer("featured", { mode: "boolean" }).notNull().default(false),
  featuredRank: integer("featured_rank").notNull().default(0),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
  publishedAt: integer("published_at"),
}, (t) => [
  uniqueIndex("plugins_slug_idx").on(t.slug),
  index("plugins_status_idx").on(t.status),
  index("plugins_kind_idx").on(t.kind),
  index("plugins_owner_key_idx").on(t.ownerKey),
  index("plugins_featured_idx").on(t.featured),
]);

/** 插件安装记录（复合主键；removed_at 非空 = 已卸载，重装复活同一行） */
export const pluginInstalls = sqliteTable("plugin_installs", {
  pluginId: text("plugin_id").notNull(),
  identity: text("identity").notNull(),
  version: text("version").notNull(),
  meta: text("meta"),
  installedAt: integer("installed_at").notNull(),
  removedAt: integer("removed_at"),
}, (t) => [
  primaryKey({ columns: [t.pluginId, t.identity] }),
  index("plugin_installs_plugin_idx").on(t.pluginId),
]);

/** 插件星标（复合主键，天然幂等） */
export const pluginStars = sqliteTable("plugin_stars", {
  pluginId: text("plugin_id").notNull(),
  identity: text("identity").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.pluginId, t.identity] }),
]);

/**
 * 插件版本快照（审核通过时落一条；同版本唯一）。
 * 表由 migrate.ts / driver.ts 的幂等 DDL 创建，这里补 Drizzle 声明保持 schema 单一事实源。
 */
export const pluginVersions = sqliteTable("plugin_versions", {
  id: text("id").primaryKey(),
  pluginId: text("plugin_id").notNull(),
  version: text("version").notNull(),
  manifest: text("manifest").notNull(),
  changelog: text("changelog"),
  checksum: text("checksum").notNull(),
  publishedAt: integer("published_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  uniqueIndex("plugin_versions_plugin_version_idx").on(t.pluginId, t.version),
  index("plugin_versions_plugin_idx").on(t.pluginId),
]);

/** 插件真实评价（仅活跃安装用户可写；status=hidden 由管理台治理） */
export const pluginReviews = sqliteTable("plugin_reviews", {
  id: text("id").primaryKey(),
  pluginId: text("plugin_id").notNull(),
  identity: text("identity").notNull(),
  rating: integer("rating").notNull(),
  title: text("title"),
  content: text("content"),
  installedVersion: text("installed_version").notNull(),
  status: text("status").notNull().default("visible"),
  reportCount: integer("report_count").notNull().default(0),
  moderationNote: text("moderation_note"),
  moderatedAt: integer("moderated_at"),
  moderatedBy: text("moderated_by"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  uniqueIndex("plugin_reviews_plugin_identity_idx").on(t.pluginId, t.identity),
  index("plugin_reviews_plugin_idx").on(t.pluginId),
  index("plugin_reviews_status_idx").on(t.status),
]);

/** 分享短链（只允许内部 /marketplace/ 目标，防开放重定向） */
export const shortLinks = sqliteTable("short_links", {
  code: text("code").primaryKey(),
  target: text("target").notNull(),
  pluginSlug: text("plugin_slug"),
  clicks: integer("clicks").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

/** 站点离线快照存档（Local-First SingleFile 归档） */
export const siteArchives = sqliteTable("site_archives", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  excerpt: text("excerpt"),
  readTimeMinutes: integer("read_time_minutes").notNull().default(1),
  htmlContent: text("html_content").notNull(),
  byteSize: integer("byte_size").notNull().default(0),
  tags: text("tags").notNull().default("[]"),
  capturedAt: integer("captured_at").notNull().$defaultFn(now),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [
  index("site_archives_site_id_idx").on(t.siteId),
  index("site_archives_captured_at_idx").on(t.capturedAt),
]);

/** 大模型用量统计（AI Observability 事实源） */
export const llmUsage = sqliteTable("llm_usage", {
  id: text("id").primaryKey(),
  scenario: text("scenario").notNull(),
  source: text("source").notNull(),
  model: text("model").notNull(),
  identity: text("identity"),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  ok: integer("ok", { mode: "boolean" }).notNull().default(true),
  errorCode: text("error_code"),
  thinking: integer("thinking", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [
  index("llm_usage_time_idx").on(t.createdAt),
  index("llm_usage_scenario_idx").on(t.scenario, t.createdAt),
  index("llm_usage_source_idx").on(t.source, t.createdAt),
]);

export const schema = {
  categories, sites, tags, tagAliases, siteTags, siteFacets, siteRelations, collections, collectionItems,
  users, sessions, notifications, apiTokens, events, healthChecks, auditLogs, jobs, idempotency, embeddings, pluginEmbeddings,
  favorites, favoriteFolders, userProfiles, searchHistory, userVaultSync, userWorkspaceBlobs, systemStates, taxonomyProposals,
  plugins, pluginInstalls, pluginStars, pluginVersions, pluginReviews, shortLinks, siteArchives, llmUsage,
  // 用户域补齐（N11）：此前这四张表没有进入导出，drizzle 工具链拿不到它们，
  // 「schema 是单一事实源」名不副实——迁移脚本与 DDL 各写一份，drift 无从校验。
  identityAliases, identityMerges, userLlmConfigs, userSettings,
};

