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
import { SiteRelationSchema, SiteStatusSchema } from "./mcp-schemas.ts";
import { TAXONOMY_PROPOSAL_KINDS } from "./taxonomy-governance.ts";
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
  /**
   * 导航快照的一致性判据（升级改造方案 P1-1）。
   *
   * 为什么要进健康面：快照缓存的正确性判据是 `data_version`，而它的递增来自数据库
   * 触发器。触发器创建失败（权限受限的 PG 部署、并发启动撞 DDL）不会让任何请求报错，
   * 只会让版本号冻结 —— 于是多实例一致性悄悄退回 TTL。运维必须能在不抓 /metrics 的
   * 情况下看见「判据还在不在」。
   *   - version=null：读不到版本号（老库没这张表 / 单行没种下）；
   *   - triggersMissing>0：应有的 bump 触发器缺失，写入不会递增。
   */
  navSnapshot: z
    .object({
      version: z.number().int().nullable(),
      triggersMissing: z.number().int().nonnegative(),
      cached: z.boolean(),
      ttlMs: z.number().int().nonnegative(),
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
  correction: z
    .object({
      original: z.string(),
      corrected: z.string(),
      reason: z.enum(["alias", "pinyin-typo", "spelling", "chinese-typo"]),
    })
    .optional(),
  queryExpansion: z.array(z.string()).optional(),
  // 零结果时才会出现的附加信息
  suggestions: z.array(z.string()).optional(),
  popular: z.array(z.string()).optional(),
  suggestionsDegraded: z.literal(true).optional(),
  relationHits: z.array(MatchedSiteRelationPayload).optional(),
});

/* ------------------------------------------------------------------ *
 * 搜索框热词
 * ------------------------------------------------------------------ */

/**
 * GET /api/search/hotwords：/search 空态「大家都在搜」chips 的数据源。
 *
 * 与零结果页 popular 同口径：suggestableTopQueries（180 天、≥2 身份 /
 * ≥2 行、形状闸）再排除零结果词，取前 8。读失败降级为空数组 +
 * suggestionsDegraded 标记，不 5xx（与 SearchResponse 同口径的
 * literal(true)，正常返回时字段不存在）。
 */
export const SearchHotwordsResponse = z.looseObject({
  /** 最多 8 条热词（路由 slice(0, 8) 截断） */
  hotwords: z.array(z.string()),
  suggestionsDegraded: z.literal(true).optional(),
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
  /**
   * 上次热度重算时刻（epoch 毫秒）：读 `recompute_rank` 事件流的
   * MAX(created_at)。无事件行时为 null，不编造时间。
   */
  recomputedAt: z.number().nullable(),
});

/** GET /api/rank/new：只带站点，没有热度分量 */
export const RankNewResponse = z.looseObject({
  hits: z.array(z.object({ site: SitePayload })),
});

/* ------------------------------------------------------------------ *
 * 全网热榜 + 每日简报（热榜管道缓存只读；简报按天落库）
 * ------------------------------------------------------------------ */

const HotlistItemPayload = z.looseObject({
  rank: z.number().int(),
  title: z.string(),
  url: z.string(),
  hotValue: z.number().nullable(),
  hotLabel: z.string().nullable(),
});

/**
 * GET /api/hotlist：全源热榜缓存。
 * status 如实区分 ok / stale（最近一次失败、下发上次缓存）/ empty（还没抓到过），
 * fetchedAt 是该源缓存的真实抓取时间；uncovered 是逐源核查后登记的未覆盖源与原因。
 */
export const HotlistResponse = z.looseObject({
  ok: z.literal(true),
  generatedAt: z.number().nullable(),
  sources: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      homeUrl: z.string(),
      status: z.enum(["ok", "stale", "empty"]),
      fetchedAt: z.number().nullable(),
      items: z.array(HotlistItemPayload),
    }),
  ),
  uncovered: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      homeUrl: z.string(),
      reason: z.string(),
    }),
  ),
});

const BriefHotPickPayload = HotlistItemPayload.extend({
  source: z.string(),
  sourceName: z.string(),
  fetchedAt: z.number(),
});

const BriefNewSitePayload = z.looseObject({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  description: z.string().nullable(),
  createdAt: z.number(),
  addedOn: z.string(),
});

const BriefWatchItemPayload = z.looseObject({
  key: z.string(),
  title: z.string(),
  platformTitle: z.string(),
  playUrl: z.string(),
  episode: z.number().int(),
  priority: z.enum(["high", "normal"]),
});

/**
 * GET /api/brief/today：今日简报。
 * watch 是唯一的用户维度段：无可信身份时为 null（通用版），有身份时
 * 按其追剧清单现算 due（到更新日）/ check（节奏未标注、只提示去看看）
 * / premieringToday（U-377：预约态的剧预计今天开播，平台待确认）。
 */
export const BriefTodayResponse = z.looseObject({
  ok: z.literal(true),
  date: z.string(),
  isToday: z.boolean(),
  generatedAt: z.number(),
  opening: z.string(),
  openingMode: z.enum(["ai", "template"]),
  hotPicks: z.array(BriefHotPickPayload),
  newSitesScope: z.enum(["today", "recent"]),
  newSites: z.array(BriefNewSitePayload),
  watch: z
    .looseObject({
      due: z.array(BriefWatchItemPayload),
      check: z.array(BriefWatchItemPayload),
      premieringToday: z.array(BriefWatchItemPayload),
    })
    .nullable(),
});

/**
 * GET /api/drama/calendar：短剧开播日历（快照只读）。
 * status 如实区分 ok / stale（最近一次失败、下发上一日快照）/ empty（还没抓到过）；
 * days 只含未来 14 天，monthPending 只含“仅精确到月”的条目，expired 是
 * 预计日期已过、档期未兑现的条目（不静默删除）；全部日期都是平台方“预计”，
 * 以官方为准——前端必须在顶部写明这一点。
 */
export const DramaCalendarResponse = z.looseObject({
  ok: z.literal(true),
  status: z.enum(["ok", "stale", "empty"]),
  fetchedAt: z.number().nullable(),
  sourceDateModified: z.string().nullable(),
  sourceName: z.string(),
  sourceUrl: z.string(),
  lastError: z.string().nullable(),
  days: z.array(
    z.looseObject({
      date: z.string(),
      label: z.string(),
      items: z.array(
        z.looseObject({
          title: z.string(),
          premiereDate: z.string(),
          reservations: z.number().nullable(),
          rawLabel: z.string(),
        }),
      ),
    }),
  ),
  monthPending: z.array(
    z.looseObject({
      month: z.number().int(),
      label: z.string(),
      overdue: z.boolean(),
      items: z.array(
        z.looseObject({
          title: z.string(),
          reservations: z.number().nullable(),
          rawLabel: z.string(),
        }),
      ),
    }),
  ),
  expired: z.array(
    z.looseObject({
      title: z.string(),
      premiereDate: z.string(),
      reservations: z.number().nullable(),
      rawLabel: z.string(),
    }),
  ),
  recentlyDropped: z.array(
    z.looseObject({
      title: z.string(),
      lastLabel: z.string().nullable(),
      lastDate: z.string().nullable(),
      at: z.number(),
    }),
  ),
  recentChanges: z.array(
    z.looseObject({
      title: z.string(),
      from: z.string().nullable(),
      to: z.string().nullable(),
      at: z.number(),
    }),
  ),
});

/**
 * GET /api/drama/rankings：短剧真榜单（快照只读）。
 * 三榜（热播 / 热搜 / 收藏）各前 30 部；status 如实区分 ok / stale
 * （最近一次失败、下发上一日快照）/ empty（还没抓到过）；数字缺失留 null，
 * 绝不编热度；榜单与数字全部来自搜短剧公开榜单页。
 */
export const DramaRankingsResponse = z.looseObject({
  ok: z.literal(true),
  status: z.enum(["ok", "stale", "empty"]),
  fetchedAt: z.number().nullable(),
  lists: z.array(
    z.looseObject({
      kind: z.enum(["rebo", "reso", "shoucang"]),
      label: z.string(),
      sourceUrl: z.string(),
      sourceName: z.string(),
      fetchedAt: z.number().nullable(),
      sourceDateModified: z.string().nullable(),
      status: z.enum(["ok", "stale", "empty"]),
      lastError: z.string().nullable(),
      droppedTitles: z.number().int(),
      entries: z.array(
        z.looseObject({
          rank: z.number().int(),
          title: z.string(),
          key: z.string(),
          detailUrl: z.string(),
          metric: z.number().nullable(),
          metricLabel: z.string().nullable(),
          rating: z.number().nullable(),
          favorites: z.number().nullable(),
          shares: z.number().nullable(),
          likes: z.number().nullable(),
          totalEpisodes: z.number().int().nullable(),
          genre: z.string().nullable(),
          actors: z.array(z.string()),
        }),
      ),
    }),
  ),
});

/**
 * GET /api/me/drama-check-states：当前登录用户的短剧新集检查状态。
 * 只读 drama_check_states（服务端每天为关注者查到的最新集数）；
 * 匿名身份返空数组；无记录返空数组。
 */
export const DramaCheckStatesResponse = z.looseObject({
  ok: z.literal(true),
  states: z.array(
    z.looseObject({
      dramaKey: z.string(),
      latestEpisode: z.number().int().nullable(),
      lastCheckedAt: z.number(),
      lastError: z.string().nullable(),
    }),
  ),
});

/* ------------------------------------------------------------------ *
 * 场景包（A2 落地页只读接口，与 ai/find 共用 scene-resolve 展开）
 * ------------------------------------------------------------------ */

/**
 * 场景步骤里的一条站点：与 ai/find 的 FinderSite 同形——只带引用级字段
 * 与一句本地拼装的推荐理由（分类 + 简介），不下发完整站点负载。
 */
const SceneSitePayload = z.looseObject({
  siteId: z.string(),
  title: z.string(),
  url: z.string(),
  description: z.string().nullable(),
  categoryId: z.string(),
  reason: z.string(),
});

/** 场景包摘要（列表口径）：计数全部按本次真实召回算，不是定义里的写死数字 */
const SceneSummaryPayload = z.looseObject({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  intro: z.string(),
  /** 场景定义的步骤数（含本次未召回站点的步骤——那是流程本身的长度） */
  stepCount: z.number().int(),
  /** 本次真实召回到的站点步数：口径与 stepCount 分开，页面文案不得混用 */
  resolvedStepCount: z.number().int(),
  siteCount: z.number().int(),
  /** 每步的标题（定义顺序），索引页做流程预览 */
  stepLabels: z.array(z.string()),
  /** 本包站点的最近更新时间（毫秒戳）；无站点时为 null */
  updatedAt: z.number().nullable(),
});

/**
 * GET /api/scenes：场景包索引。
 * degraded 只会在检索失败时为 "error"：接口不 500、也不把部分结果冒充完整，
 * 所以它和 ok 一样是契约的一部分，前端据此决定要不要提示「内容可能不全」。
 */
export const SceneListResponse = z.looseObject({
  ok: z.literal(true),
  degraded: z.enum(["error"]).nullable(),
  total: z.number().int(),
  scenes: z.array(SceneSummaryPayload),
});

/** 场景包详情里的一步：站点只来自站内真实召回，召回不到的步骤整步不下发 */
const SceneStepPayload = z.looseObject({
  label: z.string(),
  /** 这一步的检索词（页面不展示，留作口径可审计：站点就是按它们召回的） */
  queries: z.array(z.string()),
  sites: z.array(SceneSitePayload),
});

/** GET /api/scenes/{id}：场景包落地页数据；未知 id 走统一 404 错误包络 */
export const SceneDetailResponse = z.looseObject({
  ok: z.literal(true),
  degraded: z.enum(["error"]).nullable(),
  scene: z.looseObject({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    intro: z.string(),
    steps: z.array(SceneStepPayload),
    /** 全部步骤去重后的真实站点数（按本次召回算） */
    siteCount: z.number().int(),
    updatedAt: z.number().nullable(),
  }),
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
  /** 禁用开关（D 批）：true = 已禁用（运行效果已停，数据与版本不动）；disabledAt 为禁用时刻毫秒时间戳 */
  disabled: z.boolean(),
  disabledAt: z.number().nullable(),
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
  defaultSearchEngine: z.enum(["internal", "google", "baidu", "bing", "sogou", "duckduckgo", "github", "perplexity"]),
  openLinksInNewTab: z.boolean(),
  cardDensity: z.enum(["comfortable", "compact", "minimal"]),
  speculativeZeroRttEnabled: z.boolean(),
  daypartSceneEnabled: z.boolean(),
  spotlightShortcut: z.enum(["mod+k", "slash", "both"]),
  searchHistoryEnabled: z.boolean(),
  telemetryEnabled: z.boolean(),
  numberDialEnabled: z.boolean(),
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

/**
 * GET/PATCH /api/me/settings：settings 与概览里的是同一份形状，
 * 所以设置页与首屏不会出现两套字段解释。
 */
export const MeSettingsResponse = z.looseObject({
  ok: z.literal(true),
  settings: MeSettingsPayload,
});

/** 用户中心里的账号资料（与概览 user 字段同形，写侧不打折） */
const MeUserPayload = z.looseObject({
  id: z.string(),
  username: z.string(),
  email: z.string().nullable(),
  avatar: z.string().nullable(),
  source: z.string(),
});

export const MeProfileUpdateResponse = z.looseObject({
  ok: z.literal(true),
  user: MeUserPayload,
});

/** 个人令牌记录：明文只在创建回执的 token 字段出现一次，record 永不回传哈希 */
const MeApiTokenPayload = z.looseObject({
  id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  ownerIdentity: z.string().nullable(),
  expiresAt: z.number().nullable(),
  lastUsedAt: z.number().nullable(),
  createdAt: z.number(),
  revokedAt: z.number().nullable(),
  rotatedAt: z.number().nullable(),
  tokenPrefix: z.string().nullable(),
});

export const MeTokenCreateResponse = z.looseObject({
  ok: z.literal(true),
  token: z.string(),
  record: MeApiTokenPayload,
});

/** POST /api/me/sessions/check：BFF 每次代理前核对会话是否已被踢出 */
export const MeSessionCheckResponse = z.looseObject({
  ok: z.literal(true),
  revoked: z.boolean(),
});

export const MeDiagnosticsResponse = z.looseObject({
  ok: z.literal(true),
  identity: z.string(),
  repairedCount: z.number().int(),
  checks: z.array(
    z.looseObject({
      id: z.string(),
      label: z.string(),
      // 前 3 项是“检查并修复”（ok/repaired）；第 15 项新增的 3 项只读
      // 安全检查不修复、不删数，状态用 ok/warning/critical/unknown 四态。
      status: z.enum(["ok", "repaired", "warning", "critical", "unknown"]),
      detail: z.string(),
    }),
  ),
  checkedAt: z.number(),
});

const SafetyStatus = z.enum(["ok", "warning", "critical", "unknown"]);

/**
 * GET /api/me/safety（第 15 项，Phase 1）：数据安全状态一次聚合。
 * lastExport.at 为 null = 近一年内无导出记录（audit_logs 只保留 365 天，
 * 不能断言从未导出过）；truncated 为 null = 历史导出未记录截断（是否完整未知）；
 * serverBackup 恒为 unknown/not-instrumented（全站冷备无任何数据库记录与 API），
 * 且不参与 overall 计算。
 */
export const MeSafetyResponse = z.looseObject({
  ok: z.literal(true),
  checkedAt: z.number(),
  overall: SafetyStatus,
  lastExport: z
    .object({
      at: z.number().nullable(),
      format: z.enum(["json", "netscape"]).nullable(),
      counts: z
        .object({ favorites: z.number().int(), folders: z.number().int(), searches: z.number().int() })
        .nullable(),
      truncated: z.boolean().nullable(),
      sizeBytes: z.number().nullable(),
    })
    .nullable(),
  lastImport: z
    .object({
      at: z.number().nullable(),
      imported: z.object({
        folders: z.number().int(),
        favorites: z.number().int(),
        searches: z.number().int(),
      }),
      skipped: z.number().int(),
    })
    .nullable(),
  sync: z.object({
    favorites: z.object({
      lastSuccessAt: z.number().nullable(),
      lastFailureAt: z.number().nullable(),
      lastErrorCode: z.enum(["timeout", "network", "server_5xx", "validation_4xx", "unknown"]).nullable(),
    }),
    watchlist: z.object({
      lastSuccessAt: z.number().nullable(),
      lastFailureAt: z.number().nullable(),
      lastErrorCode: z.enum(["timeout", "network", "server_5xx", "validation_4xx", "unknown"]).nullable(),
    }),
    exams: z.object({
      lastSuccessAt: z.number().nullable(),
      lastFailureAt: z.number().nullable(),
      lastErrorCode: z.enum(["timeout", "network", "server_5xx", "validation_4xx", "unknown"]).nullable(),
    }),
    vault: z.object({
      exists: z.boolean(),
      version: z.number().nullable(),
      updatedAt: z.number().nullable(),
    }),
    crdt: z.object({ exists: z.boolean(), updatedAt: z.number().nullable() }),
    unreadSyncFailures: z.number().int(),
  }),
  localCounts: z.object({
    favorites: z.number().int(),
    folders: z.number().int(),
    searches: z.number().int(),
    recentEvents: z.number().int(),
  }),
  serverBackup: z.object({ status: z.literal("unknown"), reason: z.literal("not-instrumented") }),
  checks: z.array(
    z.looseObject({
      id: z.string(),
      label: z.string(),
      status: SafetyStatus,
      detail: z.string(),
    }),
  ),
});

/** POST /api/me/prune：按域回传实际清理行数（未选中的域不出现） */
export const MePruneResponse = z.looseObject({
  ok: z.literal(true),
  identity: z.string(),
  pruned: z.record(z.string(), z.number()),
});

/** DELETE /api/me：键集由数据清单驱动，未来新增可删表不破坏此契约 */
export const MeDeleteResponse = z.looseObject({
  ok: z.literal(true),
  deleted: z.record(z.string(), z.number()),
});

/**
 * POST /api/me/merge：幂等命中（alreadyMerged=true）与首次合并返回同一形状，
 * 统计字段恒在（幂等命中时取首次落库的快照），前端不需要两个分支。
 */
export const MeMergeResponse = z.looseObject({
  ok: z.literal(true),
  alreadyMerged: z.boolean(),
  source: z.string(),
  target: z.string(),
  favoritesMoved: z.number().int(),
  favoritesSkipped: z.number().int(),
  examFollowsMoved: z.number().int(),
  foldersMoved: z.number().int(),
  searchesMoved: z.number().int(),
  eventsMoved: z.number().int(),
  pluginsMoved: z.number().int(),
  starsMoved: z.number().int(),
  reviewsMoved: z.number().int(),
  llmConfigMoved: z.boolean(),
  settingsMoved: z.boolean(),
  workspacesMoved: z.boolean(),
  vaultNeedsChoice: z.boolean(),
});

/**
 * POST /api/me/favorites/sync：契约承诺的是同步信封（applied/version/截断计数）；
 * items/folders 的条目形状由收藏仓储演进，集成方应配合 GET /api/favorites 使用。
 */
export const MeFavoritesSyncResponse = z.looseObject({
  ok: z.literal(true),
  applied: z.number().int(),
  version: z.number(),
  items: z.array(z.unknown()),
  folders: z.array(z.unknown()),
  truncatedNotes: z.number().int(),
});

/**
 * GET /api/me/favorites/trash：回收站列表。items 是墓碑行 + site join，
 * 条目形状由收藏仓储演进；folderName 由路由拼装（夹子可能已删，缺失为 null）。
 */
export const MeFavoriteTrashListResponse = z.looseObject({
  ok: z.literal(true),
  items: z.array(z.unknown()),
  total: z.number().int(),
});

/** POST /api/me/favorites/trash/{siteId}/restore：复活单条墓碑 */
export const MeFavoriteTrashRestoreResponse = z.looseObject({
  ok: z.literal(true),
  favorite: z.unknown(),
  /** 原收藏夹已不存在时 true：收藏已恢复到未分组 */
  folderLost: z.boolean(),
});

/** POST /api/me/favorites/trash/restore-batch：逐条恢复，返回成功数与失败清单 */
export const MeFavoriteTrashRestoreBatchResponse = z.looseObject({
  ok: z.literal(true),
  restored: z.array(z.string()),
  failed: z.array(
    z.looseObject({
      siteId: z.string(),
      error: z.string(),
    }),
  ),
});

/** DELETE /api/me/favorites/trash/{siteId}：物理删除单条墓碑 */
export const MeFavoriteTrashPurgeResponse = z.looseObject({
  ok: z.literal(true),
  purged: z.boolean(),
});

/** DELETE /api/me/favorites/trash：物理清空回收站（body 必须带 confirm: true） */
export const MeFavoriteTrashClearResponse = z.looseObject({
  ok: z.literal(true),
  purged: z.number().int(),
});

/**
 * POST /api/me/watchlist/sync：与收藏同步同一信封口径（applied/version）；
 * entries 的条目形状由追剧仓储演进，集成方以同步回执的 entries 为准。
 */
export const MeWatchlistSyncResponse = z.looseObject({
  ok: z.literal(true),
  applied: z.number().int(),
  version: z.number(),
  entries: z.array(z.unknown()),
});

/**
 * POST /api/me/exams/sync（U-379）：与追剧同步同一信封口径（applied/version）；
 * items 是一场考试一行的关注记录（examId/checked/createdAt/updatedAt/deletedAt），
 * 条目形状由考试关注仓储定义。
 */
export const MeExamsSyncResponse = z.looseObject({
  ok: z.literal(true),
  applied: z.number().int(),
  version: z.number(),
  items: z.array(z.unknown()),
});

/**
 * 用户自定义站点（/api/me/custom-sites）：条目形状由自定义站点仓储定义，
 * 字段与建表列一一对应；note 可空，其余必填。
 */
export const CustomSiteItem = z.looseObject({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  url: z.string(),
  note: z.string().nullable(),
  sortOrder: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** GET /api/me/custom-sites */
export const MeCustomSitesListResponse = z.looseObject({
  ok: z.literal(true),
  items: z.array(CustomSiteItem),
  total: z.number().int(),
});

/** POST /api/me/custom-sites（201）与 PATCH /api/me/custom-sites/{id}（200） */
export const MeCustomSiteItemResponse = z.looseObject({
  ok: z.literal(true),
  item: CustomSiteItem,
});

/** POST /api/me/custom-sites/reorder：返回重排后的全量清单 */
export const MeCustomSitesReorderResponse = z.looseObject({
  ok: z.literal(true),
  items: z.array(CustomSiteItem),
});

/** DELETE /api/me/custom-sites/{id} */
export const MeCustomSiteDeleteResponse = z.looseObject({
  ok: z.literal(true),
  removed: z.boolean(),
});

/** 待找单条（/api/me/wanted） */
export const WantedSearchItem = z.looseObject({
  id: z.string(),
  identity: z.string(),
  query: z.string(),
  correctedQuery: z.string().nullable(),
  status: z.enum(["open", "notified"]),
  notifiedSiteId: z.string().nullable(),
  notifiedAt: z.number().nullable(),
  createdAt: z.number(),
});

/** GET /api/me/wanted */
export const MeWantedSearchesListResponse = z.looseObject({
  ok: z.literal(true),
  items: z.array(WantedSearchItem),
});

/** POST /api/me/wanted（201；去重时 200 + duplicate: true） */
export const MeWantedSearchItemResponse = z.looseObject({
  ok: z.literal(true),
  item: WantedSearchItem,
  duplicate: z.literal(true).optional(),
});

/** DELETE /api/me/wanted/{id} */
export const MeWantedSearchDeleteResponse = z.looseObject({
  ok: z.literal(true),
  removed: z.boolean(),
});

/** POST /api/me/import：回执只报「实际恢复了多少」，跳过/截断/失败分支都要能说清 */
export const MeImportResponse = z.looseObject({
  ok: z.literal(true),
  identity: z.string(),
  foldersImported: z.number().int(),
  favoritesImported: z.number().int(),
  favoritesSkipped: z.number().int(),
  favoritesSkippedMissingSite: z.number().int(),
  searchesImported: z.number().int(),
  searchesSkippedDuplicate: z.number().int(),
  searchesTruncated: z.number().int(),
  settingsRestored: z.boolean(),
  settingsError: z.string().nullable(),
  backupHistoryTruncated: z.boolean(),
  historyExportLimit: z.number().int(),
  historyImportCap: z.number().int(),
  nextHistoryOffset: z.number().int().nullable(),
  starsImported: z.number().int(),
  starsSkippedDuplicate: z.number().int(),
  starsSkippedMissing: z.number().int(),
  reviewsImported: z.number().int(),
  reviewsSkippedMissing: z.number().int(),
  reviewsSkippedNotInstalled: z.number().int(),
  reviewsSkippedInvalid: z.number().int(),
  favoritesExportLimit: z.number().int(),
});

/** DELETE /api/profile：重置画像与行为事件（收藏与搜索历史不动） */
export const ProfileResetResponse = z.looseObject({
  ok: z.literal(true),
  profileCleared: z.boolean(),
  eventsRemoved: z.number().int(),
});

/** DELETE /api/profile/signals/{kind}：清一类信号并立即重建画像 */
export const ProfileSignalClearResponse = z.looseObject({
  ok: z.literal(true),
  kind: z.enum(["click", "search", "favorite"]),
  removed: z.number().int(),
  profileRebuilt: z.boolean(),
});

/** POST /api/search-history/batch-delete：两种筛选口径共用 removed */
export const SearchHistoryBatchDeleteResponse = z.looseObject({
  ok: z.literal(true),
  removed: z.number().int(),
});

/** POST /api/search-history：只记历史、不跑检索；recorded=false 表示开关关了没记 */
export const SearchHistoryRecordResponse = z.looseObject({
  ok: z.literal(true),
  recorded: z.boolean(),
});

/** POST /api/users/sync：OAuth upsert 后回传的账号行（不含任何令牌） */
export const OauthUserSyncResponse = z.looseObject({
  id: z.string(),
  username: z.string(),
  email: z.string().nullable(),
  avatar: z.string().nullable(),
  source: z.string(),
});

const WorkspaceMemberPayload = z.looseObject({
  userId: z.string(),
  username: z.string(),
  role: z.enum(["owner", "maintainer", "member", "viewer"]),
  joinedAt: z.number(),
  avatar: z.string().optional(),
  email: z.string().optional(),
});

const WorkspacePayload = z.looseObject({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  type: z.enum(["personal", "team"]),
  role: z.enum(["owner", "maintainer", "member", "viewer"]),
  icon: z.string().optional(),
  memberCount: z.number().int(),
  isDefault: z.boolean().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const WorkspaceCreateResponse = z.looseObject({
  ok: z.literal(true),
  workspace: WorkspacePayload,
});

/** POST/DELETE /api/workspaces/{id}/members 共用名册回执 */
export const WorkspaceMembersResponse = z.looseObject({
  ok: z.literal(true),
  members: z.array(WorkspaceMemberPayload),
});

/**
 * POST /api/speculation/rules：W3C Speculation Rules 编译结果。
 * rules/script 随浏览器规范演进，契约只承诺信封与可空性，不重写规范本身。
 */
export const SpeculationRulesResponse = z.looseObject({
  ok: z.literal(true),
  hasRules: z.boolean(),
  rules: z.unknown().nullable(),
  script: z.string(),
  fallbackTags: z.array(z.unknown()),
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

/**
 * 问问我的收藏前置状态（GET /api/ask/status）：收藏条数、够不够 5 条开问、
 * 模型是否就绪、3 条取自真实收藏标题的动态示例。只读，不占额度。
 */
export const AskStatusResponse = z.looseObject({
  favoritesCount: z.number().int(),
  canAsk: z.boolean(),
  llmReady: z.boolean(),
  samples: z.array(z.string()),
});

/**
 * 跨站对照（GET /api/compare）：2–4 个已收藏站点的七维对照行。
 * 每格 `{ value, source, verified, verifiedAt }`：value 为单值或 label 数组，
 * 缺失时为 null 且 verified 为 false；maintenance 格另带 lastCheckedAt
 *（与 verifiedAt 相同，单独列出供调用方直接取用）；price 格另带 stale
 *（90–180 天“可能过期”）与 sourceUrl（官方定价页 URL）。
 */
export const ComparisonCellPayload = z.looseObject({
  value: z.union([z.string(), z.array(z.string())]).nullable(),
  source: z.string(),
  verified: z.boolean(),
  verifiedAt: z.number().nullable(),
  lastCheckedAt: z.number().nullable().optional(),
  /** 仅 price 格：90–180 天未核实的“可能过期”标记。 */
  stale: z.boolean().optional(),
  /** 仅 price 格：官方定价页 URL（有它前端才启用“从官方定价页抓取”）。 */
  sourceUrl: z.string().nullable().optional(),
  /** 仅 price 格：编辑表单回填用的原始记录字段。 */
  amountMinor: z.number().optional(),
  currency: z.string().optional(),
  period: z.string().optional(),
  freeTierLimit: z.string().nullable().optional(),
});

export const CompareItemPayload = z.looseObject({
  siteId: z.string(),
  title: z.string(),
  url: z.string(),
  pricing: ComparisonCellPayload,
  platform: ComparisonCellPayload,
  form: ComparisonCellPayload,
  maintenance: ComparisonCellPayload,
  note: ComparisonCellPayload,
  migration: ComparisonCellPayload,
  /**
   * 价格数值格（Batch 4 Phase 2 P2-2）。CompareResponse 是 looseObject，
   * 旧快照/旧返回里没有 price 格也能通过校验；这里以 optional 记下
   * 第七格的形状，不收紧历史数据。
   */
  price: ComparisonCellPayload.optional(),
});

export const CompareResponse = z.looseObject({
  ok: z.literal(true),
  items: z.array(CompareItemPayload),
});

/**
 * 对照快照（POST /api/compare/snapshots，Batch 4 Phase 2 P2-3）：
 * 快照对外形态，不含 owner_identity。items 与 GET /api/compare 共用
 * CompareItemPayload——快照存的就是服务端现算的同一对照行；P2-2 之前
 * 的旧快照可能没有 price 格，price 在 CompareItemPayload 里已是 optional。
 */
export const ComparisonSnapshotPayload = z.looseObject({
  id: z.string(),
  siteIds: z.array(z.string()),
  items: z.array(CompareItemPayload),
  createdAt: z.number(),
});

export const ComparisonSnapshotCreateResponse = z.looseObject({
  ok: z.literal(true),
  snapshot: ComparisonSnapshotPayload,
});

/**
 * 对照分享（POST /api/compare/snapshots/:id/publish、PATCH/DELETE
 * /api/compare/shares/:slug，Batch 4 Phase 2 P2-4）：shareView 的对外
 * 形态，不含 owner_identity；发布回执在 share 上多一个公开链接 url。
 */
export const ComparisonSharePayload = z.looseObject({
  slug: z.string(),
  fields: z.array(z.string()),
  status: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const ComparisonSharePublishResponse = z.looseObject({
  ok: z.literal(true),
  share: ComparisonSharePayload.extend({ url: z.string() }),
});

export const ComparisonShareUpdateResponse = z.looseObject({
  ok: z.literal(true),
  share: ComparisonSharePayload,
});

/**
 * 站点价格（POST/DELETE /api/sites/:id/price、POST /api/sites/:id/price/scrape，
 * Batch 4 Phase 2 P2-2）：priceView 的对外形态。currency/period 在 core 里
 * 与 SitePriceEntry 同口径记 string（枚举的 canonical 清单在
 * apps/api/src/routes/site-prices.ts 的 PRICE_CURRENCIES/PRICE_PERIODS，
 * 后端 400 拦截非法值）。
 */
export const SitePricePayload = z.looseObject({
  id: z.string(),
  siteId: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  period: z.string(),
  freeTierLimit: z.string().nullable(),
  sourceType: z.enum(["manual", "official_scrape"]),
  sourceUrl: z.string().nullable(),
  verifiedAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const SitePriceUpsertResponse = z.looseObject({
  ok: z.literal(true),
  price: SitePricePayload,
});

/** DELETE /api/sites/:id/price 回执：幂等，无记录也回 200 { deleted: false }。 */
export const SitePriceDeleteResponse = z.looseObject({
  ok: z.literal(true),
  deleted: z.boolean(),
});

/** 抓取返回的一条价格候选（PriceScrapeCandidate 的契约形态）。 */
export const PriceScrapeCandidatePayload = z.looseObject({
  text: z.string(),
  amount: z.number().nullable(),
  amountMinor: z.number().nullable(),
  currency: z.string().nullable(),
  period: z.string().nullable(),
  confirmToken: z.string().nullable(),
});

export const PriceScrapeResponse = z.looseObject({
  ok: z.literal(true),
  siteId: z.string(),
  sourceUrl: z.string().nullable(),
  robots_disallowed: z.boolean(),
  candidates: z.array(PriceScrapeCandidatePayload),
  message: z.string(),
});

/**
 * 刷新验证（POST /api/sites/:id/verify，Batch 4 Phase 2 P2-1）：
 * 202 已受理后台验证 / 200 robots 置灰，两者同形。
 */
export const SiteVerifyResponse = z.looseObject({
  ok: z.literal(true),
  siteId: z.string(),
  status: z.enum(["pending", "robots_disallowed"]),
  robots_disallowed: z.boolean(),
  message: z.string(),
  lastCheckedAt: z.number().nullable(),
});

/** 对照快照列表（GET /api/compare/snapshots，Batch 4 Phase 2 P2-3）。 */
export const ComparisonSnapshotListResponse = z.looseObject({
  ok: z.literal(true),
  snapshots: z.array(ComparisonSnapshotPayload),
});

/** 两快照逐格 diff（GET /api/compare/snapshots/{id}/diff，P2-3）。 */
export const SnapshotDiffChangePayload = z.looseObject({
  siteId: z.string(),
  title: z.string(),
  dimension: z.enum(["pricing", "price", "platform", "form", "maintenance", "note", "migration"]),
  kind: z.enum(["value_changed", "became_verified", "verification_added"]),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  oldVerified: z.boolean(),
  newVerified: z.boolean(),
});

export const ComparisonSnapshotDiffResponse = z.looseObject({
  ok: z.literal(true),
  diff: z.looseObject({
    base: z.object({ id: z.string(), createdAt: z.number() }),
    against: z.object({ id: z.string(), createdAt: z.number() }),
    changes: z.array(SnapshotDiffChangePayload),
  }),
});

/**
 * 公开分享的对照格（projectCell 的投影形态，P2-4）：只有白名单字段
 *（pricing/platform/form/maintenance/price），note/migration 永不进结果；
 * 价格原始字段（amountMinor/currency/period/freeTierLimit/sourceUrl）一律
 * 不复制；stale 只在 price 格 90–180 天为 true 时保留。
 */
export const PublishedComparisonCellPayload = z.looseObject({
  value: z.union([z.string(), z.array(z.string())]).nullable(),
  source: z.string(),
  verified: z.boolean(),
  verifiedAt: z.number().nullable(),
  stale: z.boolean().optional(),
});

export const PublishedComparisonItemPayload = z.looseObject({
  siteId: z.string(),
  title: z.string(),
  url: z.string(),
  pricing: PublishedComparisonCellPayload.optional(),
  platform: PublishedComparisonCellPayload.optional(),
  form: PublishedComparisonCellPayload.optional(),
  maintenance: PublishedComparisonCellPayload.optional(),
  price: PublishedComparisonCellPayload.optional(),
});

export const PublishedComparisonSnapshotPayload = z.looseObject({
  id: z.string(),
  siteIds: z.array(z.string()),
  items: z.array(PublishedComparisonItemPayload),
  createdAt: z.number(),
});

/** 公开读分享（GET /api/compare/shares/:slug，P2-4）：share 只有 slug/fields/createdAt，永不含 owner。 */
export const ComparisonShareReadResponse = z.looseObject({
  ok: z.literal(true),
  share: z.looseObject({
    slug: z.string(),
    fields: z.array(z.string()),
    createdAt: z.number(),
  }),
  snapshot: PublishedComparisonSnapshotPayload,
});

/** 探活结论（GET /api/sites/:id/verify 的 outcome，P2-1）：SiteProbeResult 的契约形态。 */
export const SiteProbeOutcomePayload = z.looseObject({
  kind: z.enum(["ok", "blocked", "parked", "dead", "unverified", "server-error"]),
  status: z.number().optional(),
  latencyMs: z.number(),
  redirectTo: z.string().nullable().optional(),
  reason: z.string(),
  robotsDisallowed: z.boolean().optional(),
  fromCache: z.boolean().optional(),
  checkedAt: z.number().optional(),
});

/** 轮询刷新验证状态（GET /api/sites/:id/verify，P2-1）。 */
export const SiteVerifyStatusResponse = z.looseObject({
  ok: z.literal(true),
  siteId: z.string(),
  status: z.enum(["idle", "pending", "done", "robots_disallowed"]),
  outcome: SiteProbeOutcomePayload.nullable(),
  robots_disallowed: z.boolean(),
  finishedAt: z.number().nullable(),
  lastCheckedAt: z.number().nullable(),
  previousLastCheckedAt: z.number().nullable(),
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

/**
 * 禁用/启用已安装插件回执（D 批）：扁平契约，disabled 由安装记录的
 * disabledAt 派生；changed=false 是幂等语义（已经是目标状态，不是错误）。
 * disable 与 enable 共用同一形状。
 */
export const PluginDisableResponse = z.looseObject({
  success: z.literal(true),
  slug: z.string(),
  version: z.string(),
  disabled: z.boolean(),
  disabledAt: z.number().nullable(),
  changed: z.boolean(),
});

/** 作者档案（D 批）：与 store 的 PluginAuthorProfile 同形 */
export const PluginAuthorProfilePayload = z.looseObject({
  ownerKey: z.string(),
  displayName: z.string().nullable(),
  bio: z.string().nullable(),
  avatar: z.string().nullable(),
  links: z.looseObject({
    homepage: z.string().optional(),
    github: z.string().optional(),
    x: z.string().optional(),
  }),
  donateUrl: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const PluginAuthorProfileResponse = z.looseObject({
  ok: z.literal(true),
  profile: PluginAuthorProfilePayload,
});

/**
 * 真实回滚回执（B-1）：安装回执 + 回滚三元组（从哪个版本回滚到哪个版本、
 * 移除了多少新版独有站点）。路由返回 { success: true, ...store 回滚结果 }。
 */
export const PluginRollbackResponse = PluginInstallResponse.extend({
  rolledBackFrom: z.string(),
  rolledBackTo: z.string(),
  sitesRemoved: z.number().int(),
});

/** 评价记录（B-3 删除回执里的快照）：与 store 的 PluginReviewRecord 同形 */
export const PluginReviewPayload = z.looseObject({
  id: z.string(),
  pluginId: z.string(),
  identity: z.string(),
  rating: z.number(),
  title: z.string().nullable(),
  content: z.string().nullable(),
  installedVersion: z.string(),
  status: z.string(),
  reportCount: z.number().int(),
  moderationNote: z.string().nullable(),
  moderatedAt: z.number().nullable(),
  moderatedBy: z.string().nullable(),
  authorReply: z.string().nullable().optional(),
  authorRepliedAt: z.number().nullable().optional(),
  helpfulCount: z.number().int(),
  helpfulByMe: z.boolean().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** 单插件安装趋势（D 批）：GET /api/plugins/{slug}/trend?days=30 */
export const PluginInstallTrendResponse = z.looseObject({
  ok: z.literal(true),
  pluginId: z.string(),
  slug: z.string(),
  days: z.number().int(),
  total: z.number().int(),
  series: z.array(
    z.looseObject({
      date: z.string(),
      installs: z.number().int(),
    }),
  ),
});

/** 评价删除回执（B-3）：硬删除，review 是删除前的快照 */
export const PluginReviewDeleteResponse = z.looseObject({
  success: z.literal(true),
  deleted: z.literal(true),
  review: PluginReviewPayload,
});

/** 评价「有用」投票切换回执（P2-3）：helpful=true 为投上，false 为撤回 */
export const PluginReviewHelpfulResponse = z.looseObject({
  ok: z.literal(true),
  helpful: z.boolean(),
  helpfulCount: z.number().int(),
  review: PluginReviewPayload,
});

/** PATCH /api/plugins/{slug}/featured：精选位变更后回传公开插件卡片 */
export const PluginFeaturedResponse = z.looseObject({
  ok: z.literal(true),
  plugin: PluginMutationPayload,
});

/** 无载荷写回执（DELETE 收藏夹等「只表示成功」的端点） */
export const OkResponse = z.looseObject({ ok: z.literal(true) });

/** 带消息文案的成功回执（邮箱验证 / 密码重置等） */
export const OkMessageResponse = z.looseObject({
  ok: z.literal(true),
  message: z.string(),
});

/** POST /api/account/register：注册成功回执 */
export const AccountRegisterResponse = z.looseObject({
  ok: z.literal(true),
  user: z.looseObject({
    id: z.string(),
    username: z.string(),
    email: z.string(),
  }),
  message: z.string(),
});

/** POST /api/account/login：登录凭证校验回执 */
export const AccountLoginResponse = z.looseObject({
  ok: z.literal(true),
  user: z.looseObject({
    id: z.string(),
    username: z.string(),
    email: z.string().nullable(),
    role: z.string(),
    emailVerified: z.boolean(),
  }),
});

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
 * 写路由回执（P1-8：write/admin 路由的可生成契约）
 * ------------------------------------------------------------------ */

/** 标签增删改的通用回执：各操作按仓库返回附带 unbound/moved/alias 之一 */
export const TagMutationResponse = z.looseObject({
  ok: z.literal(true),
  unbound: z.number().int().optional(),
  moved: z.number().int().optional(),
  alias: z.string().optional(),
});

export const CategoryMergeResponse = z.looseObject({
  ok: z.literal(true),
  movedSites: z.number().int(),
  removedCategories: z.number().int(),
});

const SiteBulkPlanItem = z.object({
  id: z.string(),
  action: z.enum(["apply", "skip"]),
  reason: z.string().optional(),
});

/** POST /api/sites/bulk：dryRun 与执行态共用一份形状（字段按阶段出现） */
export const SiteBulkResponse = z.looseObject({
  dryRun: z.boolean(),
  op: z.enum(["delete", "setCategory", "setStatus"]),
  total: z.number().int().optional(),
  wouldApply: z.number().int().optional(),
  applied: z.number().int().optional(),
  skipped: z.number().int().optional(),
  plan: z.array(SiteBulkPlanItem),
});

/** POST /api/sites/batch：批量导入回执（201） */
export const SiteBatchResponse = z.looseObject({
  success: z.literal(true),
  created: z.number().int(),
  duplicates: z.number().int(),
  categoryDegraded: z.number().int(),
  sites: z.array(SitePayload),
});

/** 任务记录的最小可依赖形状（GET /api/jobs/:id 与 retry 响应共用） */
export const JobSummaryPayload = z.looseObject({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
  attempts: z.number().int(),
  error: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  nextRunAt: z.number().nullable().optional(),
  progressDone: z.number().int().optional(),
  progressTotal: z.number().int().optional(),
});

export const JobEnqueuedResponse = z.object({
  id: z.string(),
  kind: z.string(),
});

export const JobCancelResponse = z.object({
  ok: z.literal(true),
  id: z.string(),
  status: z.enum(["cancelled", "cancelling"]),
  abortedLocally: z.boolean(),
});

export const JobRetryResponse = z.object({
  ok: z.literal(true),
  job: JobSummaryPayload,
});

export const JobPruneResponse = z.object({
  ok: z.literal(true),
  pruned: z.number().int(),
  olderThanDays: z.number().int(),
});

/** API 凭据的公开字段（不含明文与哈希） */
const apiTokenCoreShape = {
  id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  ownerIdentity: z.string().nullable(),
  expiresAt: z.number().nullable(),
  lastUsedAt: z.number().nullable(),
  createdAt: z.number(),
  revokedAt: z.number().nullable(),
  rotatedAt: z.number().nullable(),
  tokenPrefix: z.string().nullable(),
};

export const ApiTokenPayload = z.looseObject(apiTokenCoreShape);

/** GET /api/tokens：凭据列表（按创建时间倒序） */
export const ApiTokenListResponse = z.array(ApiTokenPayload);

/** POST /api/tokens 与 rotate 的唯一区别是 note 文案；明文只在此出现一次 */
export const ApiTokenIssueResponse = z.looseObject({
  ...apiTokenCoreShape,
  token: z.string(),
  note: z.string(),
});

/** POST /api/admin/notifications/read-all */
export const NotificationReadAllResponse = z.object({
  ok: z.literal(true),
  marked: z.number().int(),
});

/** PATCH /api/submissions/{number}：审核回执 */
/** 原因生成被额度挡住时的结构化信息（与 llm-quota 的响应体同口径） */
export const SubmissionReviewReasonQuota = z.object({
  scope: z.enum(["identity", "anonymous", "system"]),
  metric: z.enum(["calls", "tokens"]),
  limit: z.number().int(),
  used: z.number().int(),
  blockedBy: z.enum(["usage", "reservation", "both"]),
  retryAfterSeconds: z.number().int(),
});

export const SubmissionReviewResponse = z.object({
  success: z.literal(true),
  message: z.string(),
  siteId: z.string(),
  /** 原因文本来源：AI 生成 / 通用模板 / 额度用完降级（不许模板冒充 AI） */
  reasonSource: z.enum(["ai", "template", "quota"]).optional(),
  reasonQuota: SubmissionReviewReasonQuota.optional(),
});

/** GET /api/submissions/feedback：收录反馈（提交后网址收录情况汇报） */
export const SubmissionFeedbackItem = z.object({
  siteId: z.string(),
  title: z.string(),
  url: z.string(),
  submittedAt: z.number(),
  status: z.enum(["pending", "approved", "rejected"]),
  reason: z.string(),
  reviewedAt: z.number().nullable(),
});

export const SubmissionFeedbackResponse = z.object({
  success: z.literal(true),
  items: z.array(SubmissionFeedbackItem),
});

/* ------------------------------------------------------------------ *
 * 运维/存储管理面回执
 * ------------------------------------------------------------------ */

export const MaintenanceStatusResponse = z.looseObject({
  ok: z.boolean(),
  dialect: z.enum(["sqlite", "pg"]),
  integrity: z.string(),
  dbSizeBytes: z.number().nullable(),
  pageCount: z.number().optional(),
  pageSize: z.number().optional(),
  freePages: z.number().optional(),
  tableCounts: z.record(z.string(), z.number()),
});

export const MaintenanceActionResult = z.looseObject({
  ok: z.boolean(),
  tookMs: z.number(),
  message: z.string().optional(),
  skipped: z.boolean().optional(),
  logSize: z.number().optional(),
});

/* ------------------------------------------------------------------ *
 * 链接巡检后台（A10）：坏站清单与可见性处置回执
 * ------------------------------------------------------------------ */

export const LinkHealthItem = z.looseObject({
  siteId: z.string(),
  title: z.string(),
  url: z.string(),
  categoryId: z.string(),
  status: z.string(),
  enabled: z.boolean(),
  consecutiveFailures: z.number(),
  lastCheckedAt: z.number().nullable(),
  httpStatus: z.number().nullable(),
  error: z.string().nullable(),
  errorKind: z.string(),
});

export const LinkHealthOverviewResponse = z.looseObject({
  ok: z.boolean(),
  summary: z.looseObject({
    totalSites: z.number(),
    checkedSites: z.number(),
    uncheckedSites: z.number(),
    coveragePct: z.number(),
    brokenCount: z.number(),
    failingCount: z.number(),
    failThreshold: z.number(),
    lastPatrolAt: z.number().nullable(),
  }),
  items: z.array(LinkHealthItem),
});

export const LinkHealthVisibilityResponse = z.looseObject({
  ok: z.boolean(),
  updated: z.number(),
  results: z.array(
    z.looseObject({
      siteId: z.string(),
      ok: z.boolean(),
      enabled: z.boolean().optional(),
      reason: z.string().optional(),
    }),
  ),
});

export const StorageWriteResponse = z.looseObject({
  ok: z.literal(true),
  note: z.string(),
  version: z.number().optional(),
});

export const StorageDeleteResponse = z.object({
  ok: z.literal(true),
  path: z.string(),
});

const StorageAssetPayload = z.looseObject({
  references: z.array(z.string()),
  kind: z.string(),
  createdAt: z.number(),
  mime: z.string().nullable(),
  sha256: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  path: z.string(),
  name: z.string(),
  bytes: z.number(),
  updatedAt: z.number(),
});

export const StorageAssetListResponse = z.object({
  assets: z.array(StorageAssetPayload),
  limit: z.number().int(),
});

/** POST /api/admin/audit/scan：自治巡检报告 */
export const SiteAuditScanResponse = z.looseObject({
  ok: z.literal(true),
  scanned: z.number().int(),
  summary: z.looseObject({
    scannedAt: z.number(),
    totalSites: z.number().int(),
    activeCount: z.number().int(),
    brokenCount: z.number().int(),
    healthScore: z.number(),
    issues: z.array(z.looseObject({ siteId: z.string(), url: z.string(), title: z.string() })),
  }),
});

/** POST /api/admin/audit/apply：采纳自愈建议 */
export const SiteAuditApplyResponse = z.looseObject({
  ok: z.literal(true),
  action: z.enum(["wayback", "replacement", "dismiss"]),
  siteId: z.string(),
});

/** POST /api/warmup：embedding 预热结果（未启用时 ok=false + reason） */
export const WarmupResponse = z.looseObject({
  ok: z.boolean(),
  reason: z.string().optional(),
  tookMs: z.number().optional(),
  model: z.string().optional(),
  dim: z.number().optional(),
});

/* ------------------------------------------------------------------ *
 * 公开读路由：Top-20 高频端点补齐
 * ------------------------------------------------------------------ */

/** GET /api/tags/resolve：别名归一化解析 */
export const ResolveTagResponse = z.looseObject({
  ok: z.literal(true),
  tag: TagPayload,
});

/** GET /api/tags/{id}/related：标签共现相邻主题（标签页不再是没有出口的死胡同） */
export const RelatedTagsResponse = z.looseObject({
  ok: z.literal(true),
  tagId: z.string(),
  tagSlug: z.string(),
  related: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      group: z.string(),
      color: z.string().nullable(),
      sharedSites: z.number().int(),
    }),
  ),
});

const FacetDefinitionPayload = z.looseObject({
  key: z.string(),
  label: z.string(),
  labelEn: z.string().optional(),
  description: z.string().optional(),
  multiselect: z.boolean().optional(),
  options: z.array(z.looseObject({ value: z.string(), label: z.string(), labelEn: z.string().optional() })),
});

const FacetGroupSummaryPayload = z.looseObject({
  key: z.string(),
  label: z.string(),
  labelEn: z.string().optional(),
  description: z.string().optional(),
  options: z.array(
    z.looseObject({
      value: z.string(),
      label: z.string(),
      labelEn: z.string().optional(),
      count: z.number().int(),
    }),
  ),
});

/** GET /api/facets：受控分面定义 + 当前筛选下的计数 */
export const FacetsResponse = z.looseObject({
  ok: z.literal(true),
  definitions: z.array(FacetDefinitionPayload),
  facets: z.array(FacetGroupSummaryPayload),
});

/** GET /api/sites/{id}/facets：单个站点的分面值 */
export const SiteFacetsResponse = z.looseObject({
  ok: z.literal(true),
  siteId: z.string(),
  facets: z.record(z.string(), z.array(z.string())),
});

/** GET /api/plugins/{slug}：详情页需要的插件卡片 + 私有状态 */
export const PluginDetailResponse = z.looseObject({
  plugin: PluginMutationPayload.extend({
    installed: z.boolean(),
    starred: z.boolean(),
    installedVersion: z.string().nullable(),
    installedAt: z.number().nullable(),
    hasUpgrade: z.boolean(),
    upgradeDiff: z.unknown(),
    reviewStats: z.unknown(),
    myReview: z.unknown(),
    isOwner: z.boolean(),
  }),
  summary: z.unknown(),
});

/** PUT /api/sites/{id}/relations：覆盖写回执（回读的完整关系集） */
export const RelationsUpdateResponse = z.looseObject({
  ok: z.literal(true),
  siteId: z.string(),
  total: z.number().int(),
  relations: z.array(SiteRelationSchema),
});

/* ------------------------------------------------------------------ *
 * 分类/标签治理（taxonomy）
 * ------------------------------------------------------------------ */

const TaxonomyProposalPayload = z.looseObject({
  id: z.string(),
  kind: z.enum(TAXONOMY_PROPOSAL_KINDS),
  targetId: z.string(),
  targetTitle: z.string().optional(),
  currentValue: z.string().optional(),
  suggestedValue: z.string(),
  confidence: z.number(),
  reason: z.string(),
  status: z.enum(["pending", "applied", "dismissed"]),
  meta: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.number(),
  appliedAt: z.number().nullable().optional(),
});

/** POST /api/taxonomy/audit：全站治理审计报告 */
export const TaxonomyAuditResponse = z.looseObject({
  ok: z.literal(true),
  dryRun: z.boolean(),
  proposalsCount: z.number().int(),
  byKind: z.record(z.string(), z.number()),
  proposals: z.array(TaxonomyProposalPayload),
});

/** 单条提案的采纳/驳回回执 */
export const TaxonomyProposalMutationResponse = z.looseObject({
  ok: z.literal(true),
  message: z.string().optional(),
  proposal: TaxonomyProposalPayload,
});

/** POST /api/taxonomy/proposals/batch：批量结果如实分成功/失败 */
export const TaxonomyBatchResponse = z.looseObject({
  ok: z.literal(true),
  action: z.enum(["apply", "dismiss"]),
  total: z.number().int(),
  successCount: z.number().int(),
  failedCount: z.number().int(),
  errors: z.array(z.string()),
});

/* ------------------------------------------------------------------ *
 * 投稿与短链
 * ------------------------------------------------------------------ */

export const SubmissionCreateResponse = z.object({
  success: z.literal(true),
  message: z.string(),
  siteId: z.string(),
});

export const ShortlinkCreateResponse = z.object({
  success: z.literal(true),
  code: z.string(),
  path: z.string(),
  target: z.string(),
});

/* ------------------------------------------------------------------ *
 * 站点纠错上报与复核（升级第 10 条，apps/api/src/routes/site-reports.ts）
 * ------------------------------------------------------------------ */

/** 上报问题类型（与路由 SITE_REPORT_KINDS 同值；toReport 解析后只剩合法值） */
export const SiteReportKind = z.enum([
  "wrong-description",
  "dead-link",
  "wrong-category",
  "wrong-pricing",
  "other",
]);

export const SiteReportSource = z.enum(["site-detail", "search"]);

export const SiteReportStatus = z.enum(["open", "in_progress", "resolved", "rejected"]);

/** POST /api/sites/{id}/reports：成功只返回 { ok, id }（路由注释冻结契约，201） */
export const SiteReportCreateResponse = z.object({
  ok: z.literal(true),
  id: z.string(),
});

/** 复核列表单条（路由 toReport 的原样形状；站点已清理时标题/链接为 null） */
export const SiteReportItemResponse = z.object({
  id: z.string(),
  siteId: z.string(),
  siteTitle: z.string().nullable(),
  siteUrl: z.string().nullable(),
  kinds: z.array(SiteReportKind),
  kindLabels: z.array(z.string()),
  detail: z.string(),
  contact: z.string().nullable(),
  source: SiteReportSource,
  status: SiteReportStatus,
  createdAt: z.number(),
});

/** GET /api/admin/site-reports：复核列表（success 信封） */
export const SiteReportsListResponse = z.object({
  success: z.literal(true),
  items: z.array(SiteReportItemResponse),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

/** PATCH /api/admin/site-reports/{id}：流转回执（只改状态） */
export const SiteReportReviewResponse = z.object({
  success: z.literal(true),
  id: z.string(),
  status: SiteReportStatus,
});

/* ------------------------------------------------------------------ *
 * 绑定表
 * ------------------------------------------------------------------ */

export interface ResponseSchemaBinding {
  /**
   * 响应体契约。`noContent: true` 的绑定没有响应体，此字段可省略——
   * 204 端点若硬塞一个 `{ok:true}` schema，文档会说谎（客户端会尝试解析空 body）。
   */
  schema?: z.ZodTypeAny;
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
  /** true = 成功响应无 body（204）。与 schema 互斥。 */
  noContent?: true;
}

/* ------------------------------------------------------------------ *
 * 统一错误包络（P2-2）
 * ------------------------------------------------------------------ */

/**
 * 错误响应契约。
 *
 * 兼容口径：`error` 仍是字符串——前端与 BFF 里大量 `data.error || "..."` 在直接读它。
 * 一次改成嵌套对象会让所有存量调用方拿到 `[object Object]`，所以新增字段并列扩展：
 *   - `code`：稳定错误码（客户端按它分支，而不是匹配中文文案）
 *   - `requestId`：Fastify 请求 id，报障时把它交给运维即可定位日志
 *   - `details`：校验 issue 等结构化细节（旧路由里的 `detail` 继续保留）
 *   - `retryable`：明确「重试是否有意义」，避免客户端对所有 5xx 盲目重试
 *
 * looseObject 是因为历史路由会附带 `siteId` / `existingSiteId` 这类上下文；
 * 它们不是统一契约的一部分，但也不该让文档与实现互相否认。
 */
export const ErrorResponse = z.looseObject({
  error: z.string().describe("错误信息（兼容字段：存量客户端直接读这个字符串）"),
  code: z.string().optional().describe("稳定错误码（如 INVALID_ARGUMENT / NOT_FOUND / INTERNAL_ERROR）"),
  message: z.string().optional().describe("错误信息（与 error 同值；新客户端优先读它）"),
  requestId: z.string().optional().describe("请求 id，用于在日志中定位同一次失败"),
  details: z.unknown().optional().describe("结构化细节（字段校验 issues 等）"),
  retryable: z.boolean().optional().describe("是否值得重试（false 时客户端不应自动重试）"),
});

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
  // 搜索框热词：/search 空态「大家都在搜」chips 的数据源（只读公开端点）
  "GET /api/search/hotwords": { schema: SearchHotwordsResponse, name: "SearchHotwordsResponse" },
  "GET /api/sites": { schema: SiteListResponse, name: "SiteListResponse" },
  "GET /api/categories": { schema: CategoryListResponse, name: "CategoryListResponse" },
  "GET /api/categories/page": { schema: CategoryPageResponse, name: "CategoryPageResponse" },
  "GET /api/categories/counts": { schema: CategoryCountsResponse, name: "CategoryCountsResponse" },
  "GET /api/tags": { schema: TagListResponse, name: "TagListResponse" },
  "GET /api/rank/trending": { schema: RankTrendingResponse, name: "RankTrendingResponse" },
  "GET /api/rank/new": { schema: RankNewResponse, name: "RankNewResponse" },
  // 场景包落地页取数：列表是索引页数据源、详情是 /scenes/{id} 的数据源
  "GET /api/scenes": { schema: SceneListResponse, name: "SceneListResponse" },
  "GET /api/scenes/{id}": { schema: SceneDetailResponse, name: "SceneDetailResponse" },
  // 全网热榜缓存与每日简报：/brief 页与首页简报模块的数据源
  "GET /api/hotlist": { schema: HotlistResponse, name: "HotlistResponse" },
  "GET /api/brief/today": { schema: BriefTodayResponse, name: "BriefTodayResponse" },
  // 短剧开播日历：/drama 页“开播日历”区块的数据源（快照只读）
  "GET /api/drama/calendar": { schema: DramaCalendarResponse, name: "DramaCalendarResponse" },
  // 短剧真榜单：/drama 页“三榜”区块的数据源（快照只读）
  "GET /api/drama/rankings": { schema: DramaRankingsResponse, name: "DramaRankingsResponse" },
  "GET /api/plugins": { schema: PluginListResponse, name: "PluginListResponse" },
  "GET /api/plugins/installed": { schema: InstalledPluginsResponse, name: "InstalledPluginsResponse" },
  // 单插件安装趋势（D 批）：真实安装记录按天聚合
  "GET /api/plugins/{slug}/trend": { schema: PluginInstallTrendResponse, name: "PluginInstallTrendResponse" },
  "GET /api/plugins/taps": { schema: PluginTapsResponse, name: "PluginTapsResponse" },
  "GET /api/plugins/taps/public": { schema: PublicPluginTapsResponse, name: "PublicPluginTapsResponse" },
  // 单站详情与列表共用同一份站点形状（路由直接返回站点对象，没有外壳）
  "GET /api/sites/{id}": { schema: SitePayload, name: "SitePayload" },
  "GET /api/search-history": { schema: SearchHistoryPageResponse, name: "SearchHistoryPageResponse" },
  "GET /api/me": { schema: MeOverviewResponse, name: "MeOverviewResponse" },
  "GET /api/me/safety": { schema: MeSafetyResponse, name: "MeSafetyResponse" },
  "GET /api/me/drama-check-states": { schema: DramaCheckStatesResponse, name: "DramaCheckStatesResponse" },
  "GET /api/favorites": { schema: FavoritesListResponse, name: "FavoritesListResponse" },
  // 问问我的收藏前置状态：POST /api/ask 是 SSE 流式（见未绑定清单），只绑这个只读端点
  "GET /api/ask/status": { schema: AskStatusResponse, name: "AskStatusResponse" },
  // 跨站对照：2–4 个已收藏站点的六维对照（Batch 4 Phase 1）
  "GET /api/compare": { schema: CompareResponse, name: "CompareResponse" },
  // 对照快照与分享（Batch 4 Phase 2 P2-3/P2-4）：新建 201，上下线/删除 200
  "POST /api/compare/snapshots": {
    schema: ComparisonSnapshotCreateResponse,
    name: "ComparisonSnapshotCreateResponse",
    status: "201",
  },
  "POST /api/compare/snapshots/{id}/publish": {
    schema: ComparisonSharePublishResponse,
    name: "ComparisonSharePublishResponse",
    status: "201",
  },
  "PATCH /api/compare/shares/{slug}": {
    schema: ComparisonShareUpdateResponse,
    name: "ComparisonShareUpdateResponse",
  },
  "DELETE /api/compare/shares/{slug}": { schema: OkResponse, name: "OkResponse" },
  // 站点价格与刷新验证（Batch 4 Phase 2 P2-2/P2-1）：verify 的 202 与 200 同形
  "POST /api/sites/{id}/price": { schema: SitePriceUpsertResponse, name: "SitePriceUpsertResponse" },
  "DELETE /api/sites/{id}/price": { schema: SitePriceDeleteResponse, name: "SitePriceDeleteResponse" },
  "POST /api/sites/{id}/price/scrape": { schema: PriceScrapeResponse, name: "PriceScrapeResponse" },
  "POST /api/sites/{id}/verify": {
    schema: SiteVerifyResponse,
    name: "SiteVerifyResponse",
    status: ["200", "202"],
  },
  // 对照快照/分享的读端（Batch 4 Phase 2 P2-3/P2-4）与验证轮询（P2-1）
  "GET /api/compare/snapshots": {
    schema: ComparisonSnapshotListResponse,
    name: "ComparisonSnapshotListResponse",
  },
  "GET /api/compare/snapshots/{id}/diff": {
    schema: ComparisonSnapshotDiffResponse,
    name: "ComparisonSnapshotDiffResponse",
  },
  "GET /api/compare/shares/{slug}": {
    schema: ComparisonShareReadResponse,
    name: "ComparisonShareReadResponse",
  },
  "GET /api/sites/{id}/verify": {
    schema: SiteVerifyStatusResponse,
    name: "SiteVerifyStatusResponse",
  },
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
  "GET /api/categories/{id}": { schema: CategoryPayload, name: "CategoryPayload" },
  "GET /api/categories/by-slug/{slug}": { schema: CategoryPayload, name: "CategoryPayload" },
  "GET /api/tags/resolve": { schema: ResolveTagResponse, name: "ResolveTagResponse" },
  "GET /api/facets": { schema: FacetsResponse, name: "FacetsResponse" },
  "GET /api/sites/{id}/facets": { schema: SiteFacetsResponse, name: "SiteFacetsResponse" },
  // 详情页相似推荐：与站点列表同形（直接返回站点数组，没有外壳）
  "GET /api/sites/{id}/similar": { schema: SiteListResponse, name: "SiteListResponse" },
  "GET /api/tags/{id}/related": { schema: RelatedTagsResponse, name: "RelatedTagsResponse" },
  "GET /api/plugins/{slug}": { schema: PluginDetailResponse, name: "PluginDetailResponse" },
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
  // 禁用/启用（D 批）：与 install/uninstall 同口径的用户域写面，扁平回执
  "POST /api/plugins/{slug}/disable": { schema: PluginDisableResponse, name: "PluginDisableResponse" },
  "POST /api/plugins/{slug}/enable": { schema: PluginDisableResponse, name: "PluginDisableResponse" },
  // 真实回滚（B-1）：安装回执 + 回滚三元组
  "POST /api/plugins/{slug}/rollback": { schema: PluginRollbackResponse, name: "PluginRollbackResponse" },
  // 作者档案写入（D 批）：{ ok: true, profile }
  "POST /api/plugins/author/profile": { schema: PluginAuthorProfileResponse, name: "PluginAuthorProfileResponse" },
  // 管理员删评价（B-3）：硬删除，review 是删除前的快照
  "DELETE /api/plugins/{slug}/reviews/{id}": { schema: PluginReviewDeleteResponse, name: "PluginReviewDeleteResponse" },
  // 评价「有用」投票切换（P2-3）：一人一票，再点撤回
  "POST /api/plugins/{slug}/reviews/{id}/helpful": { schema: PluginReviewHelpfulResponse, name: "PluginReviewHelpfulResponse" },
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

  /* 站点/回收站写路由 */
  "DELETE /api/sites/{id}": { name: "NoContent", status: "204", noContent: true },
  "POST /api/sites/bulk": { schema: SiteBulkResponse, name: "SiteBulkResponse" },
  "POST /api/sites/batch": { schema: SiteBatchResponse, name: "SiteBatchResponse", status: "201" },
  "POST /api/trash/{id}/restore": { schema: SitePayload, name: "SitePayload" },
  "DELETE /api/trash/{id}": { name: "NoContent", status: "204", noContent: true },

  /* 类目/标签写路由 */
  "POST /api/categories": { schema: CategoryPayload, name: "CategoryPayload", status: "201" },
  "PATCH /api/categories/{id}": { schema: CategoryPayload, name: "CategoryPayload" },
  "POST /api/categories/{id}/move": { schema: CategoryPayload, name: "CategoryPayload" },
  "POST /api/categories/merge": { schema: CategoryMergeResponse, name: "CategoryMergeResponse" },
  "DELETE /api/categories/{id}": { name: "NoContent", status: "204", noContent: true },
  "PATCH /api/tags/{id}": { schema: OkResponse, name: "OkResponse" },
  "DELETE /api/tags/{id}": { schema: TagMutationResponse, name: "TagMutationResponse" },
  "POST /api/tags/merge": { schema: TagMutationResponse, name: "TagMutationResponse" },
  "POST /api/tags/{id}/aliases": { schema: TagMutationResponse, name: "TagMutationResponse" },
  "DELETE /api/tags/{id}/aliases/{alias}": { schema: OkResponse, name: "OkResponse" },
  "PUT /api/sites/{id}/facets": { schema: SiteFacetsResponse, name: "SiteFacetsResponse" },
  "PUT /api/sites/{id}/relations": { schema: RelationsUpdateResponse, name: "RelationsUpdateResponse" },

  /* 类目/标签治理 */
  "POST /api/taxonomy/audit": { schema: TaxonomyAuditResponse, name: "TaxonomyAuditResponse" },
  "POST /api/taxonomy/proposals/{id}/apply": {
    schema: TaxonomyProposalMutationResponse,
    name: "TaxonomyProposalMutationResponse",
  },
  "POST /api/taxonomy/proposals/{id}/dismiss": {
    schema: TaxonomyProposalMutationResponse,
    name: "TaxonomyProposalMutationResponse",
  },
  "POST /api/taxonomy/proposals/batch": { schema: TaxonomyBatchResponse, name: "TaxonomyBatchResponse" },

  /* 任务队列 */
  "POST /api/jobs": { schema: JobEnqueuedResponse, name: "JobEnqueuedResponse", status: "201" },
  "POST /api/jobs/{id}/cancel": { schema: JobCancelResponse, name: "JobCancelResponse" },
  "POST /api/jobs/{id}/retry": { schema: JobRetryResponse, name: "JobRetryResponse" },
  "POST /api/jobs/prune": { schema: JobPruneResponse, name: "JobPruneResponse" },

  /* API 凭据 */
  "GET /api/tokens": { schema: ApiTokenListResponse, name: "ApiTokenListResponse" },
  "POST /api/tokens": { schema: ApiTokenIssueResponse, name: "ApiTokenIssueResponse", status: "201" },
  "PATCH /api/tokens/{id}": { schema: ApiTokenPayload, name: "ApiTokenPayload" },
  "POST /api/tokens/{id}/rotate": { schema: ApiTokenIssueResponse, name: "ApiTokenIssueResponse" },
  "POST /api/tokens/{id}/revoke": { schema: ApiTokenPayload, name: "ApiTokenPayload" },
  "DELETE /api/tokens/{id}": { name: "NoContent", status: "204", noContent: true },

  /* 审核与通知 */
  "POST /api/submissions": { schema: SubmissionCreateResponse, name: "SubmissionCreateResponse", status: "201" },
  "PATCH /api/submissions/{number}": { schema: SubmissionReviewResponse, name: "SubmissionReviewResponse" },
  "GET /api/submissions/feedback": { schema: SubmissionFeedbackResponse, name: "SubmissionFeedbackResponse" },
  /* 站点纠错上报与复核（升级第 10 条） */
  "POST /api/sites/{id}/reports": { schema: SiteReportCreateResponse, name: "SiteReportCreateResponse", status: "201" },
  "GET /api/admin/site-reports": { schema: SiteReportsListResponse, name: "SiteReportsListResponse" },
  "PATCH /api/admin/site-reports/{id}": { schema: SiteReportReviewResponse, name: "SiteReportReviewResponse" },
  "POST /api/admin/notifications/read-all": {
    schema: NotificationReadAllResponse,
    name: "NotificationReadAllResponse",
  },
  "POST /api/me/notifications/read-all": {
    schema: NotificationReadAllResponse,
    name: "NotificationReadAllResponse",
  },
  "POST /api/me/notifications/{id}/read": {
    schema: NotificationReadAllResponse,
    name: "NotificationReadAllResponse",
  },

  /* 插件市场公开写路由 */
  "DELETE /api/plugins/{slug}/star": { schema: PluginStarResponse, name: "PluginStarResponse" },
  "PATCH /api/plugins/{slug}/featured": { schema: PluginFeaturedResponse, name: "PluginFeaturedResponse" },
  "POST /api/shortlinks": { schema: ShortlinkCreateResponse, name: "ShortlinkCreateResponse" },

  /* 运维/存储管理面 */
  "GET /api/admin/maintenance/status": { schema: MaintenanceStatusResponse, name: "MaintenanceStatusResponse" },
  "GET /api/admin/link-health": { schema: LinkHealthOverviewResponse, name: "LinkHealthOverviewResponse" },
  "POST /api/admin/link-health/visibility": { schema: LinkHealthVisibilityResponse, name: "LinkHealthVisibilityResponse" },
  "POST /api/admin/maintenance/checkpoint": { schema: MaintenanceActionResult, name: "MaintenanceActionResult" },
  "POST /api/admin/maintenance/optimize": { schema: MaintenanceActionResult, name: "MaintenanceActionResult" },
  "POST /api/admin/maintenance/vacuum": { schema: MaintenanceActionResult, name: "MaintenanceActionResult" },
  "GET /api/storage/list": { schema: StorageAssetListResponse, name: "StorageAssetListResponse" },
  "PUT /api/storage": { schema: StorageWriteResponse, name: "StorageWriteResponse" },
  "DELETE /api/storage": { schema: StorageDeleteResponse, name: "StorageDeleteResponse" },
  "POST /api/admin/audit/scan": { schema: SiteAuditScanResponse, name: "SiteAuditScanResponse" },
  "POST /api/admin/audit/apply": { schema: SiteAuditApplyResponse, name: "SiteAuditApplyResponse" },
  "DELETE /api/admin/client-errors": { schema: OkResponse, name: "OkResponse" },
  "POST /api/warmup": { schema: WarmupResponse, name: "WarmupResponse" },

  /* 用户域写路由（设置/资料/令牌/会话/数据主权） */
  "PATCH /api/me/settings": { schema: MeSettingsResponse, name: "MeSettingsResponse" },
  "PATCH /api/me/profile": { schema: MeProfileUpdateResponse, name: "MeProfileUpdateResponse" },
  "POST /api/me/tokens": { schema: MeTokenCreateResponse, name: "MeTokenCreateResponse" },
  "DELETE /api/me/tokens/{id}": { schema: OkResponse, name: "OkResponse" },
  "DELETE /api/me/sessions/{id}": { schema: OkResponse, name: "OkResponse" },
  "POST /api/me/sessions/check": { schema: MeSessionCheckResponse, name: "MeSessionCheckResponse" },
  "POST /api/me/diagnostics": { schema: MeDiagnosticsResponse, name: "MeDiagnosticsResponse" },
  "POST /api/me/prune": { schema: MePruneResponse, name: "MePruneResponse" },
  "DELETE /api/me": { schema: MeDeleteResponse, name: "MeDeleteResponse" },
  "POST /api/me/merge": { schema: MeMergeResponse, name: "MeMergeResponse" },
  "POST /api/me/favorites/sync": { schema: MeFavoritesSyncResponse, name: "MeFavoritesSyncResponse" },
  /* 收藏回收站：墓碑即回收站（恢复 = add 复活，彻底删除 = 物理删行） */
  "GET /api/me/favorites/trash": { schema: MeFavoriteTrashListResponse, name: "MeFavoriteTrashListResponse" },
  "POST /api/me/favorites/trash/{siteId}/restore": {
    schema: MeFavoriteTrashRestoreResponse,
    name: "MeFavoriteTrashRestoreResponse",
  },
  "POST /api/me/favorites/trash/restore-batch": {
    schema: MeFavoriteTrashRestoreBatchResponse,
    name: "MeFavoriteTrashRestoreBatchResponse",
  },
  "DELETE /api/me/favorites/trash/{siteId}": {
    schema: MeFavoriteTrashPurgeResponse,
    name: "MeFavoriteTrashPurgeResponse",
  },
  "DELETE /api/me/favorites/trash": { schema: MeFavoriteTrashClearResponse, name: "MeFavoriteTrashClearResponse" },
  "POST /api/me/watchlist/sync": { schema: MeWatchlistSyncResponse, name: "MeWatchlistSyncResponse" },
  "POST /api/me/exams/sync": { schema: MeExamsSyncResponse, name: "MeExamsSyncResponse" },
  "GET /api/me/custom-sites": { schema: MeCustomSitesListResponse, name: "MeCustomSitesListResponse" },
  "POST /api/me/custom-sites": { schema: MeCustomSiteItemResponse, name: "MeCustomSiteItemResponse" },
  "PATCH /api/me/custom-sites/{id}": { schema: MeCustomSiteItemResponse, name: "MeCustomSiteItemResponse" },
  "DELETE /api/me/custom-sites/{id}": { schema: MeCustomSiteDeleteResponse, name: "MeCustomSiteDeleteResponse" },
  "POST /api/me/custom-sites/reorder": { schema: MeCustomSitesReorderResponse, name: "MeCustomSitesReorderResponse" },
  "GET /api/me/wanted": { schema: MeWantedSearchesListResponse, name: "MeWantedSearchesListResponse" },
  "POST /api/me/wanted": { schema: MeWantedSearchItemResponse, name: "MeWantedSearchItemResponse" },
  "DELETE /api/me/wanted/{id}": { schema: MeWantedSearchDeleteResponse, name: "MeWantedSearchDeleteResponse" },
  "POST /api/me/import": { schema: MeImportResponse, name: "MeImportResponse" },
  "DELETE /api/profile": { schema: ProfileResetResponse, name: "ProfileResetResponse" },
  "DELETE /api/profile/signals/{kind}": {
    schema: ProfileSignalClearResponse,
    name: "ProfileSignalClearResponse",
  },
  "DELETE /api/search-history/{id}": { schema: OkResponse, name: "OkResponse" },
  "DELETE /api/search-history": { schema: OkResponse, name: "OkResponse" },
  "POST /api/search-history": { schema: SearchHistoryRecordResponse, name: "SearchHistoryRecordResponse" },
  "POST /api/search-history/batch-delete": {
    schema: SearchHistoryBatchDeleteResponse,
    name: "SearchHistoryBatchDeleteResponse",
  },
  "POST /api/users/sync": { schema: OauthUserSyncResponse, name: "OauthUserSyncResponse" },

  /* 公开遥测写路由：204 无响应体也算「已绑定」 */
  "POST /api/events": { schema: OkResponse, name: "OkResponse" },
  "POST /api/vitals": { name: "NoContent", status: "204", noContent: true },
  "POST /api/errors": { name: "NoContent", status: "204", noContent: true },

  /* 团队空间（名册写回执） */
  "POST /api/workspaces": { schema: WorkspaceCreateResponse, name: "WorkspaceCreateResponse", status: "201" },
  "POST /api/workspaces/{id}/members": {
    schema: WorkspaceMembersResponse,
    name: "WorkspaceMembersResponse",
  },
  "DELETE /api/workspaces/{id}/members/{userId}": {
    schema: WorkspaceMembersResponse,
    name: "WorkspaceMembersResponse",
  },
  "POST /api/speculation/rules": { schema: SpeculationRulesResponse, name: "SpeculationRulesResponse" },
  /* 账号生命周期（注册/验证/登录/找回/重置） */
  "POST /api/account/register": { schema: AccountRegisterResponse, name: "AccountRegisterResponse", status: "201" },
  "POST /api/account/verify-email": { schema: OkMessageResponse, name: "OkMessageResponse" },
  "POST /api/account/resend-verification": { schema: OkMessageResponse, name: "OkMessageResponse" },
  "POST /api/account/forgot-password": { schema: OkMessageResponse, name: "OkMessageResponse" },
  "POST /api/account/reset-password": { schema: OkMessageResponse, name: "OkMessageResponse" },
  "POST /api/account/login": { schema: AccountLoginResponse, name: "AccountLoginResponse" },
};
