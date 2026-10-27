/**
 * 自动生成，请勿手改。
 *
 * 事实源：packages/core/src/rest-responses.ts 的 RESPONSE_SCHEMA_BINDINGS。
 * 重新生成：node --experimental-strip-types scripts/generate-rest-contract-types.mjs
 * 漂移门禁：scripts/generate-rest-contract-types.test.ts（生成物与源码不同源即红）。
 *
 * 这里的形状与 /api/openapi.json 的 components.schemas 是同一次 zod -> JSON Schema
 * 转换的产物，所以前端类型、文档、契约测试三者只可能一起变。
 */

/**
 * GET /api/health
 */
export interface HealthResponse {
  ok: true;
  mode: "lite" | "standard";
  capabilities: {
    semantic: boolean;
    fts: boolean;
    llm: boolean;
    notes: string[];
  };
  db: {
    ok: boolean;
  };
  stats: {
    sites: number;
    categories: number;
    tags: number;
    broken: number;
    pending: number;
    trashed: number;
  } | null;
  embedding?: {
    cache: {
      size: number;
      hits: number;
      misses: number;
    };
  };
  [key: string]: unknown;
}

/**
 * GET /api/search
 * POST /api/search
 */
export interface SearchResponse {
  hits: ({
    siteId: string;
    score: number;
    contributions: Record<string, {
      rank: number;
      value: number;
    }>;
    site: {
      id: string;
      url: string;
      title: string;
      categoryId: string;
      tags: string[];
      status: "active" | "pending" | "broken" | "archived";
      enabled: boolean;
      sort: number;
      weight: number;
      health: {
        ok: boolean;
        httpStatus?: number | null;
        latencyMs?: number | null;
        redirectTo?: string | null;
        error?: string | null;
        lastCheckedAt?: number | null;
      };
      createdAt: number;
      updatedAt: number;
      titleEn?: string | null;
      description?: string | null;
      descriptionEn?: string | null;
      iconKey?: string | null;
      screenshotKey?: string | null;
      subCategoryId?: string | null;
      featured?: boolean;
      source?: string | null;
      visitCount?: number;
      lastVisitedAt?: number | null;
      trendScore?: number;
      deletedAt?: number | null;
      workspaces?: string[];
      facets?: Record<string, string[]>;
      [key: string]: unknown;
    } | null;
  })[];
  items: ({
    siteId: string;
    score: number;
    contributions: Record<string, {
      rank: number;
      value: number;
    }>;
    site: {
      id: string;
      url: string;
      title: string;
      categoryId: string;
      tags: string[];
      status: "active" | "pending" | "broken" | "archived";
      enabled: boolean;
      sort: number;
      weight: number;
      health: {
        ok: boolean;
        httpStatus?: number | null;
        latencyMs?: number | null;
        redirectTo?: string | null;
        error?: string | null;
        lastCheckedAt?: number | null;
      };
      createdAt: number;
      updatedAt: number;
      titleEn?: string | null;
      description?: string | null;
      descriptionEn?: string | null;
      iconKey?: string | null;
      screenshotKey?: string | null;
      subCategoryId?: string | null;
      featured?: boolean;
      source?: string | null;
      visitCount?: number;
      lastVisitedAt?: number | null;
      trendScore?: number;
      deletedAt?: number | null;
      workspaces?: string[];
      facets?: Record<string, string[]>;
      [key: string]: unknown;
    } | null;
  })[];
  channelsUsed: string[];
  semanticAvailable: boolean;
  tookMs: number;
  offset?: number;
  hasMore?: boolean;
  fallback?: "filter" | "fuzzy";
  planner?: "early-exit";
  channelTimings?: {
    exactMs: number;
    ftsMs: number;
    pinyinMs: number;
    semanticMs: number;
    skippedSemantic: boolean;
  };
  inferredFacets?: Record<string, string[]>;
  inferredTag?: string;
  inferredCategory?: string;
  excludedTerms?: string[];
  didYouMean?: string;
  queryExpansion?: string[];
  suggestions?: string[];
  popular?: string[];
  suggestionsDegraded?: true;
  relationHits?: ({
    targetTitle: string;
    targetUrl: string;
    relationType: string;
    sourceSite: {
      id: string;
      url: string;
      title: string;
      categoryId: string;
      tags: string[];
      status: "active" | "pending" | "broken" | "archived";
      enabled: boolean;
      sort: number;
      weight: number;
      health: {
        ok: boolean;
        httpStatus?: number | null;
        latencyMs?: number | null;
        redirectTo?: string | null;
        error?: string | null;
        lastCheckedAt?: number | null;
      };
      createdAt: number;
      updatedAt: number;
      titleEn?: string | null;
      description?: string | null;
      descriptionEn?: string | null;
      iconKey?: string | null;
      screenshotKey?: string | null;
      subCategoryId?: string | null;
      featured?: boolean;
      source?: string | null;
      visitCount?: number;
      lastVisitedAt?: number | null;
      trendScore?: number;
      deletedAt?: number | null;
      workspaces?: string[];
      facets?: Record<string, string[]>;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  })[];
  [key: string]: unknown;
}

/**
 * GET /api/sites
 */
export type SiteListResponse = ({
  id: string;
  url: string;
  title: string;
  categoryId: string;
  tags: string[];
  status: "active" | "pending" | "broken" | "archived";
  enabled: boolean;
  sort: number;
  weight: number;
  health: {
    ok: boolean;
    httpStatus?: number | null;
    latencyMs?: number | null;
    redirectTo?: string | null;
    error?: string | null;
    lastCheckedAt?: number | null;
  };
  createdAt: number;
  updatedAt: number;
  titleEn?: string | null;
  description?: string | null;
  descriptionEn?: string | null;
  iconKey?: string | null;
  screenshotKey?: string | null;
  subCategoryId?: string | null;
  featured?: boolean;
  source?: string | null;
  visitCount?: number;
  lastVisitedAt?: number | null;
  trendScore?: number;
  deletedAt?: number | null;
  workspaces?: string[];
  facets?: Record<string, string[]>;
  [key: string]: unknown;
})[];

/**
 * GET /api/categories
 */
export type CategoryListResponse = ({
  id: string;
  anchor: string;
  parentId: string | null;
  title: string;
  enabled: boolean;
  sort: number;
  createdAt: number;
  updatedAt: number;
  titleEn?: string | null;
  slug?: string | null;
  description?: string | null;
  icon?: string | null;
  source?: string | null;
  altLabels?: string[];
  relatedCategories?: string[];
  [key: string]: unknown;
})[];

/**
 * GET /api/categories/page
 */
export interface CategoryPageResponse {
  items: ({
    id: string;
    anchor: string;
    parentId: string | null;
    title: string;
    enabled: boolean;
    sort: number;
    createdAt: number;
    updatedAt: number;
    titleEn?: string | null;
    slug?: string | null;
    description?: string | null;
    icon?: string | null;
    source?: string | null;
    altLabels?: string[];
    relatedCategories?: string[];
    [key: string]: unknown;
  })[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * GET /api/categories/counts
 */
export interface CategoryCountsResponse {
  counts: {
    categoryId: string;
    sites: number;
  }[];
}

/**
 * GET /api/tags
 */
export type TagListResponse = ({
  id: string;
  name: string;
  slug: string;
  count: number;
  group: string;
  aliases: string[];
  color?: string | null;
  description?: string | null;
  [key: string]: unknown;
})[];

/**
 * GET /api/rank/trending
 */
export interface RankTrendingResponse {
  hits: ({
    site: {
      id: string;
      url: string;
      title: string;
      categoryId: string;
      tags: string[];
      status: "active" | "pending" | "broken" | "archived";
      enabled: boolean;
      sort: number;
      weight: number;
      health: {
        ok: boolean;
        httpStatus?: number | null;
        latencyMs?: number | null;
        redirectTo?: string | null;
        error?: string | null;
        lastCheckedAt?: number | null;
      };
      createdAt: number;
      updatedAt: number;
      titleEn?: string | null;
      description?: string | null;
      descriptionEn?: string | null;
      iconKey?: string | null;
      screenshotKey?: string | null;
      subCategoryId?: string | null;
      featured?: boolean;
      source?: string | null;
      visitCount?: number;
      lastVisitedAt?: number | null;
      trendScore?: number;
      deletedAt?: number | null;
      workspaces?: string[];
      facets?: Record<string, string[]>;
      [key: string]: unknown;
    };
    trend: {
      visits: number;
      trendScore: number;
      lastVisitedAt: number | null;
    };
  })[];
  [key: string]: unknown;
}

/**
 * GET /api/rank/new
 */
export interface RankNewResponse {
  hits: ({
    site: {
      id: string;
      url: string;
      title: string;
      categoryId: string;
      tags: string[];
      status: "active" | "pending" | "broken" | "archived";
      enabled: boolean;
      sort: number;
      weight: number;
      health: {
        ok: boolean;
        httpStatus?: number | null;
        latencyMs?: number | null;
        redirectTo?: string | null;
        error?: string | null;
        lastCheckedAt?: number | null;
      };
      createdAt: number;
      updatedAt: number;
      titleEn?: string | null;
      description?: string | null;
      descriptionEn?: string | null;
      iconKey?: string | null;
      screenshotKey?: string | null;
      subCategoryId?: string | null;
      featured?: boolean;
      source?: string | null;
      visitCount?: number;
      lastVisitedAt?: number | null;
      trendScore?: number;
      deletedAt?: number | null;
      workspaces?: string[];
      facets?: Record<string, string[]>;
      [key: string]: unknown;
    };
  })[];
  [key: string]: unknown;
}

/**
 * GET /api/plugins
 */
export interface PluginListResponse {
  items: ({
    id: string;
    slug: string;
    kind: "site-pack" | "workspace-preset" | "theme" | "search-pack" | "bundle";
    name: string;
    description: string;
    icon: string | null;
    tags: string[];
    author: string | null;
    authorKind: string | null;
    ownerKey?: string | null;
    license: string | null;
    homepage: string | null;
    version: string;
    status: string;
    reviewNote: string | null;
    reviewedAt: number | null;
    source: string;
    installCount: number;
    starCount: number;
    reportCount: number;
    featured: boolean;
    featuredRank: number;
    ratingAvg: number;
    reviewCount: number;
    createdAt: number;
    updatedAt: number;
    publishedAt: number | null;
    summary: {
      kind: "site-pack" | "workspace-preset" | "theme" | "search-pack" | "bundle";
      siteCount: number;
      categoryCount: number;
      uniqueTagCount: number;
      hosts: string[];
      boardCount: number;
      widgetCount: number;
      widgetTypes: string[];
      themeTokenCount: number;
      engineCount: number;
      enginePrefixes: string[];
      bundleItemCount: number;
      bundleKinds: string[];
      [key: string]: unknown;
    };
    manifest?: unknown;
    aiAudit?: {
      score: number;
      level: string;
      auditedAt: number;
    } | null;
    [key: string]: unknown;
  })[];
  total: number;
  limit: number;
  offset: number;
}

/** 路由键 -> 响应类型（前端按端点取类型，避免自己再抄一份接口） */
export interface RestContractRoutes {
  "GET /api/categories": CategoryListResponse;
  "GET /api/categories/counts": CategoryCountsResponse;
  "GET /api/categories/page": CategoryPageResponse;
  "GET /api/health": HealthResponse;
  "GET /api/plugins": PluginListResponse;
  "GET /api/rank/new": RankNewResponse;
  "GET /api/rank/trending": RankTrendingResponse;
  "GET /api/search": SearchResponse;
  "GET /api/sites": SiteListResponse;
  "GET /api/tags": TagListResponse;
  "POST /api/search": SearchResponse;
}
