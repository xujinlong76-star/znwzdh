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
import type { SearchHit, Site } from "./types.ts";

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
 * 绑定表：路由键 -> 响应契约
 * ------------------------------------------------------------------ */

export interface ResponseSchemaBinding {
  schema: z.ZodTypeAny;
  /**
   * OpenAPI components.schemas 里的组件名。
   * 显式命名（而不是从路由派生）是为了让生成的客户端类型可直接引用。
   */
  name: string;
}

export const RESPONSE_SCHEMA_BINDINGS: Record<string, ResponseSchemaBinding> = {
  "GET /api/health": { schema: HealthResponse, name: "HealthResponse" },
  "GET /api/search": { schema: SearchResponse, name: "SearchResponse" },
  // POST 与 GET 共用同一处理器，必须共用同一份契约，否则两边会各自漂移
  "POST /api/search": { schema: SearchResponse, name: "SearchResponse" },
  "GET /api/sites": { schema: SiteListResponse, name: "SiteListResponse" },
};
