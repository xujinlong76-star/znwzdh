import type {
  Category,
  Collection,
  Site,
  SiteAction,
  SiteLiveMetrics,
  SiteRelation,
  SiteStatus,
  TaxonomyProposal,
  TaxonomyProposalKind,
  TaxonomyProposalStatus,
} from "@navhub/core";
export type { TaxonomyProposal, TaxonomyProposalKind, TaxonomyProposalStatus };
import type { Db, Dialect } from "../driver.ts";

export interface SiteInput {
  url: string;
  title?: string;
  description?: string | null;
  categoryId: string;
  subCategoryId?: string | null;
  iconKey?: string | null;
  tags?: string[];
  status?: SiteStatus;
  enabled?: boolean;
  sort?: number;
  featured?: boolean;
  source?: string | null;
  actions?: SiteAction[];
  relations?: SiteRelation[];
  liveMetrics?: SiteLiveMetrics;
  workspaces?: string[];
  facets?: Record<string, string[]>;
  metadata?: Record<string, unknown>;
}

/* ------------------------- 新领域记录类型 ------------------------- */

export interface DashboardOverview {
  overview: {
    totalSites: number;
    activeSites: number;
    brokenSites: number;
    pendingSites: number;
    archivedSites: number;
    trashedSites: number;
    categories: number;
    tags: number;
    collections: number;
    favorites: number;
  };
  metrics24h: {
    newSites: number;
    healthChecks: number;
    healthFailed: number;
    healthRate: number | null;
    avgLatencyMs: number | null;
    jobsTotal: number;
    jobsCompleted: number;
    jobsFailed: number;
    jobsPending: number;
    jobsRunning: number;
    auditLogs: number;
    authFailures: number;
    eventsTotal: number;
    searches: number;
    clicks: number;
    zeroResults: number;
  };
  storage: {
    dbSizeBytes: number | null;
    walSizeBytes: number | null;
    tableCounts: Record<string, number>;
  };
}

export interface CategoryDistributionItem {
  id: string;
  title: string;
  icon: string | null;
  siteCount: number;
  percentage: number;
  brokenCount?: number;
}

export interface CategorySemanticDetail {
  category: Category;
  related: Array<{
    id: string;
    title: string;
    titleEn?: string | null;
    icon?: string | null;
    siteCount: number;
  }>;
}

export interface SiteKnowledgeGraph {
  centerSiteId: string;
  nodes: Array<{
    id: string;
    title: string;
    url: string;
    iconKey?: string | null;
    categoryId?: string;
    categoryTitle?: string;
    isCenter?: boolean;
  }>;
  edges: Array<{
    source: string;
    target: string;
    relationType: string;
    labelZh: string;
    symmetric: boolean;
    note?: string;
  }>;
}

export interface MatchedSiteRelation extends SiteRelation {
  sourceSite: Site | null;
}


export interface SecurityOverview {
  recentFailures: Array<{ action: string; ip: string | null; count: number; lastAt: number }>;
  totalAuthFailures24h: number;
  recentAudits: Array<{ id: number; actor: string; actorKind: string; action: string; target: string | null; createdAt: number }>;
  tokenStats: {
    total: number;
    active: number;
    expired: number;
    revoked: number;
  };
}

export interface FavoriteRecord {
  id: string;
  userId: string;
  siteId: string;
  folderId: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FavoriteFolderRecord {
  id: string;
  userId: string;
  name: string;
  sort: number;
  createdAt: number;
}

export interface UserProfileRecord {
  userId: string;
  topCategories: string[];
  topTags: string[];
  visitedSiteIds: string[];
  favoriteSiteIds: string[];
  searchCount: number;
  updatedAt: number;
}

export interface UserVaultRecord {
  userId: string;
  payload: string;
  version: number;
  updatedAt: number;
}

export interface UserRecord {
  id: string;
  username: string;
  role: string;
  email: string | null;
  avatar: string | null;
  source: string;
}

/** API token 记录（**不含 token_hash 明文**——哈希只在查询入参里出现，不进返回值） */
export interface ApiTokenRecord {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  /**
   * 软吊销时间戳。非 null = 已停用，鉴权一律拒绝。
   *
   * 为什么要有"停用"而不是只有"删除"：审核日志里 token 是以 id 记录的，
   * 硬删之后 audit_logs.target 变成悬空 id，"哪条凭据做过什么"就永远查不到了。
   */
  revokedAt: number | null;
  /** 上次轮换时间；null = 从未轮换。轮换**不**重写 created_at */
  rotatedAt: number | null;
  /** 明文前缀（如 nh_1a2b3c），仅用于列表区分凭据 */
  tokenPrefix: string | null;
}

/** 审计日志记录；diff 已解析（库里存的是 JSON 文本） */
export interface AuditLogRecord {
  id: number;
  actor: string;
  actorKind: string;
  action: string;
  target: string | null;
  diff: unknown;
  ip: string | null;
  createdAt: number;
}

export interface JobRecord {
  id: string;
  kind: string;
  payload: unknown;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  /** 下次可被认领的时间（退避中任务的 pending 到点时间；NULL = 立即可认领） */
  nextRunAt: number | null;
}

export interface TagWithCount {
  id: string;
  name: string;
  slug: string;
  count: number;
  group: string;
  color?: string | null;
  description?: string | null;
  aliases: string[];
}

export interface TagAliasRecord {
  alias: string;
  tagId: string;
  createdAt: number;
}

export interface SiteFacetRecord {
  siteId: string;
  facetKey: string;
  facetValue: string;
}

export interface FacetCountRecord {
  facetKey: string;
  facetValue: string;
  count: number;
}

export interface MaintenanceStatus {
  ok: boolean;
  dialect: Dialect;
  integrity: string;
  dbSizeBytes: number | null;
  pageCount?: number;
  pageSize?: number;
  freePages?: number;
  tableCounts: Record<string, number>;
}
