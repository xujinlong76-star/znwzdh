/**
 * REST 响应契约（文档与契约测试的单一事实源）。
 *
 * 请求契约早就收敛到了 mcp-schemas 的 zod 定义，但响应体在 OpenAPI 里
 * 一直写成「通用 object」——文档不描述真实形状，前端与第三方只能读源码，
 * 而源码改了也没人知道契约破了。这里把高频只读端点的响应形状定义一次：
 *   - OpenAPI 的 components.schemas 与 200 响应的 $ref 由它生成
 *   - 端到端契约测试用同一份 schema 校验真实注入响应（漂移即红）
 *
 * 与核心 TS 类型的关系：只承诺「集成方可以依赖的稳定核心」，用
 * looseObject 允许仓储继续附带扩展字段——**新增**字段不算破坏性变更，
 * 但核心字段改名、类型降级、可空性变化会立刻被契约测试抓住。
 *
 * 刻意不做的：不为全部 100+ 端点批量补响应。契约的价值在于「被校验」，
 * 写一份没人验、又跟不上实现的 schema，比不写更容易误导调用方。
 */

import { z } from "zod";
import { SiteStatusSchema } from "./mcp-schemas.ts";
import type { PluginKind } from "./plugin-manifest.ts";
import type { Category, SearchHit, Site } from "./types.ts";

/* ------------------------------------------------------------------ *
 * 站点（列表/搜索命中/关系来源共用）
 * ------------------------------------------------------------------ */

const SiteHealthPayload = z.object({
  ok: z.boolean(),
  httpStatus: z.number().nullable().optional(),
  latencyMs: z.number().nullable().optional(),
  redirectTo: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  lastCheckedAt: z.number().nullable().optional(),
});

/** 集成方可以依赖的站点核心字段（与 Site 的键集合做编译期对齐） */
export const SITE_CORE_FIELDS = [
  "id",
  "url",
  "title",
  "categoryId",
  "tags",
  "status",
  "enabled",
  "sort",
  "weight",
  "health",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof Site)[];

type SiteCoreField = (typeof SITE_CORE_FIELDS)[number];

/**
 * 站点响应形状。
 * satisfies 把这张 shape 与 SITE_CORE_FIELDS 绑死：清单里少写或多写一个键，
 * 编译期就红，不需要等运行时才发现文档漏字段。
 */
const siteCoreShape = {
  id: z.string(),
  url: z.string(),
  title: z.string(),
  categoryId: z.string(),
  tags: z.array(z.string()),
  status: SiteStatusSchema,
  enabled: z.boolean(),
  sort: z.number(),
  weight: z.number(),
  health: SiteHealthPayload,
  createdAt: z.number(),
  updatedAt: z.number(),
} satisfies Record<SiteCoreField, z.ZodTypeAny>;

export const SitePayload = z.looseObject({
  ...siteCoreShape,
  // 常用但不保证恒有值的字段：显式声明类型，便于生成的文档说明语义
  titleEn: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  descriptionEn: z.string().nullable().optional(),
  iconKey: z.string().nullable().optional(),
  screenshotKey: z.string().nullable().optional(),
  subCategoryId: z.string().nullable().optional(),
  featured: z.boolean().optional(),
  source: z.string().nullable().optional(),
  visitCount: z.number().optional(),
  lastVisitedAt: z.number().nullable().optional(),
  trendScore: z.number().optional(),
  deletedAt: z.number().nullable().optional(),
  workspaces: z.array(z.string()).optional(),
  facets: z.record(z.string(), z.array(z.string())).optional(),
});

export const SiteListResponse = z.array(SitePayload);

/* ------------------------------------------------------------------ *
 * GET /api/health
 * ------------------------------------------------------------------ */

export const HealthResponse = z.looseObject({
  ok: z.literal(true),
  mode: z.enum(["lite", "standard"]),
  capabilities: z.object({
    semantic: z.boolean(),
    fts: z.boolean(),
    llm: z.boolean(),
    notes: z.array(z.string()),
  }),
  db: z.object({ ok: z.boolean() }),
  // 数据库不可用时 stats 为 null（存活探针不因 DB 故障返回 500，见 health.ts）
  stats: z
    .object({
      sites: z.number().int(),
      categories: z.number().int(),
      tags: z.number().int(),
      broken: z.number().int(),
      pending: z.number().int(),
      trashed: z.number().int(),
    })
    .nullable(),
  embedding: z
    .object({
      cache: z.object({ size: z.number().int(), hits: z.number().int(), misses: z.number().int() }),
    })
    .optional(),
});

/* ------------------------------------------------------------------ *
 * GET/POST /api/search
 * ------------------------------------------------------------------ */

/** 命中记录的核心字段（与 SearchHit 做编译期对齐） */
export const SEARCH_HIT_CORE_FIELDS = ["siteId", "score", "contributions"] as const satisfies readonly (keyof SearchHit)[];

type SearchHitCoreField = (typeof SEARCH_HIT_CORE_FIELDS)[number];

const searchHitCoreShape = {
  siteId: z.string(),
  score: z.number(),
  contributions: z.record(z.string(), z.object({ rank: z.number().int(), value: z.number() })),
} satisfies Record<SearchHitCoreField, z.ZodTypeAny>;

/** 路由在命中上补挂了站点详情（site 查不到时为 null） */
const SearchHitPayload = z.object({
  ...searchHitCoreShape,
  site: SitePayload.nullable(),
});

const MatchedSiteRelationPayload = z.looseObject({
  targetTitle: z.string(),
  targetUrl: z.string(),
  relationType: z.string(),
  sourceSite: SitePayload.nullable(),
});

export const SearchResponse = z.looseObject({
  hits: z.array(SearchHitPayload),
  /** 与 hits 同源的别名（兼容旧客户端；新代码请用 hits） */
  items: z.array(SearchHitPayload),
  channelsUsed: z.array(z.string()),
  semanticAvailable: z.boolean(),
  tookMs: z.number(),
  offset: z.number().int().optional(),
  hasMore: z.boolean().optional(),
  fallback: z.enum(["filter", "fuzzy"]).optional(),
  planner: z.literal("early-exit").optional(),
  channelTimings: z
    .object({
      exactMs: z.number(),
      ftsMs: z.number(),
      pinyinMs: z.number(),
      semanticMs: z.number(),
      skippedSemantic: z.boolean(),
      semanticFiltered: z.number().int(),
    })
    .optional(),
  inferredFacets: z.record(z.string(), z.array(z.string())).optional(),
  inferredTag: z.string().optional(),
  inferredCategory: z.string().optional(),
  excludedTerms: z.array(z.string()).optional(),
  didYouMean: z.string().optional(),
  queryExpansion: z.array(z.string()).optional(),
  // 零结果时才会出现的附加信息
  suggestions: z.array(z.string()).optional(),
  popular: z.array(z.string()).optional(),
  suggestionsDegraded: z.literal(true).optional(),
  relationHits: z.array(MatchedSiteRelationPayload).optional(),
});

/* ------------------------------------------------------------------ *
 * 类目（全量 / 分页 / 站点计数）
 * ------------------------------------------------------------------ */

/** 类目核心字段（与 Category 的键集合做编译期对齐） */
export const CATEGORY_CORE_FIELDS = [
  "id",
  "anchor",
  "parentId",
  "title",
  "enabled",
  "sort",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof Category)[];

type CategoryCoreField = (typeof CATEGORY_CORE_FIELDS)[number];

const categoryCoreShape = {
  id: z.string(),
  anchor: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  enabled: z.boolean(),
  sort: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
} satisfies Record<CategoryCoreField, z.ZodTypeAny>;

export const CategoryPayload = z.looseObject({
  ...categoryCoreShape,
  titleEn: z.string().nullable().optional(),
  // 可空是过渡口径（历史行由启动期迁移回填），不能收成必填
  slug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  altLabels: z.array(z.string()).optional(),
  relatedCategories: z.array(z.string()).optional(),
});

/** GET /api/categories：全表（SKOS 导出与快照构建要整棵树，故无分页壳） */
export const CategoryListResponse = z.array(CategoryPayload);

/** GET /api/categories/page：有界分页壳 */
export const CategoryPageResponse = z.object({
  items: z.array(CategoryPayload),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

/** GET /api/categories/counts：每个类目的存活站点数 */
export const CategoryCountsResponse = z.object({
  counts: z.array(z.object({ categoryId: z.string(), sites: z.number().int() })),
});

/* ------------------------------------------------------------------ *
 * 标签云
 * ------------------------------------------------------------------ */

/**
 * 标签核心字段。
 *
 * 与 `TagWithCount` 的编译期对齐放在 apps/api/test 里：那个类型在
 * @navhub/store（依赖方向 store → core），core 不能反向 import。
 */
export const TAG_CORE_FIELDS = ["id", "name", "slug", "count", "group", "aliases"] as const;

type TagCoreField = (typeof TAG_CORE_FIELDS)[number];

const tagCoreShape = {
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  count: z.number().int(),
  group: z.string(),
  aliases: z.array(z.string()),
} satisfies Record<TagCoreField, z.ZodTypeAny>;

export const TagPayload = z.looseObject({
  ...tagCoreShape,
  color: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

/** GET /api/tags：按热度降序的标签数组 */
export const TagListResponse = z.array(TagPayload);

/* ------------------------------------------------------------------ *
 * 推荐榜单
 * ------------------------------------------------------------------ */

/**
 * GET /api/rank/trending。
 * trend 是「为什么排在这儿」的可解释分量，前端 tooltip 直接读，
 * 所以三个字段都是契约的一部分而不是可选装饰。
 */
export const RankTrendingResponse = z.looseObject({
  hits: z.array(
    z.object({
      site: SitePayload,
      trend: z.object({
        visits: z.number(),
        trendScore: z.number(),
        lastVisitedAt: z.number().nullable(),
      }),
    }),
  ),
});

/** GET /api/rank/new：只带站点，没有热度分量 */
export const RankNewResponse = z.looseObject({
  hits: z.array(z.object({ site: SitePayload })),
});

/* ------------------------------------------------------------------ *
 * 搜索历史（「最近搜索」与历史管理页）
 * ------------------------------------------------------------------ */

/**
 * 单条搜索历史。
 * resultCount 是「那次查询当时命中几条」——历史管理页靠它区分零结果记录，
 * 并支持一次清掉它们（DELETE /api/search-history?filter=zero_results）。
 */
const SearchHistoryItemPayload = z.looseObject({
  id: z.number().int(),
  query: z.string(),
  resultCount: z.number().int(),
  createdAt: z.number(),
});

/**
 * GET /api/search-history：键集分页壳。
 * hasMore 与 nextOffset 由服务端算好，前端不该自己拿 limit 推——
 * probe 式分页（多取一条判 hasMore）是仓储的实现细节，写进契约就会绑死它。
 */
export const SearchHistoryPageResponse = z.object({
  items: z.array(SearchHistoryItemPayload),
  hasMore: z.boolean(),
  nextOffset: z.number().int(),
});

/* ------------------------------------------------------------------ *
 * 插件市场列表
 * ------------------------------------------------------------------ */

/** 与 PLUGIN_KINDS 对齐；写成元组是因为 z.enum 只接受字面量元组 */
export const PLUGIN_KIND_VALUES = [
  "site-pack",
  "workspace-preset",
  "theme",
  "search-pack",
  "bundle",
] as const satisfies readonly PluginKind[];

const PluginKindSchema = z.enum(PLUGIN_KIND_VALUES);

/**
 * 列表卡片用的清单摘要。
 * 列表响应刻意删掉了 manifest（一页 24 条曾达 1.16MB），
 * 卡片只读 summary，所以这层必须进契约。
 */
const PluginSummaryPayload = z.looseObject({
  kind: PluginKindSchema,
  siteCount: z.number().int(),
  categoryCount: z.number().int(),
  uniqueTagCount: z.number().int(),
  hosts: z.array(z.string()),
  boardCount: z.number().int(),
  widgetCount: z.number().int(),
  widgetTypes: z.array(z.string()),
  themeTokenCount: z.number().int(),
  engineCount: z.number().int(),
  enginePrefixes: z.array(z.string()),
  bundleItemCount: z.number().int(),
  bundleKinds: z.array(z.string()),
});

export const PluginPayload = z.looseObject({
  id: z.string(),
  slug: z.string(),
  kind: PluginKindSchema,
  name: z.string(),
  description: z.string(),
  icon: z.string().nullable(),
  tags: z.array(z.string()),
  author: z.string().nullable(),
  authorKind: z.string().nullable(),
  // ownerIdentity 是内部归属串，公共响应必须剔除；ownerKey 是不可逆哈希，可公开
  ownerKey: z.string().nullable().optional(),
  license: z.string().nullable(),
  homepage: z.string().nullable(),
  version: z.string(),
  status: z.string(),
  reviewNote: z.string().nullable(),
  reviewedAt: z.number().nullable(),
  source: z.string(),
  installCount: z.number().int(),
  starCount: z.number().int(),
  reportCount: z.number().int(),
  featured: z.boolean(),
  featuredRank: z.number().int(),
  ratingAvg: z.number(),
  reviewCount: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
  publishedAt: z.number().nullable(),
  // 列表始终带 summary（卡片只读它）；缺失就是契约破了，不能给 optional 放行
  summary: PluginSummaryPayload,
  // site-pack 的 manifest 默认被摘掉（单条约 34KB），?manifest=1 时才回来；
  // 其余 kind 的清单很小，保留原样。故这里只能是可选。
  manifest: z.unknown().optional(),
  aiAudit: z
    .object({ score: z.number(), level: z.string(), auditedAt: z.number() })
    .nullable()
    .optional(),
});

export const PluginListResponse = z.object({
  items: z.array(PluginPayload),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

/* ------------------------------------------------------------------ *
 * 插件订阅源（Taps）与已装清单
 * ------------------------------------------------------------------ */

/**
 * 订阅源记录（admin 面）。description 创建时可选；lastSyncedAt 只有同步过才有。
 * 其余字段创建即写死，缺一个说明系统状态被写坏了——所以不是 optional。
 */
const PluginTapPayload = z.looseObject({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  description: z.string().optional(),
  enabled: z.boolean(),
  pluginCount: z.number().int(),
  lastSyncedAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** 官方精选源：内置常量（FEATURED_TAPS），不落库，字段因此恒有值 */
const FeaturedTapPayload = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  url: z.string(),
  isFeatured: z.literal(true),
  author: z.string(),
});

/** GET /api/plugins/taps（admin）：完整源清单 + 官方精选 */
export const PluginTapsResponse = z.object({
  ok: z.literal(true),
  items: z.array(PluginTapPayload),
  featuredTaps: z.array(FeaturedTapPayload),
});

/**
 * GET /api/plugins/taps/public 的条目：**刻意不含 url**。
 * 订阅源地址常带访问凭据（GitHub raw 的 ?token= 一类），admin 与公开面
 * 字段集不同，因此不能共用一份 schema——共用就等于把「不泄露 url」这件事
 * 降级成路由里的约定。
 */
const PublicPluginTapPayload = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  pluginCount: z.number().int(),
  lastSyncedAt: z.number().nullable(),
});

export const PublicPluginTapsResponse = z.object({
  ok: z.literal(true),
  items: z.array(PublicPluginTapPayload),
  featuredTaps: z.array(FeaturedTapPayload),
});

/**
 * GET /api/plugins/installed 的条目。
 * installedVersion 与 version 可能不同（装了 1.0，市场已到 2.0），
 * 前端靠这两个字段提示「可升级」，所以都进契约。
 */
const InstalledPluginPayload = z.looseObject({
  id: z.string(),
  slug: z.string(),
  kind: PluginKindSchema,
  name: z.string(),
  description: z.string(),
  icon: z.string().nullable(),
  version: z.string(),
  installedVersion: z.string(),
  installedAt: z.number(),
  source: z.string(),
});

export const InstalledPluginsResponse = z.object({
  items: z.array(InstalledPluginPayload),
  total: z.number().int(),
});

/* ------------------------------------------------------------------ *
 * GET /api/me（用户中心总览）
 * ------------------------------------------------------------------ */

/**
 * 用户设置。
 * 与仓储的 UserSettingsRecord 同形：缺省即「开启 + 默认体验」，所以扩展偏好
 * 恒有值（不是可选）。前端据此直接渲染开关，不需要自己再兜一层默认值。
 */
const MeSettingsPayload = z.looseObject({
  identity: z.string(),
  personalizationEnabled: z.boolean(),
  favoriteSignalCutoff: z.number(),
  updatedAt: z.number(),
  defaultSearchEngine: z.enum(["internal", "google", "bing", "duckduckgo", "github", "perplexity"]),
  openLinksInNewTab: z.boolean(),
  cardDensity: z.enum(["comfortable", "compact", "minimal"]),
  speculativeZeroRttEnabled: z.boolean(),
  daypartSceneEnabled: z.boolean(),
  spotlightShortcut: z.enum(["mod+k", "slash", "both"]),
  searchHistoryEnabled: z.boolean(),
  telemetryEnabled: z.boolean(),
  historyRetentionDays: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]),
});

/**
 * GET /api/me：用户中心概览与设置一次取回（首屏只发一个请求）。
 *
 * 计数值是**该用户自己的聚合**（收藏/收藏夹/搜索/已装插件…），前端据此渲染
 * 侧栏数字；`user` 为 null 表示尚未绑定登录账号——匿名身份仍是合法身份，
 * 概览照常返回，所以 null 是契约的一部分而不是异常分支。
 */
export const MeOverviewResponse = z.looseObject({
  ok: z.literal(true),
  identity: z.string(),
  user: z
    .object({
      id: z.string(),
      username: z.string(),
      email: z.string().nullable(),
      avatar: z.string().nullable(),
      source: z.string(),
    })
    .nullable(),
  counts: z.object({
    favorites: z.number().int(),
    folders: z.number().int(),
    searches: z.number().int(),
    activePluginInstalls: z.number().int(),
    pluginStars: z.number().int(),
    authoredPlugins: z.number().int(),
    recentEvents: z.number().int(),
  }),
  profile: z.object({ exists: z.boolean(), updatedAt: z.number().nullable() }),
  vault: z.object({
    exists: z.boolean(),
    version: z.number().nullable(),
    updatedAt: z.number().nullable(),
  }),
  llmConfig: z.object({ exists: z.boolean() }),
  aliases: z.array(z.string()),
  settings: MeSettingsPayload,
});

/* ------------------------------------------------------------------ *
 * 绑定表：路由键 -> 响应契约
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 收藏（写侧与列表）
 * ------------------------------------------------------------------ */

/**
 * 收藏行。
 * `userId` 是调用方自己的规范化身份（别名合并后的），对调用方不是秘密，
 * 但它不是集成方该依赖的业务字段——契约只承诺收藏内容本身。
 * `site` 只有列表接口会内联（详情写接口不带），所以是可选。
 */
export const FavoritePayload = z.looseObject({
  id: z.string(),
  siteId: z.string(),
  folderId: z.string().nullable(),
  note: z.string().nullable(),
  tags: z.array(z.string()).nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
  deletedAt: z.number().nullable().optional(),
  site: SitePayload.nullable().optional(),
});

export const FavoriteFolderPayload = z.looseObject({
  id: z.string(),
  name: z.string(),
  sort: z.number(),
  createdAt: z.number(),
  // 同名夹去重命中时路由会附带 existed=true（没有这个字段就是新建）
  existed: z.boolean().optional(),
});

/**
 * GET /api/favorites：全量模式（无 limit）与分页模式（带 limit）共用。
 * 分页模式额外给 total/hasMore/identity；全量模式恒定全量，不能给 total 假装分页。
 */
export const FavoritesListResponse = z.looseObject({
  items: z.array(FavoritePayload),
  folders: z.array(FavoriteFolderPayload),
  total: z.number().int().optional(),
  hasMore: z.boolean().optional(),
  identity: z.string().optional(),
});

export const FavoriteCreateResponse = z.looseObject({
  favorite: FavoritePayload,
  // true = 这条收藏早已存在（重复收藏是幂等操作，不是错误）
  existed: z.boolean(),
});

export const FavoriteUpdateResponse = z.looseObject({
  ok: z.literal(true),
  favorite: FavoritePayload,
});

/** 收藏夹改名/排序回执：载荷键是 folder 而不是 favorite */
export const FavoriteFolderUpdateResponse = z.looseObject({
  ok: z.literal(true),
  folder: FavoriteFolderPayload,
});

/** DELETE /api/favorites（清空）回执：removed 是清掉的条数 */
export const FavoriteRemovalResponse = z.looseObject({
  ok: z.literal(true),
  removed: z.number().int(),
});

/** DELETE /api/favorites/{siteId} 回执：removed 是布尔（这一条是否真的被删）。两种语义不能共用同一 schema */
export const FavoriteSiteRemovalResponse = z.looseObject({
  ok: z.literal(true),
  removed: z.boolean(),
});

/* ------------------------------------------------------------------ *
 * 精选专题
 * ------------------------------------------------------------------ */

export const COLLECTION_KIND_VALUES = ["topic", "geo", "roadmap"] as const;
const CollectionKindSchema = z.enum(COLLECTION_KIND_VALUES);

export const CollectionPayload = z.looseObject({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  kind: CollectionKindSchema,
  icon: z.string().nullable().optional(),
  sort: z.number(),
  enabled: z.boolean(),
  siteCount: z.number().int().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const CollectionListResponse = z.array(CollectionPayload);

/** 专题详情里的站点：站点全量字段 + 该专题内的条目注记与排序 */
export const CollectionSitePayload = z.looseObject({
  ...SitePayload.shape,
  collectionNote: z.string().nullable().optional(),
  collectionSort: z.number().optional(),
});

export const CollectionDetailResponse = z.looseObject({
  collection: CollectionPayload,
  sites: z.array(CollectionSitePayload),
});

/** POST /api/collections 与 PATCH /api/collections/{id} 均直接返回专题对象 */

export const CollectionDeleteResponse = z.looseObject({
  ok: z.literal(true),
  id: z.string(),
});

/** 专题条目 add/update/remove 的共用回执 */
export const CollectionItemMutationResponse = z.looseObject({
  ok: z.literal(true),
  collectionId: z.string(),
  siteId: z.string(),
});

/* ------------------------------------------------------------------ *
 * 插件安装生命周期（写侧）
 * ------------------------------------------------------------------ */

/**
 * 安装/卸载响应里的插件卡片。
 * 写路由直接回传仓储记录（当前未走 publicPlugin() 剔敏），因此 ownerIdentity /
 * pendingChangelog 这类内部字段**可能出现**；looseObject 放行多余字段，
 * 但契约只承诺下面这些公开字段，调用方不该依赖内部字段。
 */
const PluginMutationPayload = z.looseObject({
  id: z.string(),
  slug: z.string(),
  kind: PluginKindSchema,
  name: z.string(),
  description: z.string(),
  icon: z.string().nullable(),
  tags: z.array(z.string()),
  author: z.string().nullable(),
  authorKind: z.string().nullable(),
  version: z.string(),
  status: z.string(),
  source: z.string(),
  installCount: z.number().int(),
  starCount: z.number().int(),
  ratingAvg: z.number(),
  reviewCount: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/**
 * 安装落库的增量结果。
 * bundle 的逐成员明细只在装 bundle 时出现；site-pack 的类目缺口/父级不一致
 * 也只是告警字段——都不写成 required，免得为空时契约假红。
 */
const PluginInstallAppliedPayload = z.looseObject({
  sitesAdded: z.number().int(),
  sitesSkipped: z.number().int(),
  categoriesCreated: z.number().int(),
  createdSiteIds: z.array(z.string()),
  enginesAdded: z.number().int().optional(),
  categoryGaps: z.array(z.string()).optional(),
  categoryParentMismatches: z.array(z.string()).optional(),
  bundleItems: z
    .array(
      z.looseObject({
        slug: z.string(),
        kind: PluginKindSchema,
        name: z.string(),
        alreadyInstalled: z.boolean(),
        sitesAdded: z.number().int(),
        sitesSkipped: z.number().int(),
        enginesAdded: z.number().int(),
      }),
    )
    .optional(),
});

export const PluginInstallResponse = z.looseObject({
  success: z.literal(true),
  plugin: PluginMutationPayload,
  // install 记录含调用方身份：存在性与版本是客户端「已装版本」提示的依据
  install: z.looseObject({
    pluginId: z.string(),
    version: z.string(),
    installedAt: z.number(),
    removedAt: z.number().nullable(),
  }),
  // true = 重复安装（幂等），计数未变
  alreadyInstalled: z.boolean(),
  applied: PluginInstallAppliedPayload,
});

/**
 * 卸载回执。
 * removed=false 是幂等语义（本来就没装），不是错误；sitesRemoved 与 categoriesRemoved
 * 是 result.removedSites/removedCategories 的对外别名，两套键同时存在是历史形状。
 */
export const PluginUninstallResponse = z.looseObject({
  success: z.literal(true),
  plugin: PluginMutationPayload,
  removed: z.boolean(),
  removedSites: z.number().int(),
  removedCategories: z.number().int(),
  sitesRemoved: z.number().int(),
  categoriesRemoved: z.number().int(),
});

export const PluginStarResponse = z.looseObject({
  success: z.literal(true),
  starred: z.boolean(),
  starCount: z.number().int(),
});

/** 无载荷写回执（DELETE 收藏夹等「只表示成功」的端点） */
export const OkResponse = z.looseObject({ ok: z.literal(true) });

/* ------------------------------------------------------------------ *
 * 通知中心（站内信 + 投递台账）
 * ------------------------------------------------------------------ */

/**
 * 一条站内通知。`readAt` 为 null 表示未读；`body` 可空（只有标题的提醒）。
 * identity 是服务端规范化后的收件人键，前端只当不透明串用。
 */
export const NotificationItemPayload = z.looseObject({
  id: z.string(),
  identity: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  readAt: z.number().nullable(),
  createdAt: z.number(),
});

/** GET /api/me/notifications 与 GET /api/admin/notifications 共用的分页壳 */
export const NotificationListResponse = z.looseObject({
  items: z.array(NotificationItemPayload),
  hasMore: z.boolean(),
  unread: z.number().int(),
  nextOffset: z.number().int(),
});

/** GET /api/me/notifications/unread-count：角标轮询的最小载荷 */
export const NotificationUnreadCountResponse = z.looseObject({
  ok: z.literal(true),
  unread: z.number().int(),
});

/**
 * GET /api/admin/notifications/deliveries：投递台账。
 * status/attempts/nextAttemptAt 是重试判据，缺一个后台就只能看不能判。
 */
export const NotificationDeliveryItemPayload = z.looseObject({
  id: z.string(),
  identity: z.string(),
  channel: z.string(),
  kind: z.string(),
  status: z.enum(["pending", "delivered", "deferred", "failed"]),
  attempts: z.number().int(),
  nextAttemptAt: z.number().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.number(),
  deliveredAt: z.number().nullable(),
});

export const NotificationDeliveryListResponse = z.looseObject({
  items: z.array(NotificationDeliveryItemPayload),
  hasMore: z.boolean(),
  nextOffset: z.number().int(),
});

/**
 * GET /api/categories/{id}/impact：删类目前的影响面预演。
 * 四个计数必须是服务端算好的数——前端自己遍历全树会把「能不能删」的判断
 * 变成一次客户端复制，两侧口径一旦分叉就等于没有护栏。
 */
export const CategoryImpactResponse = z.looseObject({
  category: z.looseObject({
    id: z.string(),
    title: z.string(),
    slug: z.string().nullable(),
    enabled: z.boolean(),
    parentId: z.string().nullable(),
    anchor: z.string(),
  }),
  childCategories: z.number().int(),
  descendantCategories: z.number().int(),
  directSites: z.number().int(),
  subtreeSites: z.number().int(),
});

/* ------------------------------------------------------------------ *
 * 视频库只读查询（/api/videos）
 * ------------------------------------------------------------------ */

/**
 * 视频条目：列表与详情共用同一形状。
 * `videoConfig`（章节树/字幕）只在详情或 `compact=0` 时返回，内部形状归视频域维护，
 * 这里只约束它会以对象出现，不把章节协议复制进契约。
 */
export const VideoItemPayload = z.looseObject({
  id: z.string(),
  categoryId: z.string(),
  title: z.string(),
  href: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  enabled: z.boolean(),
  sort: z.number().int(),
  platform: z.string().nullable(),
  externalId: z.string().nullable(),
  author: z.string().nullable(),
  durationSec: z.number().nullable(),
  publishedAt: z.string().nullable(),
  qualityScore: z.number().nullable(),
  freshnessScore: z.number().nullable(),
  healthStatus: z.string().nullable(),
  sourceType: z.string().nullable(),
  pinned: z.boolean(),
  updatedAt: z.number(),
  // 详情/compact=0 才出现；脏数据缺 config 时服务端归一成 null，不是省略
  videoConfig: z.record(z.string(), z.unknown()).nullable().optional(),
});

/**
 * GET /api/videos：分页壳。
 * `source` 必须如实标注本次供数走了关系表（db）还是 KV 文档（kv）——
 * 灰度期靠它核对读路径是否真的切过去，而不是只看响应有没有数据。
 */
export const VideoListResponse = z.looseObject({
  source: z.enum(["db", "kv"]),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  returned: z.number().int(),
  items: z.array(VideoItemPayload),
});

/** GET /api/videos/{id}：详情，始终带完整 videoConfig 之外的条目字段 */
export const VideoDetailResponse = z.looseObject({
  source: z.enum(["db", "kv"]),
  item: VideoItemPayload,
});

/* ------------------------------------------------------------------ *
 * 绑定表
 * ------------------------------------------------------------------ */

export interface ResponseSchemaBinding {
  schema: z.ZodTypeAny;
  /**
   * OpenAPI components.schemas 里的组件名。
   * 显式命名（而不是从路由派生）是为了让生成的客户端类型可直接引用。
   */
  name: string;
  /**
   * 成功状态码，默认 "200"。
   * 写路由常以 201 表示「已创建」，收藏创建还会在幂等命中时回 200——
   * 声明多个状态码时 OpenAPI 里每个都指向同一份组件。
   */
  status?: string | string[];
}

/** GET /api/admin/ai/prices：模型单价簿 + 旧版单一价回落值 */
export const AdminAiPricesResponse = z.looseObject({
  prices: z.array(
    z.looseObject({
      model: z.string(),
      /** 输入价（¥/1K tokens） */
      promptPer1kRmb: z.number(),
      /** 输出价（¥/1K tokens） */
      completionPer1kRmb: z.number(),
      updatedAt: z.number(),
    }),
  ),
  /** 旧版单一价（¥/1K，输入输出同价）：单价簿没命中的模型才回落到它；无回落值时为 null */
  legacyUnitPriceRmb: z.number().nullable(),
});

export const RESPONSE_SCHEMA_BINDINGS: Record<string, ResponseSchemaBinding> = {
  "GET /api/health": { schema: HealthResponse, name: "HealthResponse" },
  "GET /api/search": { schema: SearchResponse, name: "SearchResponse" },
  // POST 与 GET 共用同一处理器，必须共用同一份契约，否则两边会各自漂移
  "POST /api/search": { schema: SearchResponse, name: "SearchResponse" },
  "GET /api/sites": { schema: SiteListResponse, name: "SiteListResponse" },
  "GET /api/categories": { schema: CategoryListResponse, name: "CategoryListResponse" },
  "GET /api/categories/page": { schema: CategoryPageResponse, name: "CategoryPageResponse" },
  "GET /api/categories/counts": { schema: CategoryCountsResponse, name: "CategoryCountsResponse" },
  "GET /api/tags": { schema: TagListResponse, name: "TagListResponse" },
  "GET /api/rank/trending": { schema: RankTrendingResponse, name: "RankTrendingResponse" },
  "GET /api/rank/new": { schema: RankNewResponse, name: "RankNewResponse" },
  "GET /api/plugins": { schema: PluginListResponse, name: "PluginListResponse" },
  "GET /api/plugins/installed": { schema: InstalledPluginsResponse, name: "InstalledPluginsResponse" },
  "GET /api/plugins/taps": { schema: PluginTapsResponse, name: "PluginTapsResponse" },
  "GET /api/plugins/taps/public": { schema: PublicPluginTapsResponse, name: "PublicPluginTapsResponse" },
  // 单站详情与列表共用同一份站点形状（路由直接返回站点对象，没有外壳）
  "GET /api/sites/{id}": { schema: SitePayload, name: "SitePayload" },
  "GET /api/search-history": { schema: SearchHistoryPageResponse, name: "SearchHistoryPageResponse" },
  "GET /api/me": { schema: MeOverviewResponse, name: "MeOverviewResponse" },
  "GET /api/favorites": { schema: FavoritesListResponse, name: "FavoritesListResponse" },
  "GET /api/collections": { schema: CollectionListResponse, name: "CollectionListResponse" },
  "GET /api/collections/{slug}": { schema: CollectionDetailResponse, name: "CollectionDetailResponse" },
  // 通知中心：用户面与管理端共用分页壳（管理端多一个收件人维度，形状一致）
  "GET /api/me/notifications": { schema: NotificationListResponse, name: "NotificationListResponse" },
  "GET /api/admin/notifications": { schema: NotificationListResponse, name: "NotificationListResponse" },
  "GET /api/me/notifications/unread-count": {
    schema: NotificationUnreadCountResponse,
    name: "NotificationUnreadCountResponse",
  },
  "GET /api/admin/ai/prices": { schema: AdminAiPricesResponse, name: "AdminAiPricesResponse" },
  "GET /api/admin/notifications/deliveries": {
    schema: NotificationDeliveryListResponse,
    name: "NotificationDeliveryListResponse",
  },
  "GET /api/categories/{id}/impact": { schema: CategoryImpactResponse, name: "CategoryImpactResponse" },
  // 视频库只读查询：列表/详情共用条目形状，来源字段由服务端如实标注
  "GET /api/videos": { schema: VideoListResponse, name: "VideoListResponse" },
  "GET /api/videos/{id}": { schema: VideoDetailResponse, name: "VideoDetailResponse" },

  /* 写侧：创建返回 201，更新/删除返回 200；收藏创建在幂等命中时回 200 */
  "POST /api/sites": { schema: SitePayload, name: "SitePayload", status: "201" },
  "PATCH /api/sites/{id}": { schema: SitePayload, name: "SitePayload" },
  "POST /api/plugins/{slug}/install": { schema: PluginInstallResponse, name: "PluginInstallResponse" },
  "POST /api/plugins/{slug}/uninstall": { schema: PluginUninstallResponse, name: "PluginUninstallResponse" },
  "DELETE /api/plugins/{slug}/install": { schema: PluginUninstallResponse, name: "PluginUninstallResponse" },
  "POST /api/plugins/{slug}/star": { schema: PluginStarResponse, name: "PluginStarResponse" },
  "POST /api/favorites": { schema: FavoriteCreateResponse, name: "FavoriteCreateResponse", status: ["200", "201"] },
  "PATCH /api/favorites/{siteId}": { schema: FavoriteUpdateResponse, name: "FavoriteUpdateResponse" },
  "DELETE /api/favorites/{siteId}": { schema: FavoriteSiteRemovalResponse, name: "FavoriteSiteRemovalResponse" },
  "DELETE /api/favorites": { schema: FavoriteRemovalResponse, name: "FavoriteRemovalResponse" },
  "POST /api/favorites/folders": { schema: FavoriteFolderPayload, name: "FavoriteFolderPayload", status: ["200", "201"] },
  "PATCH /api/favorites/folders/{id}": { schema: FavoriteFolderUpdateResponse, name: "FavoriteFolderUpdateResponse" },
  "DELETE /api/favorites/folders/{id}": { schema: OkResponse, name: "OkResponse" },
  "POST /api/collections": { schema: CollectionPayload, name: "CollectionPayload", status: "201" },
  "PATCH /api/collections/{id}": { schema: CollectionPayload, name: "CollectionPayload" },
  "DELETE /api/collections/{id}": { schema: CollectionDeleteResponse, name: "CollectionDeleteResponse" },
  "POST /api/collections/{id}/items": { schema: CollectionItemMutationResponse, name: "CollectionItemMutationResponse" },
  "PATCH /api/collections/{id}/items/{siteId}": { schema: CollectionItemMutationResponse, name: "CollectionItemMutationResponse" },
  "DELETE /api/collections/{id}/items/{siteId}": { schema: CollectionItemMutationResponse, name: "CollectionItemMutationResponse" },
};
