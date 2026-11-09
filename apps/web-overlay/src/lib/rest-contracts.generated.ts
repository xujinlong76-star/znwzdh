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
  navSnapshot?: {
    version: number | null;
    triggersMissing: number;
    cached: boolean;
    ttlMs: number;
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
    semanticFiltered: number;
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
 * GET /api/sites/{id}/similar
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

/**
 * GET /api/plugins/installed
 */
export interface InstalledPluginsResponse {
  items: ({
    id: string;
    slug: string;
    kind: "site-pack" | "workspace-preset" | "theme" | "search-pack" | "bundle";
    name: string;
    description: string;
    icon: string | null;
    version: string;
    installedVersion: string;
    installedAt: number;
    source: string;
    [key: string]: unknown;
  })[];
  total: number;
}

/**
 * GET /api/plugins/taps
 */
export interface PluginTapsResponse {
  ok: true;
  items: {
    id: string;
    name: string;
    url: string;
    description?: string;
    enabled: boolean;
    pluginCount: number;
    lastSyncedAt?: number;
    createdAt: number;
    updatedAt: number;
    [key: string]: unknown;
  }[];
  featuredTaps: {
    id: string;
    name: string;
    description: string;
    url: string;
    isFeatured: true;
    author: string;
  }[];
}

/**
 * GET /api/plugins/taps/public
 */
export interface PublicPluginTapsResponse {
  ok: true;
  items: ({
    id: string;
    name: string;
    description?: string;
    pluginCount: number;
    lastSyncedAt: number | null;
  })[];
  featuredTaps: {
    id: string;
    name: string;
    description: string;
    url: string;
    isFeatured: true;
    author: string;
  }[];
}

/**
 * GET /api/sites/{id}
 * POST /api/sites
 * PATCH /api/sites/{id}
 * POST /api/trash/{id}/restore
 */
export interface SitePayload {
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
}

/**
 * GET /api/search-history
 */
export interface SearchHistoryPageResponse {
  items: {
    id: number;
    query: string;
    resultCount: number;
    createdAt: number;
    [key: string]: unknown;
  }[];
  hasMore: boolean;
  nextOffset: number;
}

/**
 * GET /api/me
 */
export interface MeOverviewResponse {
  ok: true;
  identity: string;
  user: {
    id: string;
    username: string;
    email: string | null;
    avatar: string | null;
    source: string;
  } | null;
  counts: {
    favorites: number;
    folders: number;
    searches: number;
    activePluginInstalls: number;
    pluginStars: number;
    authoredPlugins: number;
    recentEvents: number;
  };
  profile: {
    exists: boolean;
    updatedAt: number | null;
  };
  vault: {
    exists: boolean;
    version: number | null;
    updatedAt: number | null;
  };
  llmConfig: {
    exists: boolean;
  };
  aliases: string[];
  settings: {
    identity: string;
    personalizationEnabled: boolean;
    favoriteSignalCutoff: number;
    updatedAt: number;
    defaultSearchEngine: "internal" | "google" | "bing" | "duckduckgo" | "github" | "perplexity";
    openLinksInNewTab: boolean;
    cardDensity: "comfortable" | "compact" | "minimal";
    speculativeZeroRttEnabled: boolean;
    daypartSceneEnabled: boolean;
    spotlightShortcut: "mod+k" | "slash" | "both";
    searchHistoryEnabled: boolean;
    telemetryEnabled: boolean;
    historyRetentionDays: 30 | 90 | 180 | 365;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * GET /api/favorites
 */
export interface FavoritesListResponse {
  items: ({
    id: string;
    siteId: string;
    folderId: string | null;
    note: string | null;
    tags?: string[] | null;
    createdAt: number;
    updatedAt?: number;
    deletedAt?: number | null;
    site?: {
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
  folders: {
    id: string;
    name: string;
    sort: number;
    createdAt: number;
    existed?: boolean;
    [key: string]: unknown;
  }[];
  total?: number;
  hasMore?: boolean;
  identity?: string;
  [key: string]: unknown;
}

/**
 * GET /api/collections
 */
export type CollectionListResponse = ({
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  kind: "topic" | "geo" | "roadmap";
  icon?: string | null;
  sort: number;
  enabled: boolean;
  siteCount?: number;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
})[];

/**
 * GET /api/collections/{slug}
 */
export interface CollectionDetailResponse {
  collection: {
    id: string;
    slug: string;
    title: string;
    description?: string | null;
    kind: "topic" | "geo" | "roadmap";
    icon?: string | null;
    sort: number;
    enabled: boolean;
    siteCount?: number;
    createdAt: number;
    updatedAt: number;
    [key: string]: unknown;
  };
  sites: ({
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
    collectionNote?: string | null;
    collectionSort?: number;
    [key: string]: unknown;
  })[];
  [key: string]: unknown;
}

/**
 * GET /api/me/notifications
 * GET /api/admin/notifications
 */
export interface NotificationListResponse {
  items: ({
    id: string;
    identity: string;
    kind: string;
    title: string;
    body: string | null;
    readAt: number | null;
    createdAt: number;
    [key: string]: unknown;
  })[];
  hasMore: boolean;
  unread: number;
  nextOffset: number;
  [key: string]: unknown;
}

/**
 * GET /api/me/notifications/unread-count
 */
export interface NotificationUnreadCountResponse {
  ok: true;
  unread: number;
  [key: string]: unknown;
}

/**
 * GET /api/admin/ai/prices
 */
export interface AdminAiPricesResponse {
  prices: {
    model: string;
    promptPer1kRmb: number;
    completionPer1kRmb: number;
    updatedAt: number;
    [key: string]: unknown;
  }[];
  legacyUnitPriceRmb: number | null;
  [key: string]: unknown;
}

/**
 * GET /api/admin/notifications/deliveries
 */
export interface NotificationDeliveryListResponse {
  items: ({
    id: string;
    identity: string;
    channel: string;
    kind: string;
    status: "pending" | "delivered" | "deferred" | "failed";
    attempts: number;
    nextAttemptAt: number | null;
    lastError: string | null;
    createdAt: number;
    deliveredAt: number | null;
    [key: string]: unknown;
  })[];
  hasMore: boolean;
  nextOffset: number;
  [key: string]: unknown;
}

/**
 * GET /api/categories/{id}/impact
 */
export interface CategoryImpactResponse {
  category: {
    id: string;
    title: string;
    slug: string | null;
    enabled: boolean;
    parentId: string | null;
    anchor: string;
    [key: string]: unknown;
  };
  childCategories: number;
  descendantCategories: number;
  directSites: number;
  subtreeSites: number;
  [key: string]: unknown;
}

/**
 * GET /api/categories/{id}
 * GET /api/categories/by-slug/{slug}
 * POST /api/categories
 * PATCH /api/categories/{id}
 * POST /api/categories/{id}/move
 */
export interface CategoryPayload {
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
}

/**
 * GET /api/tags/resolve
 */
export interface ResolveTagResponse {
  ok: true;
  tag: {
    id: string;
    name: string;
    slug: string;
    count: number;
    group: string;
    aliases: string[];
    color?: string | null;
    description?: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * GET /api/facets
 */
export interface FacetsResponse {
  ok: true;
  definitions: {
    key: string;
    label: string;
    labelEn?: string;
    description?: string;
    multiselect?: boolean;
    options: {
      value: string;
      label: string;
      labelEn?: string;
      [key: string]: unknown;
    }[];
    [key: string]: unknown;
  }[];
  facets: {
    key: string;
    label: string;
    labelEn?: string;
    description?: string;
    options: {
      value: string;
      label: string;
      labelEn?: string;
      count: number;
      [key: string]: unknown;
    }[];
    [key: string]: unknown;
  }[];
  [key: string]: unknown;
}

/**
 * GET /api/sites/{id}/facets
 * PUT /api/sites/{id}/facets
 */
export interface SiteFacetsResponse {
  ok: true;
  siteId: string;
  facets: Record<string, string[]>;
  [key: string]: unknown;
}

/**
 * GET /api/tags/{id}/related
 */
export interface RelatedTagsResponse {
  ok: true;
  tagId: string;
  tagSlug: string;
  related: ({
    id: string;
    name: string;
    slug: string;
    group: string;
    color: string | null;
    sharedSites: number;
    [key: string]: unknown;
  })[];
  [key: string]: unknown;
}

/**
 * GET /api/plugins/{slug}
 */
export interface PluginDetailResponse {
  plugin: {
    id: string;
    slug: string;
    kind: "site-pack" | "workspace-preset" | "theme" | "search-pack" | "bundle";
    name: string;
    description: string;
    icon: string | null;
    tags: string[];
    author: string | null;
    authorKind: string | null;
    version: string;
    status: string;
    source: string;
    installCount: number;
    starCount: number;
    ratingAvg: number;
    reviewCount: number;
    createdAt: number;
    updatedAt: number;
    installed: boolean;
    starred: boolean;
    installedVersion: string | null;
    installedAt: number | null;
    hasUpgrade: boolean;
    upgradeDiff: unknown;
    reviewStats: unknown;
    myReview: unknown;
    isOwner: boolean;
    [key: string]: unknown;
  };
  summary: unknown;
  [key: string]: unknown;
}

/**
 * GET /api/videos
 */
export interface VideoListResponse {
  source: "db" | "kv";
  total: number;
  limit: number;
  offset: number;
  returned: number;
  items: ({
    id: string;
    categoryId: string;
    title: string;
    href: string;
    description: string | null;
    icon: string | null;
    enabled: boolean;
    sort: number;
    platform: string | null;
    externalId: string | null;
    author: string | null;
    durationSec: number | null;
    publishedAt: string | null;
    qualityScore: number | null;
    freshnessScore: number | null;
    healthStatus: string | null;
    sourceType: string | null;
    pinned: boolean;
    updatedAt: number;
    videoConfig?: Record<string, unknown> | null;
    [key: string]: unknown;
  })[];
  [key: string]: unknown;
}

/**
 * GET /api/videos/{id}
 */
export interface VideoDetailResponse {
  source: "db" | "kv";
  item: {
    id: string;
    categoryId: string;
    title: string;
    href: string;
    description: string | null;
    icon: string | null;
    enabled: boolean;
    sort: number;
    platform: string | null;
    externalId: string | null;
    author: string | null;
    durationSec: number | null;
    publishedAt: string | null;
    qualityScore: number | null;
    freshnessScore: number | null;
    healthStatus: string | null;
    sourceType: string | null;
    pinned: boolean;
    updatedAt: number;
    videoConfig?: Record<string, unknown> | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * POST /api/plugins/{slug}/install
 */
export interface PluginInstallResponse {
  success: true;
  plugin: {
    id: string;
    slug: string;
    kind: "site-pack" | "workspace-preset" | "theme" | "search-pack" | "bundle";
    name: string;
    description: string;
    icon: string | null;
    tags: string[];
    author: string | null;
    authorKind: string | null;
    version: string;
    status: string;
    source: string;
    installCount: number;
    starCount: number;
    ratingAvg: number;
    reviewCount: number;
    createdAt: number;
    updatedAt: number;
    [key: string]: unknown;
  };
  install: {
    pluginId: string;
    version: string;
    installedAt: number;
    removedAt: number | null;
    [key: string]: unknown;
  };
  alreadyInstalled: boolean;
  applied: {
    sitesAdded: number;
    sitesSkipped: number;
    categoriesCreated: number;
    createdSiteIds: string[];
    enginesAdded?: number;
    categoryGaps?: string[];
    categoryParentMismatches?: string[];
    bundleItems?: ({
      slug: string;
      kind: "site-pack" | "workspace-preset" | "theme" | "search-pack" | "bundle";
      name: string;
      alreadyInstalled: boolean;
      sitesAdded: number;
      sitesSkipped: number;
      enginesAdded: number;
      [key: string]: unknown;
    })[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * POST /api/plugins/{slug}/uninstall
 * DELETE /api/plugins/{slug}/install
 */
export interface PluginUninstallResponse {
  success: true;
  plugin: {
    id: string;
    slug: string;
    kind: "site-pack" | "workspace-preset" | "theme" | "search-pack" | "bundle";
    name: string;
    description: string;
    icon: string | null;
    tags: string[];
    author: string | null;
    authorKind: string | null;
    version: string;
    status: string;
    source: string;
    installCount: number;
    starCount: number;
    ratingAvg: number;
    reviewCount: number;
    createdAt: number;
    updatedAt: number;
    [key: string]: unknown;
  };
  removed: boolean;
  removedSites: number;
  removedCategories: number;
  sitesRemoved: number;
  categoriesRemoved: number;
  [key: string]: unknown;
}

/**
 * POST /api/plugins/{slug}/star
 * DELETE /api/plugins/{slug}/star
 */
export interface PluginStarResponse {
  success: true;
  starred: boolean;
  starCount: number;
  [key: string]: unknown;
}

/**
 * POST /api/favorites
 */
export interface FavoriteCreateResponse {
  favorite: {
    id: string;
    siteId: string;
    folderId: string | null;
    note: string | null;
    tags?: string[] | null;
    createdAt: number;
    updatedAt?: number;
    deletedAt?: number | null;
    site?: {
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
  };
  existed: boolean;
  [key: string]: unknown;
}

/**
 * PATCH /api/favorites/{siteId}
 */
export interface FavoriteUpdateResponse {
  ok: true;
  favorite: {
    id: string;
    siteId: string;
    folderId: string | null;
    note: string | null;
    tags?: string[] | null;
    createdAt: number;
    updatedAt?: number;
    deletedAt?: number | null;
    site?: {
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
  };
  [key: string]: unknown;
}

/**
 * DELETE /api/favorites/{siteId}
 */
export interface FavoriteSiteRemovalResponse {
  ok: true;
  removed: boolean;
  [key: string]: unknown;
}

/**
 * DELETE /api/favorites
 */
export interface FavoriteRemovalResponse {
  ok: true;
  removed: number;
  [key: string]: unknown;
}

/**
 * POST /api/favorites/folders
 */
export interface FavoriteFolderPayload {
  id: string;
  name: string;
  sort: number;
  createdAt: number;
  existed?: boolean;
  [key: string]: unknown;
}

/**
 * PATCH /api/favorites/folders/{id}
 */
export interface FavoriteFolderUpdateResponse {
  ok: true;
  folder: {
    id: string;
    name: string;
    sort: number;
    createdAt: number;
    existed?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * DELETE /api/favorites/folders/{id}
 * PATCH /api/tags/{id}
 * DELETE /api/tags/{id}/aliases/{alias}
 * DELETE /api/admin/client-errors
 * DELETE /api/me/tokens/{id}
 * DELETE /api/me/sessions/{id}
 * DELETE /api/search-history/{id}
 * DELETE /api/search-history
 * POST /api/events
 */
export interface OkResponse {
  ok: true;
  [key: string]: unknown;
}

/**
 * POST /api/collections
 * PATCH /api/collections/{id}
 */
export interface CollectionPayload {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  kind: "topic" | "geo" | "roadmap";
  icon?: string | null;
  sort: number;
  enabled: boolean;
  siteCount?: number;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
}

/**
 * DELETE /api/collections/{id}
 */
export interface CollectionDeleteResponse {
  ok: true;
  id: string;
  [key: string]: unknown;
}

/**
 * POST /api/collections/{id}/items
 * PATCH /api/collections/{id}/items/{siteId}
 * DELETE /api/collections/{id}/items/{siteId}
 */
export interface CollectionItemMutationResponse {
  ok: true;
  collectionId: string;
  siteId: string;
  [key: string]: unknown;
}

/**
 * POST /api/sites/bulk
 */
export interface SiteBulkResponse {
  dryRun: boolean;
  op: "delete" | "setCategory" | "setStatus";
  total?: number;
  wouldApply?: number;
  applied?: number;
  skipped?: number;
  plan: ({
    id: string;
    action: "apply" | "skip";
    reason?: string;
  })[];
  [key: string]: unknown;
}

/**
 * POST /api/sites/batch
 */
export interface SiteBatchResponse {
  success: true;
  created: number;
  duplicates: number;
  categoryDegraded: number;
  sites: ({
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
  [key: string]: unknown;
}

/**
 * POST /api/categories/merge
 */
export interface CategoryMergeResponse {
  ok: true;
  movedSites: number;
  removedCategories: number;
  [key: string]: unknown;
}

/**
 * DELETE /api/tags/{id}
 * POST /api/tags/merge
 * POST /api/tags/{id}/aliases
 */
export interface TagMutationResponse {
  ok: true;
  unbound?: number;
  moved?: number;
  alias?: string;
  [key: string]: unknown;
}

/**
 * PUT /api/sites/{id}/relations
 */
export interface RelationsUpdateResponse {
  ok: true;
  siteId: string;
  total: number;
  relations: ({
    id?: string;
    sourceSiteId?: string;
    targetSiteId?: string | null;
    targetTitle: string;
    targetUrl: string;
    relationType: "alternative" | "ecosystem" | "complementary" | "part_of" | "upstream" | "mirror" | "related";
    isFreeOrOpenSource?: boolean;
    note?: string;
    confidence?: number;
  })[];
  [key: string]: unknown;
}

/**
 * POST /api/taxonomy/audit
 */
export interface TaxonomyAuditResponse {
  ok: true;
  dryRun: boolean;
  proposalsCount: number;
  byKind: Record<string, number>;
  proposals: ({
    id: string;
    kind: "categorization_mismatch" | "tag_consolidation" | "zero_result_gap" | "facet_gap" | "category_gap" | "leaf_too_small" | "duplicate_title";
    targetId: string;
    targetTitle?: string;
    currentValue?: string;
    suggestedValue: string;
    confidence: number;
    reason: string;
    status: "pending" | "applied" | "dismissed";
    meta?: Record<string, unknown>;
    createdAt: number;
    appliedAt?: number | null;
    [key: string]: unknown;
  })[];
  [key: string]: unknown;
}

/**
 * POST /api/taxonomy/proposals/{id}/apply
 * POST /api/taxonomy/proposals/{id}/dismiss
 */
export interface TaxonomyProposalMutationResponse {
  ok: true;
  message?: string;
  proposal: {
    id: string;
    kind: "categorization_mismatch" | "tag_consolidation" | "zero_result_gap" | "facet_gap" | "category_gap" | "leaf_too_small" | "duplicate_title";
    targetId: string;
    targetTitle?: string;
    currentValue?: string;
    suggestedValue: string;
    confidence: number;
    reason: string;
    status: "pending" | "applied" | "dismissed";
    meta?: Record<string, unknown>;
    createdAt: number;
    appliedAt?: number | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * POST /api/taxonomy/proposals/batch
 */
export interface TaxonomyBatchResponse {
  ok: true;
  action: "apply" | "dismiss";
  total: number;
  successCount: number;
  failedCount: number;
  errors: string[];
  [key: string]: unknown;
}

/**
 * POST /api/jobs
 */
export interface JobEnqueuedResponse {
  id: string;
  kind: string;
}

/**
 * POST /api/jobs/{id}/cancel
 */
export interface JobCancelResponse {
  ok: true;
  id: string;
  status: "cancelled" | "cancelling";
  abortedLocally: boolean;
}

/**
 * POST /api/jobs/{id}/retry
 */
export interface JobRetryResponse {
  ok: true;
  job: {
    id: string;
    kind: string;
    status: string;
    attempts: number;
    error: string | null;
    createdAt: number;
    updatedAt: number;
    nextRunAt?: number | null;
    progressDone?: number;
    progressTotal?: number;
    [key: string]: unknown;
  };
}

/**
 * POST /api/jobs/prune
 */
export interface JobPruneResponse {
  ok: true;
  pruned: number;
  olderThanDays: number;
}

/**
 * GET /api/tokens
 */
export type ApiTokenListResponse = ({
  id: string;
  name: string;
  scopes: string[];
  ownerIdentity: string | null;
  expiresAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  revokedAt: number | null;
  rotatedAt: number | null;
  tokenPrefix: string | null;
  [key: string]: unknown;
})[];

/**
 * POST /api/tokens
 * POST /api/tokens/{id}/rotate
 */
export interface ApiTokenIssueResponse {
  id: string;
  name: string;
  scopes: string[];
  ownerIdentity: string | null;
  expiresAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  revokedAt: number | null;
  rotatedAt: number | null;
  tokenPrefix: string | null;
  token: string;
  note: string;
  [key: string]: unknown;
}

/**
 * PATCH /api/tokens/{id}
 * POST /api/tokens/{id}/revoke
 */
export interface ApiTokenPayload {
  id: string;
  name: string;
  scopes: string[];
  ownerIdentity: string | null;
  expiresAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  revokedAt: number | null;
  rotatedAt: number | null;
  tokenPrefix: string | null;
  [key: string]: unknown;
}

/**
 * POST /api/submissions
 */
export interface SubmissionCreateResponse {
  success: true;
  message: string;
  siteId: string;
}

/**
 * PATCH /api/submissions/{number}
 */
export interface SubmissionReviewResponse {
  success: true;
  message: string;
  siteId: string;
}

/**
 * POST /api/admin/notifications/read-all
 * POST /api/me/notifications/read-all
 * POST /api/me/notifications/{id}/read
 */
export interface NotificationReadAllResponse {
  ok: true;
  marked: number;
}

/**
 * PATCH /api/plugins/{slug}/featured
 */
export interface PluginFeaturedResponse {
  ok: true;
  plugin: {
    id: string;
    slug: string;
    kind: "site-pack" | "workspace-preset" | "theme" | "search-pack" | "bundle";
    name: string;
    description: string;
    icon: string | null;
    tags: string[];
    author: string | null;
    authorKind: string | null;
    version: string;
    status: string;
    source: string;
    installCount: number;
    starCount: number;
    ratingAvg: number;
    reviewCount: number;
    createdAt: number;
    updatedAt: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * POST /api/shortlinks
 */
export interface ShortlinkCreateResponse {
  success: true;
  code: string;
  path: string;
  target: string;
}

/**
 * GET /api/admin/maintenance/status
 */
export interface MaintenanceStatusResponse {
  ok: boolean;
  dialect: "sqlite" | "pg";
  integrity: string;
  dbSizeBytes: number | null;
  pageCount?: number;
  pageSize?: number;
  freePages?: number;
  tableCounts: Record<string, number>;
  [key: string]: unknown;
}

/**
 * POST /api/admin/maintenance/checkpoint
 * POST /api/admin/maintenance/optimize
 * POST /api/admin/maintenance/vacuum
 */
export interface MaintenanceActionResult {
  ok: boolean;
  tookMs: number;
  message?: string;
  skipped?: boolean;
  logSize?: number;
  [key: string]: unknown;
}

/**
 * GET /api/storage/list
 */
export interface StorageAssetListResponse {
  assets: ({
    references: string[];
    kind: string;
    createdAt: number;
    mime: string | null;
    sha256: string | null;
    width: number | null;
    height: number | null;
    path: string;
    name: string;
    bytes: number;
    updatedAt: number;
    [key: string]: unknown;
  })[];
  limit: number;
}

/**
 * PUT /api/storage
 */
export interface StorageWriteResponse {
  ok: true;
  note: string;
  version?: number;
  [key: string]: unknown;
}

/**
 * DELETE /api/storage
 */
export interface StorageDeleteResponse {
  ok: true;
  path: string;
}

/**
 * POST /api/admin/audit/scan
 */
export interface SiteAuditScanResponse {
  ok: true;
  scanned: number;
  summary: {
    scannedAt: number;
    totalSites: number;
    activeCount: number;
    brokenCount: number;
    healthScore: number;
    issues: {
      siteId: string;
      url: string;
      title: string;
      [key: string]: unknown;
    }[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * POST /api/admin/audit/apply
 */
export interface SiteAuditApplyResponse {
  ok: true;
  action: "wayback" | "replacement" | "dismiss";
  siteId: string;
  [key: string]: unknown;
}

/**
 * POST /api/warmup
 */
export interface WarmupResponse {
  ok: boolean;
  reason?: string;
  tookMs?: number;
  model?: string;
  dim?: number;
  [key: string]: unknown;
}

/**
 * PATCH /api/me/settings
 */
export interface MeSettingsResponse {
  ok: true;
  settings: {
    identity: string;
    personalizationEnabled: boolean;
    favoriteSignalCutoff: number;
    updatedAt: number;
    defaultSearchEngine: "internal" | "google" | "bing" | "duckduckgo" | "github" | "perplexity";
    openLinksInNewTab: boolean;
    cardDensity: "comfortable" | "compact" | "minimal";
    speculativeZeroRttEnabled: boolean;
    daypartSceneEnabled: boolean;
    spotlightShortcut: "mod+k" | "slash" | "both";
    searchHistoryEnabled: boolean;
    telemetryEnabled: boolean;
    historyRetentionDays: 30 | 90 | 180 | 365;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * PATCH /api/me/profile
 */
export interface MeProfileUpdateResponse {
  ok: true;
  user: {
    id: string;
    username: string;
    email: string | null;
    avatar: string | null;
    source: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * POST /api/me/tokens
 */
export interface MeTokenCreateResponse {
  ok: true;
  token: string;
  record: {
    id: string;
    name: string;
    scopes: string[];
    ownerIdentity: string | null;
    expiresAt: number | null;
    lastUsedAt: number | null;
    createdAt: number;
    revokedAt: number | null;
    rotatedAt: number | null;
    tokenPrefix: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * POST /api/me/sessions/check
 */
export interface MeSessionCheckResponse {
  ok: true;
  revoked: boolean;
  [key: string]: unknown;
}

/**
 * POST /api/me/diagnostics
 */
export interface MeDiagnosticsResponse {
  ok: true;
  identity: string;
  repairedCount: number;
  checks: ({
    id: string;
    label: string;
    status: "ok" | "repaired";
    detail: string;
    [key: string]: unknown;
  })[];
  checkedAt: number;
  [key: string]: unknown;
}

/**
 * POST /api/me/prune
 */
export interface MePruneResponse {
  ok: true;
  identity: string;
  pruned: Record<string, number>;
  [key: string]: unknown;
}

/**
 * DELETE /api/me
 */
export interface MeDeleteResponse {
  ok: true;
  deleted: Record<string, number>;
  [key: string]: unknown;
}

/**
 * POST /api/me/merge
 */
export interface MeMergeResponse {
  ok: true;
  alreadyMerged: boolean;
  source: string;
  target: string;
  favoritesMoved: number;
  favoritesSkipped: number;
  foldersMoved: number;
  searchesMoved: number;
  eventsMoved: number;
  pluginsMoved: number;
  starsMoved: number;
  reviewsMoved: number;
  llmConfigMoved: boolean;
  settingsMoved: boolean;
  workspacesMoved: boolean;
  vaultNeedsChoice: boolean;
  [key: string]: unknown;
}

/**
 * POST /api/me/favorites/sync
 */
export interface MeFavoritesSyncResponse {
  ok: true;
  applied: number;
  version: number;
  items: unknown[];
  folders: unknown[];
  truncatedNotes: number;
  [key: string]: unknown;
}

/**
 * POST /api/me/import
 */
export interface MeImportResponse {
  ok: true;
  identity: string;
  foldersImported: number;
  favoritesImported: number;
  favoritesSkipped: number;
  favoritesSkippedMissingSite: number;
  searchesImported: number;
  searchesSkippedDuplicate: number;
  searchesTruncated: number;
  settingsRestored: boolean;
  settingsError: string | null;
  backupHistoryTruncated: boolean;
  historyExportLimit: number;
  historyImportCap: number;
  nextHistoryOffset: number | null;
  starsImported: number;
  starsSkippedDuplicate: number;
  starsSkippedMissing: number;
  reviewsImported: number;
  reviewsSkippedMissing: number;
  reviewsSkippedNotInstalled: number;
  reviewsSkippedInvalid: number;
  favoritesExportLimit: number;
  [key: string]: unknown;
}

/**
 * DELETE /api/profile
 */
export interface ProfileResetResponse {
  ok: true;
  profileCleared: boolean;
  eventsRemoved: number;
  [key: string]: unknown;
}

/**
 * DELETE /api/profile/signals/{kind}
 */
export interface ProfileSignalClearResponse {
  ok: true;
  kind: "click" | "search" | "favorite";
  removed: number;
  profileRebuilt: boolean;
  [key: string]: unknown;
}

/**
 * POST /api/search-history/batch-delete
 */
export interface SearchHistoryBatchDeleteResponse {
  ok: true;
  removed: number;
  [key: string]: unknown;
}

/**
 * POST /api/users/sync
 */
export interface OauthUserSyncResponse {
  id: string;
  username: string;
  email: string | null;
  avatar: string | null;
  source: string;
  [key: string]: unknown;
}

/**
 * POST /api/workspaces
 */
export interface WorkspaceCreateResponse {
  ok: true;
  workspace: {
    id: string;
    name: string;
    slug: string;
    description?: string;
    type: "personal" | "team";
    role: "owner" | "maintainer" | "member" | "viewer";
    icon?: string;
    memberCount: number;
    isDefault?: boolean;
    createdAt: number;
    updatedAt: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * POST /api/workspaces/{id}/members
 * DELETE /api/workspaces/{id}/members/{userId}
 */
export interface WorkspaceMembersResponse {
  ok: true;
  members: ({
    userId: string;
    username: string;
    role: "owner" | "maintainer" | "member" | "viewer";
    joinedAt: number;
    avatar?: string;
    email?: string;
    [key: string]: unknown;
  })[];
  [key: string]: unknown;
}

/**
 * POST /api/speculation/rules
 */
export interface SpeculationRulesResponse {
  ok: true;
  hasRules: boolean;
  rules: unknown | null;
  script: string;
  fallbackTags: unknown[];
  [key: string]: unknown;
}

/**
 * POST /api/account/register
 */
export interface AccountRegisterResponse {
  ok: true;
  user: {
    id: string;
    username: string;
    email: string;
    [key: string]: unknown;
  };
  message: string;
  [key: string]: unknown;
}

/**
 * POST /api/account/verify-email
 * POST /api/account/resend-verification
 * POST /api/account/forgot-password
 * POST /api/account/reset-password
 */
export interface OkMessageResponse {
  ok: true;
  message: string;
  [key: string]: unknown;
}

/**
 * POST /api/account/login
 */
export interface AccountLoginResponse {
  ok: true;
  user: {
    id: string;
    username: string;
    email: string | null;
    role: string;
    emailVerified: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** 路由键 -> 响应类型（前端按端点取类型，避免自己再抄一份接口） */
export interface RestContractRoutes {
  "DELETE /api/admin/client-errors": OkResponse;
  "DELETE /api/categories/{id}": undefined;
  "DELETE /api/collections/{id}": CollectionDeleteResponse;
  "DELETE /api/collections/{id}/items/{siteId}": CollectionItemMutationResponse;
  "DELETE /api/favorites": FavoriteRemovalResponse;
  "DELETE /api/favorites/folders/{id}": OkResponse;
  "DELETE /api/favorites/{siteId}": FavoriteSiteRemovalResponse;
  "DELETE /api/me": MeDeleteResponse;
  "DELETE /api/me/sessions/{id}": OkResponse;
  "DELETE /api/me/tokens/{id}": OkResponse;
  "DELETE /api/plugins/{slug}/install": PluginUninstallResponse;
  "DELETE /api/plugins/{slug}/star": PluginStarResponse;
  "DELETE /api/profile": ProfileResetResponse;
  "DELETE /api/profile/signals/{kind}": ProfileSignalClearResponse;
  "DELETE /api/search-history": OkResponse;
  "DELETE /api/search-history/{id}": OkResponse;
  "DELETE /api/sites/{id}": undefined;
  "DELETE /api/storage": StorageDeleteResponse;
  "DELETE /api/tags/{id}": TagMutationResponse;
  "DELETE /api/tags/{id}/aliases/{alias}": OkResponse;
  "DELETE /api/tokens/{id}": undefined;
  "DELETE /api/trash/{id}": undefined;
  "DELETE /api/workspaces/{id}/members/{userId}": WorkspaceMembersResponse;
  "GET /api/admin/ai/prices": AdminAiPricesResponse;
  "GET /api/admin/maintenance/status": MaintenanceStatusResponse;
  "GET /api/admin/notifications": NotificationListResponse;
  "GET /api/admin/notifications/deliveries": NotificationDeliveryListResponse;
  "GET /api/categories": CategoryListResponse;
  "GET /api/categories/by-slug/{slug}": CategoryPayload;
  "GET /api/categories/counts": CategoryCountsResponse;
  "GET /api/categories/page": CategoryPageResponse;
  "GET /api/categories/{id}": CategoryPayload;
  "GET /api/categories/{id}/impact": CategoryImpactResponse;
  "GET /api/collections": CollectionListResponse;
  "GET /api/collections/{slug}": CollectionDetailResponse;
  "GET /api/facets": FacetsResponse;
  "GET /api/favorites": FavoritesListResponse;
  "GET /api/health": HealthResponse;
  "GET /api/me": MeOverviewResponse;
  "GET /api/me/notifications": NotificationListResponse;
  "GET /api/me/notifications/unread-count": NotificationUnreadCountResponse;
  "GET /api/plugins": PluginListResponse;
  "GET /api/plugins/installed": InstalledPluginsResponse;
  "GET /api/plugins/taps": PluginTapsResponse;
  "GET /api/plugins/taps/public": PublicPluginTapsResponse;
  "GET /api/plugins/{slug}": PluginDetailResponse;
  "GET /api/rank/new": RankNewResponse;
  "GET /api/rank/trending": RankTrendingResponse;
  "GET /api/search": SearchResponse;
  "GET /api/search-history": SearchHistoryPageResponse;
  "GET /api/sites": SiteListResponse;
  "GET /api/sites/{id}": SitePayload;
  "GET /api/sites/{id}/facets": SiteFacetsResponse;
  "GET /api/sites/{id}/similar": SiteListResponse;
  "GET /api/storage/list": StorageAssetListResponse;
  "GET /api/tags": TagListResponse;
  "GET /api/tags/resolve": ResolveTagResponse;
  "GET /api/tags/{id}/related": RelatedTagsResponse;
  "GET /api/tokens": ApiTokenListResponse;
  "GET /api/videos": VideoListResponse;
  "GET /api/videos/{id}": VideoDetailResponse;
  "PATCH /api/categories/{id}": CategoryPayload;
  "PATCH /api/collections/{id}": CollectionPayload;
  "PATCH /api/collections/{id}/items/{siteId}": CollectionItemMutationResponse;
  "PATCH /api/favorites/folders/{id}": FavoriteFolderUpdateResponse;
  "PATCH /api/favorites/{siteId}": FavoriteUpdateResponse;
  "PATCH /api/me/profile": MeProfileUpdateResponse;
  "PATCH /api/me/settings": MeSettingsResponse;
  "PATCH /api/plugins/{slug}/featured": PluginFeaturedResponse;
  "PATCH /api/sites/{id}": SitePayload;
  "PATCH /api/submissions/{number}": SubmissionReviewResponse;
  "PATCH /api/tags/{id}": OkResponse;
  "PATCH /api/tokens/{id}": ApiTokenPayload;
  "POST /api/account/forgot-password": OkMessageResponse;
  "POST /api/account/login": AccountLoginResponse;
  "POST /api/account/register": AccountRegisterResponse;
  "POST /api/account/resend-verification": OkMessageResponse;
  "POST /api/account/reset-password": OkMessageResponse;
  "POST /api/account/verify-email": OkMessageResponse;
  "POST /api/admin/audit/apply": SiteAuditApplyResponse;
  "POST /api/admin/audit/scan": SiteAuditScanResponse;
  "POST /api/admin/maintenance/checkpoint": MaintenanceActionResult;
  "POST /api/admin/maintenance/optimize": MaintenanceActionResult;
  "POST /api/admin/maintenance/vacuum": MaintenanceActionResult;
  "POST /api/admin/notifications/read-all": NotificationReadAllResponse;
  "POST /api/categories": CategoryPayload;
  "POST /api/categories/merge": CategoryMergeResponse;
  "POST /api/categories/{id}/move": CategoryPayload;
  "POST /api/collections": CollectionPayload;
  "POST /api/collections/{id}/items": CollectionItemMutationResponse;
  "POST /api/errors": undefined;
  "POST /api/events": OkResponse;
  "POST /api/favorites": FavoriteCreateResponse;
  "POST /api/favorites/folders": FavoriteFolderPayload;
  "POST /api/jobs": JobEnqueuedResponse;
  "POST /api/jobs/prune": JobPruneResponse;
  "POST /api/jobs/{id}/cancel": JobCancelResponse;
  "POST /api/jobs/{id}/retry": JobRetryResponse;
  "POST /api/me/diagnostics": MeDiagnosticsResponse;
  "POST /api/me/favorites/sync": MeFavoritesSyncResponse;
  "POST /api/me/import": MeImportResponse;
  "POST /api/me/merge": MeMergeResponse;
  "POST /api/me/notifications/read-all": NotificationReadAllResponse;
  "POST /api/me/notifications/{id}/read": NotificationReadAllResponse;
  "POST /api/me/prune": MePruneResponse;
  "POST /api/me/sessions/check": MeSessionCheckResponse;
  "POST /api/me/tokens": MeTokenCreateResponse;
  "POST /api/plugins/{slug}/install": PluginInstallResponse;
  "POST /api/plugins/{slug}/star": PluginStarResponse;
  "POST /api/plugins/{slug}/uninstall": PluginUninstallResponse;
  "POST /api/search": SearchResponse;
  "POST /api/search-history/batch-delete": SearchHistoryBatchDeleteResponse;
  "POST /api/shortlinks": ShortlinkCreateResponse;
  "POST /api/sites": SitePayload;
  "POST /api/sites/batch": SiteBatchResponse;
  "POST /api/sites/bulk": SiteBulkResponse;
  "POST /api/speculation/rules": SpeculationRulesResponse;
  "POST /api/submissions": SubmissionCreateResponse;
  "POST /api/tags/merge": TagMutationResponse;
  "POST /api/tags/{id}/aliases": TagMutationResponse;
  "POST /api/taxonomy/audit": TaxonomyAuditResponse;
  "POST /api/taxonomy/proposals/batch": TaxonomyBatchResponse;
  "POST /api/taxonomy/proposals/{id}/apply": TaxonomyProposalMutationResponse;
  "POST /api/taxonomy/proposals/{id}/dismiss": TaxonomyProposalMutationResponse;
  "POST /api/tokens": ApiTokenIssueResponse;
  "POST /api/tokens/{id}/revoke": ApiTokenPayload;
  "POST /api/tokens/{id}/rotate": ApiTokenIssueResponse;
  "POST /api/trash/{id}/restore": SitePayload;
  "POST /api/users/sync": OauthUserSyncResponse;
  "POST /api/vitals": undefined;
  "POST /api/warmup": WarmupResponse;
  "POST /api/workspaces": WorkspaceCreateResponse;
  "POST /api/workspaces/{id}/members": WorkspaceMembersResponse;
  "PUT /api/sites/{id}/facets": SiteFacetsResponse;
  "PUT /api/sites/{id}/relations": RelationsUpdateResponse;
  "PUT /api/storage": StorageWriteResponse;
}
