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

/** 路由键 -> 响应类型（前端按端点取类型，避免自己再抄一份接口） */
export interface RestContractRoutes {
  "DELETE /api/collections/{id}": CollectionDeleteResponse;
  "DELETE /api/collections/{id}/items/{siteId}": CollectionItemMutationResponse;
  "DELETE /api/favorites": FavoriteRemovalResponse;
  "DELETE /api/favorites/folders/{id}": OkResponse;
  "DELETE /api/favorites/{siteId}": FavoriteSiteRemovalResponse;
  "DELETE /api/plugins/{slug}/install": PluginUninstallResponse;
  "GET /api/admin/notifications": NotificationListResponse;
  "GET /api/admin/notifications/deliveries": NotificationDeliveryListResponse;
  "GET /api/categories": CategoryListResponse;
  "GET /api/categories/counts": CategoryCountsResponse;
  "GET /api/categories/page": CategoryPageResponse;
  "GET /api/categories/{id}/impact": CategoryImpactResponse;
  "GET /api/collections": CollectionListResponse;
  "GET /api/collections/{slug}": CollectionDetailResponse;
  "GET /api/favorites": FavoritesListResponse;
  "GET /api/health": HealthResponse;
  "GET /api/me": MeOverviewResponse;
  "GET /api/me/notifications": NotificationListResponse;
  "GET /api/me/notifications/unread-count": NotificationUnreadCountResponse;
  "GET /api/plugins": PluginListResponse;
  "GET /api/plugins/installed": InstalledPluginsResponse;
  "GET /api/plugins/taps": PluginTapsResponse;
  "GET /api/plugins/taps/public": PublicPluginTapsResponse;
  "GET /api/rank/new": RankNewResponse;
  "GET /api/rank/trending": RankTrendingResponse;
  "GET /api/search": SearchResponse;
  "GET /api/search-history": SearchHistoryPageResponse;
  "GET /api/sites": SiteListResponse;
  "GET /api/sites/{id}": SitePayload;
  "GET /api/tags": TagListResponse;
  "GET /api/videos": VideoListResponse;
  "GET /api/videos/{id}": VideoDetailResponse;
  "PATCH /api/collections/{id}": CollectionPayload;
  "PATCH /api/collections/{id}/items/{siteId}": CollectionItemMutationResponse;
  "PATCH /api/favorites/folders/{id}": FavoriteFolderUpdateResponse;
  "PATCH /api/favorites/{siteId}": FavoriteUpdateResponse;
  "PATCH /api/sites/{id}": SitePayload;
  "POST /api/collections": CollectionPayload;
  "POST /api/collections/{id}/items": CollectionItemMutationResponse;
  "POST /api/favorites": FavoriteCreateResponse;
  "POST /api/favorites/folders": FavoriteFolderPayload;
  "POST /api/plugins/{slug}/install": PluginInstallResponse;
  "POST /api/plugins/{slug}/star": PluginStarResponse;
  "POST /api/plugins/{slug}/uninstall": PluginUninstallResponse;
  "POST /api/search": SearchResponse;
  "POST /api/sites": SitePayload;
}
